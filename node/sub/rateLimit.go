package sub

import (
	"net"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// 订阅端点的极简限速。
//
// 为什么要限：订阅 URL 里就是凭据，而且它默认对外可访问。没有限速时，
// 攻击者可以高速枚举（legacy 名字空间）或爆破（令牌空间）。
// 这里不引第三方依赖：一个按 IP 的固定窗口计数器足够挡住暴力枚举，
// 也不会因为共享 NAT 误伤（30 次/分钟，正常客户端 12 小时才拉一次）。
const (
	subRateLimitPerMinute = 30
	subRateWindow         = time.Minute
)

type rlBucket struct {
	count int
	reset time.Time
}

var (
	rlMu  sync.Mutex
	rlMap = make(map[string]*rlBucket)
)

func subRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 用 RemoteAddr 而不是 c.ClientIP()：gin 默认信任所有代理，
		// X-Forwarded-For 可被任意客户端伪造，按它限速等于不限。
		host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
		if err != nil {
			host = c.Request.RemoteAddr
		}
		nowT := time.Now()

		rlMu.Lock()
		b := rlMap[host]
		if b == nil || nowT.After(b.reset) {
			b = &rlBucket{reset: nowT.Add(subRateWindow)}
			rlMap[host] = b
			// 顺手清理过期桶，避免 map 无界增长（每次最多清 64 个）
			if len(rlMap) > 4096 {
				n := 0
				for k, v := range rlMap {
					if nowT.After(v.reset) {
						delete(rlMap, k)
						n++
						if n >= 64 {
							break
						}
					}
				}
			}
		}
		b.count++
		over := b.count > subRateLimitPerMinute
		rlMu.Unlock()

		if over {
			c.Header("Retry-After", "60")
			c.AbortWithStatus(429)
			return
		}
		c.Next()
	}
}
