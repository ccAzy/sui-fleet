// 代次闸门（纯函数）：被降级的实例不允许以主控身份启动。
//
// 为什么单独抽出来：这是防脑裂的唯一一道机械闸门，必须有确定性测试，
// 而不是靠"起两个进程观察一下"——上一次那样测的结果是不可靠的。
export type Gate =
  | { allow: true; reason: 'no-token' | 'fresh' | 'forced' | 'unknown-remote' }
  | { allow: false; reason: 'stale'; local: number; remote: number }

export interface GateInput {
  local: number
  /** undefined 表示仲裁不可达，此时按本地情况继续（不允许因为网络抖动把主控锁死） */
  remote?: number
  force?: boolean
  hasToken: boolean
}

export function epochGate(input: GateInput): Gate {
  if (!input.hasToken) return { allow: true, reason: 'no-token' }
  if (input.remote === undefined) return { allow: true, reason: 'unknown-remote' }
  if (input.remote > input.local) {
    if (input.force) return { allow: true, reason: 'forced' }
    return { allow: false, reason: 'stale', local: input.local, remote: input.remote }
  }
  return { allow: true, reason: 'fresh' }
}
