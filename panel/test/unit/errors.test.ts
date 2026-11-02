import { describe, expect, it } from "vitest";
import { AppError, invalid, isAppError, rateLimited, unauthorized } from "../../src/errors";

// 领域错误的意义：前端按 code 分支，而不是匹配中文文案。
describe("AppError", () => {
  it("带稳定的 code 与可读文案", () => {
    const e = unauthorized();
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("UNAUTHORIZED");
    expect(e.message).toBe("Invalid login");
    expect(isAppError(e)).toBe(true);
  });

  it("普通 Error 不会被当成领域错误", () => {
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it("快捷构造器各自带对应 code", () => {
    expect(rateLimited().code).toBe("RATE_LIMITED");
    expect(invalid("bad").code).toBe("VALIDATION");
  });
});

describe("json() 的响应信封", () => {
  // 造一个最小 context，只为观察 .json() 收到的对象
  const ctx = () => {
    let got: any;
    return {
      json: (o: unknown) => {
        got = o;
        return o as any;
      },
      get payload() {
        return got;
      },
    };
  };

  it("失败时带 code", async () => {
    const { json } = await import("../../src/http");
    const c = ctx();
    json(c, null, rateLimited());
    expect(c.payload.success).toBe(false);
    expect(c.payload.code).toBe("RATE_LIMITED");
  });

  it("老式 Error 仍然工作，只是没有 code", async () => {
    const { json } = await import("../../src/http");
    const c = ctx();
    json(c, null, new Error("旧写法"));
    expect(c.payload.success).toBe(false);
    expect(c.payload.msg).toBe("旧写法");
    expect(c.payload.code).toBeUndefined();
  });

  it("成功时 code 不出现", async () => {
    const { json } = await import("../../src/http");
    const c = ctx();
    json(c, { ok: 1 });
    expect(c.payload).toMatchObject({ success: true, obj: { ok: 1 } });
    expect(c.payload.code).toBeUndefined();
  });
});
