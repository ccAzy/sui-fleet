package cmd

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"runtime/debug"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/alireza0/s-ui/config"
	"github.com/alireza0/s-ui/core"
	"github.com/alireza0/s-ui/database"
	"github.com/alireza0/s-ui/database/model"
	"github.com/alireza0/s-ui/logger"
	"github.com/alireza0/s-ui/service"

	"github.com/op/go-logging"
)

// ---------------------------------------------------------------------------
// agent 模式：节点侧不再暴露面板，只做三件事
//   1) 定时向面板 pull 期望配置（对象快照）
//   2) 快照落地本地 SQLite，调 s-ui 原生逻辑渲染并重启 sing-box
//   3) 定时上报流量增量 / 在线 / 状态，并回执下发的指令
// 方向永远是"节点出站"，面板不需要能连到节点。
// ---------------------------------------------------------------------------

const agentRevKey = "agent_revision"

type agentPullResp struct {
	OK        bool                       `json:"ok"`
	Unchanged bool                       `json:"unchanged"`
	Revision  int64                      `json:"revision"`
	Node      struct{ ID, Name string }  `json:"node"`
	Config    json.RawMessage            `json:"config"`
	Settings  map[string]string          `json:"settings"`
	Inbounds  []json.RawMessage          `json:"inbounds"`
	Outbounds []json.RawMessage          `json:"outbounds"`
	Endpoints []json.RawMessage          `json:"endpoints"`
	Services  []json.RawMessage          `json:"services"`
	TLS       []json.RawMessage          `json:"tls"`
	Clients   []json.RawMessage          `json:"clients"`
	Commands  []agentCommand             `json:"commands"`
}

type agentCommand struct {
	ID      int64           `json:"id"`
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload"`
}

type trafficDelta struct {
	Tag  string `json:"tag"`
	Up   int64  `json:"up"`
	Down int64  `json:"down"`
}

type reportBody struct {
	RevisionApplied int64                       `json:"revision_applied"`
	AgentVersion    string                      `json:"agent_version"`
	KernelVersion   string                      `json:"kernel_version"`
	CoreState       string                      `json:"core_state"`
	Uptime          int64                       `json:"uptime"`
	Status          map[string]interface{}      `json:"status"`
	Traffic         []trafficDelta              `json:"traffic"`
	Commands        []map[string]interface{}    `json:"commands"`
	LastLog         string                      `json:"last_log,omitempty"`
}

type agent struct {
	panel    string
	token    string
	interval time.Duration
	client   *http.Client

	coreSvc *service.ConfigService
	rev     int64
	started time.Time
	mu      sync.Mutex

	// 内核是否已经成功拉起过。首轮 pull 失败（开机瞬间 DNS/网络没就绪）时，
	// force 只生效一次，之后每轮都是 force=false，于是「revision 没变」→ 内核永远不启动，
	// 节点看.着在线却完全不可用，只能靠人工改一次面板或重启进程才能恢复。
	// 所以把「还没拉起过」本身当成持续为真的 force 条件。
	coreStarted bool

	// 收到 update_agent 并成功替换二进制后，上报完回执就重启自己
	restartSelf bool
}

func agentCmd(args []string) {
	fs := flag.NewFlagSet("agent", flag.ExitOnError)
	panel := fs.String("panel", os.Getenv("SUI_PANEL"), "panel base url, e.g. https://panel.example.com")
	token := fs.String("token", os.Getenv("SUI_AGENT_TOKEN"), "agent token issued by the panel")
	interval := fs.Int("interval", 30, "pull/report interval in seconds")
	noCore := fs.Bool("no-core", false, "only sync data, do not start sing-box (debug)")
	dumpCfg := fs.Bool("dump-config", false, "print the rendered sing-box config from local db and exit")
	_ = fs.Parse(args)

	if *panel == "" || *token == "" {
		fmt.Fprintln(os.Stderr, "agent: --panel and --token are required")
		os.Exit(2)
	}

	a := &agent{
		panel:    *panel,
		token:    *token,
		interval: time.Duration(*interval) * time.Second,
		client:   &http.Client{Timeout: 30 * time.Second},
		started:  time.Now(),
	}
	if a.interval < 5*time.Second {
		a.interval = 5 * time.Second
	}

	initAgentLog()

	if err := database.InitDB(config.GetDBPath()); err != nil {
		fmt.Fprintln(os.Stderr, "agent: init db:", err)
		os.Exit(1)
	}
	settingSvc := &service.SettingService{}
	if _, err := settingSvc.GetAllSetting(); err != nil {
		fmt.Fprintln(os.Stderr, "agent: load settings:", err)
		os.Exit(1)
	}
	a.rev = loadLocalRevision()

	if *dumpCfg {
		svc := service.NewConfigService(core.NewCore())
		raw, err := svc.GetConfig("")
		if err != nil {
			fmt.Fprintln(os.Stderr, "render config:", err)
			os.Exit(1)
		}
		fmt.Println(string(*raw))
		return
	}

	if !*noCore {
		c := core.NewCore()
		a.coreSvc = service.NewConfigService(c)
	}

	fmt.Printf("agent: panel=%s interval=%s local_revision=%d\n", a.panel, a.interval, a.rev)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	ticker := time.NewTicker(a.interval)
	defer ticker.Stop()

	// 首轮强制拉起内核：agent 重启（含整机重启）后本地 revision 往往与面板一致，
	// applied 会是 false，只靠 applied 判断就永远不会启动 sing-box —— 端口全空、
	// 节点看起来在线但完全不可用。force 保证首轮一定确保内核在跑。
	a.cycle(!*noCore, true)
	for {
		select {
		case <-stop:
			fmt.Println("agent: stopping")
			if a.coreSvc != nil {
				_ = a.coreSvc.StopCore()
			}
			return
		case <-ticker.C:
			a.cycle(!*noCore, false)
		}
	}
}

// initAgentLog 必须在 core.NewCore() 之前调用：registries 在缺 feature 时会走
// logger.Error，而 logger 未初始化时会空指针崩掉整个进程。
func initAgentLog() {
	switch config.GetLogLevel() {
	case config.Debug:
		logger.InitLogger(logging.DEBUG)
	case config.Info:
		logger.InitLogger(logging.INFO)
	case config.Warn:
		logger.InitLogger(logging.WARNING)
	case config.Error:
		logger.InitLogger(logging.ERROR)
	default:
		logger.InitLogger(logging.INFO)
	}
}

func (a *agent) cycle(withCore bool, force bool) {
	// 只要内核还没成功跑起来过，每一轮都当首轮（force）重试，直到成功。
	if withCore && !a.coreStarted {
		force = true
	}
	applied, cmds, err := a.pullOnce()
	if err != nil {
		fmt.Fprintln(os.Stderr, "agent: pull:", err)
	} else if withCore && a.coreSvc != nil && (applied || force) {
		if err := a.restartCore(); err != nil {
			fmt.Fprintln(os.Stderr, "agent: restart core:", err)
		}
	}
	if err := a.reportOnce(cmds); err != nil {
		fmt.Fprintln(os.Stderr, "agent: report:", err)
	}
	if a.restartSelf {
		a.execSelf()
	}
}

func (a *agent) restartCore() error {
	if a.coreSvc == nil {
		return nil
	}
	if err := a.coreSvc.RestartCore(); err != nil {
		return err
	}
	a.mu.Lock()
	a.coreStarted = true
	a.mu.Unlock()
	fmt.Println("agent: sing-box restarted with new config")
	return nil
}

// pullOnce 拉取并落地配置。返回是否应用了新配置，以及本轮要回执的指令结果。
func (a *agent) pullOnce() (bool, []map[string]interface{}, error) {
	a.mu.Lock()
	rev := a.rev
	a.mu.Unlock()

	body, _ := json.Marshal(map[string]int64{"revision": rev})
	resp, err := a.do("POST", "/agent/pull", body)
	if err != nil {
		return false, nil, err
	}
	var pr agentPullResp
	if err := json.Unmarshal(resp, &pr); err != nil {
		return false, nil, fmt.Errorf("decode pull: %w", err)
	}
	if !pr.OK {
		return false, nil, fmt.Errorf("panel rejected pull")
	}

	results := a.runCommands(pr.Commands)

	if pr.Unchanged {
		return false, results, nil
	}
	if err := a.apply(&pr); err != nil {
		return false, results, fmt.Errorf("apply config: %w", err)
	}

	a.mu.Lock()
	a.rev = pr.Revision
	a.mu.Unlock()
	saveLocalRevision(pr.Revision)
	fmt.Printf("agent: applied revision %d (inbounds=%d clients=%d)\n", pr.Revision, len(pr.Inbounds), len(pr.Clients))
	return true, results, nil
}

// apply 全量替换本地配置并落盘。s-ui 的 model 自带拆列逻辑，
// 因此这里反序列化后直接入库即可，渲染仍由 s-ui 原生代码完成。
//
// 注意：必须保留面板下发的 id，不能置零交给 GORM 自增。
// inbound.tls_id / client.inbounds 等关联字段引用的是面板侧的 obj_id，
// 每次 revision 都 DELETE + INSERT，自增序列会持续增长，
// 一旦 id 与关联字段脱节，就会出现「hysteria2 拿到 reality 私钥」
// 「vless 丢失 TLS」这类错位，内核直接起不来。
func (a *agent) apply(pr *agentPullResp) error {
	db := database.GetDB()
	tx := db.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	fail := func(err error) error {
		tx.Rollback()
		return err
	}

	for _, table := range []string{"inbounds", "outbounds", "endpoints", "services", "tls", "clients"} {
		if err := tx.Exec("DELETE FROM " + table).Error; err != nil {
			return fail(err)
		}
	}

	for _, raw := range pr.TLS {
		var m model.Tls
		if err := json.Unmarshal(raw, &m); err != nil {
			return fail(fmt.Errorf("tls: %w", err))
		}
		if err := tx.Create(&m).Error; err != nil {
			return fail(fmt.Errorf("tls create: %w", err))
		}
	}
	for _, raw := range pr.Inbounds {
		var m model.Inbound
		if err := json.Unmarshal(raw, &m); err != nil {
			return fail(fmt.Errorf("inbound: %w", err))
		}
		if err := tx.Create(&m).Error; err != nil {
			return fail(fmt.Errorf("inbound create: %w", err))
		}
	}
	for _, raw := range pr.Outbounds {
		var m model.Outbound
		if err := json.Unmarshal(raw, &m); err != nil {
			return fail(fmt.Errorf("outbound: %w", err))
		}
		if err := tx.Create(&m).Error; err != nil {
			return fail(fmt.Errorf("outbound create: %w", err))
		}
	}
	for _, raw := range pr.Endpoints {
		var m model.Endpoint
		if err := json.Unmarshal(raw, &m); err != nil {
			return fail(fmt.Errorf("endpoint: %w", err))
		}
		if err := tx.Create(&m).Error; err != nil {
			return fail(fmt.Errorf("endpoint create: %w", err))
		}
	}
	for _, raw := range pr.Services {
		var m model.Service
		if err := json.Unmarshal(raw, &m); err != nil {
			return fail(fmt.Errorf("service: %w", err))
		}
		if err := tx.Create(&m).Error; err != nil {
			return fail(fmt.Errorf("service create: %w", err))
		}
	}
	for _, raw := range pr.Clients {
		var m model.Client
		if err := json.Unmarshal(raw, &m); err != nil {
			return fail(fmt.Errorf("client: %w", err))
		}
		if err := tx.Create(&m).Error; err != nil {
			return fail(fmt.Errorf("client create: %w", err))
		}
	}

	// 防御：route 里 final 常指向 direct，若面板没托管这个出站，
	// 内核会以 "default outbound not found: direct" 起不来。
	var directCount int64
	if err := tx.Model(&model.Outbound{}).Where("tag = ?", "direct").Count(&directCount).Error; err == nil && directCount == 0 {
		if err := tx.Create(&model.Outbound{Type: "direct", Tag: "direct", Options: json.RawMessage(`{}`)}).Error; err != nil {
			return fail(err)
		}
	}

	if len(pr.Config) > 0 && string(pr.Config) != "null" {
		if err := (&service.SettingService{}).SaveConfig(tx, pr.Config); err != nil {
			return fail(fmt.Errorf("save config: %w", err))
		}
	}
	for k, v := range pr.Settings {
		if k == "config" {
			continue
		}
		var cnt int64
		tx.Model(&model.Setting{}).Where("key = ?", k).Count(&cnt)
		if cnt == 0 {
			if err := tx.Create(&model.Setting{Key: k, Value: v}).Error; err != nil {
				return fail(err)
			}
		} else if err := tx.Model(&model.Setting{}).Where("key = ?", k).Update("value", v).Error; err != nil {
			return fail(err)
		}
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}
	return nil
}

func (a *agent) runCommands(cmds []agentCommand) []map[string]interface{} {
	results := make([]map[string]interface{}, 0, len(cmds))
	for _, c := range cmds {
		ok := true
		msg := ""
		switch c.Kind {
		case "restart_core":
			if a.coreSvc != nil {
				if err := a.coreSvc.RestartCore(); err != nil {
					ok, msg = false, err.Error()
				}
			}
		case "stop_core":
			if a.coreSvc != nil {
				if err := a.coreSvc.StopCore(); err != nil {
					ok, msg = false, err.Error()
				}
			}
		case "update_agent":
			if err := a.selfUpdate(c.Payload); err != nil {
				ok, msg = false, err.Error()
			}

		case "reset_traffic":
			if err := database.GetDB().Model(&model.Client{}).Where("1 = 1").Updates(map[string]interface{}{"up": 0, "down": 0}).Error; err != nil {
				ok, msg = false, err.Error()
			}
		default:
			ok, msg = false, "unknown command: "+c.Kind
		}
		results = append(results, map[string]interface{}{"id": c.ID, "ok": ok, "error": msg})
		if len(cmds) > 0 {
			fmt.Printf("agent: command %s id=%d ok=%v %s\n", c.Kind, c.ID, ok, msg)
		}
	}
	return results
}

func (a *agent) reportOnce(cmdResults []map[string]interface{}) error {
	status := map[string]interface{}{}
	if c := service.CoreInstance(); c != nil {
		status["running"] = c.IsRunning()
	}
	svc := &service.ServerService{}
	raw := svc.GetStatus("cpu,mem,dsk,swp,net,sys,sbd")
	if raw != nil {
		for k, v := range *raw {
			status[k] = v
		}
	}
	status["onlines"] = collectOnlines()

	traffic := collectTraffic()

	coreState := "stopped"
	if c := service.CoreInstance(); c != nil {
		if c.IsRunning() {
			coreState = "running"
		} else {
			coreState = "error"
		}
	}

	body := reportBody{
		RevisionApplied: a.currentRev(),
		AgentVersion:    config.GetVersion(),
		KernelVersion:   kernelVersion(),
		CoreState:       coreState,
		Uptime:          int64(time.Since(a.started).Seconds()),
		Status:          status,
		Traffic:         traffic,
		Commands:        cmdResults,
	}
	if coreState != "running" {
		if logs := svc.GetLogs("1", "error"); len(logs) > 0 {
			body.LastLog = logs[0]
		}
	}

	payload, _ := json.Marshal(body)
	_, err := a.do("POST", "/agent/report", payload)
	return err
}

// collectTraffic 取内核计数器增量（GetStats 内部会 swap(0)），按客户端聚合。
func collectTraffic() []trafficDelta {
	if box := coreInstance(); box != nil {
		if st := box.StatsTracker(); st != nil {
			stats := st.GetStats()
			agg := map[string]*trafficDelta{}
			for _, s := range *stats {
				if s.Resource != "user" {
					continue
				}
				d, ok := agg[s.Tag]
				if !ok {
					d = &trafficDelta{Tag: s.Tag}
					agg[s.Tag] = d
				}
				if s.Direction {
					d.Up += s.Traffic
				} else {
					d.Down += s.Traffic
				}
			}
			out := make([]trafficDelta, 0, len(agg))
			for _, d := range agg {
				out = append(out, *d)
			}
			return out
		}
	}
	return nil
}

// collectOnlines 采集"当前在线"的入站/出站/用户。
//
// 不能用 StatsTracker().GetStats()：那个函数对每个计数器做 Swap(0)（读一次就清零），
// 而 s-ui 自己的流量统计定时任务（cronjob/statsJob.go → SaveStats）也在消费同一份数据，
// 谁先读谁拿到，后读的永远是空 —— 面板上那三个数字因此长期为 0。
//
// 改为读 sing-box 的 clash-api /connections：它返回的是**当前活跃连接**，
// 语义上才是"在线"，而且不会被谁消费掉。
func collectOnlines() map[string][]string {
	on := map[string][]string{"inbound": {}, "outbound": {}, "user": {}}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:9090/connections")
	if err != nil {
		return on
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return on
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return on
	}

	var payload struct {
		Connections []struct {
			Metadata struct {
				Inbound string `json:"inbound"`
				User    string `json:"user"`
			} `json:"metadata"`
			Chains []string `json:"chains"`
		} `json:"connections"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return on
	}

	seen := map[string]map[string]bool{"inbound": {}, "outbound": {}, "user": {}}
	add := func(kind, tag string) {
		if tag == "" || seen[kind][tag] {
			return
		}
		seen[kind][tag] = true
		on[kind] = append(on[kind], tag)
	}
	for _, c := range payload.Connections {
		add("inbound", c.Metadata.Inbound)
		add("user", c.Metadata.User)
		// chains 形如 [入站tag, 出站tag, ...]，最后一个是最终出站
		if n := len(c.Chains); n > 0 {
			add("outbound", c.Chains[n-1])
		}
	}
	return on
}

// coreInstance 拿到当前 sing-box 实例（经 service 包导出的进程级句柄）。
func coreInstance() *core.Box {
	if c := service.CoreInstance(); c != nil {
		return c.GetInstance()
	}
	return nil
}

type updatePayload struct {
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Version string `json:"version"`
}

// selfUpdate 下载新二进制 → 校验 sha256 → 原子替换自身 → 标记重启。
// 任何一步失败都保留原二进制并继续运行，避免把节点搞失联。
func (a *agent) selfUpdate(raw json.RawMessage) error {
	var p updatePayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return fmt.Errorf("bad payload: %w", err)
	}
	if p.URL == "" {
		return errors.New("missing download url")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, _ = filepath.EvalSymlinks(exe)

	// 大文件下载单独用长超时，不复用 30s 的 API client
	dl := &http.Client{Timeout: 10 * time.Minute}
	resp, err := dl.Get(p.URL)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download: %s", resp.Status)
	}

	tmp := exe + ".new"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(f, h), resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return fmt.Errorf("write: %w", err)
	}
	f.Close()

	if p.SHA256 != "" {
		got := hex.EncodeToString(h.Sum(nil))
		if !strings.EqualFold(got, p.SHA256) {
			os.Remove(tmp)
			return fmt.Errorf("sha256 mismatch: got %s", got)
		}
	}
	if err := os.Chmod(tmp, 0o755); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, exe); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("replace binary: %w", err)
	}

	fmt.Printf("agent: binary replaced (%s), restarting after report%c", p.Version, 10)
	a.restartSelf = true
	return nil
}

// execSelf 用新二进制重新执行自己（systemd 下也能正常接管）。
func (a *agent) execSelf() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "agent: exec self:", err)
		os.Exit(0)
	}
	exe, _ = filepath.EvalSymlinks(exe)
	fmt.Println("agent: re-exec", exe)
	if err := syscall.Exec(exe, os.Args, os.Environ()); err != nil {
		fmt.Fprintln(os.Stderr, "agent: exec failed, exiting for supervisor restart:", err)
		os.Exit(0)
	}
}

// kernelVersion 返回编译进二进制的 sing-box 版本（面板据此判断内核是否需要升级）。
func kernelVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, dep := range info.Deps {
		if dep.Path == "github.com/sagernet/sing-box" {
			return dep.Version
		}
	}
	return ""
}

func (a *agent) currentRev() int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.rev
}

func (a *agent) do(method, path string, body []byte) ([]byte, error) {
	url := a.panel + path
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", resp.Status, string(data))
	}
	return data, nil
}

func loadLocalRevision() int64 {
	var s model.Setting
	if err := database.GetDB().Where("key = ?", agentRevKey).First(&s).Error; err != nil {
		return 0
	}
	v, _ := strconv.ParseInt(s.Value, 10, 64)
	return v
}

func saveLocalRevision(rev int64) {
	db := database.GetDB()
	var s model.Setting
	err := db.Where("key = ?", agentRevKey).First(&s).Error
	if err != nil {
		_ = db.Create(&model.Setting{Key: agentRevKey, Value: strconv.FormatInt(rev, 10)}).Error
		return
	}
	_ = db.Model(&model.Setting{}).Where("key = ?", agentRevKey).Update("value", strconv.FormatInt(rev, 10)).Error
}
