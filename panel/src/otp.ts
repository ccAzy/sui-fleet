// TOTP（RFC 6238）+ 恢复码。
//
// 为什么不用短信/邮件：面板没有短信通道，邮件通道一旦失效就等于被锁在门外；
// TOTP 是纯本地计算，断网也能出码，且不依赖任何第三方服务。
//
// 注意两个必须做对的地方：
//  1. 重放：同一个 30 秒步长只能成功一次，否则截获一个码在窗口内可反复用。
//  2. 恢复：一定要有"手机丢了还能进"的路径，否则就是自己给自己上锁。

const DIGITS = 6;
const STEP = 30;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 随机 base32 密钥（默认 20 字节 = 32 字符，与 Google Authenticator 一致） */
export function newSecret(bytes = 20): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let bits = "";
  for (const b of raw) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5)
    out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

/**
 * 返回 Uint8Array<ArrayBuffer>：直接用 ArrayBuffer 构造，类型上就是合法的 BufferSource，
 * 免得在 importKey 那里写 `as unknown as BufferSource`（那是把类型问题藏起来，不是解决）。
 */
export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const s = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const len = Math.floor(bits.length / 8);
  const out = new Uint8Array(new ArrayBuffer(len));
  for (let i = 0; i < len; i++)
    out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

/** 当前（或指定）时间步长的 6 位码 */
export async function totpAt(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // 64 位大端计数：取高 32 位（到 2106 年都不会溢出低 32 位）
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const off = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[off] & 0x7f) << 24) |
    ((mac[off + 1] & 0xff) << 16) |
    ((mac[off + 2] & 0xff) << 8) |
    (mac[off + 3] & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function currentStep(at = Date.now()): number {
  return Math.floor(at / 1000 / STEP);
}

/**
 * 校验 6 位码。窗口 ±1 步（共 90 秒），容忍手机时钟轻微漂移。
 * 返回命中的步长；失败返回 0。
 * lastStep 是上次成功用掉的步长——命中值 <= lastStep 一律拒绝（防重放）。
 */
export async function totpVerify(
  secret: string,
  code: string,
  lastStep = 0,
  at = Date.now(),
): Promise<number> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== DIGITS) return 0;
  const step = currentStep(at);
  for (const delta of [0, -1, 1]) {
    const s = step + delta;
    if (s <= lastStep) continue;
    if ((await totpAt(secret, s)) === clean) return s;
  }
  return 0;
}

/* ----------------------------------------------------------- 恢复码 */

/** 去掉容易看错的 0/O/1/I，10 个码足够用一年 */
export function newRecoveryCodes(count = 10): string[] {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.getRandomValues(new Uint8Array(10));
    out.push([...raw].map((b) => alphabet[b % alphabet.length]).join(""));
  }
  return out;
}

/** 恢复码只在库里存 sha256；比对时统一去掉空格与连字符 */
export async function hashRecovery(code: string): Promise<string> {
  const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(norm),
  );
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** otpauth:// URI，交给前端生成二维码 */
export function otpauthURI(
  secret: string,
  account: string,
  issuer = "s-ui cloud",
) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
