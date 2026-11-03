/**
 * DESIGN.md ↔ paper.css 一致性测试
 *
 * 为什么需要它：DESIGN.md 声称「以本文件为准」，但它其实是**从实现反写**的。
 * 两边只要有一边改了颜色/字号/墨点尺寸而另一边没动，文档就开始骗人——而文档是
 * 后续所有 UI 改动的依据。手工核对靠不住（实测已经漂移过一次：--ink-3 深色从
 * #7e7b73 提到 #908d84，文档表还停在旧值）。
 *
 * 这里做双向断言：
 *   1. front matter 的 colors 必须等于 paper.css 浅色主题的真实取值
 *   2. 文档「颜色」表格里的每一格必须等于 CSS 里的真实取值（明暗两列都查）
 *   3. 文档写死的结构数字（字号刻度、墨点轨道/本体、圆角）必须和 CSS 一致
 *
 * 任一方向漂移 → 测试红，提醒「改了一边，另一边也要改」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')          // 仓库根
const DESIGN = readFileSync(resolve(ROOT, 'DESIGN.md'), 'utf8')
const PAPER = readFileSync(resolve(ROOT, 'frontend/src/styles/paper.css'), 'utf8')

/** 取某个主题块里的 CSS 变量：.v-theme--light { --paper: #f6f5f1; ... } */
function themeVars(selector: string): Record<string, string> {
  const at = PAPER.indexOf(selector)
  expect(at, `paper.css 里找不到 ${selector}`).toBeGreaterThan(-1)
  const open = PAPER.indexOf('{', at)
  const close = PAPER.indexOf('}', open)
  const body = PAPER.slice(open + 1, close)
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim()
  }
  return out
}

/** 取 front matter 里 colors: 这一段（扁平键值） */
function frontMatterColors(): Record<string, string> {
  const fm = DESIGN.match(/^---\n([\s\S]*?)\n---\n/)
  expect(fm, 'DESIGN.md 缺 front matter').not.toBeNull()
  const colors = fm![1].match(/\ncolors:\n((?: {2}[^\n]*\n)+)/)
  expect(colors, 'front matter 里缺 colors:').not.toBeNull()
  const out: Record<string, string> = {}
  for (const m of colors![1].matchAll(/^ {2}([a-z0-9-]+):\s*"([^"]+)"/gm)) {
    out[m[1]] = m[2]
  }
  return out
}

/** 取文档里那张「颜色（浅色 / 深色）」表格：| `--x` | `#aaa` | `#bbb` | 用途 | */
function docColorTable(): Array<{ name: string; light: string; dark: string }> {
  const rows: Array<{ name: string; light: string; dark: string }> = []
  for (const line of DESIGN.split('\n')) {
    const m = line.match(/^\|\s*`(--[a-z0-9-]+)`\s*\|\s*`(#[0-9a-fA-F]{3,8})`\s*\|\s*`(#[0-9a-fA-F]{3,8})`/)
    if (m) rows.push({ name: m[1], light: m[2].toLowerCase(), dark: m[3].toLowerCase() })
  }
  return rows
}

const light = themeVars('.v-theme--light')
const dark = themeVars('.v-theme--dark')
// 字号/字体/间距这些与主题无关，定义在 :root
const root = themeVars(':root {')   // 第二个 :root 块（字号/字体/间距）

describe('DESIGN.md ↔ paper.css', () => {
  it('文档颜色表两列都等于 CSS 的真实取值', () => {
    const rows = docColorTable()
    expect(rows.length, '文档里解析不到颜色表').toBeGreaterThanOrEqual(10)
    const bad: string[] = []
    for (const r of rows) {
      const cssLight = (light[r.name] || '').toLowerCase()
      const cssDark = (dark[r.name] || '').toLowerCase()
      if (!cssLight) bad.push(`${r.name} 在 paper.css 浅色主题里不存在`)
      else if (cssLight !== r.light) bad.push(`${r.name} 浅色：文档 ${r.light} ≠ CSS ${cssLight}`)
      if (cssDark && cssDark !== r.dark) bad.push(`${r.name} 深色：文档 ${r.dark} ≠ CSS ${cssDark}`)
    }
    expect(bad, bad.join('；')).toEqual([])
  })

  it('front matter 的 colors 与浅色主题一致', () => {
    const fm = frontMatterColors()
    expect(Object.keys(fm).length).toBeGreaterThanOrEqual(10)
    const bad: string[] = []
    for (const [k, v] of Object.entries(fm)) {
      const css = (light[`--${k}`] || '').toLowerCase()
      if (!css) continue // front matter 允许有别名 token（primary/tertiary 等）
      if (css !== v.toLowerCase()) bad.push(`${k}: front matter ${v} ≠ CSS ${css}`)
    }
    expect(bad, bad.join('；')).toEqual([])
  })

  it('字号刻度 11/12/13/15/19/26 与 CSS 一致', () => {
    const scale = [...DESIGN.matchAll(/字号刻度固定（不用 clamp）：([\d /\s]+)px/g)]
    expect(scale.length, '文档里找不到字号刻度那句话').toBe(1)
    const documented = scale[0][1].split('/').map((x) => Number(x.trim()))
    const actual = ['xs', 'sm', 'base', 'lg', 'xl', '2xl'].map((k) =>
      Number((root[`--fs-${k}`] || '').replace('px', '')),
    )
    expect(actual).toEqual(documented)
  })

  it('账簿墨点：文档写「轨道 14px、本体 6px」，CSS 必须一致', () => {
    expect(DESIGN).toContain('轨道 14px，墨点本体 6px')
    expect(PAPER).toMatch(/grid-template-columns:\s*14px/)
    const mark = PAPER.match(/\.ledger-mark\s*\{[^}]*\}/)
    expect(mark, '.ledger-mark 规则不存在').not.toBeNull()
    expect(mark![0]).toMatch(/width:\s*6px/)
    expect(mark![0]).toMatch(/height:\s*6px/)
  })

  it('圆角只有 2px 一档（文档说「按钮、输入框、卡片、chip 全部统一」）', () => {
    expect(DESIGN).toContain('圆角：2px')
    const radii = [...PAPER.matchAll(/--radius[a-z0-9-]*:\s*([^;]+);/g)].map((m) => m[1].trim())
    for (const r of radii) expect(r).toBe('2px')
  })
})

/** WCAG 2.x 相对亮度与对比度（公式照抄规范，不引第三方库） */
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

describe('配色可读性（这才是 --ink-3 那次回归的真正防线）', () => {
  // 正文三级色都要能当可读文字用：对纸面、对内容面板、明暗两版，全部 ≥ 4.5:1
  for (const [theme, vars] of [['浅色', light], ['深色', dark]] as const) {
    for (const ink of ['--ink', '--ink-2', '--ink-3']) {
      for (const bg of ['--paper', '--surface', '--surface-2']) {
        it(`${theme} ${ink} 在 ${bg} 上 ≥ 4.5:1`, () => {
          const ratio = contrast(vars[ink], vars[bg])
          expect(ratio, `${ink} ${vars[ink]} on ${bg} ${vars[bg]} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }

  it('强调色/异常色对纸面 ≥ 4.5:1（链接与错误文案要能读）', () => {
    for (const [theme, vars] of [['浅色', light], ['深色', dark]] as const) {
      for (const c of ['--accent', '--error', '--ok']) {
        const ratio = contrast(vars[c], vars['--paper'])
        expect(ratio, `${theme} ${c} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
