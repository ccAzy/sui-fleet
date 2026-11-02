import { describe, expect, it } from "vitest";
import { buildClashConfig } from "../../src/clash";
import { buildSingboxConfig } from "../../src/singbox";

// 全协议「特征化测试」（characterization test / golden master）：
// 先把当前输出**原样钉住**，再重构转换代码——输出只要有一个字节变了测试就红。
//
// 为什么需要它：clash.ts 里的 TLS/传输拼装是"改错就静默给用户发错配置"的代码，
// 而重构前只有零散几条断言。钉住之后才敢把它改成表驱动。

const LINKS = [
  // VLESS + Reality（vision）
  "vless://11111111-2222-3333-4444-555555555555@1.2.3.4:443" +
    "?type=tcp&security=reality&pbk=TrsKws6hJseeVGwMIqUtY9z_uZLwUpmBC_nX9DgRrBc" +
    "&fp=chrome&sni=www.apple.com&sid=84223ca3&flow=xtls-rprx-vision#vless-reality",
  // VLESS + WS + TLS
  "vless://11111111-2222-3333-4444-555555555555@1.2.3.4:8443" +
    "?type=ws&security=tls&sni=example.com&host=example.com&path=%2Fws#vless-ws",
  // VLESS + gRPC
  "vless://11111111-2222-3333-4444-555555555555@1.2.3.4:9443" +
    "?type=grpc&security=tls&sni=example.com&serviceName=grpc#vless-grpc",
  // VMess + WS + TLS
  "vmess://" +
    Buffer.from(
      JSON.stringify({
        v: "2",
        ps: "vmess-ws",
        add: "5.5.5.5",
        port: "443",
        id: "11111111-2222-3333-4444-555555555555",
        aid: "0",
        scy: "auto",
        net: "ws",
        type: "none",
        host: "example.com",
        path: "/vm",
        tls: "tls",
        sni: "example.com",
      }),
    ).toString("base64"),
  // Trojan
  "trojan://password123@6.6.6.6:443?sni=example.com&allowInsecure=1#trojan",
  // Shadowsocks（老格式）
  "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@5.6.7.8:8388#ss",
  // Shadowsocks 2022
  "ss://MjAyMi1ibGFrZTMtYWVzLTI1Ni1nY206cGFzc3dvcmQ=@5.6.7.8:8389#ss2022",
  // Hysteria2（自签 + insecure）
  "hysteria2://pass@9.9.9.9:443?sni=www.bing.com&insecure=1#hy2",
  // TUIC
  "tuic://11111111-2222-3333-4444-555555555555:pw@9.9.9.9:8443" +
    "?security=tls&insecure=1&sni=example.com&alpn=h3&congestion_control=bbr#tuic",
  // AnyTLS
  "anytls://pw@9.9.9.9:8444?sni=example.com&insecure=1#anytls",
  // SOCKS5（国内中转常用）
  "socks5://user:pass@7.7.7.7:1080#socks5",
];

describe("转换输出的特征化快照", () => {
  it("Clash 全协议配置", () => {
    expect(buildClashConfig(LINKS, "snapshot")).toMatchSnapshot();
  });

  it("sing-box 全协议配置", () => {
    expect(buildSingboxConfig(LINKS, "snapshot")).toMatchSnapshot();
  });
});
