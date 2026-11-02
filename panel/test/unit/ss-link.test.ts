import { describe, expect, it } from "vitest";
import { linkToProxy } from "../../src/clash";

// SIP002 的 userinfo 是 base64，而 base64 字母表里有 `/`。
// 不先归一化就被 URL 解析器按路径切断：host 变成 base64 前缀，节点直接丢。
// 这条用例只有在 normalizeSSLink 生效时才会通过。
const B64 = "Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTo/YQ=="; // chacha20-ietf-poly1305:?a

describe("ss 链接里的 base64 斜杠", () => {
  it("含 / 的 base64 userinfo 仍能解析出正确的主机和密码", () => {
    const uri = `ss://${B64}@1.2.3.4:8388#ss-slash`;
    const p = linkToProxy(uri);
    expect(p).not.toBeNull();
    expect(p?.type).toBe("ss");
    expect(p?.server).toBe("1.2.3.4");
    expect(p?.port).toBe(8388);
    expect(p?.cipher).toBe("chacha20-ietf-poly1305");
    expect(p?.password).toBe("?a");
  });
});
