package vless

import (
	"sync"
	"testing"

	"github.com/sagernet/sing-box/option"
)

// 这条测试的意义：让 `go test -race` 真的能验到 UpdateUsers 与连接读取之间的
// 并发。单跑其它单测时，--race 只覆盖被执行到的路径，热更新那条路径根本没人碰。
// 没有 atomic.Pointer + 越界保护时，这里会 panic（index out of range）或报 data race。
func TestUsersHotSwapConcurrent(t *testing.T) {
	h := &Inbound{}
	mk := func(n int) []option.VLESSUser {
		out := make([]option.VLESSUser, n)
		for i := range out {
			out[i] = option.VLESSUser{Name: "u"}
		}
		return out
	}
	sets := [][]option.VLESSUser{mk(1), mk(8), mk(64), mk(2), mk(32)}
	h.users.Store(&sets[0])

	var wg sync.WaitGroup
	// 写：不断替换用户列表（模拟面板改客户端触发的 UpdateUsers）
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 2000; i++ {
			s := sets[i%len(sets)]
			h.users.Store(&s)
		}
	}()
	// 读：模拟 in-flight 连接用旧索引取用户名（索引一定越界，必须被安全兜住）
	for g := 0; g < 4; g++ {
		wg.Add(1)
		go func(seed int) {
			defer wg.Done()
			for i := 0; i < 2000; i++ {
				_ = h.userName((seed + i) % 100)
			}
		}(g)
	}
	wg.Wait()
}
