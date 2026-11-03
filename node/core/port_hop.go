package core

// 端口跳跃（port hopping）的服务端一半。
//
// 为什么需要这个文件：sing-box 的 inbound **没有** mport 字段 ——
// `mport` 只是客户端的事（hysteria2 链接参数 / sing-box outbound 的 server_ports）。
// 服务端必须在整段 UDP 端口上做 NAT，把 40000-42000 全转到真正的监听端口，
// 否则客户端跳到别的端口就直接丢包。
//
// 面板侧不需要新字段：入站编辑里的「拨号」(out_json) 已经能填 server_ports，
// links.ts 也已读它生成 mport=... 的分享链接。缺的正是这一段。
//
// 设计约束：
//   1. 独立表 `inet sui_hop`，每次全量重建（先删后建），幂等；
//      不碰别人的 nft/iptables 规则。
//   2. 失败只告警，绝不阻断内核启动 —— 端口跳跃是增强功能。
//   3. 规则随 agent 启动重建：nft 规则不持久化，重启后必然丢。

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/alireza0/s-ui/database"
	"github.com/alireza0/s-ui/database/model"
	"github.com/alireza0/s-ui/logger"
)

const hopTable = "sui_hop"

type hopRule struct {
	dport  string // nft 语法：40000-42000
	target int    // 入站真实监听端口
}

// syncPortHopping 根据本地库里的入站配置重建端口跳跃规则。
func syncPortHopping() {
	// 先删掉自己的表；不存在时 nft 会报错，忽略
	_ = exec.Command("nft", "delete", "table", "inet", hopTable).Run()

	rules := collectHopRules()
	if len(rules) == 0 {
		return
	}

	var b strings.Builder
	b.WriteString("table inet " + hopTable + " {\n")
	b.WriteString("\tchain prerouting {\n")
	b.WriteString("\t\ttype nat hook prerouting priority dstnat; policy accept;\n")
	for _, r := range rules {
		fmt.Fprintf(&b, "\t\tudp dport %s dnat to :%d\n", r.dport, r.target)
	}
	b.WriteString("\t}\n}\n")

	cmd := exec.Command("nft", "-f", "-")
	cmd.Stdin = strings.NewReader(b.String())
	if out, err := cmd.CombinedOutput(); err != nil {
		// 常见原因：没装 nftables、内核无 nf_tables、权限不足。都不该影响代理。
		logger.Warning("端口跳跃规则下发失败（不影响内核运行）:", err.Error(), strings.TrimSpace(string(out)))
		return
	}
	logger.Info("端口跳跃已生效：", len(rules), "条规则（表 inet ", hopTable, "）")
}

func collectHopRules() []hopRule {
	db := database.GetDB()
	if db == nil {
		return nil
	}
	var inbounds []model.Inbound
	// 只有 QUIC 系（UDP）能做端口跳跃；TCP 是有状态连接，换端口等于换连接。
	if err := db.Where("type IN ?", []string{"hysteria2", "tuic", "hysteria"}).
		Find(&inbounds).Error; err != nil {
		return nil
	}
	var rules []hopRule
	for _, ib := range inbounds {
		dport := hopRange(ib.OutJson)
		if dport == "" {
			continue
		}
		target := listenPort(ib.Options)
		if target == 0 || target > 65535 {
			continue
		}
		rules = append(rules, hopRule{dport: dport, target: target})
	}
	return rules
}

// hopRange 解析 out_json.server_ports，兼容三种写法：
//
//	["40000:42000"]  数组（sing-box 标准写法）
//	"40000:42000"    单个字符串
//	"40000-42000"    已经写成 nft 语法
func hopRange(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var oj struct {
		ServerPorts json.RawMessage `json:"server_ports"`
	}
	if err := json.Unmarshal(raw, &oj); err != nil || len(oj.ServerPorts) == 0 {
		return ""
	}
	var one string
	if err := json.Unmarshal(oj.ServerPorts, &one); err == nil {
		return normalizeHop(one)
	}
	var many []string
	if err := json.Unmarshal(oj.ServerPorts, &many); err == nil && len(many) > 0 {
		return normalizeHop(many[0])
	}
	return ""
}

func normalizeHop(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, ":", "-") // 40000:42000 -> 40000-42000
	return s
}

func listenPort(raw json.RawMessage) int {
	var opt struct {
		ListenPort int `json:"listen_port"`
	}
	if err := json.Unmarshal(raw, &opt); err != nil {
		return 0
	}
	return opt.ListenPort
}
