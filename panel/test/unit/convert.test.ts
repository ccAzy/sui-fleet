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

// 回归用例：short-id 恰好是 `50e9`（= 50×10⁹），不引引号会被 YAML 当浮点，
// Karing 报 “type 'double' is not a subtype of type 'String?'” 并把整条 vless 丢掉
const VLESS_SID_SCI =
  "vless://11111111-2222-3333-4444-555555555555@1.2.3.4:18417" +
  "?type=tcp&security=reality&pbk=TrsKws6hJseeVGwMIqUtY9z_uZLwUpmBC_nX9DgRrBc" +
  "&fp=chrome&sni=www.apple.com&sid=50e9&flow=xtls-rprx-vision#vless-sid-sci";

const SS = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@5.6.7.8:8388#ss-test";

const HY2 = "hysteria2://pass@9.9.9.9:443?sni=www.bing.com#hy2-test";

// 带 insecure=1 的真实形态（节点默认用自签证书，少了 insecure 客户端连不上）
const HY2_INSECURE =
  "hysteria2://sMjUfexWEa@67.215.233.13:23059?security=tls&insecure=1&sni=www.apple.com#hy2-insecure";

const TUIC =
  "tuic://11111111-2222-3333-4444-555555555555:pw@67.215.233.13:18211" +
  "?security=tls&insecure=1&sni=www.apple.com&alpn=h3&congestion_control=bbr#tuic-test";

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

  // 回归：YAML 会把 50e9 解析成浮点，short-id 必须是带引号的字符串
  it("short-id 像科学计数法时要加引号", () => {
    const yml = buildClashConfig([VLESS_SID_SCI], "us");
    expect(yml).toContain('short-id: "50e9"');
    // 正常 hex 不该被无谓地引引号（保持可读）
    expect(buildClashConfig([VLESS], "hk")).toContain("short-id: 84223ca3");
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

  // 回归：clash.ts 不给 hy2/tuic 设 `tls` 标记，singbox 这边如果照传就会丢 TLS ——
  // outbound 缺 tls/insecure 时客户端加载整份配置失败，用户看到的是「订阅只有几个节点」。
  it("hysteria2 必须带上 tls.insecure 与 sni", () => {
    const o = linkToOutbound(HY2_INSECURE) as any;
    expect(o.type).toBe("hysteria2");
    expect(o.tls?.enabled).toBe(true);
    expect(o.tls?.insecure).toBe(true);
    expect(o.tls?.server_name).toBe("www.apple.com");
  });

  it("tuic 必须带 tls + alpn + bbr", () => {
    const o = linkToOutbound(TUIC) as any;
    expect(o.type).toBe("tuic");
    expect(o.tls?.enabled).toBe(true);
    expect(o.tls?.insecure).toBe(true);
    expect(o.tls?.alpn).toEqual(["h3"]);
    expect(o.congestion_control).toBe("bbr");
  });
});

// ---------------------------------------------------------------------------
// 回归用例：vless 的 flow 是「入站 × 用户」的属性，不是客户端的属性。
//
// 同一个客户端常常同时挂在两个入站上：reality（要 xtls-rprx-vision）和
// ws（必须留空）。早期实现只看 client.config.vless.flow，于是 ws 链接也带上
// vision —— 客户端按 vision 握手、服务端走纯 WS，必然连不上，而且现象是
// 「节点在旁边、就是不通」，很难定位。
// ---------------------------------------------------------------------------
describe("genLinks 的 flow 选取", () => {
  const client = {
    name: "user-x",
    config: { vless: { uuid: "u-1", flow: "xtls-rprx-vision" } },
  };
  const tls = {
    server: { enabled: true, server_name: "a.example.com" },
    client: { enabled: true, insecure: true, server_name: "a.example.com" },
  };

  const realityInbound = {
    type: "vless",
    tag: "vless-reality",
    listen: "::",
    listen_port: 443,
    transport: {},
    tls_id: 1,
    users: [{ name: "user-x", uuid: "u-1", flow: "xtls-rprx-vision" }],
  };
  const wsInbound = {
    type: "vless",
    tag: "vless-argo",
    listen: "127.0.0.1",
    listen_port: 2087,
    transport: {
      type: "ws",
      path: "/argo",
      headers: { Host: "a.example.com" },
    },
    tls_id: 1,
    addrs: [{ server: "a.example.com", server_port: 443 }],
    users: [{ name: "user-x", uuid: "u-1", flow: "" }],
  };

  it("reality 入站保留 flow", async () => {
    const { genLinks } = await import("../../src/links");
    const [uri] = genLinks(
      client.config,
      realityInbound,
      tls,
      "1.2.3.4",
      "user-x",
    );
    expect(uri).toContain("flow=xtls-rprx-vision");
  });

  it("ws 入站不继承 reality 的 flow，且地址取 addrs", async () => {
    const { genLinks } = await import("../../src/links");
    const [uri] = genLinks(client.config, wsInbound, tls, "1.2.3.4", "user-x");
    expect(uri).toBeDefined();
    expect(uri).not.toContain("flow=");
    expect(uri).toContain("@a.example.com:443");
    expect(uri).toContain("type=ws");
    expect(uri).toContain("security=tls");
  });

  it("入站没登记该用户时退回 client.config 的 flow（老数据兼容）", async () => {
    const { genLinks } = await import("../../src/links");
    const legacy = { ...wsInbound, users: [] };
    const [uri] = genLinks(client.config, legacy, tls, "1.2.3.4", "user-x");
    expect(uri).toContain("flow=xtls-rprx-vision");
  });
});
