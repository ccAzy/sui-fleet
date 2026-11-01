// KV 配额防线的纯函数测试。
//
// 背景：Workers KV 免费版每天只有 1000 次写（put/delete）。仲裁者的 cron 每分钟一次，
// 原来每个 tick 无条件写 state + log（2 次 put）再删 lastError（1 次写）= 4320 次/天，
// 必然把配额打爆，之后当天剩余时间仲裁者全部 429 失败。
// 所以「状态没变就不写」这条必须被测试锁住。
import { test } from "node:test";
import assert from "node:assert/strict";
import { stateChanged } from "../src/index.ts";
import type { ArbiterState } from "../src/decide.ts";

const base: ArbiterState = { epoch: 3, failures: 0, lastSwitchAt: 0 };

test("探活正常且无变化 → 不写（健康路径零 put）", () => {
  assert.equal(stateChanged(base, { ...base }), false);
});

test("失败次数变化 → 要写", () => {
  assert.equal(stateChanged(base, { ...base, failures: 1 }), true);
});

test("切换成功（epoch 变化）→ 要写", () => {
  assert.equal(
    stateChanged(base, { ...base, epoch: 4, lastSwitchAt: 1_000 }),
    true,
  );
});

test("三次失败计数递进各自算一次变化", () => {
  let prev: ArbiterState = { ...base };
  let writes = 0;
  for (const f of [1, 2, 3]) {
    const next = { ...prev, failures: f };
    if (stateChanged(prev, next)) writes += 1;
    prev = next;
  }
  // 一次故障事件最多 3 次写，而不是每分钟一次
  assert.equal(writes, 3);
});

test("失败归零（恢复）也算变化，会被记录一次", () => {
  assert.equal(
    stateChanged({ ...base, failures: 3 }, { ...base, failures: 0 }),
    true,
  );
});
