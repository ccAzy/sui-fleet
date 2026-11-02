import type { D1Database } from "@cloudflare/workers-types";
import { first } from "../db";
import type { ObjectKind } from "./consts";

export type J = Record<string, unknown>;

export const isObj = (v: unknown): v is J =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const o = (v: unknown): J => (isObj(v) ? v : {});

export const s = (v: unknown): string => (typeof v === "string" ? v : "");

export const num = (v: unknown): number =>
  typeof v === "number" ? v : parseInt(String(v ?? 0), 10) || 0;

export const USER_TYPES = new Set([
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "shadowtls",
  "hysteria",
  "hysteria2",
  "tuic",
  "anytls",
  "socks",
  "http",
  "mixed",
]);

/** s-ui 在读取时会把"引用了该入站的客户端"挂进 inbound.users，面板据此显示客户端数。
 *  存储里不落这个字段（它由客户端表推导），所以每次读的时候现算。 */

export function protocolKeyOf(inbound: J): string {
  const type = s(inbound.type);
  if (type === "shadowsocks") {
    // 必须与节点侧 util.ShadowsocksClientConfigKey 完全一致：
    // s-ui 把 SS-2022 的用户配置存在 shadowsocks16 / shadowsocks32 下，
    // 不是存在完整 method 名里。写成 method 名会导致用户挂不上、节点 SQL 取到 NULL。
    const m = s(inbound.method);
    if (m === "2022-blake3-aes-128-gcm") return "shadowsocks16";
    if (
      m === "2022-blake3-aes-256-gcm" ||
      m === "2022-blake3-chacha20-poly1305"
    )
      return "shadowsocks32";
    return "shadowsocks";
  }
  return type;
}

export function inboundIds(c: J): number[] {
  return (Array.isArray(c.inbounds) ? c.inbounds : [])
    .map((x) => (typeof x === "number" ? x : num(o(x).id)))
    .filter((n) => n > 0);
}

export function hydrateUsers(inbounds: J[], clients: J[]): J[] {
  const enabled = clients.filter((c) => c.enable !== false);
  return inbounds.map((ib) => {
    const type = s(ib.type);
    if (!USER_TYPES.has(type)) return ib;
    const id = num(ib.id);
    const key = protocolKeyOf(ib);
    const users = enabled
      .filter((c) => inboundIds(c).includes(id))
      .map((c) => o(o(c.config)[key]))
      .filter((u) => Object.keys(u).length > 0);
    return { ...ib, users };
  });
}

export function toArray(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [data];
}

/**
 * 删除时的主键解析。
 *
 * 前端删除传的是 **tag** 而不是 id（Inbounds.vue 的 `Data().save("inbounds","del",tag)`），
 * 而 outbounds/endpoints/services/tls 也各有用 tag 或 id 的调用点，因此这里统一兼容：
 *   - 数字 / 纯数字字符串 → 直接当 obj_id
 *   - 其它字符串 → 当 tag 查（name 走同一列，新建时 tag 就取自 tag||name）
 *   - 对象 → 先看 id，再看 tag/name
 * 只按 id 解析会让前端删除变成静默空操作（接口返回成功但一行没删）。
 */

export async function resolveIds(
  db: D1Database,
  nodeId: string,
  kind: ObjectKind,
  data: unknown,
): Promise<number[]> {
  const out: number[] = [];
  const push = (n: number) => {
    if (n > 0 && !out.includes(n)) out.push(n);
  };
  const byTag = async (tag: string) => {
    const row = await first<{ obj_id: number }>(
      db,
      "SELECT obj_id FROM objects WHERE node_id = ? AND kind = ? AND tag = ?",
      nodeId,
      kind,
      tag,
    );
    if (row) push(num(row.obj_id));
  };

  for (const d of toArray(data)) {
    if (isObj(d)) {
      const id = num(o(d).id);
      if (id > 0) {
        push(id);
        continue;
      }
      const tag = s(o(d).tag) || s(o(d).name);
      if (tag) await byTag(tag);
      continue;
    }
    if (typeof d === "number") {
      push(d);
      continue;
    }
    const str = s(d).trim();
    if (!str) continue;
    const n = Number(str);
    if (Number.isInteger(n) && n > 0) {
      push(n);
      continue;
    }
    await byTag(str);
  }
  return out;
}

/** 重算某节点的全部 client.links（inbound 变更后调用）。
 *  s-ui 的约定：client.inbounds 是 id 数组，client.links 是 {remark,type,uri} 数组，
 *  其中 type=local 的由服务端按入站重算，external/sub 的原样保留。 */

export async function nextId(
  db: D1Database,
  nodeId: string,
  kind: ObjectKind,
): Promise<number> {
  const row = await first<{ m: number }>(
    db,
    "SELECT COALESCE(MAX(obj_id), 0) as m FROM objects WHERE node_id = ? AND kind = ?",
    nodeId,
    kind,
  );
  return (row?.m ?? 0) + 1;
}

/** 校验 id/tag 唯一性（s-ui 里 tag 是 unique 约束）。 */

export async function tagTaken(
  db: D1Database,
  nodeId: string,
  kind: ObjectKind,
  tag: string,
  exceptId: number,
): Promise<boolean> {
  if (!tag) return false;
  const row = await first<{ c: number }>(
    db,
    "SELECT COUNT(*) as c FROM objects WHERE node_id = ? AND kind = ? AND tag = ? AND obj_id <> ?",
    nodeId,
    kind,
    tag,
    exceptId,
  );
  return (row?.c ?? 0) > 0;
}
