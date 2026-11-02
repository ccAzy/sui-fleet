// 边界校验：请求体、备份文件、节点上报都在这里一次性 decode，
// 之后业务层可以拿"已经解析过的值"工作，不必再到处 typeof。
//
// 为什么集中在一处：以前这些判断散在 6 个 handler 里（112 处 unknown），
// 每加一个字段就多一处手写检查，且没人能说清"到底哪些字段是必需的"。
import { z } from "zod";

/** 校验失败：带字段路径，便于直接回给调用方 / 写日志。 */
export class ValidationError extends Error {
  readonly issues: string[];
  constructor(scope: string, issues: string[]) {
    super(`${scope} 校验失败：${issues.slice(0, 3).join("; ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

const issuesOf = (err: z.ZodError): string[] =>
  err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

/** 解析失败就抛 ValidationError（调用方统一 catch 成 400）。 */
export function decode<T>(schema: z.ZodType<T>, value: unknown, scope: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(scope, issuesOf(parsed.error));
  return parsed.data;
}

/** 需要"不抛异常、自己处理"时用。 */
export function tryDecode<T>(
  schema: z.ZodType<T>,
  value: unknown,
): { ok: true; data: T } | { ok: false; issues: string[] } {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, issues: issuesOf(parsed.error) };
}

/** /api/save 能接受的 object 类型。新增类型时这里会先报错，比运行期才发现好。 */
export const OBJECT_KINDS = [
  "inbounds",
  "outbounds",
  "endpoints",
  "services",
  "tls",
  "clients",
  "config",
  "settings",
  "servers",
] as const;

export const SaveEnvelope = z.object({
  object: z.enum(OBJECT_KINDS),
  action: z.string().min(1).max(32),
});

const TrafficDelta = z.object({
  tag: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  // 允许负数：节点侧计数器偶尔会抖。业务层仍按 Math.max(0, …) 累加，
  // 这里只拒绝"压根不是有限数"的脏值（NaN/Infinity 进了 SQL 会变 0 或报错）。
  up: z.number().finite().optional(),
  down: z.number().finite().optional(),
});

const CommandResult = z.object({
  id: z.number().int().nonnegative(),
  ok: z.boolean(),
  error: z.string().max(2000).optional(),
});

/** /agent/report 的请求体。字段都可选：老版本 agent 不会带新字段。 */
export const AgentReportBody = z.object({
  // 节点上报的字段名是 revision_applied（见 node/cmd/agent.go 的 reportBody）。
  // 这里曾经只写 revision，zod 默认 strip 未知键 → 上报里的 revision_applied 被丢掉，
  // nodes.applied_rev 永远停在旧值，「已下发 == 已应用」的验收因此失效。
  // 两个名字都收：老 agent 若只发 revision 也不会被拒。
  revision: z.number().int().nonnegative().optional(),
  revision_applied: z.number().int().nonnegative().optional(),
  agent_version: z.string().max(64).optional(),
  kernel_version: z.string().max(64).optional(),
  core_state: z.enum(["running", "stopped", "error"]).optional(),
  uptime: z.number().finite().optional(),
  last_log: z.string().max(20000).optional(),
  status: z.record(z.string(), z.unknown()).optional(),
  traffic: z.array(TrafficDelta).optional(),
  commands: z.array(CommandResult).max(500).optional(),
});

/** /api/importdb 的外形。表内容逐表校验在 backup.ts 里做（列名要对照 PRAGMA）。 */
export const ImportBundleSchema = z.object({
  kind: z.string().max(64).optional(),
  exported_at: z.union([z.string(), z.number()]).optional(),
  tables: z.record(z.string(), z.array(z.unknown())),
});

// ---- 对象数据的结构体检 --------------------------------------------------
//
// `/api/save` 的对象内容此前只校验了信封（object/action 对不对），data 原样入库。
// 后果：一个 `"port": "abc"` 或 `"listen": "__proto__"` 之类的值会一路传到节点，
// 渲染出的 sing-box 配置非法 → 内核起不来 → 整个节点断流，而面板显示"保存成功"。
//
// 这里不做业务级校验（每个协议的字段太多且随内核版本变化），只做三类体检：
//  1) 结构：必须是普通对象，禁止原型污染键，限深度与条目数；
//  2) 尺寸：字符串/数组/总字节封顶，防止一次保存把库塞爆；
//  3) 端口：凡是名字像端口的键，必须是 1..65535 的整数。
const PORT_KEY = /^(port|listen_port|server_port|dest_port|source_port|mport|obfs_port|target_port)$/;
const MAX_DEPTH = 8;
const MAX_ITEMS = 2000;
const MAX_STR = 8192;
const MAX_JSON_BYTES = 256 * 1024;
const BANNED = new Set(["__proto__", "prototype", "constructor"]);

function walk(v: unknown, depth: number, path: string): void {
  if (depth > MAX_DEPTH) throw new ValidationError("对象内容", [`${path} 嵌套过深`]);
  if (typeof v === "string") {
    if (v.length > MAX_STR) throw new ValidationError("对象内容", [`${path} 字符串过长`]);
    return;
  }
  if (typeof v === "number" && !Number.isFinite(v))
    throw new ValidationError("对象内容", [`${path} 不是有限数字`]);
  if (Array.isArray(v)) {
    if (v.length > MAX_ITEMS) throw new ValidationError("对象内容", [`${path} 数组过长`]);
    v.forEach((x, i) => walk(x, depth + 1, `${path}[${i}]`));
    return;
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > MAX_ITEMS) throw new ValidationError("对象内容", [`${path} 字段过多`]);
    for (const [k, x] of entries) {
      if (BANNED.has(k)) throw new ValidationError("对象内容", [`${path}.${k} 是非法键`]);
      if (PORT_KEY.test(k)) {
        const n = typeof x === "string" ? Number(x) : x;
        if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 65535)
          throw new ValidationError("对象内容", [`${path}.${k} 端口必须是 1..65535 的整数`]);
      }
      walk(x, depth + 1, `${path}.${k}`);
    }
  }
}

/** 校验并归一化 /api/save 的对象内容。非法时抛 ValidationError（→ 400）。 */
export function sanitizeObjectData(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new ValidationError("对象内容", ["必须是 JSON 对象"]);
  const bytes = JSON.stringify(input).length;
  if (bytes > MAX_JSON_BYTES)
    throw new ValidationError("对象内容", [`对象内容过大（${bytes} 字节）`]);
  walk(input, 0, "data");
  return input as Record<string, unknown>;
}
