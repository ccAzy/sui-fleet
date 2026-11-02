import { describe, expect, it } from "vitest";
import { redactForToken } from "../../src/redact";

// 这组测试守的是「授权粒度是字段，不是端点名」这条结论。
// 审计 run-1 实测：只读监控 token 通过 /api/endpoints|outbounds|services|inbounds
// 拿到了 WireGuard/Reality 私钥、service token、入站密码（4/4 命中），
// 因为这些端点与其它端点共用同一个原始对象返回路径。

describe("redactForToken", () => {
  it("剔除对象顶层的私钥与密码", () => {
    const out = redactForToken({
      id: 1,
      type: "wireguard",
      private_key: "SECRET",
      password: "SECRET",
      address: ["10.0.0.2/32"],
    }) as Record<string, unknown>;
    expect(out.private_key).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    // 非机密字段必须保留：监控就要靠它们
    expect(out.id).toBe(1);
    expect(out.type).toBe("wireguard");
    expect(out.address).toEqual(["10.0.0.2/32"]);
  });

  it("递归处理嵌套结构（services.users[].token / tls.private_key）", () => {
    const out = redactForToken({
      tag: "derp",
      users: [{ name: "u1", token: "SECRET", mesh_psk: "SECRET" }],
      tls: { server_name: "example.com", private_key: "SECRET" },
    }) as any;
    expect(out.users[0].name).toBe("u1");
    expect(out.users[0].token).toBe("[redacted]");
    expect(out.users[0].mesh_psk).toBe("[redacted]");
    expect(out.tls.server_name).toBe("example.com");
    expect(out.tls.private_key).toBe("[redacted]");
  });

  it("处理数组与 clients[].config.vless.uuid", () => {
    const out = redactForToken([
      {
        name: "alice",
        config: { vless: { uuid: "11111111-2222-3333-4444-555555555555" } },
      },
    ]) as any[];
    expect(out[0].name).toBe("alice");
    expect(out[0].config.vless.uuid).toBe("[redacted]");
  });

  it("不改变原始对象（纯函数）", () => {
    const src = { private_key: "SECRET", port: 443 };
    redactForToken(src);
    expect(src.private_key).toBe("SECRET");
  });

  it("对 null / 基本类型安全", () => {
    expect(redactForToken(null)).toBeNull();
    expect(redactForToken(7)).toBe(7);
    expect(redactForToken("x")).toBe("x");
  });

  it("字段名大小写不敏感的场景不应误判（当前只按精确键名）", () => {
    // Private_Key 这类变体不会出现在本项目的对象模型里；万一出现，说明模型变了，
    // 那时应当同步改 SECRET_KEYS，而不是在这里放宽成模糊匹配（会误伤普通字段）。
    const out = redactForToken({ Private_Key: "SECRET" }) as Record<
      string,
      unknown
    >;
    expect(out.Private_Key).toBe("SECRET");
  });
});

// 第 6 轮审计：WARP 的 access_token/license_key 与 ACME 的 api_token/access_key_secret
// 曾整串出现在只读令牌的响应和 changes 日志里。这条测试把它们钉住。
describe("redactForToken 覆盖 WARP 与 ACME 凭据", () => {
  it("WARP 凭据被替换", () => {
    const out = redactForToken({
      type: "warp",
      access_token: "AT-SECRET",
      license_key: "LIC-SECRET",
      device_id: "keep-me",
    }) as Record<string, unknown>;
    expect(out.access_token).not.toBe("AT-SECRET");
    expect(out.license_key).not.toBe("LIC-SECRET");
    expect(out.device_id).toBe("keep-me");
  });

  it("ACME 凭据被替换", () => {
    const out = redactForToken({
      api_token: "T-SECRET",
      access_key_secret: "AKS-SECRET",
      security_token: "ST-SECRET",
      provider: "aliyun",
    }) as Record<string, unknown>;
    expect(out.api_token).not.toBe("T-SECRET");
    expect(out.access_key_secret).not.toBe("AKS-SECRET");
    expect(out.security_token).not.toBe("ST-SECRET");
    expect(out.provider).toBe("aliyun");
  });
});
