package util

import (
	"net/url"
	"strings"
	"testing"
)

// 密码里的特殊字符必须能往返：以前手写 "%s:%s@"，密码含 @ : / # ? % 时
// 生成出来的链接会指向错误的主机，甚至被客户端拒收。
func TestUserinfoRoundTrip(t *testing.T) {
	cases := []struct{ user, pass string }{
		{"alice", "p@ss"}, {"alice", "p:ss"}, {"alice", "p#ss"},
		{"alice", "p?ss"}, {"alice", "p/ss"}, {"alice", "p%ss"},
		{"alice", "p&ss=q"}, {"alice", "p ss"}, {"alice", "密码😀"},
		{"alice", ""},
	}
	for _, c := range cases {
		uri := "trojan://" + userinfo(c.user, c.pass) + "@1.2.3.4:443"
		u, err := url.Parse(uri)
		if err != nil {
			t.Fatalf("解析失败 %q: %v", uri, err)
		}
		if u.Hostname() != "1.2.3.4" {
			t.Fatalf("主机被改坏了 %q -> host=%q", uri, u.Hostname())
		}
		if u.User.Username() != c.user {
			t.Fatalf("用户名还原失败 %q -> %q", uri, u.User.Username())
		}
		got, _ := u.User.Password()
		if got != c.pass {
			t.Fatalf("密码还原失败 %q -> %q (want %q)", uri, got, c.pass)
		}
	}
}

// addParams 曾经忽略 url.Parse 的错误并对 nil 解引用：
// 一条含非法转义（如密码里的 %zz）的链接会让整个链接生成 panic。
func TestAddParamsDoesNotPanicOnBadURI(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("addParams 不该 panic: %v", r)
		}
	}()
	out := addParams("vless://x@h:443?bad=%zz", []LinkParam{{Key: "type", Value: "tcp"}}, "备注")
	if out == "" {
		t.Fatal("退化路径也要返回可用字符串")
	}
}

func TestHostPortIPv6(t *testing.T) {
	got := hostPort("2001:db8::1", 443)
	if !strings.Contains(got, "[2001:db8::1]") {
		t.Fatalf("IPv6 必须加方括号，got %q", got)
	}
}
