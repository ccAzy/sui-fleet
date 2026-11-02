// 只读令牌的字段级脱敏。
//
// 为什么不是「把端点移出白名单」：
//   /api/endpoints|outbounds|services|inbounds 是监控真正需要看的（连接数、握手、
//   流量都从这些对象里读），但它们的对象 JSON 里同时住着 WireGuard/Reality 私钥、
//   DERP/mesh 的 service token、入站密码。机密性取决于**字段**，不取决于端点名。
//   只要还按端点放行，就一定会有下一个「这个端点应该不含密钥」的错误假设。
//
// 所以：令牌身份访问到的响统一过这一层，按 key 名剔除机密字段。

const SECRET_KEYS = new Set([
  "private_key",
  "public_key", // 与私钥成对，单独拿出去也足够指纹化一个节点
  "private_key_path",
  "private_key_passphrase", // SSH outbound：有它 + 私钥文件就能登录
  "client_key",
  "client_key_path",
  "password",
  "password_hash",
  "token",
  "token_hash",
  "uuid",
  "short_id",
  "psk",
  "pre_shared_key", // WireGuard peer：密钥材料，监控不需要
  "mesh_psk",
  "mesh_psk_file",
  "psk_file",
  "auth_key",
  "auth_str", // hysteria v1 的认证串
  "reality_private_key",
  "otp_secret",
  "sub_key",
  "sub_token",
  "jwt_secret",
  "secret",
  // 第 6 轮审计补：这些是 WARP(Cloudflare) 与 ACME(DNS-01) 的凭据键，
  // 之前漏在名单外 —— /api/outbounds 能把 WARP 的 access_token/license_key
  // 整串读出来，changes 日志里的 ACME api_token/access_key_secret 也一样。
  "access_token",
  "refresh_token",
  "license_key",
  "api_token",
  "api_key",
  "auth_token",
  "client_secret",
  "access_key_secret",
  "security_token",
  "secret_key",
  "session_token",
]);

/**
 * 这些键是「头名 → 头值」的映射。键名本身要留（监控要看目标是什么），
 * 值必须脱敏：里面可能就是 `Authorization: Bearer ...`。
 */
const HEADER_MAP_KEYS = new Set(["headers", "extra_headers"]);

/** 递归剔除机密字段。命中时替换为占位符，让「有但不可见」可被前端/测试识别。 */
export function redactForToken<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactForToken(v)) as never;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        HEADER_MAP_KEYS.has(k) &&
        v &&
        typeof v === "object" &&
        !Array.isArray(v)
      ) {
        out[k] = Object.fromEntries(
          Object.keys(v as Record<string, unknown>).map((h) => [
            h,
            "[redacted]",
          ]),
        );
        continue;
      }
      out[k] = SECRET_KEYS.has(k) ? "[redacted]" : redactForToken(v);
    }
    return out as never;
  }
  return value;
}
