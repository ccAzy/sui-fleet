package sub

import (
	"context"
	"crypto/tls"
	"github.com/alireza0/s-ui/util/common"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/alireza0/s-ui/config"
	"github.com/alireza0/s-ui/logger"
	"github.com/alireza0/s-ui/middleware"
	"github.com/alireza0/s-ui/network"
	"github.com/alireza0/s-ui/service"

	"github.com/gin-gonic/gin"
)

type Server struct {
	httpServer *http.Server
	listener   net.Listener
	ctx        context.Context
	cancel     context.CancelFunc

	service.SettingService
}

func NewServer() *Server {
	ctx, cancel := context.WithCancel(context.Background())
	return &Server{
		ctx:    ctx,
		cancel: cancel,
	}
}

func (s *Server) initRouter() (*gin.Engine, error) {
	if config.IsDebug() {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.DefaultWriter = io.Discard
		gin.DefaultErrorWriter = io.Discard
		gin.SetMode(gin.ReleaseMode)
	}

	engine := gin.Default()
	// 订阅路由统一限速（凭据就在 URL 里，必须防枚举/爆破）
	engine.Use(subRateLimit(s.SettingService))

	subPath, err := s.SettingService.GetSubPath()
	if err != nil {
		return nil, err
	}

	subDomain, err := s.SettingService.GetSubDomain()
	if err != nil {
		return nil, err
	}

	if subDomain != "" {
		engine.Use(middleware.DomainValidator(subDomain))
	}

	g := engine.Group(subPath)
	NewSubHandler(g)

	return engine, nil
}

func (s *Server) Start() (err error) {
	//This is an anonymous function, no function name
	defer func() {
		if err != nil {
			s.Stop()
		}
	}()

	engine, err := s.initRouter()
	if err != nil {
		return err
	}

	certFile, err := s.SettingService.GetSubCertFile()
	if err != nil {
		return err
	}
	keyFile, err := s.SettingService.GetSubKeyFile()
	if err != nil {
		return err
	}
	listen, err := s.SettingService.GetSubListen()
	if err != nil {
		return err
	}
	port, err := s.SettingService.GetSubPort()
	if err != nil {
		return err
	}

	listenAddr := net.JoinHostPort(listen, strconv.Itoa(port))
	// 安全检查必须在 Listen 之前：先占端口再拒绝，既会留下 TIME_WAIT，
	// 报错信息还可能被 "address already in use" 盖住，看不出真正原因。
	if certFile == "" && keyFile == "" && !isLoopbackListen(listen) && !s.SettingService.GetSubAllowInsecure() {
		return common.NewError("订阅服务拒绝了不安全的配置：监听 " + listenAddr +
			" 且未配置 TLS 证书。请配 subCertFile/subKeyFile，或监听 127.0.0.1 交给反代，" +
			"或显式设置 subAllowInsecure=true（不建议）")
	}
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return err
	}

	if certFile != "" || keyFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			listener.Close()
			return err
		}
		subDomain, err := s.SettingService.GetSubDomain()
		if err != nil {
			return err
		}
		c := network.NewTLSConfig(cert, subDomain)
		listener = network.NewAutoHttpsListener(listener)
		listener = tls.NewListener(listener, c)
	}

	if s.SettingService.GetSubLegacyNameAccess() {
		// 这条必须显眼：legacy = 知道客户端名就能拿到该客户端全部凭据。
		// 客户端名通常就是用户名/邮箱，等于把订阅退回了"可枚举"。
		logger.Warning("订阅服务的 legacy 名字访问是开启的（/sub/<客户端名> 仍可用）；" +
			"确认所有客户端都已换用 /sub/<sub_token> 后，把设置项 subLegacyNameAccess 置为 false")
	}
	plaintext := certFile == "" && keyFile == ""
	if plaintext {
		logger.Warning("Sub server run http (plaintext) on", listener.Addr())
	} else {
		logger.Info("Sub server run https on", listener.Addr())
	}
	s.listener = listener

	s.httpServer = &http.Server{
		Handler:           engine,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		s.httpServer.Serve(listener)
	}()

	return nil
}

func (s *Server) Stop() error {
	var err error
	if s.httpServer != nil {
		shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 30*time.Second)
		err = s.httpServer.Shutdown(shutdownCtx)
		cancelShutdown()
		if err != nil {
			s.cancel()
			if s.listener != nil {
				_ = s.listener.Close()
			}
			return err
		}
	} else if s.listener != nil {
		err = s.listener.Close()
		if err != nil {
			s.cancel()
			return err
		}
	}
	s.cancel()
	return nil
}

func (s *Server) GetCtx() context.Context {
	return s.ctx
}

// isLoopbackListen 判断监听地址是否只在本机。
func isLoopbackListen(host string) bool {
	if host == "" || host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
