package util

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	"github.com/alireza0/s-ui/logger"
	"github.com/alireza0/s-ui/util/common"
)

// 外部订阅拉取的加固参数。
//
// 原来这里是：InsecureSkipVerify=true、没有 Timeout、io.ReadAll 不限长、
// 不检查状态码。后果：中间人可以替换订阅内容（进而变成 outbound 配置）、
// 慢速端点能长期占住 goroutine、超大响应直接吃内存。
// externalSubAllowPrivate 只给测试用：httptest 起的服务在 127.0.0.1 上，
// 会被 SSRF 防护拒绝。生产永远为 false。
var externalSubAllowPrivate = false

const (
	externalSubTimeout     = 20 * time.Second
	externalSubMaxBytes    = 4 << 20 // 4 MiB，正常订阅远小于此
	externalSubMaxRedirect = 5
)

var externalSubClient = &http.Client{
	Timeout: externalSubTimeout,
	Transport: &http.Transport{
		// SSRF 防护：只校验 scheme 不够 —— 初始 URL 或重定向目标都可以是
		// http://127.0.0.1、http://169.254.169.254/（云元数据）、内网域名，
		// 甚至 DNS rebinding。在真正拨号这一层判断解析后的 IP，这些花样都绕不过。
		DialContext: (&net.Dialer{
			Timeout: 5 * time.Second,
			Control: func(network, address string, _ syscall.RawConn) error {
				host, _, err := net.SplitHostPort(address)
				if err != nil {
					return err
				}
				ip := net.ParseIP(host)
				if ip == nil {
					return common.NewError("拒绝无法解析的目标地址: " + address)
				}
				if !externalSubAllowPrivate && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
					ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast()) {
					return common.NewError("拒绝访问内网/回环地址: " + host)
				}
				return nil
			},
		}).DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		Proxy:                 http.ProxyFromEnvironment,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          8,
		IdleConnTimeout:       30 * time.Second,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= externalSubMaxRedirect {
			return common.NewError("too many redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return common.NewError("bad redirect scheme")
		}
		return nil
	},
}

func GetExternalLink(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		logger.Warning("sub: bad external url:", err)
		return ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		logger.Warning("sub: unsupported external scheme:", u.Scheme)
		return ""
	}

	response, err := externalSubClient.Get(rawURL)
	if err != nil {
		logger.Warning("sub: Error making HTTP request:", err)
		return ""
	}
	defer response.Body.Close()

	// 只接受 200：把 HTML 错误页当订阅解析会生成一堆垃圾节点。
	if response.StatusCode != http.StatusOK {
		logger.Warning("sub: external url returned", response.StatusCode)
		return ""
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, externalSubMaxBytes+1))
	if err != nil {
		logger.Warning("sub: Error reading response body:", err)
		return ""
	}
	if len(body) > externalSubMaxBytes {
		logger.Warning("sub: external subscription too large, ignored")
		return ""
	}

	data := StrOrBase64Encoded(string(body))
	return data
}

func GetExternalSub(url string) ([]map[string]interface{}, error) {
	var err error
	var result []map[string]interface{}

	if len(url) == 0 {
		return nil, common.NewError("no url")
	}

	data := GetExternalLink(url)
	if len(data) == 0 {
		return nil, common.NewError("no result")
	}

	// if the data is a JSON object
	if strings.HasPrefix(data, "{") && strings.HasSuffix(data, "}") {
		var jsonData map[string]interface{}
		err = json.Unmarshal([]byte(data), &jsonData)
		if err != nil {
			logger.Warning("sub: Error unmarshalling JSON:", err)
			return nil, err
		}
		outbounds, ok := jsonData["outbounds"].([]any)
		if !ok {
			// err 此时必为 nil（是断言失败不是解析失败）。原来 return nil, err
			// 等于返回 (nil, nil)：调用方以为成功、拿到空结果，日志还打印 "<nil>"。
			return nil, common.NewError("外部订阅里没有 outbounds 数组")
		}
		for _, outbound := range outbounds {
			outboundMap, ok := outbound.(map[string]interface{})
			if ok && len(outboundMap) > 0 {
				oType, _ := outboundMap["type"].(string)
				switch oType {
				case "urltest":
				case "direct":
				case "selector":
				case "block":
					continue
				default:
					result = append(result, outboundMap)
				}
			}
		}
		if len(result) == 0 {
			return nil, common.NewError("no result")
		}
		return result, nil
	} else {
		// if data is a text
		links := strings.Split(data, "\n")
		for _, link := range links {
			linkToJson, _, err := GetOutbound(link, 0)
			if err == nil {
				result = append(result, *linkToJson)
			}
		}
	}
	if len(result) == 0 {
		return nil, common.NewError("no result")
	}
	return result, nil
}
