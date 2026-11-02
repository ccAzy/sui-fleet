import { describe, expect, it } from "vitest";
import RandomUtil from "./randomUtil";

// shortId 会被写进客户端凭证/链接里，格式一旦变了就可能导致客户端解析失败。
describe("RandomUtil.randomShortId", () => {
  it("返回 24 项，第 0 项为空（索引 0 不使用）", () => {
    const ids = RandomUtil.randomShortId();
    expect(ids).toHaveLength(24);
    expect(ids[0]).toBe("");
  });

  it("每一非空项都是成对的十六进制（4/6/8 位），且不同次调用不同", () => {
    const a = RandomUtil.randomShortId();
    for (const s of a.slice(1)) {
      expect(s).toMatch(/^([0-9a-f]{2})+$/);
    }
    const b = RandomUtil.randomShortId();
    expect(b.join("")).not.toBe(a.join(""));
  });
});
