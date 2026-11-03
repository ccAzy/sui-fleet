package core

// 端口跳跃（port hopping）的服务端一半。
//
// 为什么需要这个文件：sing-box 的 inbound **没有** mport 字段 ——
// `mport` 只是客户端的事（hysteria2 链接参数 / sing-box outbound 的 server_ports）。
// 服务端必须在整段 UDP 端口上做 NAT，把 40000-42000 全转到真正的监听端口，
// 否则客户端跳到别的端口就直接丢包。
//
// 面板侧不需要新字段：入站编辑里的「拨号」(out_json) 已经能填 server_ports，
// links.ts 也已读它生成 mport=... 的分享链接。缺的正是这一段。
//
// 2026-11 调整：改用 iptables 而不是 nft。
// 原因：这些节点上早就存在历史 dnat 规则（我们自己早期脚本配的），
// 持久化在 /etc/iptables/rules.v4，由 netfilter-persistent 开机恢复；
// 而历史规则是 iptables 格式。nft(inet) 与 iptables(ip nat) 都挂
// prerouting/dstnat，谁先命中取决于内核注册顺序、不可控 →
// 会出现「面板改了端口但实际走老规则」的鬼故事。
// 统一到 iptables，并且把自己的链插到 PREROUTING 第 1 位，顺序就确定了。
//
// 设计约束：
//   1. 独立链 SUI_HOP，每次全量重建（flush 后重加），幂等；
//      不碰别人的规则，只保证自己在最前面。
//   2. 失败只告警，绝不阻断内核启动 —— 端口跳跃是增强功能。
//   3. 立即 iptables-save 持久化：重启后规则还在，不依赖 agent 再跑一次。

import (
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"

	"github.com/alireza0/s-ui/database"
	"github.com/alireza0/s-ui/database/model"
	"github.com/alireza0/s-ui/logger"
)

const hopChain = "SUI_HOP"

type hopRule struct {
	dport  string // iptables 语法：40000:42000
	target int    // 入站真实监听端口
}

// syncPortHopping 根据本地库里的入站配置重建端口跳跃规则。
func syncPortHopping() {
	rules := collectHopRules()

	// 链不存在时先建（已存在会报错，忽略）
	_ = run("iptables", "-t", "nat", "-N", hopChain)
	// 全量清空，幂等
	if err := run("iptables", "-t", "nat", "-F", hopChain); err != nil {
		logger.Warning("端口跳跃：清空", hopChain, "失败（不影响内核运行）:", err.Error())
		return
	}

	for _, r := range rules {
		if err := run("iptables", "-t", "nat", "-A", hopChain,
			"-p", "udp", "--dport", r.dport,
			"-j", "DNAT", "--to-destination", ":"+strconv.Itoa(r.target)); err != nil {
			logger.Warning("端口跳跃：添加规则失败", r.dport, "->", r.target, err.Error())
			return
		}
	}

	// 把自己挂到 PREROUTING 第 1 位：先清掉历史挂载再插最前，顺序才确定。
	// （-D 可能有多条，循环删到没有为止；不存在时 iptables 返回非 0，忽略）
	for i := 0; i < 5; i++ {
		if run("iptables", "-t", "nat", "-D", "PREROUTING", "-j", hopChain) != nil {
			break
		}
	}
	if len(rules) > 0 {
		if err := run("iptables", "-t", "nat", "-I", "PREROUTING", "1", "-j", hopChain); err != nil {
			logger.Warning("端口跳跃：挂载 PREROUTING 失败（不影响内核运行）:", err.Error())
			return
		}
	}

	// 持久化：netfilter-persistent 存在才保存（Debian/Ubuntu 标准）。
	// 失败只告警 —— agent 每次启动也会重建一次，规则不会真的丢。
	if err := run("netfilter-persistent", "save"); err != nil {
		logger.Warning("端口跳跃：netfilter-persistent save 失败，重启后需靠 agent 重建:", err.Error())
	}

	if len(rules) == 0 {
		logger.Info("端口跳跃：未配置 server_ports，已清空", hopChain)
		return
	}
	logger.Info("端口跳跃已生效：", len(rules), "条规则（链 nat/", hopChain, "）")
}

func collectHopRules() []hopRule {
	db := database.GetDB()
	if db == nil {
		return nil
	}
	var inbounds []model.Inbound
	// 只有 QUIC 系（UDP）能做端口跳跃；TCP 是有状态连接，换端口等于换连接。
	if err := db.Where("type IN ?", []string{"hysteria2", "tuic", "hysteria"}).
		Find(&inbounds).Error; err != nil {
		return nil
	}
	var rules []hopRule
	seen := map[string]bool{}
	for _, ib := range inbounds {
		dport := hopRange(ib.OutJson)
		if dport == "" {
			continue
		}
		target := listenPort(ib.Options)
		if target == 0 || target > 65535 {
			continue
		}
		// 同一段端口被两个入站占用时（历史遗留的 vn 就是这样），
		// 只保留第一条，避免出现「谁先命中谁生效」的歧义。
		if seen[dport] {
			logger.Warning("端口跳跃：", dport, "重复，跳过入站", ib.Tag)
			continue
		}
		seen[dport] = true
		rules = append(rules, hopRule{dport: dport, target: target})
	}
	return rules
}

// hopRange 解析 out_json.server_ports，兼容三种写法：
//
//	["40000:42000"]  数组（sing-box 标准写法）
//	"40000:42000"    单个字符串
//	"40000-42000"    已经写成范围语法
func hopRange(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var oj struct {
		ServerPorts json.RawMessage `json:"server_ports"`
	}
	if err := json.Unmarshal(raw, &oj); err != nil || len(oj.ServerPorts) == 0 {
		return ""
	}
	var one string
	if err := json.Unmarshal(oj.ServerPorts, &one); err == nil {
		return normalizeHop(one)
	}
	var many []string
	if err := json.Unmarshal(oj.ServerPorts, &many); err == nil && len(many) > 0 {
		return normalizeHop(many[0])
	}
	return ""
}

func normalizeHop(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "-", ":") // 40000-42000 -> 40000:42000（iptables 语法）
	if !strings.Contains(s, ":") {
		s = s + ":" + s // 单端口 40000 -> 40000:40000
	}
	return s
}

func listenPort(raw json.RawMessage) int {
	var opt struct {
		ListenPort int `json:"listen_port"`
	}
	if err := json.Unmarshal(raw, &opt); err != nil {
		return 0
	}
	return opt.ListenPort
}

func run(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg != "" {
			return &runErr{cmd: name + " " + strings.Join(args, " "), msg: msg, err: err}
		}
		return err
	}
	return nil
}

type runErr struct {
	cmd string
	msg string
	err error
}

func (e *runErr) Error() string { return e.cmd + ": " + e.msg }
