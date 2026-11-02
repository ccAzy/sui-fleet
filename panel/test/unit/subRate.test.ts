import { describe, expect, it } from "vitest";
import { maskIp, subRateLimited } from "../../src/routes/sub";

// 造一个最小的 Hono 上下文替身：限速只看请求头。
function ctx(headers: Record<string, string>, env: Record<string, unknown> = {}) {
  return {
    env,
    req: { header: (k: string) => headers[k] ?? headers[k.toLowerCase()] },
  } as any;
}

describe("订阅限速", () => {
  it("同一 IP 第 61 次被拒（60/分钟）", () => {
    const c = ctx({ "CF-Connecting-IP": "203.0.113.7", "cf-ray": "abc" });
    let limited = false;
    for (let i = 0; i < 61; i++) limited = subRateLimited(c);
    expect(limited).toBe(true);
  });

  it("伪造 CF-Connecting-IP 不足以绕过（缺 cf-ray 时视为 direct）", () => {
    // 同一个"unknown/direct"桶，换 CF 头也不会换桶 —— 这是修 key 可伪造的核心
    const a = ctx({ "CF-Connecting-IP": "198.51.100.1" });
    const b = ctx({ "CF-Connecting-IP": "198.51.100.2" });
    let limitedA = false;
    for (let i = 0; i < 61; i++) limitedA = subRateLimited(a);
    expect(limitedA).toBe(true);
    // b 落进同一个 direct 桶，同样被限
    expect(subRateLimited(b)).toBe(true);
  });

  it("IPv6 按 /64 聚合", () => {
    expect(maskIp("2001:db8:1:2:3:4:5:6")).toBe(maskIp("2001:db8:1:2:9:9:9:9"));
    expect(maskIp("2001:db8:1:2::1")).not.toBe(maskIp("2001:db8:9:9::1"));
    expect(maskIp("10.0.0.1")).toBe("10.0.0.1");
  });
});
