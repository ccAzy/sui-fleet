// 会话载荷的纯函数单测。
//
// 为什么单独测这一条：`isSessionPayload` 是「二次验证能否被绕过」的唯一关口。
// 曾经的实现只检查 payload.u 是不是字符串，于是 /api/login 返回的 120 秒
// otp 票据（payload.otp === 1）被手工塞进 cookie 就能当完整会话用 —— 2FA 形同虚设。
import { describe, expect, it } from "vitest";
import { isSessionPayload, tokenIsValid } from "../../src/auth";

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
