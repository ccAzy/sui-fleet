// 静态资源：等价于 Cloudflare Workers Assets 的行为（含 SPA 深链兜底）。
//
// 为什么要自己写而不是用 express.static：Cloudflare 的语义是
//   「命中文件 → 返回文件；未命中 → 返回 index.html（single-page-application）」
// 而且缓存头要和线上一致（带 content-hash 的 assets 可长缓存，index.html 不能）。
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

export type AssetsBinding = {
  fetch: (input: Request) => Promise<Response>
}

export function createAssets(distDir: string): AssetsBinding {
  const root = resolve(distDir)

  async function readIfFile(file: string): Promise<Buffer | null> {
    try {
      const info = await stat(file)
      if (!info.isFile()) return null
      return await readFile(file)
    } catch {
      return null
    }
  }

  async function fetch(input: Request): Promise<Response> {
    // URL 解析失败（畸形请求）直接当作 404，不要让异常冒到服务层
    let url: URL
    try {
      url = new URL(input.url)
    } catch {
      return new Response('bad request', { status: 400 })
    }
    const rawPath = decodeURIComponent(url.pathname)
    // 防目录穿越：normalize 后必须仍在 dist 目录内
    const rel = normalize(rawPath).replace(/^(\.\.[/\\])+/, '')
    const target = join(root, rel === sep ? 'index.html' : rel)
    if (!target.startsWith(root)) return new Response('forbidden', { status: 403 })

    if (input.method !== 'GET' && input.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 })
    }

    const file = await readIfFile(target)
    if (file) {
      const ext = extname(target).toLowerCase()
      // 带内容哈希的产物可以长缓存；入口文件必须每次回源，否则更新推不下去
      const immutable = /-(?:[A-Za-z0-9_-]{8,})\.[a-z0-9]+$/.test(target) && !target.endsWith('index.html')
      return new Response(file, {
        status: 200,
        headers: {
          'Content-Type': TYPES[ext] ?? 'application/octet-stream',
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      })
    }

    // SPA 兜底：未命中的路径交给前端路由
    const index = await readIfFile(join(root, 'index.html'))
    if (!index) return new Response('not found', { status: 404 })
    return new Response(index, {
      status: 200,
      headers: { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' },
    })
  }

  return { fetch }
}
