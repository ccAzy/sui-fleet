// 配置内容指纹。
//
// 为什么需要它：只比 revision 的话，「恢复备份 / 待机机 promote / 手工改库」这三条路径
// 都可能让 revision 撞在同一个值上而内容已经不同，节点就会永远收到 unchanged、
// 永远跑旧配置，而面板上一切正常。指纹必须对「同样内容」稳定、对「不同内容」敏感。
import { describe, expect, it } from "vitest";
import { configHashOf } from "../../src/agent";

const base = () => ({
  config: { log: { level: "info" }, dns: { servers: [] } },
  settings: { k1: "v1" },
  inbounds: [{ id: 1, tag: "vless-in", listen_port: 443 }],
  outbounds: [{ id: 2, tag: "direct" }],
  endpoints: [],
  services: [],
  tls: [{ id: 3, server: { enabled: true } }],
  clients: [{ id: 4, name: "alice" }],
});

describe("configHashOf", () => {
  it("同样内容一定得到同一个指纹", async () => {
    expect(await configHashOf(base())).toBe(await configHashOf(base()));
  });

  it("键的插入顺序不影响结果（SELECT 换序不能造成「内容变了」）", async () => {
    const a = base();
    const b = {
      clients: a.clients,
      tls: a.tls,
      services: a.services,
      endpoints: a.endpoints,
      outbounds: a.outbounds,
      inbounds: a.inbounds,
      settings: a.settings,
      config: { dns: a.config.dns, log: a.config.log },
    };
    expect(await configHashOf(a as never)).toBe(await configHashOf(b as never));
  });

  it("内容变化一定改变指纹", async () => {
    const changed = base();
    changed.inbounds[0].listen_port = 8443;
    expect(await configHashOf(changed)).not.toBe(await configHashOf(base()));
  });

  it("客户端结构变化会改变指纹（up/down 是否进指纹见 fingerprint.test.ts）", async () => {
    const changed = base();
    changed.clients[0].name = "bob";
    expect(await configHashOf(changed)).not.toBe(await configHashOf(base()));
  });

  it("数组顺序变化会改变指纹（顺序本身就是配置语义的一部分）", async () => {
    const a = base();
    a.outbounds = [
      { id: 2, tag: "direct" },
      { id: 5, tag: "proxy" },
    ];
    const b = base();
    b.outbounds = [
      { id: 5, tag: "proxy" },
      { id: 2, tag: "direct" },
    ];
    expect(await configHashOf(a)).not.toBe(await configHashOf(b));
  });
});
