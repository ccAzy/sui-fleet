import { describe, expect, it } from "vitest";
import { HumanReadable } from "./utils";

// 这一层是纯格式化，但它是面板上出现频率最高的字符串（每个流量数字都走它），
// 边界值错了会显示成 "NaN GB" 或 "-"。
describe("HumanReadable.sizeFormat", () => {
  it("0 与负数返回占位符，而不是 NaN", () => {
    expect(HumanReadable.sizeFormat(0)).toBe("-");
    expect(HumanReadable.sizeFormat(-1)).toBe("-");
    expect(HumanReadable.sizeFormat(Number.NaN)).toBe("-");
  });

  it("1023 仍按字节显示，1024 进位到 KB", () => {
    expect(HumanReadable.sizeFormat(1023)).toContain("1023");
    expect(HumanReadable.sizeFormat(1024)).toMatch(/1\.00/);
  });

  it("逐级进位到 GB", () => {
    expect(HumanReadable.sizeFormat(1024 ** 2)).toMatch(/1\.00/);
    expect(HumanReadable.sizeFormat(1024 ** 3)).toMatch(/1\.00/);
  });

  it("小数位可配置", () => {
    expect(HumanReadable.sizeFormat(1536, 0)).toMatch(/2/);
    expect(HumanReadable.sizeFormat(1536, 3)).toMatch(/1\.500/);
  });
});
