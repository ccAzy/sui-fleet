package sub

import (
	"net"
	"strings"
	"sync"
	"time"

	"github.com/alireza0/s-ui/service"
	"github.com/gin-gonic/gin"
)

// 订阅端点的极简限速。
//
// 三条约束决定了实现：
//  1. 订阅 URL 里就是凭据，必须防枚举/爆破；
//  2. 默认部署是 "Caddy → 127.0.0.1:2096"，此时 RemoteAddr 对所有用户都是
//     127.0.0.1 —— 只按 RemoteAddr 分桶等于所有人共用一个桶，一个人刷就全员 429。
//     所以：来自可信代理的请求看 X-Forwarded-For，其它一律用 RemoteAddr。
//  3. IPv6 换地址零成本，按 /64 聚合；否则一个 /64 就能绕过。
const (
	subRateLimitPerMinute = 30
	subRateWindow         = time.Minute
	subRateMaxBuckets     = 65536
)

type rlBucket struct {
	count int
	reset time.Time
}

var (
	rlMu  sync.Mutex
	rlMap = make(map[string]*rlBucket)
)

func subRateLimit(setting service.SettingService) gin.HandlerFunc {
	trusted := trustedProxySet(setting)
	return func(c *gin.Context) {
		key := rateLimitKey(c, trusted)
		nowT := time.Now()

		rlMu.Lock()
		b := rlMap[key]
		if b == nil || nowT.After(b.reset) {
			if b == nil && len(rlMap) >= subRateMaxBuckets {
				evictExpiredLocked(nowT, len(rlMap)/8)
				// 清理后仍然满了：淘汰一批，保证服务可用（宁可短期放宽，也不要 500）
				if len(rlMap) >= subRateMaxBuckets {
					evictSomeLocked(len(rlMap) / 8)
				}
			}
			b = &rlBucket{reset: nowT.Add(subRateWindow)}
			rlMap[key] = b
		}
		b.count++
		over := b.count > subRateLimitPerMinute
		retry := int(time.Until(b.reset).Seconds()) + 1
		rlMu.Unlock()

		if over {
			if retry < 1 {
				retry = 1
			}
			c.Header("Retry-After", itoa(retry))
			c.Header("Cache-Control", "no-store")
			c.AbortWithStatus(429)
			return
		}
		c.Next()
	}
}

// rateLimitKey 取"客户端身份"，口径与是否在反代后有关。
func rateLimitKey(c *gin.Context, trusted map[string]bool) string {
	remote := c.Request.RemoteAddr
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	ip := host
	if trusted[host] {
		// 从右往左跳过可信代理，取第一个不可信的跳 —— 这样客户端伪造的
		// 左端 XFF 不会生效（只有我们信任的那几跳才有资格追加）。
		parts := strings.Split(c.GetHeader("X-Forwarded-For"), ",")
		for i := len(parts) - 1; i >= 0; i-- {
			h := strings.TrimSpace(parts[i])
			if h == "" || trusted[h] {
				continue
			}
			ip = h
			break
		}
	}
	return maskIP(ip)
}

// maskIP 把 IPv6 归到 /64，IPv4 原样（分桶粒度不需要更细）。
func maskIP(s string) string {
	p := net.ParseIP(s)
	if p == nil {
		return s
	}
	if p.To4() != nil {
		return p.String()
	}
	masked := p.Mask(net.CIDRMask(64, 128))
	if masked == nil {
		return s
	}
	return masked.String() + "/64"
}

func trustedProxySet(setting service.SettingService) map[string]bool {
	out := map[string]bool{"127.0.0.1": true, "::1": true}
	raw, err := setting.GetSubTrustedProxies()
	if err != nil {
		return out
	}
	if raw == "" {
		return map[string]bool{}
	}
	out = map[string]bool{}
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out[p] = true
		}
	}
	return out
}

func evictExpiredLocked(nowT time.Time, max int) {
	n := 0
	for k, v := range rlMap {
		if nowT.After(v.reset) {
			delete(rlMap, k)
			n++
			if n >= max {
				return
			}
		}
	}
}

func evictSomeLocked(max int) {
	n := 0
	for k := range rlMap {
		delete(rlMap, k)
		n++
		if n >= max {
			return
		}
	}
}

// itoa 避免为了一个整数再引 strconv（保持这个文件依赖最小）。
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
