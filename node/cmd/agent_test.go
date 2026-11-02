package cmd

import (
	"encoding/json"
	"sync"
	"testing"
)

// 这些测试只覆盖纯逻辑：流量累加、配置签名。它们跑起来不碰数据库、
// 不启内核，是 agent 里最该有测试、也最容易写错的两块。

func newTestAgent() *agent {
	return &agent{mu: sync.Mutex{}, pending: map[string]*trafficDelta{}}
}

func TestAbsorbTrafficAccumulatesByTag(t *testing.T) {
	a := newTestAgent()
	a.absorbTraffic([]trafficDelta{
		{Tag: "alice", Up: 10, Down: 100},
		{Tag: "bob", Up: 1, Down: 2},
	})
	// 同一个 tag 再来一轮（模拟上次没发出去、这轮又采到增量）
	a.absorbTraffic([]trafficDelta{
		{Tag: "alice", Up: 5, Down: 50},
	})

	got := map[string]trafficDelta{}
	for _, d := range a.snapshotTraffic() {
		got[d.Tag] = d
	}
	if got["alice"].Up != 15 || got["alice"].Down != 150 {
		t.Fatalf("alice 应累加成 15/150，实际 %d/%d", got["alice"].Up, got["alice"].Down)
	}
	if got["bob"].Up != 1 || got["bob"].Down != 2 {
		t.Fatalf("bob 应保持 1/2，实际 %d/%d", got["bob"].Up, got["bob"].Down)
	}
}

func TestAbsorbTrafficIgnoresEmptyTag(t *testing.T) {
	a := newTestAgent()
	a.absorbTraffic([]trafficDelta{{Tag: "", Up: 9, Down: 9}})
	if n := len(a.snapshotTraffic()); n != 0 {
		t.Fatalf("空 tag 不该进 pending，实际 %d 条", n)
	}
}

func TestSnapshotIsACopy(t *testing.T) {
	a := newTestAgent()
	a.absorbTraffic([]trafficDelta{{Tag: "alice", Up: 1, Down: 1}})

	snap := a.snapshotTraffic()
	snap[0].Up = 999 // 改快照不应影响内部状态

	again := a.snapshotTraffic()
	if again[0].Up != 1 {
		t.Fatalf("快照被共享了：内部 Up 变成了 %d", again[0].Up)
	}
}

func TestCoreConfigSigStable(t *testing.T) {
	mk := func() *agentPullResp {
		return &agentPullResp{
			Config:    json.RawMessage(`{"log":{"level":"info"}}`),
			Inbounds:  []json.RawMessage{json.RawMessage(`{"type":"vless","tag":"a"}`)},
			Outbounds: []json.RawMessage{json.RawMessage(`{"type":"direct","tag":"direct"}`)},
		}
	}
	if coreConfigSig(mk()) != coreConfigSig(mk()) {
		t.Fatal("同样的内容应得到同样的签名")
	}
}

func TestCoreConfigSigIgnoresSettings(t *testing.T) {
	base := &agentPullResp{
		Config:   json.RawMessage(`{}`),
		Inbounds: []json.RawMessage{json.RawMessage(`{"tag":"a"}`)},
	}
	// settings 变了但内核配置没变：不该触发重启
	changed := &agentPullResp{
		Config:   json.RawMessage(`{}`),
		Inbounds: []json.RawMessage{json.RawMessage(`{"tag":"a"}`)},
		Settings: map[string]string{"webPort": "2095", "someoneElse": "1"},
	}
	if coreConfigSig(base) != coreConfigSig(changed) {
		t.Fatal("settings 变化不该改变内核配置签名")
	}
}

func TestCoreConfigSigChangesWithInbound(t *testing.T) {
	a := &agentPullResp{Config: json.RawMessage(`{}`), Inbounds: []json.RawMessage{json.RawMessage(`{"tag":"a"}`)}}
	b := &agentPullResp{Config: json.RawMessage(`{}`), Inbounds: []json.RawMessage{json.RawMessage(`{"tag":"b"}`)}}
	if coreConfigSig(a) == coreConfigSig(b) {
		t.Fatal("inbound 内容不同，签名必须不同")
	}
}

func TestCoreConfigSigDetectsOrder(t *testing.T) {
	a := &agentPullResp{
		Config:   json.RawMessage(`{}`),
		Inbounds: []json.RawMessage{json.RawMessage(`{"tag":"a"}`), json.RawMessage(`{"tag":"b"}`)},
	}
	b := &agentPullResp{
		Config:   json.RawMessage(`{}`),
		Inbounds: []json.RawMessage{json.RawMessage(`{"tag":"b"}`), json.RawMessage(`{"tag":"a"}`)},
	}
	if coreConfigSig(a) == coreConfigSig(b) {
		t.Fatal("入站顺序变了就是配置变了，签名必须不同")
	}
}
