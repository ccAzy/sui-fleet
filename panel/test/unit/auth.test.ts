// 会话载荷的纯函数单测。
//
// 为什么单独测这一条：`isSessionPayload` 是「二次验证能否被绕过」的唯一关口。
// 曾经的实现只检查 payload.u 是不是字符串，于是 /api/login 返回的 120 秒
// otp 票据（payload.otp === 1）被手工塞进 cookie 就能当完整会话用 —— 2FA 形同虚设。
import { describe, expect, it } from "vitest";
import {
  isSessionPayload,
  signJWT,
  timingSafeEqual,
  tokenIsValid,
  verifyJWT,
} from "../../src/auth";

describe("isSessionPayload", () => {
  it("正常会话载荷通过", () => {
    expect(isSessionPayload({ u: "admin", uid: 1, mc: false })).toBe(true);
  });

  it("拒绝二次验证票据（otp:1）——票据不是会话", () => {
    expect(isSessionPayload({ u: "admin", uid: 1, otp: 1 })).toBe(false);
  });

  it("otp:0 或缺失时不影响正常会话", () => {
    expect(isSessionPayload({ u: "admin", otp: 0 })).toBe(true);
    expect(isSessionPayload({ u: "admin" })).toBe(true);
  });

  it("缺少 u 或载荷为空时拒绝", () => {
    expect(isSessionPayload({ uid: 1 })).toBe(false);
    expect(isSessionPayload(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// API Token 的有效期判定。
//
// 这张表原来只在 UI 里增删查、从不参与鉴权，expiry 也从不检查 —— 等于一个
// 「看起来能用的死凭据」。现在它作为只读接口的脚本访问凭据，有效期必须真的生效。
// ---------------------------------------------------------------------------
describe("tokenIsValid", () => {
  const NOW = 1_800_000_000;

  it("expiry=0 表示永不过期", () => {
    expect(tokenIsValid({ expiry: 0 }, NOW)).toBe(true);
  });

  it("未到期的令牌可用", () => {
    expect(tokenIsValid({ expiry: NOW + 60 }, NOW)).toBe(true);
  });

  it("已过期的令牌被拒绝", () => {
    expect(tokenIsValid({ expiry: NOW - 1 }, NOW)).toBe(false);
  });

  it("正好到期的那一刻算过期（边界是 >，不是 >=）", () => {
    expect(tokenIsValid({ expiry: NOW }, NOW)).toBe(false);
  });

  it("查不到记录时拒绝", () => {
    expect(tokenIsValid(null, NOW)).toBe(false);
    expect(tokenIsValid(undefined, NOW)).toBe(false);
  });

  it("expiry 缺失按永不过期处理（老数据兼容）", () => {
    expect(tokenIsValid({}, NOW)).toBe(true);
  });
});


describe("timingSafeEqual", () => {
  it("相同字符串为真", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("长度不同直接为假", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("同长但内容不同为假（必须整体比完，不能首字符即返回）", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(timingSafeEqual("zbc123", "abc123")).toBe(false);
  });

  it("空串与空串相等", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("verifyJWT：exp 必须是数字", () => {
  const secret = "unit-test-secret-0123456789";

  it("带 exp 的正常令牌通过", async () => {
    const t = await signJWT({ u: "admin", uid: 1 }, secret);
    const p = await verifyJWT(t, secret);
    expect(p?.u).toBe("admin");
  });

  it("没有 exp 的令牌一律拒绝（原实现把它当成永不过期）", async () => {
    // 手工构造：payload 里只放 u/uid，不写 exp
    const enc = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const data = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ u: "admin", uid: 1 })}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifyJWT(`${data}.${b64}`, secret)).toBeNull();
  });

  it("签名被篡改则拒绝", async () => {
    const t = await signJWT({ u: "admin", uid: 1 }, secret);
    const parts = t.split(".");
    const broken = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}aa`;
    expect(await verifyJWT(broken, secret)).toBeNull();
  });
});
