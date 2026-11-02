package database

import (
	"os"
	"regexp"
	"testing"

	"github.com/alireza0/s-ui/logger"
	"github.com/op/go-logging"
)

// 这个包的代码会打日志，logger 未初始化时 Warning/Info 会 nil 解引用。
func TestMain(m *testing.M) {
	logger.InitLogger(logging.ERROR)
	os.Exit(m.Run())
}

// 订阅令牌就是凭据：必须是 32 位小写 hex，且两次生成不能相同。
// 曾经有一条"随机源失败就退化到时间戳"的路径，那等于发出可预测的凭据。
func TestRandomSubToken(t *testing.T) {
	re := regexp.MustCompile(`^[0-9a-f]{32}$`)
	seen := map[string]bool{}
	for i := 0; i < 64; i++ {
		tok, err := RandomSubToken()
		if err != nil {
			t.Fatalf("生成失败: %v", err)
		}
		if !re.MatchString(tok) {
			t.Fatalf("格式不对: %q", tok)
		}
		if seen[tok] {
			t.Fatalf("重复令牌: %q", tok)
		}
		seen[tok] = true
	}
}
