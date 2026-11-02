// 订阅 URL 的拼接。
//
// 两种部署的 subURI 形状不一样：
//   面板（Worker/自托管）：`https://host/sub/<nodeId>?k=<sub_key>`  —— 带查询串
//   Go 单机模式：        `http://host:2096/sub/`                  —— 不带查询串
//
// 以前的代码直接写 `${base}&client=alice`，在第二种情况下会拼成
// `/sub/&client=alice`（`&client` 落进路径），Gin 把整串当成 subid，必然 400。
// 所以查询参数一律走这个 helper，靠 hasQuery 决定用 `?` 还是 `&`。

export function withQuery(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

/**
 * 客户端订阅地址。
 * - 有 sub_token：一律用 `?t=<token>`（令牌自带作用域，去参数也拿不到别人的链接）
 * - 没有令牌：退回 `client=<name>` 过滤写法（面板的 cron 会给老客户端补令牌）
 */
export function clientSubUrl(
  subURI: string,
  token?: string,
  name?: string,
): string {
  if (!subURI) return "";
  const path = subURI.replace(/\?.*$/, "");
  if (token) return withQuery(path, "t", token);
  return name ? withQuery(subURI, "client", name) : subURI;
}
