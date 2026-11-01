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
  "password",
  "token",
  "uuid",
  "psk",
  "mesh_psk",
  "auth_key",
  "short_id",
  "reality_private_key",
  "private_key_path",
]);

/** 递归剔除机密字段。命中时替换为占位符，让「有但不可见」可被前端/测试识别。 */
export function redactForToken<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactForToken(v)) as never;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k) ? "[redacted]" : redactForToken(v);
    }
    return out as never;
  }
  return value;
}
