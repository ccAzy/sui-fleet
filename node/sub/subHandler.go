package sub

import (
	"strings"

	"github.com/alireza0/s-ui/database"
	"github.com/alireza0/s-ui/logger"
	"github.com/alireza0/s-ui/service"

	"github.com/gin-gonic/gin"
)

type SubHandler struct {
	service.SettingService
	SubService
	JsonService
	ClashService
}

func NewSubHandler(g *gin.RouterGroup) {
	a := &SubHandler{}
	a.initRouter(g)
}

func (s *SubHandler) initRouter(g *gin.RouterGroup) {
	// 三种形状都收：
	//   /sub/<sub_token>       正式（令牌）
	//   /sub?t=<sub_token>     查询串（兼容前端可能生成的形式）
	//   /sub/<客户端名>         legacy，受 subLegacyNameAccess 控制
	g.GET("/:subid", s.subs)
	g.HEAD("/:subid", s.subHeaders)
	g.GET("", s.subs)
	g.HEAD("", s.subHeaders)
}

// subIDFrom 按优先级取订阅标识：?t= > 路径 > ?client=（legacy 面板风格）。
func subIDFrom(c *gin.Context) string {
	if t := c.Query("t"); t != "" {
		return t
	}
	if id := c.Param("subid"); id != "" {
		return id
	}
	return c.Query("client")
}

// subFail 把错误翻译成状态码。
//
// 以前一律 400 "Error!"：既没法区分"令牌错"和"服务端坏了"，
// 也让 404 无法用来做正确性判断（客户端会无限重试 400）。
func subFail(c *gin.Context, err error) {
	c.Header("Cache-Control", "no-store")
	if database.IsNotFound(err) {
		c.String(404, "Not Found")
		return
	}
	if err != nil {
		logger.Error(err)
	}
	c.String(500, "Internal Error")
}

func (s *SubHandler) subs(c *gin.Context) {
	var headers []string
	var result *string
	var err error
	subId := subIDFrom(c)
	if subId == "" {
		c.Header("Cache-Control", "no-store")
		c.String(400, "Bad Request")
		return
	}
	// 面板与前端用 `type=`，Go 历史上只认 `format=`。两边统一成：
	//   type 优先（与面板一致）→ format → 缺省
	// 并统一小写 + 别名（mihomo→clash、sing-box→singbox），否则
	// `?type=JSON` 这种大小写差异会直接 400。
	raw := c.Query("type")
	if raw == "" {
		raw = c.Query("format")
	}
	format := strings.ToLower(strings.TrimSpace(raw))
	switch format {
	case "sing-box":
		format = "singbox"
	case "mihomo":
		format = "clash"
	}
	isFormat := format != ""
	if isFormat {
		switch format {
		case "json":
			result, headers, err = s.JsonService.GetJson(subId, format)
		case "clash":
			result, headers, err = s.ClashService.GetClash(subId)
		case "singbox", "sing-box":
			// 面板把 sing-box 配置叫 type=singbox；Go 侧只有 json 一种实现
			result, headers, err = s.JsonService.GetJson(subId, "json")
		default:
			c.Header("Cache-Control", "no-store")
			c.String(400, "Bad Request")
			return
		}
		if err != nil || result == nil {
			subFail(c, err)
			return
		}
	} else {
		result, headers, err = s.SubService.GetSubs(subId)
		if err != nil || result == nil {
			subFail(c, err)
			return
		}
	}

	s.addHeaders(c, headers)
	// 订阅内容包含全部凭据，任何缓存（浏览器/反代/CDN）都不该留存
	c.Header("Cache-Control", "no-store")

	c.String(200, *result)
}

func (s *SubHandler) subHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	subId := subIDFrom(c)
	if subId == "" {
		c.String(400, "Bad Request")
		return
	}
	client, err := s.SubService.getClientBySubId(subId)
	if err != nil {
		subFail(c, err)
		return
	}

	headers := s.SubService.getClientHeaders(client)
	s.addHeaders(c, headers)

	c.Status(200)
}

func (s *SubHandler) addHeaders(c *gin.Context, headers []string) {
	c.Writer.Header().Set("Subscription-Userinfo", headers[0])
	c.Writer.Header().Set("Profile-Update-Interval", headers[1])
	c.Writer.Header().Set("Profile-Title", headers[2])
}
