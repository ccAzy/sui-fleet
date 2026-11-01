// 登录限流的客户端地址取值。
//
// 原来的实现无条件采信 X-Forwarded-For：自托管直连时这个头是客户端随便填的，
// 每次换一个值就能让每个限流桶的计数都到不了阈值 → 无限次猜密码。
// 现在默认只信「CF-Connecting-IP + cf-ray 同时存在」，其余靠 TRUST_PROXY 显式开启。
import { describe, expect, it } from "vitest";
import { clientIp } from "../../src/http";

function fakeCtx(headers: Record<string, string>, env: Record<string, unknown> = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    env,
    req: {
      header: (name: string) => lower.get(name.toLowerCase()),
    },
  };
}

describe("clientIp", () => {
  it("默认模式：cf-ray + CF-Connecting-IP 同时存在才采信", () => {
    const c = fakeCtx({
      "CF-Connecting-IP": "1.2.3.4",
      "cf-ray": "8abc123-HKG",
    });
    expect(clientIp(c)).toBe("1.2.3.4");
  });

  it("只有 CF-Connecting-IP、没有 cf-ray → 视为直连，不采信（防伪造成本最低的绕过）", () => {
    const c = fakeCtx({ "CF-Connecting-IP": "1.2.3.4" });
    expect(clientIp(c)).toBe("direct");
  });

  it("只有 X-Forwarded-For → 不采信", () => {
    const c = fakeCtx({ "X-Forwarded-For": "9.9.9.9" });
    expect(clientIp(c)).toBe("direct");
  });

  it("TRUST_PROXY=1 → 采信 XFF 第一跳（自建反代会重写该头时使用）", () => {
    const c = fakeCtx({ "X-Forwarded-For": "9.9.9.9, 10.0.0.1" }, { TRUST_PROXY: "1" });
    expect(clientIp(c)).toBe("9.9.9.9");
  });

  it("TRUST_PROXY=1 且无 XFF → 回落到 X-Real-IP", () => {
    const c = fakeCtx({ "X-Real-IP": "8.8.8.8" }, { TRUST_PROXY: "1" });
    expect(clientIp(c)).toBe("8.8.8.8");
  });

  it("TRUST_PROXY=off → 任何头都不采信", () => {
    const c = fakeCtx(
      { "CF-Connecting-IP": "1.2.3.4", "cf-ray": "x", "X-Forwarded-For": "9.9.9.9" },
      { TRUST_PROXY: "off" },
    );
    expect(clientIp(c)).toBe("direct");
  });

  it("没有任何头 → direct", () => {
    expect(clientIp(fakeCtx({}))).toBe("direct");
  });
});
