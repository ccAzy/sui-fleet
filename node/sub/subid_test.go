package sub

import "testing"

// 令牌与客户端名的形状判断是订阅鉴权的第一道门：
// 32 位小写 hex 只按令牌查，绝不回退按名字（否则客户端名可以冒充令牌空间）。
func TestIsSubTokenShape(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"0123456789abcdef0123456789abcdef", true},
		{"0123456789ABCDEF0123456789abcdef", false}, // 大写不算令牌
		{"0123456789abcdef0123456789abcde", false},  // 31 位
		{"0123456789abcdef0123456789abcdef0", false},
		{"alice", false},
		{"", false},
		{"0123456789abcdef0123456789abcdeg", false}, // 非 hex
	}
	for _, c := range cases {
		if got := isSubTokenShape(c.in); got != c.want {
			t.Fatalf("isSubTokenShape(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
