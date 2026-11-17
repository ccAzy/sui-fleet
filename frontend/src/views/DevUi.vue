<script setup lang="ts">
import { ref } from 'vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Label from '@/components/ui/label/Label.vue'
import FormField from '@/components/ui/form-field/FormField.vue'
import Select from '@/components/ui/select/Select.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import Switch from '@/components/ui/switch/Switch.vue'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import DataTable from '@/components/ui/table/DataTable.vue'
import type { TableHeader } from '@/components/ui/table/DataTable.vue'

const text = ref('')
const pick = ref<string | number | null>('direct')
const checked = ref(true)
const enabled = ref(true)

const shadcnDialog = ref(false)
const vuetifyDialog = ref(false)

const plans = [
  { title: '直连 direct', value: 'direct' },
  { title: '代理 proxy', value: 'proxy' },
  { title: '阻断 block', value: 'block' },
]

const headers: TableHeader[] = [
  { title: '名称', key: 'name' },
  { title: '地址', key: 'addr' },
  { title: '端口', key: 'port', align: 'right' },
]

const rows = [
  { name: 'HK-01', addr: '192.0.2.10', port: 443 },
  { name: 'JP-02', addr: '198.51.100.20', port: 8443 },
  { name: 'VN-03', addr: '203.0.113.30', port: 2096 },
]

// v-data-table 的 TableHeader 类型用自己的 align 取值（start/end），
// 跟本项目的 TableHeader（left/center/right）不兼容，对照页里各用一份。
const vuetifyHeaders = headers.map((h) => ({ title: h.title, key: h.key }))

const svcRows = [
  { tag: 'vless-reality-46250', type: 'vless', port: 46250, tls: true, listen: '0.0.0.0' },
  { tag: 'hysteria2-50381', type: 'hysteria2', port: 50381, tls: true, listen: '0.0.0.0' },
  { tag: 'ss-2022-30814', type: 'shadowsocks', port: 30814, tls: false, listen: '0.0.0.0' },
  { tag: 'trojan-ws-2087', type: 'trojan', port: 2087, tls: true, listen: '127.0.0.1' },
]
</script>

<template>
  <v-app>
    <main class="mx-auto max-w-[1180px] px-8 py-10 text-[var(--ink)]" style="background: var(--paper); min-height: 100vh">
      <h1 class="text-[24px] font-semibold" style="font-family: var(--serif)">组件对照</h1>
      <p class="mt-1 text-[12px] text-[var(--ink-3)]">Vuetify（现有） · shadcn（新）— 并排看视觉是否一致</p>

      <!-- 按钮 -->
      <section class="mt-9">
        <h2 class="mb-3 text-[15px] font-semibold" style="font-family: var(--serif)">按钮</h2>
        <div class="grid grid-cols-2 gap-6">
          <div class="flex flex-wrap items-start gap-2">
            <div class="mb-1 w-full text-[11px] uppercase tracking-wider text-[var(--ink-3)]">Vuetify</div>
            <v-btn color="primary" size="small">主操作</v-btn>
            <v-btn variant="outlined" size="small">次操作</v-btn>
            <v-btn variant="text" size="small">文本</v-btn>
          </div>
          <div class="flex flex-wrap items-start gap-2">
            <div class="mb-1 w-full text-[11px] uppercase tracking-wider text-[var(--ink-3)]">shadcn</div>
            <Button size="sm">主操作</Button>
            <Button size="sm" variant="outline">次操作</Button>
            <Button size="sm" variant="ghost">文本</Button>
            <Button size="sm" variant="accent">选中态</Button>
            <Button size="sm" variant="destructive">删除</Button>
            <Button size="sm" disabled>禁用</Button>
          </div>
        </div>
      </section>

      <!-- 输入框 -->
      <section class="mt-9">
        <h2 class="mb-3 text-[15px] font-semibold" style="font-family: var(--serif)">输入框</h2>
        <div class="grid grid-cols-3 gap-5">
          <div class="space-y-3">
            <div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--ink-3)]">Vuetify（现）</div>
            <v-text-field v-model="text" label="主机地址" density="compact" variant="outlined" hide-details />
            <v-text-field model-value="禁用" label="禁用" density="compact" variant="outlined" hide-details disabled />
            <v-text-field v-model="text" label="带错误" density="compact" variant="outlined" hide-details error-messages="端口已被占用" />
          </div>
          <div class="space-y-3">
            <div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--ink-3)]">shadcn · 浮动标签</div>
            <FormField v-model="text" label="主机地址" placeholder="example.com" />
            <FormField model-value="禁用" label="禁用" disabled />
            <FormField v-model="text" label="带错误" error="端口已被占用" />
          </div>
          <div class="space-y-3">
            <div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--ink-3)]">shadcn · 上方标签</div>
            <div>
              <Label for="demo-host2" class="mb-1">主机地址</Label>
              <Input id="demo-host2" v-model="text" placeholder="example.com" />
            </div>
            <div>
              <Label for="demo-dis2" class="mb-1">禁用</Label>
              <Input id="demo-dis2" model-value="禁用" disabled />
            </div>
            <div>
              <Label for="demo-err2" class="mb-1">带错误</Label>
              <Input id="demo-err2" v-model="text" />
              <p class="mt-0.5 text-[11px] text-[var(--error)]">端口已被占用</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 下拉 -->
      <section class="mt-9">
        <h2 class="mb-3 text-[15px] font-semibold" style="font-family: var(--serif)">下拉选择</h2>
        <div class="grid grid-cols-2 gap-6">
          <div class="space-y-3">
            <div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--ink-3)]">Vuetify</div>
            <v-select v-model="pick" :items="plans" item-title="title" item-value="value" label="出站" density="compact" variant="outlined" hide-details />
            <v-select :items="plans" item-title="title" item-value="value" label="禁用" model-value="direct" density="compact" variant="outlined" hide-details disabled />
          </div>
          <div class="space-y-3">
            <div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--ink-3)]">shadcn</div>
            <Select v-model="pick" :items="plans" label="出站" clearable />
            <Select :items="plans" label="禁用" model-value="direct" disabled />
          </div>
        </div>
      </section>

      <!-- 勾选 / 开关 -->
      <section class="mt-9">
        <h2 class="mb-3 text-[15px] font-semibold" style="font-family: var(--serif)">勾选 / 开关</h2>
        <div class="grid grid-cols-2 gap-6">
          <div class="space-y-3">
            <div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--ink-3)]">Vuetify</div>
            <div class="flex items-center gap-5">
              <v-checkbox v-model="checked" label="启用" density="compact" hide-details color="primary" />
              <v-switch v-model="enabled" label="开启" density="compact" hide-details color="primary" />
            </div>
          </div>
          <div class="space-y-3">
            <div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--ink-3)]">shadcn</div>
            <div class="flex items-center gap-6 pt-1">
              <Checkbox v-model="checked" label="启用" />
              <Switch v-model="enabled" label="开启" />
            </div>
          </div>
        </div>
      </section>

      <!-- 弹窗 -->
      <section class="mt-9">
        <h2 class="mb-3 text-[15px] font-semibold" style="font-family: var(--serif)">弹窗</h2>
        <div class="flex items-center gap-3">
          <Button variant="outline" size="sm" @click="vuetifyDialog = true">Vuetify 弹窗</Button>
          <Button variant="outline" size="sm" @click="shadcnDialog = true">shadcn 弹窗</Button>
        </div>

        <v-dialog v-model="vuetifyDialog" max-width="520">
          <v-card>
            <v-card-title>Vuetify 标题</v-card-title>
            <v-card-text>
              <v-text-field v-model="text" label="名称" density="compact" variant="outlined" hide-details />
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="vuetifyDialog = false">取消</v-btn>
              <v-btn color="primary" @click="vuetifyDialog = false">保存</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <Dialog v-model:open="shadcnDialog" title="shadcn 标题" description="焦点陷阱、ESC、点遮罩关闭都由 reka-ui 处理">
          <FormField v-model="text" label="名称" placeholder="hk-01" />
          <template #footer>
            <Button variant="ghost" size="sm" @click="shadcnDialog = false">取消</Button>
            <Button size="sm" @click="shadcnDialog = false">保存</Button>
          </template>
        </Dialog>
      </section>

      <!-- 表格 -->
      <section class="mt-9">
        <h2 class="mb-3 text-[15px] font-semibold" style="font-family: var(--serif)">表格</h2>
        <div class="grid grid-cols-2 gap-6">
          <div>
            <div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--ink-3)]">Vuetify</div>
            <v-data-table :headers="vuetifyHeaders" :items="rows" density="compact" hide-default-footer />
          </div>
          <div>
            <div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--ink-3)]">shadcn</div>
            <DataTable :headers="headers" :items="rows" />
          </div>
        </div>
      </section>

      <!-- 整页改造对比 -->
      <section class="mt-12 mb-24 border-t-2 border-[var(--ink)] pt-8">
        <h2 class="text-[19px] font-semibold" style="font-family: var(--serif)">整页改造：服务页</h2>
        <p class="mt-1 max-w-[760px] text-[12px] leading-relaxed text-[var(--ink-3)]">
          同一份数据、同样的信息量，两种组织方式。改后的结构就是 DESIGN.md 里写的「账簿式名录」——
          入站、节点、客户端三个页面早就在用，只有服务页还是卡片墙。
        </p>

        <div class="mt-7 space-y-9">
          <!-- 改前 -->
          <div>
            <div class="mb-3 flex items-baseline gap-2">
              <span class="text-[13px] font-semibold text-[var(--ink)]">改前</span>
              <span class="text-[11px] text-[var(--ink-3)]">v-card 网格 · 每个服务一个框</span>
            </div>
            <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div v-for="s in svcRows" :key="s.tag" class="rounded-[2px] border border-[var(--rule)] bg-[var(--surface)]">
                <div class="border-b border-[var(--rule)] px-2.5 py-1.5 text-[12px] font-semibold" style="font-family: var(--serif)">{{ s.tag }}</div>
                <dl class="space-y-0.5 px-2.5 py-1.5 text-[11px]">
                  <div class="flex justify-between gap-2"><dt class="text-[var(--ink-3)]">类型</dt><dd class="truncate">{{ s.type }}</dd></div>
                  <div class="flex justify-between gap-2"><dt class="text-[var(--ink-3)]">端口</dt><dd class="tabular-nums">{{ s.port }}</dd></div>
                  <div class="flex justify-between gap-2"><dt class="text-[var(--ink-3)]">TLS</dt><dd>{{ s.tls ? '启用' : '关闭' }}</dd></div>
                </dl>
                <div class="flex gap-1 border-t border-[var(--rule)] px-1.5 py-1 text-[11px] text-[var(--ink-3)]">
                  <span>✎</span><span>🗑</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 改后 -->
          <div>
            <div class="mb-3 flex items-baseline gap-2">
              <span class="text-[13px] font-semibold text-[var(--ink)]">改后</span>
              <span class="text-[11px] text-[var(--ink-3)]">账簿名录 · 一行一个，靠列对齐扫读</span>
            </div>
            <div class="ledger">
              <div v-for="(s, i) in svcRows" :key="s.tag" class="ledger-row">
                <span class="ledger-mark" :data-state="s.tls ? 'up' : 'down'" aria-hidden="true"></span>
                <span class="ledger-name">{{ s.tag }}</span>
                <span class="ledger-meta">
                  <span class="mono">:{{ s.port }}</span>
                  <span class="sep">·</span>{{ s.type }}
                  <span class="sep">·</span>{{ s.tls ? 'TLS' : 'plain' }}
                  <span class="sep">·</span><span class="mono">{{ s.listen }}</span>
                </span>
                <div class="ledger-actions" :style="i === 0 ? 'opacity:1' : ''">
                  <span class="grid h-6 w-6 place-items-center text-[var(--ink-3)]">✎</span>
                  <span class="grid h-6 w-6 place-items-center text-[var(--ink-3)]">🗑</span>
                </div>
              </div>
            </div>
            <p class="mt-2 text-[11px] text-[var(--ink-3)]">
              操作按钮默认隐形（第一行是 hover 状态的样子），账目不需要满屏图标。
            </p>
          </div>
        </div>

        <div class="mt-8 grid grid-cols-3 gap-6 border-t border-[var(--rule)] pt-5 text-[12px] leading-relaxed text-[var(--ink-2)]">
          <div>
            <div class="mb-1 text-[10px] uppercase tracking-[0.1em] text-[var(--ink-3)]">改前的问题</div>
            四张卡片要占用四倍高度，横向只有四列；再多的服务就得往下滚。每个框自身的边线又切碎视线。
          </div>
          <div>
            <div class="mb-1 text-[10px] uppercase tracking-[0.1em] text-[var(--ink-3)]">改后</div>
            行高 36–40px，一屏能放二十多个；名称、端口、协议、TLS 各占一列，竖着扫一眼就对得上。墨点是唯一的状态信号。
          </div>
          <div>
            <div class="mb-1 text-[10px] uppercase tracking-[0.1em] text-[var(--ink-3)]">顺带修掉</div>
            原来每张卡片各自维护一个 delOverlay[index]，删掉中间一张后索引全偏移，点 A 弹 B。现在只记一个删除目标。
          </div>
        </div>
      </section>
    </main>
  </v-app>
</template>
