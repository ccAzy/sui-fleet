package util

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/alireza0/s-ui/logger"
	"github.com/alireza0/s-ui/util/common"
)

// 外部订阅拉取的加固参数。
//
// 原来这里是：InsecureSkipVerify=true、没有 Timeout、io.ReadAll 不限长、
// 不检查状态码。后果：中间人可以替换订阅内容（进而变成 outbound 配置）、
// 慢速端点能长期占住 goroutine、超大响应直接吃内存。
const (
	externalSubTimeout     = 20 * time.Second
	externalSubMaxBytes    = 4 << 20 // 4 MiB，正常订阅远小于此
	externalSubMaxRedirect = 5
)

var externalSubClient = &http.Client{
	Timeout: externalSubTimeout,
	Transport: &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
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
			logger.Warning("sub: Error getting outbounds:", err)
			return nil, err
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
