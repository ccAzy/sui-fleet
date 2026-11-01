// 顺位接管的决策核心（纯函数，无 IO，便于测试）。
//
// 设计要点：
//   - 判定用"连续失败次数"而不是单次失败，避免抖动误切；
//   - 切换后有冷却窗口，防止来回弹；
//   - 每次切换 epoch + 1，被降级的实例启动时发现 epoch 落后就只能只读；
//   - 跳过当前主控自己（顺位表可能把当前主控列在里面）。

export interface ArbiterState {
  epoch: number;
  failures: number;
  lastSwitchAt: number;
  /**
   * 上次切换到的目标。没有它时 `candidates[0]` 永远是同一个节点 ——
   * 顺位表第 2 台挂了就一直往一台死机器上切，而且每次冷却结束都会再切一次。
   */
  target?: string;
}

export interface DecideInput {
  probeOk: boolean;
  currentPrimary: string;
  order: string[];
  now: number;
  threshold: number;
  cooldownMs: number;
  /** 各备选的探活结果（缺省视为未知=可用）。 */
  candidateOk?: Record<string, boolean>;
}

export type Decision =
  | { action: "reset"; state: ArbiterState }
  | { action: "wait"; state: ArbiterState }
  | { action: "switch"; state: ArbiterState; to: string; reason: string }
  | { action: "exhausted"; state: ArbiterState };

export function decide(state: ArbiterState, input: DecideInput): Decision {
  if (input.probeOk) {
    // 回到健康就清掉切换指针，下次故障重新从顺位表头开始。
    return { action: "reset", state: { ...state, failures: 0, target: "" } };
  }

  const failures = state.failures + 1;
  const next: ArbiterState = { ...state, failures };

  if (failures < input.threshold) {
    return { action: "wait", state: next };
  }
  if (input.now - state.lastSwitchAt < input.cooldownMs) {
    return { action: "wait", state: next };
  }

  const candidates = input.order.filter((x) => x && x !== input.currentPrimary);
  if (candidates.length === 0) {
    return { action: "exhausted", state: next };
  }

  // 从「上次切到的那个」往后继续，形成环形推进；没探活信息时也至少不会原地打转。
  const after = state.target ? candidates.indexOf(state.target) + 1 : 0;
  const rotated = [...candidates.slice(after), ...candidates.slice(0, after)];
  // 已知探活失败的备选要跳过，否则会切到另一台死机器上。
  const healthy = rotated.filter((x) => input.candidateOk?.[x] !== false);

  if (healthy.length === 0) {
    return { action: "exhausted", state: next };
  }

  const to = healthy[0];
  return {
    action: "switch",
    state: {
      epoch: state.epoch + 1,
      failures: 0,
      lastSwitchAt: input.now,
      target: to,
    },
    to,
    reason: `primary ${input.currentPrimary || "(未设置)"} 连续 ${failures} 次探活失败`,
  };
}

/** 顺位表规范化：去空、去重、保持顺序。 */
export function normalizeOrder(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const v = String(raw ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
