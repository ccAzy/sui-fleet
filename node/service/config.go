package service

import (
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/alireza0/s-ui/core"
	"github.com/alireza0/s-ui/database"
	"github.com/alireza0/s-ui/database/model"
	"github.com/alireza0/s-ui/logger"
	"github.com/alireza0/s-ui/util/common"
)

var (
	// 最近一次成功启动的配置：Start 失败时用它回滚，避免"坏配置一存就整节点断流"。
	lastGoodConfig      []byte
	lastGoodConfigMu    sync.Mutex
	LastUpdate          int64
	corePtr             *core.Core
	startCoreMu         sync.Mutex
	startCoreInProgress bool
	lastStartFailTime   time.Time
	startCooldown       = 15 * time.Second
)

type ConfigService struct {
	ClientService
	TlsService
	SettingService
	InboundService
	OutboundService
	ServicesService
	EndpointService
	ServerListService
}

type SingBoxConfig struct {
	Log          json.RawMessage   `json:"log"`
	Dns          json.RawMessage   `json:"dns"`
	Ntp          json.RawMessage   `json:"ntp"`
	Inbounds     []json.RawMessage `json:"inbounds"`
	Outbounds    []json.RawMessage `json:"outbounds"`
	Services     []json.RawMessage `json:"services"`
	Endpoints    []json.RawMessage `json:"endpoints"`
	Route        json.RawMessage   `json:"route"`
	Experimental json.RawMessage   `json:"experimental"`
}

func NewConfigService(core *core.Core) *ConfigService {
	corePtr = core
	return &ConfigService{}
}

func (s *ConfigService) GetConfig(data string) (*[]byte, error) {
	var err error
	if len(data) == 0 {
		data, err = s.SettingService.GetConfig()
		if err != nil {
			return nil, err
		}
	}
	singboxConfig := SingBoxConfig{}
	err = json.Unmarshal([]byte(data), &singboxConfig)
	if err != nil {
		return nil, err
	}

	singboxConfig.Inbounds, err = s.InboundService.GetAllConfig(database.GetDB())
	if err != nil {
		return nil, err
	}
	singboxConfig.Outbounds, err = s.OutboundService.GetAllConfig(database.GetDB())
	if err != nil {
		return nil, err
	}
	singboxConfig.Services, err = s.ServicesService.GetAllConfig(database.GetDB())
	if err != nil {
		return nil, err
	}
	singboxConfig.Endpoints, err = s.EndpointService.GetAllConfig(database.GetDB())
	if err != nil {
		return nil, err
	}
	rawConfig, err := json.MarshalIndent(singboxConfig, "", "  ")
	if err != nil {
		return nil, err
	}
	return &rawConfig, nil
}

func (s *ConfigService) StartCore() error {
	if corePtr.IsRunning() {
		return nil
	}
	startCoreMu.Lock()
	if startCoreInProgress {
		startCoreMu.Unlock()
		return nil
	}
	if time.Since(lastStartFailTime) < startCooldown {
		logger.Info("start core cooldown ", startCooldown/time.Second, " seconds")
		startCoreMu.Unlock()
		// 不能返回 nil：调用方会把“因为冷却跳过”当成“启动成功”，
		// 于是不再重试，节点就一直停在旧/空配置上。给一个明确的错误。
		return common.NewError("start core skipped: in cooldown after a previous failure")
	}
	startCoreInProgress = true
	startCoreMu.Unlock()
	defer func() {
		startCoreMu.Lock()
		startCoreInProgress = false
		startCoreMu.Unlock()
	}()

	logger.Info("starting core")
	rawConfig, err := s.GetConfig("")
	if err != nil {
		return err
	}
	err = corePtr.Start(*rawConfig)
	if err != nil {
		startCoreMu.Lock()
		lastStartFailTime = time.Now()
		startCoreMu.Unlock()
		logger.Error("start sing-box err:", err.Error())
		return err
	}
	logger.Info("sing-box started")
	lastGoodConfigMu.Lock()
	lastGoodConfig = append([]byte(nil), (*rawConfig)...)
	lastGoodConfigMu.Unlock()
	return nil
}

// IsCoreRunning 报告内核当前是否真的在跑。
// agent 每轮用它做存活守护：两轮 pull 之间内核崩掉时 revision 不会变、applied=false，
// 没有这个检查就再也不会有人拉起它，节点表现为“在线但全端口不通”。
func (s *ConfigService) IsCoreRunning() bool {
	return corePtr != nil && corePtr.IsRunning()
}

func (s *ConfigService) RestartCore() error {
	// 先验证再停。原实现是"停 → 渲染 → 起"，新配置一旦不合法，
	// 旧内核已经没了、新的起不来 —— 一条坏配置就让整节点断流，
	// 而 agent 下一轮还是同一份坏数据，于是反复"停-起不来"。
	if err := s.validateCoreConfig(); err != nil {
		logger.Error("refuse to restart with invalid config:", err.Error())
		return err
	}
	err := s.StopCore()
	if err != nil {
		return err
	}
	return s.StartCore()
}

// validateCoreConfig 渲染当前配置并让内核解析一遍，不改变运行状态。
func (s *ConfigService) validateCoreConfig() error {
	raw, err := s.GetConfig("")
	if err != nil {
		return err
	}
	return core.ValidateConfig(*raw)
}

func (s *ConfigService) restartCoreWithConfig(config json.RawMessage) error {
	startCoreMu.Lock()
	if startCoreInProgress {
		startCoreMu.Unlock()
		return nil
	}
	startCoreInProgress = true
	startCoreMu.Unlock()
	defer func() {
		startCoreMu.Lock()
		startCoreInProgress = false
		startCoreMu.Unlock()
	}()

	// 先渲染 + 验证，再停旧内核。
	// 原实现是"停 → 渲染 → 起"：新配置一旦不合法（JSON 结构对但语义错、端口占用、
	// 证书读不到），旧内核已经没了、新的起不来，而这个坏配置已经落库，
	// cron 每 5 秒重试同一次失败 —— 节点持续断流直到人工改回。
	rawConfig, err := s.GetConfig(string(config))
	if err != nil {
		logger.Error("restart sing-box err (get config):", err.Error())
		return err
	}
	if err := core.ValidateConfig(*rawConfig); err != nil {
		logger.Error("restart sing-box err (invalid config, 旧内核继续运行):", err.Error())
		return err
	}
	if corePtr.IsRunning() {
		if err := corePtr.Stop(); err != nil {
			logger.Error("restart sing-box err (stop):", err.Error())
			return err
		}
	}
	if err := corePtr.Start(*rawConfig); err != nil {
		logger.Error("restart sing-box err (start):", err.Error())
		// 用最近一次成功的配置把内核拉回来：坏配置已经入库，不回滚就是一直断流。
		lastGoodConfigMu.Lock()
		good := lastGoodConfig
		lastGoodConfigMu.Unlock()
		if len(good) > 0 {
			if e := corePtr.Start(good); e != nil {
				logger.Error("rollback to last good config failed:", e.Error())
			} else {
				logger.Warning("已回滚到最近一次成功启动的配置（新配置保留在库里，修正后重新保存即可）")
			}
		}
		return err
	}
	logger.Info("sing-box restarted with new config")
	return nil
}

func (s *ConfigService) StopCore() error {
	err := corePtr.Stop()
	if err != nil {
		return err
	}
	logger.Info("sing-box stopped")
	return nil
}

func (s *ConfigService) CheckOutbound(tag string, link string) core.CheckOutboundResult {
	if tag == "" {
		return core.CheckOutboundResult{Error: "missing query parameter: tag"}
	}
	if corePtr == nil || !corePtr.IsRunning() {
		return core.CheckOutboundResult{Error: "core not running"}
	}
	return core.CheckOutbound(corePtr.GetCtx(), tag, link)
}

func (s *ConfigService) Save(obj string, act string, data json.RawMessage, initUsers string, loginUser string, hostname string) ([]string, error) {
	var err error
	var objs []string = []string{obj}

	db := database.GetDB()
	tx := db.Begin()
	defer func() {
		if err == nil {
			tx.Commit()
			// Try to start core if it is not running
			if !corePtr.IsRunning() {
				s.StartCore()
			}
		} else {
			tx.Rollback()
		}
	}()

	switch obj {
	case "clients":
		var inboundIds []uint
		inboundIds, err = s.ClientService.Save(tx, act, data, hostname)
		if err == nil && len(inboundIds) > 0 {
			objs = append(objs, "inbounds")
			err = s.InboundService.UpdateInboundsUsers(tx, inboundIds)
			if err != nil {
				return nil, common.NewErrorf("failed to update users for inbounds: %v", err)
			}
		}
	case "tls":
		err = s.TlsService.Save(tx, act, data, hostname)
		objs = append(objs, "clients", "inbounds")
	case "inbounds":
		err = s.InboundService.Save(tx, act, data, initUsers, hostname)
		objs = append(objs, "clients")
	case "outbounds":
		err = s.OutboundService.Save(tx, act, data)
	case "services":
		err = s.ServicesService.Save(tx, act, data)
	case "endpoints":
		err = s.EndpointService.Save(tx, act, data)
	case "config":
		err = s.SettingService.SaveConfig(tx, data)
		if err != nil {
			return nil, err
		}
		configData := make(json.RawMessage, len(data))
		copy(configData, data)
		go func() { _ = s.restartCoreWithConfig(configData) }()
	case "settings":
		err = s.SettingService.Save(tx, data)
	case "servers":
		// Saved panel addresses (launcher); no core involvement.
		err = s.ServerListService.Save(tx, act, data)
	default:
		return nil, common.NewError("unknown object: ", obj)
	}
	if err != nil {
		return nil, err
	}

	dt := time.Now().Unix()
	err = tx.Create(&model.Changes{
		DateTime: dt,
		Actor:    loginUser,
		Key:      obj,
		Action:   act,
		Obj:      data,
	}).Error
	if err != nil {
		return nil, err
	}

	LastUpdate = time.Now().Unix()

	return objs, nil
}

func (s *ConfigService) CheckChanges(lu string) (bool, error) {
	if lu == "" {
		return true, nil
	}
	intLu, err := strconv.ParseInt(lu, 10, 64)
	if err != nil {
		return false, err
	}
	if LastUpdate == 0 {
		db := database.GetDB()
		var count int64
		err := db.Model(model.Changes{}).Where("date_time > ?", intLu).Count(&count).Error
		if err == nil {
			LastUpdate = time.Now().Unix()
		}
		return count > 0, err
	}
	return LastUpdate > intLu, nil
}

func (s *ConfigService) GetChanges(actor string, chngKey string, count string) []model.Changes {
	c, _ := strconv.Atoi(count)
	db := database.GetDB()
	tx := db.Model(model.Changes{}).Where("`id` > 0")
	if len(actor) > 0 {
		tx = tx.Where("`actor` = ?", actor)
	}
	if len(chngKey) > 0 {
		tx = tx.Where("`key` = ?", chngKey)
	}
	var chngs []model.Changes
	err := tx.Order("`id` desc").Limit(c).Scan(&chngs).Error
	if err != nil {
		logger.Warning(err)
	}
	return chngs
}
