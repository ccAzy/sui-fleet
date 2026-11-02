package util

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/alireza0/s-ui/logger"
	"github.com/op/go-logging"
)

// 这个包的代码会打日志，而 logger 的全局实例只有 InitLogger 之后才可用
// （没初始化就 Warning 会 nil 解引用 panic）。测试里先初始化一次。
func TestMain(m *testing.M) {
	logger.InitLogger(logging.ERROR)
	os.Exit(m.Run())
}

// 外部订阅拉取的加固回归：
// 只接受 http(s)、只接受 200、限长 4MiB。
func TestGetExternalLinkRejectsBadScheme(t *testing.T) {
	for _, u := range []string{"file:///etc/passwd", "ftp://x/y", "gopher://x"} {
		if got := GetExternalLink(u); got != "" {
			t.Fatalf("%s 应被拒绝，got %q", u, got)
		}
	}
}

func TestGetExternalLinkRejectsNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusNotFound)
	}))
	defer srv.Close()
	if got := GetExternalLink(srv.URL); got != "" {
		t.Fatalf("404 应返回空，got %q", got)
	}
}

func TestGetExternalLinkReturnsBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("vless://uuid@1.2.3.4:443#node\n"))
	}))
	defer srv.Close()
	if got := GetExternalLink(srv.URL); !strings.Contains(got, "vless://") {
		t.Fatalf("正常响应应原样返回，got %q", got)
	}
}

func TestGetExternalLinkRejectsOversize(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 比上限多 1 字节就够触发拒绝
		_, _ = w.Write([]byte(strings.Repeat("a", externalSubMaxBytes+1)))
	}))
	defer srv.Close()
	if got := GetExternalLink(srv.URL); got != "" {
		t.Fatalf("超过 %d 字节应被拒绝", externalSubMaxBytes)
	}
}
