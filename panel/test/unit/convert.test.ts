// 纯函数单测：链接 → Clash / sing-box 配置。
//
// 为什么只测这三个：它们是面板里唯一"输入字符串、输出配置"的确定性逻辑，
// 出错的后果是客户端导入订阅后连不上（历史上 SS-2022 键名映射错过一次）。
// 需要 D1/网络的路径由 test/e2e.py 覆盖，这里不重复。
import { describe, expect, it } from "vitest";
import { buildClashConfig, linkToProxy } from "../../src/clash";
import { buildSingboxOutbounds, linkToOutbound } from "../../src/singbox";

const VLESS =
  "vless://11111111-2222-3333-4444-555555555555@1.2.3.4:443" +
  "?type=tcp&security=reality&pbk=TrsKws6hJseeVGwMIqUtY9z_uZLwUpmBC_nX9DgRrBc" +
  "&fp=chrome&sni=www.apple.com&sid=84223ca3&flow=xtls-rprx-vision#vless-test";

const SS = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@5.6.7.8:8388#ss-test";

const HY2 = "hysteria2://pass@9.9.9.9:443?sni=www.bing.com#hy2-test";

describe("clash 转换", () => {
  it("vless+reality 保留端口、SNI 与公钥", () => {
    const p = linkToProxy(VLESS);
    expect(p).not.toBeNull();
    expect(p!.type).toBe("vless");
    expect(p!.port).toBe(443);
    expect(p!.server).toBe("1.2.3.4");
    expect((p as any)["servername"] ?? (p as any).sni).toBe("www.apple.com");
    const pbk = (p as any)["reality-opts"]?.["public-key"];
    expect(pbk).toBe("TrsKws6hJseeVGwMIqUtY9z_uZLwUpmBC_nX9DgRrBc");
  });

  it("生成完整 clash 配置：proxy-groups 与 rules 都在", () => {
    const yml = buildClashConfig([VLESS, SS], "jp");
    expect(yml).toContain("proxies:");
    expect(yml).toContain("proxy-groups:");
    expect(yml).toContain("rules:");
    expect(yml).toContain("MATCH,PROXY");
  });

  it("坏链接返回 null，不抛异常", () => {
    expect(linkToProxy("not-a-link")).toBeNull();
    expect(linkToProxy("")).toBeNull();
  });
});

describe("sing-box 转换", () => {
  it("vless+reality 打开 tls.reality", () => {
    const o = linkToOutbound(VLESS);
    expect(o).not.toBeNull();
    expect((o as any).type).toBe("vless");
    expect((o as any).tls?.enabled).toBe(true);
    expect((o as any).tls?.reality?.enabled).toBe(true);
  });

  it("三种协议都能产出 outbound", () => {
    const list = buildSingboxOutbounds([VLESS, SS, HY2]);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(3);
    const types = list.map((o: any) => o.type).sort();
    expect(types).toEqual(["hysteria2", "shadowsocks", "vless"]);
  });

  it("坏链接被跳过而不是整体失败", () => {
    const list = buildSingboxOutbounds(["bad", VLESS]);
    expect(list.length).toBe(1);
    expect((list[0] as any).type).toBe("vless");
  });
});
