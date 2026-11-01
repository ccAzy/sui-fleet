import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, normalizeOrder, type ArbiterState } from "../src/decide.ts";

const base: ArbiterState = { epoch: 3, failures: 0, lastSwitchAt: 0 };
const input = {
  probeOk: false,
  currentPrimary: "hk",
  order: ["hk", "jp", "vn"],
  now: 1_000_000,
  threshold: 3,
  cooldownMs: 600_000,
};

test("探活正常 → 失败计数归零", () => {
  const d = decide({ ...base, failures: 2 }, { ...input, probeOk: true });
  assert.equal(d.action, "reset");
  assert.equal(d.state.failures, 0);
});

test("未到阈值 → 只累计失败，不切", () => {
  const d = decide(base, input);
  assert.equal(d.action, "wait");
  assert.equal(d.state.failures, 1);
  assert.equal(d.state.epoch, 3);
});

test("达到阈值 → 切到顺位下一台，epoch +1", () => {
  const d = decide({ ...base, failures: 2 }, input);
  assert.equal(d.action, "switch");
  if (d.action !== "switch") return;
  assert.equal(d.to, "jp");
  assert.equal(d.state.epoch, 4);
  assert.equal(d.state.failures, 0);
});

test("冷却窗口内不重复切", () => {
  const d = decide(
    { epoch: 4, failures: 5, lastSwitchAt: input.now - 60_000 },
    { ...input, order: ["jp", "hk", "vn"], currentPrimary: "jp" },
  );
  assert.equal(d.action, "wait");
});

test("顺位表里没有备选 → exhausted", () => {
  const d = decide({ ...base, failures: 2 }, { ...input, order: ["hk"] });
  assert.equal(d.action, "exhausted");
});

test("顺位表规范化：去空、去重、保序", () => {
  assert.deepEqual(normalizeOrder([" hk ", "jp", "hk", "", "vn"]), [
    "hk",
    "jp",
    "vn",
  ]);
  assert.deepEqual(normalizeOrder("hk,jp"), []);
});

test("切换后记住目标：下一次跳到再下一台，不会原地打转", () => {
  const after = (state: ArbiterState) => state;
  // 第一次：hk 挂了 → 切 jp，并记住 target=jp
  const d1 = decide(
    { ...base, failures: 2 },
    { ...input, order: ["hk", "jp", "vn"], now: 2_000_000 },
  );
  assert.equal(d1.action, "switch");
  if (d1.action !== "switch") return;
  assert.equal(d1.to, "jp");
  assert.equal(d1.state.target, "jp");

  // 第二次：jp 也挂了 → 应该推进到 vn，而不是又切 jp
  // 切换后 failures 会归零，要再累计到阈值才会再切
  const d2 = decide(
    { ...after(d1.state), failures: 2 },
    {
      ...input,
      order: ["hk", "jp", "vn"],
      now: 3_000_000,
    },
  );
  assert.equal(d2.action, "switch");
  if (d2.action !== "switch") return;
  assert.equal(d2.to, "vn");
});

test("已知探活失败的备选会被跳过", () => {
  const d = decide(
    { ...base, failures: 2 },
    {
      ...input,
      order: ["hk", "jp", "vn"],
      now: 2_000_000,
      candidateOk: { jp: false, vn: true },
    },
  );
  assert.equal(d.action, "switch");
  if (d.action !== "switch") return;
  assert.equal(d.to, "vn");
});

test("备选全部探活失败 → exhausted（不切到死机器上）", () => {
  const d = decide(
    { ...base, failures: 2 },
    {
      ...input,
      order: ["hk", "jp", "vn"],
      now: 2_000_000,
      candidateOk: { jp: false, vn: false },
    },
  );
  assert.equal(d.action, "exhausted");
});

test("恢复健康后清掉切换指针", () => {
  const d = decide(
    { ...base, failures: 5, target: "vn" },
    { ...input, probeOk: true, now: 2_000_000 },
  );
  assert.equal(d.action, "reset");
  if (d.action !== "reset") return;
  assert.equal(d.state.target, "");
});
