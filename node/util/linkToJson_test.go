package util

import "testing"

// ss:// 的 userinfo 是 base64，字母表含 "/"。不归一化时 url.Parse 会把 authority
// 切成 host=<b64 前缀> + path=/...，节点直接丢。
// 这条用例只在 normalizeSSLink 生效时通过。
const ssSlash = "ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTo/YQ==@1.2.3.4:8388#ss-slash"

func TestGetOutboundSSBase64Slash(t *testing.T) {
	ob, tag, err := GetOutbound(ssSlash, 0)
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	m := *ob
	if m["type"] != "shadowsocks" && m["type"] != "ss" {
		t.Fatalf("type 应为 shadowsocks/ss，got %v", m["type"])
	}
	if m["server"] != "1.2.3.4" {
		t.Fatalf("server 解析错: %v", m["server"])
	}
	if tag == "" {
		t.Fatal("tag 不应为空")
	}
}

func TestNormalizeSSLinkKeepsOtherSchemes(t *testing.T) {
	in := "vless://uuid@h:443?type=tcp"
	if out := normalizeSSLink(in); out != in {
		t.Fatalf("非 ss 链接不该被改动: %q", out)
	}
}
