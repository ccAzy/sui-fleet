import { test } from 'node:test'
import assert from 'node:assert/strict'
import { epochGate } from '../src/epoch.ts'

test('未配置令牌 → 不拦', () => {
  assert.deepEqual(epochGate({ local: 0, remote: 9, hasToken: false }), { allow: true, reason: 'no-token' })
})

test('代次相同 → 放行', () => {
  assert.deepEqual(epochGate({ local: 3, remote: 3, hasToken: true }), { allow: true, reason: 'fresh' })
})

test('本地落后 → 拒绝（防脑裂）', () => {
  const g = epochGate({ local: 2, remote: 5, hasToken: true })
  assert.equal(g.allow, false)
  assert.equal((g as { reason: string }).reason, 'stale')
})

test('落后但显式 SUI_FORCE → 放行', () => {
  assert.deepEqual(epochGate({ local: 2, remote: 5, hasToken: true, force: true }), { allow: true, reason: 'forced' })
})

test('仲裁不可达 → 按本地继续', () => {
  assert.deepEqual(epochGate({ local: 2, hasToken: true }), { allow: true, reason: 'unknown-remote' })
})
