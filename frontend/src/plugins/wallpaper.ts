/**
 * plugins/wallpaper.ts
 *
 * 壁纸：只铺「桌面」，不铺「纸」。
 *
 * 三条硬约束，写在代码里而不是文档里：
 * 1. 内容面板（--surface）永远不透明。壁纸只透过页面底（--paper），
 *    否则表格和表单会压在图上，对比度直接崩。半透明面板是显式开关，默认关。
 * 2. 图片进浏览器之前先降采样到 ≤1280 宽。filter: blur(40px) 直接糊 4K 原图
 *    会掉帧；降采样后视觉等效、代价降一个数量级（见 animation-performance）。
 * 3. 遮罩不是装饰，是对比度工具。采样图片最亮的那一格算「估算对比度」，
 *    低于 4.5:1 就报警并给一键修正——用最亮处算，因为深色字最怕亮块。
 */

export type WpBuiltin = 'none' | 'fiber' | 'grid' | 'dots'
export type WpFit = 'cover' | 'contain'

export interface WpConfig {
  on: boolean
  /** 图片源：已降采样的 dataURL，或无法跨域处理时直接用原始 URL */
  srcLight: string
  srcDark: string
  /** 首帧用的 32px 缩略图，避免先白后黑 */
  thumbLight: string
  thumbDark: string
  /** 是否能安全采样亮度（跨域图片为 false，只能手动调遮罩） */
  sampledLight: boolean
  sampledDark: boolean
  /** 4×4 网格里最亮那格的平均亮度（0–1，-1 表示没采到） */
  lumLight: number
  lumDark: number
  builtin: WpBuiltin
  blur: number
  contrast: number
  saturate: number
  veil: number
  fit: WpFit
  glass: boolean
}

const KEY = 'ui.wallpaper'
const MAX_W = 1280
const THUMB_W = 32

export const DEFAULT_WP: WpConfig = {
  on: false,
  srcLight: '',
  srcDark: '',
  thumbLight: '',
  thumbDark: '',
  sampledLight: false,
  sampledDark: false,
  lumLight: -1,
  lumDark: -1,
  builtin: 'none',
  blur: 0,
  contrast: 100,
  saturate: 100,
  veil: 30,
  fit: 'cover',
  glass: false,
}

export function readWp(): WpConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_WP }
    return { ...DEFAULT_WP, ...(JSON.parse(raw) as Partial<WpConfig>) }
  } catch {
    return { ...DEFAULT_WP }
  }
}

/** 只存参数（滑块每次拖动都会调，别每次都写图片） */
export function saveParams(c: WpConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...c, srcLight: '', srcDark: '' }))
  } catch {
    /* 存不下不影响当前会话 */
  }
}

/** 存参数 + 落图片 */
export function saveWp(c: WpConfig) {
  try {
    // 大图不放 localStorage（5MB 上限），只存缩略图与参数
    const slim: WpConfig = { ...c, srcLight: '', srcDark: '' }
    localStorage.setItem(KEY, JSON.stringify(slim))
    void putImg('light', c.srcLight)
    void putImg('dark', c.srcDark)
  } catch {
    /* 存不下就只影响下次打开，界面仍然可用 */
  }
}

/* ----------------------------------------------------------- IndexedDB */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sui-wp', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('img')) db.createObjectStore('img')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function putImg(slot: 'light' | 'dark', value: string) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('img', 'readwrite')
    const st = tx.objectStore('img')
    if (value) st.put(value, slot)
    else st.delete(slot)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function getImg(slot: 'light' | 'dark'): Promise<string> {
  try {
    const db = await openDb()
    const value = await new Promise<string>((resolve) => {
      const tx = db.transaction('img', 'readonly')
      const req = tx.objectStore('img').get(slot)
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : '')
      req.onerror = () => resolve('')
    })
    db.close()
    return value
  } catch {
    return ''
  }
}

/* ----------------------------------------------------------- 应用 */

const CSS_BUILTIN: Record<Exclude<WpBuiltin, 'none'>, { image: string; size: string }> = {
  // 注意：background-image 不认 `0 0/24px 24px` 这种 background 简写，
  // 尺寸必须单独走 background-size，否则整条声明失效（踩过一次，页面看着什么都不变）。
  fiber: {
    image:
      'repeating-linear-gradient(90deg, rgba(0,0,0,.035) 0 1px, transparent 1px 3px),' +
      'repeating-linear-gradient(0deg, rgba(0,0,0,.025) 0 1px, transparent 1px 4px),' +
      'radial-gradient(120% 90% at 30% 10%, rgba(255,255,255,.5), transparent 60%)',
    size: 'auto, auto, auto',
  },
  grid: {
    image:
      'linear-gradient(rgba(0,0,0,.06) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(0,0,0,.06) 1px, transparent 1px)',
    size: '24px 24px, 24px 24px',
  },
  dots: {
    image: 'radial-gradient(rgba(0,0,0,.10) 1px, transparent 1px)',
    size: '16px 16px',
  },
}

export function isDarkNow() {
  return isDark()
}

function isDark() {
  const t = document.documentElement.getAttribute('data-theme')
  if (t === 'dark') return true
  if (t === 'light') return false
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

/** 把配置写到 :root，纯同步，可安全在首帧前调用 */
export function applyWp(c: WpConfig) {
  const root = document.documentElement
  const dark = isDark()
  const src = dark ? c.srcDark || c.srcLight : c.srcLight || c.srcDark
  const thumb = dark ? c.thumbDark || c.thumbLight : c.thumbLight || c.thumbDark
  const pat = c.builtin !== 'none' ? CSS_BUILTIN[c.builtin] : null
  const active = c.on && !!(pat || src || thumb)

  root.style.setProperty('--wp-image', pat ? pat.image : thumb ? `url("${thumb}")` : 'none')
  root.style.setProperty('--wp-size', pat ? pat.size : c.fit)
  root.style.setProperty('--wp-blur', `${c.blur}px`)
  root.style.setProperty('--wp-contrast', `${c.contrast}%`)
  root.style.setProperty('--wp-saturate', `${c.saturate}%`)
  root.style.setProperty('--wp-veil', String(c.veil / 100))
  root.style.setProperty('--wp-fit', c.fit)
  // 双纹理叠一起会脏：开壁纸就把纸纹压到几乎看不见
  root.style.setProperty('--wp-grain', active ? '0.008' : '0.025')
  root.setAttribute('data-wallpaper', active ? (c.glass ? 'glass' : 'on') : 'off')

}

export async function initWallpaper() {
  const c = readWp()
  applyWp(c)
  // localStorage 里只有缩略图，大图在 IndexedDB
  const [l, d] = await Promise.all([getImg('light'), getImg('dark')])
  if (l || d) {
    c.srcLight = l || ''
    c.srcDark = d || ''
    applyWp(c)
  }
  lastDark = isDark()

  const resync = async () => {
    lastDark = isDark()
    const cfg = readWp()
    const [a, b] = await Promise.all([getImg('light'), getImg('dark')])
    cfg.srcLight = a || ''
    cfg.srcDark = b || ''
    applyWp(cfg)
  }

  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    void resync()
  })
  new MutationObserver(() => {
    if (isDark() !== lastDark) void resync()
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

let lastDark = false

/* ----------------------------------------------------------- 取图 */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load failed'))
    img.src = url
  })
}

function draw(img: HTMLImageElement, maxW: number) {
  const scale = Math.min(1, maxW / (img.naturalWidth || maxW))
  const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale))
  const h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('no 2d ctx')
  ctx.drawImage(img, 0, 0, w, h)
  return { cv, ctx, w, h }
}

/** 4×4 网格取最亮格的平均亮度（深色字最怕亮块，所以取最坏值） */
function brightestCell(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const cols = 4
  const rows = 4
  let worst = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor((c * w) / cols)
      const y = Math.floor((r * h) / rows)
      const cw = Math.max(1, Math.floor(w / cols))
      const ch = Math.max(1, Math.floor(h / rows))
      const d = ctx.getImageData(x, y, cw, ch).data
      let sum = 0
      let n = 0
      for (let i = 0; i < d.length; i += 4 * 7) {
        sum += srgbLum(d[i], d[i + 1], d[i + 2])
        n++
      }
      if (n) worst = Math.max(worst, sum / n)
    }
  }
  return worst
}

function srgbLum(r: number, g: number, b: number): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export interface PreparedImage {
  src: string
  thumb: string
  sampled: boolean
  lum: number
}

export async function prepareImage(input: File | string): Promise<PreparedImage> {
  const url = typeof input === 'string' ? input : URL.createObjectURL(input)
  try {
    const img = await loadImage(url)
    const { cv, ctx, w, h } = draw(img, MAX_W)
    const lum = brightestCell(ctx, w, h)
    const src = cv.toDataURL('image/webp', 0.86) || cv.toDataURL('image/jpeg', 0.86)
    const t = draw(img, THUMB_W)
    const thumb = t.cv.toDataURL('image/webp', 0.6) || t.cv.toDataURL('image/jpeg', 0.6)
    return { src, thumb, sampled: true, lum }
  } catch {
    // 跨域图片：canvas 读不了，直接用原 URL，亮度和降采样都放弃
    if (typeof input === 'string') return { src: input, thumb: '', sampled: false, lum: -1 }
    throw new Error('本地图片读取失败')
  } finally {
    if (typeof input !== 'string') URL.revokeObjectURL(url)
  }
}

/* ----------------------------------------------------------- 对比度 */

const PAPER = { light: [246, 245, 241], dark: [18, 18, 17] }
const INK = { light: [26, 26, 25], dark: [233, 231, 225] }

/** 遮罩把「最亮格」往纸色拉，返回估算对比度（最坏区域） */
export function estimateContrast(lum: number, veil: number, dark: boolean): number {
  if (lum < 0) return -1
  const paper = PAPER[dark ? 'dark' : 'light']
  const paperLum = srgbLum(paper[0], paper[1], paper[2])
  const v = Math.min(1, Math.max(0, veil / 100))
  // 亮度按遮罩比例线性混合（近似：遮罩是一层不透明纸色）
  const mixed = lum * (1 - v) + paperLum * v
  const ink = INK[dark ? 'dark' : 'light']
  const inkLum = srgbLum(ink[0], ink[1], ink[2])
  const a = Math.max(mixed, inkLum)
  const b = Math.min(mixed, inkLum)
  return (a + 0.05) / (b + 0.05)
}

/** 反推：达到 target 需要多少遮罩 */
export function suggestVeil(lum: number, dark: boolean, target = 4.5): number {
  if (lum < 0) return 0
  for (let v = 0; v <= 95; v++) {
    if (estimateContrast(lum, v, dark) >= target) return v
  }
  return 95
}
