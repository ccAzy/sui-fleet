// 内核版本追踪：定时查上游 sing-box 最新 release，缓存进 meta 表。
// Worker 每 2 分钟跑一次 cron，但 GitHub 匿名 API 只有 60 次/小时，所以做 6 小时节流。
import type { D1Database } from "@cloudflare/workers-types";
import { first, now, run } from "./db";

const CHECK_INTERVAL = 6 * 3600;

export interface KernelInfo {
  latest: string;
  checkedAt: number;
}

export async function metaGet(db: D1Database, key: string): Promise<string> {
  const row = await first<{ value: string }>(
    db,
    "SELECT value FROM meta WHERE key = ?",
    key,
  );
  return row?.value ?? "";
}

export async function metaSet(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  await run(
    db,
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

export async function getKernelInfo(db: D1Database): Promise<KernelInfo> {
  return {
    latest: await metaGet(db, "kernel_latest"),
    checkedAt: parseInt((await metaGet(db, "kernel_checked_at")) || "0", 10),
  };
}

/** 拉上游最新 tag。失败静默（保留旧值），不影响面板其它功能。 */
export async function refreshKernelInfo(
  db: D1Database,
  force = false,
): Promise<KernelInfo> {
  const current = await getKernelInfo(db);
  if (!force && current.checkedAt && now() - current.checkedAt < CHECK_INTERVAL)
    return current;

  try {
    const res = await fetch(
      "https://api.github.com/repos/SagerNet/sing-box/releases/latest",
      {
        headers: {
          "User-Agent": "sui-panel-cf",
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!res.ok) return current;
    const data = (await res.json()) as { tag_name?: string };
    const tag = String(data.tag_name ?? "").trim();
    if (!tag) return current;
    await metaSet(db, "kernel_latest", tag);
    await metaSet(db, "kernel_checked_at", String(now()));
    return { latest: tag, checkedAt: now() };
  } catch {
    return current;
  }
}

/** 比对 "v1.13.18" 与 "v1.13.18" 这类标签，判断节点内核是否落后。 */
export function isOutdated(current: string, latest: string): boolean {
  const norm = (v: string) => v.trim().replace(/^v/i, "");
  const a = norm(current);
  const b = norm(latest);
  if (!a || !b) return false;
  if (a === b) return false;
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
