#!/usr/bin/env node
/**
 * 生成 MDI 图标子集：只打包项目真正用到的图标。
 *
 * 背景：@mdi/font 全量是 7492 个图标类、4 种字体格式（eot/ttf/woff/woff2 共 3.6MB），
 * 而面板实际只用 100 多个。全量引入会让国内首屏多下 3MB 无用字节。
 *
 * 做法：
 *   1. 扫 src/ 里的 "mdi-xxx" 字面量（模板里没有动态拼接，扫描可靠）
 *   2. 扫 vuetify/lib 内置的 mdi-xxx（选择框箭头、chip 关闭、复选框等）
 *   3. 从 @mdi/font 的 CSS 里取这些类的码点，用 pyftsubset 裁字体
 *   4. 生成只含这些类的 CSS（@font-face 只留 woff2）
 *
 * 用法：node scripts/subset-mdi.mjs   （加图标后重跑，然后 npm run build）
 * 巡检：脚本会打印"找不到码点"的图标名——那是拼错或 MDI 改名，必须修。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const mdiCss = join(root, 'node_modules/@mdi/font/css/materialdesignicons.css')
const mdiWoff2 = join(root, 'node_modules/@mdi/font/fonts/materialdesignicons-webfont.woff2')
const outCss = join(root, 'src/styles/mdi-subset.css')
const outFont = join(root, 'src/assets/fonts/materialdesignicons-subset.woff2')

const ICON_RE = /mdi-[a-z0-9]+(?:-[a-z0-9]+)*/g

function walk(dir, exts, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, exts, acc)
    else if (exts.some(e => p.endsWith(e))) acc.push(p)
  }
  return acc
}

const used = new Set()
for (const f of walk(join(root, 'src'), ['.vue', '.ts', '.css'])) {
  for (const m of readFileSync(f, 'utf8').matchAll(ICON_RE)) used.add(m[0])
}

// Vuetify 内部图标（下拉箭头、chip 关闭、复选标记…）也要留
for (const f of walk(join(root, 'node_modules/vuetify/lib'), ['.mjs', '.js'])) {
  for (const m of readFileSync(f, 'utf8').matchAll(ICON_RE)) used.add(m[0])
}

const css = readFileSync(mdiCss, 'utf8')
const codepoints = new Map()
for (const m of css.matchAll(/\.(mdi-[a-z0-9-]+)::before\s*\{\s*content:\s*"\\([0-9A-Fa-f]+)";/g)) {
  codepoints.set(m[1], parseInt(m[2], 16))
}

const found = []
const missing = []
for (const name of [...used].sort()) {
  const cp = codepoints.get(name)
  if (cp) found.push([name, cp])
  else missing.push(name)
}

mkdirSync(dirname(outFont), { recursive: true })
const unicodes = found.map(([, cp]) => `U+${cp.toString(16).toUpperCase()}`).join(',')
execFileSync('python', ['-m', 'fontTools.subset', mdiWoff2,
  `--unicodes=${unicodes}`, '--flavor=woff2', '--layout-features=', '--no-hinting',
  `--output-file=${outFont}`], { stdio: 'inherit' })

const head = `/* 由 scripts/subset-mdi.mjs 生成，勿手改。
 * 只含项目用到的 ${found.length} 个图标；加新图标后重跑脚本。 */
@font-face {
  font-family: "Material Design Icons";
  src: url("../assets/fonts/materialdesignicons-subset.woff2") format("woff2");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

.mdi:before,
.mdi-set {
  display: inline-block;
  font: normal normal normal 24px/1 "Material Design Icons";
  font-size: inherit;
  text-rendering: auto;
  line-height: inherit;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`
const body = found.map(([n, cp]) => `.${n}::before {\n  content: "\\${cp.toString(16).toUpperCase()}";\n}`).join('\n\n')
writeFileSync(outCss, `${head}\n${body}\n`, 'utf8')

console.log(`icons used: ${used.size}, in subset: ${found.length}`)
if (missing.length) console.log(`MISSING codepoints (拼错或 MDI 改名): ${missing.join(', ')}`)
