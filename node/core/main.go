package core

import (
	"context"
	"fmt"

	"github.com/alireza0/s-ui/logger"

	sb "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	_ "github.com/sagernet/sing-box/experimental/clashapi"
	_ "github.com/sagernet/sing-box/experimental/v2rayapi"
	"github.com/sagernet/sing-box/log"
	"github.com/sagernet/sing-box/option"
	_ "github.com/sagernet/sing-box/transport/v2rayquic"
	"github.com/sagernet/sing/service"
)

var (
	globalCtx        context.Context
	inbound_manager  adapter.InboundManager
	outbound_manager adapter.OutboundManager
	service_manager  adapter.ServiceManager
	endpoint_manager adapter.EndpointManager
	router           adapter.Router
	factory          log.Factory
)

type Core struct {
	isRunning bool
	instance  *Box
}

func NewCore() *Core {
	globalCtx = context.Background()
	globalCtx = sb.Context(globalCtx, InboundRegistry(), OutboundRegistry(), EndpointRegistry(), DNSTransportRegistry(), ServiceRegistry())
	return &Core{
		isRunning: false,
		instance:  nil,
	}
}

func (c *Core) GetCtx() context.Context {
	return globalCtx
}

func (c *Core) GetInstance() *Box {
	return c.instance
}

// ValidateConfig 只校验"这份配置内核能不能解析"，不启动、不落盘。
// 用途：重启内核之前先验证，避免"先断开所有连接、再发现新配置是坏的"。
func ValidateConfig(sbConfig []byte) error {
	var opt option.Options
	if err := opt.UnmarshalJSONContext(globalCtx, sbConfig); err != nil {
		return fmt.Errorf("配置解析失败: %w", err)
	}
	return nil
}

func (c *Core) Start(sbConfig []byte) error {
	var opt option.Options
	err := opt.UnmarshalJSONContext(globalCtx, sbConfig)
	if err != nil {
		// 解析失败必须中止。以前这里只打日志然后继续 NewBox(opt)：
		// 半解析出来的 opt 会让内核带着「零个 inbound」成功启动，
		// IsRunning() 变 true、agent 上报 running —— 所有端口静默消失，
		// 而且不会触发 agent 的重试逻辑。宁可起不来（可见的错误），也不要假 running。
		logger.Error("Unmarshal config err:", err.Error())
		return fmt.Errorf("配置解析失败: %w", err)
	}

	c.instance, err = NewBox(Options{
		Context: globalCtx,
		Options: opt,
	})
	if err != nil {
		return err
	}

	err = c.instance.Start()
	if err != nil {
		_ = c.instance.Close()
		c.instance = nil
		return err
	}

	globalCtx = service.ContextWith(globalCtx, c)
	inbound_manager = service.FromContext[adapter.InboundManager](globalCtx)
	outbound_manager = service.FromContext[adapter.OutboundManager](globalCtx)
	service_manager = service.FromContext[adapter.ServiceManager](globalCtx)
	endpoint_manager = service.FromContext[adapter.EndpointManager](globalCtx)
	router = service.FromContext[adapter.Router](globalCtx)

	c.isRunning = true
	// 内核起来了再重建端口跳跃规则：nft 规则不持久化，agent 每次启动都要重来一遍。
	// 失败只告警，不影响已启动的内核（见 port_hop.go 的设计约束）。
	syncPortHopping()
	return nil
}

func (c *Core) Stop() error {
	c.isRunning = false
	if c.instance == nil {
		return nil
	}
	err := c.instance.Close()
	c.instance = nil
	return err
}

func (c *Core) IsRunning() bool {
	return c.isRunning
}
