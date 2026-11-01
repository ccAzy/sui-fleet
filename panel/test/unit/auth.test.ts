// 会话载荷的纯函数单测。
//
// 为什么单独测这一条：`isSessionPayload` 是「二次验证能否被绕过」的唯一关口。
// 曾经的实现只检查 payload.u 是不是字符串，于是 /api/login 返回的 120 秒
// otp 票据（payload.otp === 1）被手工塞进 cookie 就能当完整会话用 —— 2FA 形同虚设。
import { describe, expect, it } from "vitest";
import { isSessionPayload } from "../../src/auth";

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
