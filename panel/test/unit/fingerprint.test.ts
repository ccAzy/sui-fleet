import { describe, expect, it } from "vitest";
import { configFingerprintView } from "../../src/agent";

// 这组测试守的是「配置指纹只对配置敏感」。
// 背景：clients 对象里混着 up/down/totalUp/totalDown（每次上报都改写）和 sub_token
// （订阅令牌，不进内核配置）。它们一旦进了指纹，hash_checked_at 到点重算就一定判定
// 「变了」→ 全量下发 → 重启内核，等于给有流量的节点做了小时级重启。

describe("configFingerprintView", () => {
  const client = {
    id: 1,
    name: "alice",
    enable: true,
    config: { vless: { uuid: "11111111-2222-3333-4444-555555555555" } },
    inbounds: [1],
    up: 100,
    down: 200,
    totalUp: 1000,
    totalDown: 2000,
    sub_token: "deadbeefdeadbeefdeadbeefdeadbeef",
  };

  it("剔掉四个流量计数与 sub_token", () => {
    const [v] = configFingerprintView([client]) as Array<
      Record<string, unknown>
    >;
    for (const k of ["up", "down", "totalUp", "totalDown", "sub_token"]) {
      expect(v).not.toHaveProperty(k);
    }
    expect(v.id).toBe(1);
    expect(v.name).toBe("alice");
    expect(v.enable).toBe(true);
  });

  it("流量变化不改变指纹视图（序列化后逐字节相同）", () => {
    const before = JSON.stringify(configFingerprintView([client]));
    const after = JSON.stringify(
      configFingerprintView([
        { ...client, up: 999999, down: 888888, totalUp: 7, totalDown: 9 },
      ]),
    );
    expect(after).toBe(before);
  });

  it("回填 sub_token 不改变指纹视图", () => {
    const before = JSON.stringify(
      configFingerprintView([{ ...client, sub_token: "" }]),
    );
    const after = JSON.stringify(
      configFingerprintView([{ ...client, sub_token: "a" }]),
    );
    expect(after).toBe(before);
  });

  it("真正的配置变化仍然改变指纹视图", () => {
    const before = JSON.stringify(configFingerprintView([client]));
    const renamed = JSON.stringify(
      configFingerprintView([{ ...client, name: "bob" }]),
    );
    const disabled = JSON.stringify(
      configFingerprintView([{ ...client, enable: false }]),
    );
    expect(renamed).not.toBe(before);
    expect(disabled).not.toBe(before);
  });

  it("不改动入参对象", () => {
    configFingerprintView([client]);
    expect(client.up).toBe(100);
    expect(client.sub_token).toBe("deadbeefdeadbeefdeadbeefdeadbeef");
  });
});
