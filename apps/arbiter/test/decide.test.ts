import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, normalizeOrder, type ArbiterState } from '../src/decide.ts'

const base: ArbiterState = { epoch: 3, failures: 0, lastSwitchAt: 0 }
const input = {
  probeOk: false,
  currentPrimary: 'hk',
  order: ['hk', 'jp', 'vn'],
  now: 1_000_000,
  threshold: 3,
  cooldownMs: 600_000,
}

test('探活正常 → 失败计数归零', () => {
  const d = decide({ ...base, failures: 2 }, { ...input, probeOk: true })
  assert.equal(d.action, 'reset')
  assert.equal(d.state.failures, 0)
})

test('未到阈值 → 只累计失败，不切', () => {
  const d = decide(base, input)
  assert.equal(d.action, 'wait')
  assert.equal(d.state.failures, 1)
  assert.equal(d.state.epoch, 3)
})

test('达到阈值 → 切到顺位下一台，epoch +1', () => {
  const d = decide({ ...base, failures: 2 }, input)
  assert.equal(d.action, 'switch')
  if (d.action !== 'switch') return
  assert.equal(d.to, 'jp')
  assert.equal(d.state.epoch, 4)
  assert.equal(d.state.failures, 0)
})

test('冷却窗口内不重复切', () => {
  const d = decide(
    { epoch: 4, failures: 5, lastSwitchAt: input.now - 60_000 },
    { ...input, order: ['jp', 'hk', 'vn'], currentPrimary: 'jp' },
  )
  assert.equal(d.action, 'wait')
})

test('顺位表里没有备选 → exhausted', () => {
  const d = decide({ ...base, failures: 2 }, { ...input, order: ['hk'] })
  assert.equal(d.action, 'exhausted')
})

test('顺位表规范化：去空、去重、保序', () => {
  assert.deepEqual(normalizeOrder([' hk ', 'jp', 'hk', '', 'vn']), ['hk', 'jp', 'vn'])
  assert.deepEqual(normalizeOrder('hk,jp'), [])
})
