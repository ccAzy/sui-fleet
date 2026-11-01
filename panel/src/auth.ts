// 认证：PBKDF2-SHA256 存密码（Workers 无 bcrypt），HMAC-SHA256 自签 JWT 走 HttpOnly cookie。
import type { D1Database } from '@cloudflare/workers-types'
import { first, run, now, type UserRow } from './db'

const ITER = 10_000

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    key,
    256,
  )
  return `pbkdf2$${ITER}$${b64(salt.buffer)}$${b64(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iter = parseInt(parts[1], 10)
  const salt = unb64(parts[2])
  const expected = parts[3]
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256)
  const got = b64(bits)
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

const enc = (o: unknown): string =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function signJWT(payload: Record<string, unknown>, secret: string, ttlSeconds = 86400): Promise<string> {
  const body = { ...payload, iat: now(), exp: now() + ttlSeconds }
  const head = enc({ alg: 'HS256', typ: 'JWT' })
  const data = `${head}.${enc(body)}`
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(data))
  return `${data}.${b64(sig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

export async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const data = `${parts[0]}.${parts[1]}`
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(data))
  const expect = b64(sig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (expect !== parts[2]) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
    const exp = typeof payload.exp === 'number' ? payload.exp : 0
    if (exp && exp < now()) return null
    return payload
  } catch {
    return null
  }
}

export async function getUser(db: D1Database, username: string): Promise<UserRow | null> {
  return await first<UserRow>(db, 'SELECT * FROM users WHERE username = ?', username)
}

/** 首次启动按 env 里的 ADMIN_USER / ADMIN_PASS 建号（缺省 admin/admin）。 */
export async function ensureAdmin(db: D1Database, user = 'admin', pass = 'admin'): Promise<boolean> {
  const exists = await first<UserRow>(db, 'SELECT id FROM users LIMIT 1')
  if (exists) return false
  // 没配 ADMIN_PASS（或还是 admin）时强制首次登录改密，避免面板裸奔
  const weak = !pass || pass === 'admin'
  await run(
    db,
    'INSERT INTO users (username, password_hash, must_change, created_at) VALUES (?, ?, ?, ?)',
    user,
    await hashPassword(pass || 'admin'),
    weak ? 1 : 0,
    now(),
  )
  return true
}

export async function login(db: D1Database, username: string, password: string): Promise<UserRow | null> {
  const u = await getUser(db, username)
  if (!u) return null
  if (!(await verifyPassword(password, u.password_hash))) return null
  return u
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** agent token：随机 32 字节，库里只存 sha256。 */
export async function newAgentToken(): Promise<{ token: string; hash: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const token = [...raw].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { token, hash: await sha256(token) }
}

export const COOKIE = 'sui_session'

/**
 * 备份令牌：给"顺位 2 的定时快照"用——无人值守地拉一次全量备份。
 *
 * 为什么需要：`/api/getdb` 原本只认登录会话，备用机没有密码（也不该有），
 * 于是备份只能靠人工点。令牌存在 meta.backup_token_hash（只存 sha256），
 * 48 位 hex、常数时间比较、每次使用落一条 changes 审计。
 *
 * 这个令牌能读到整库（含密码哈希与 TOTP 密钥），因此只在"备用机定时拉"这一
 * 个场景使用，且必须与面板同域不同路径地暴露在 HTTPS 后面。
 */
export async function verifyBackupToken(db: D1Database, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{48}$/.test(token)) return false
  const row = await first<{ value: string }>(
    db,
    "SELECT value FROM meta WHERE key = 'backup_token_hash'",
  )
  if (!row?.value) return false
  const got = await sha256(token)
  if (got.length !== row.value.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ row.value.charCodeAt(i)
  return diff === 0
}
