<template>
  <v-dialog transition="dialog-bottom-transition" width="600">
    <v-card class="rounded-lg" :loading="loading">
      <v-card-title>{{ $t('quickTemplate.title') }}</v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-container style="padding: 0;">
          <v-row v-if="hasServers">
            <v-col cols="12">
              <v-select
                hide-details
                :label="$t('server.deployTo')"
                :items="serverOptions"
                v-model="deployTo">
              </v-select>
            </v-col>
          </v-row>
          <v-row>
            <v-col cols="12">
              <v-select
                hide-details
                :label="$t('quickTemplate.pick')"
                :items="templates"
                v-model="selected">
              </v-select>
            </v-col>
          </v-row>
          <v-row v-if="selectedTemplate">
            <v-col cols="12">
              <v-card variant="tonal" color="primary">
                <v-card-text style="font-size: 0.85rem;">{{ selectedTemplate.desc }}</v-card-text>
              </v-card>
            </v-col>
          </v-row>
          <v-row>
            <v-col cols="12" :sm="needsPort ? 6 : 12">
              <v-text-field
                :label="$t('client.name')"
                v-model="form.clientName"
                hide-details>
              </v-text-field>
            </v-col>
            <v-col cols="12" sm="6" v-if="needsPort">
              <v-text-field
                :label="$t('in.port')"
                type="number"
                v-model.number="form.port"
                hide-details>
              </v-text-field>
            </v-col>
            <v-col cols="12" v-if="needsSni">
              <v-combobox
                :label="$t('quickTemplate.sni')"
                :hint="$t('quickTemplate.sniHint')"
                persistent-hint
                :items="sniPresets"
                v-model="form.sni">
              </v-combobox>
            </v-col>
          </v-row>
        </v-container>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" variant="outlined" @click="closeModal">
          {{ $t('actions.close') }}
        </v-btn>
        <v-btn color="primary" variant="tonal" :loading="loading" @click="create">
          {{ $t('quickTemplate.create') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
/**
 * 「★ All Protocols」的生成计划 —— 唯一事实来源。
 *
 * 一次建 5 个入站，但只有 3 种协议：VMess ×3、Hysteria2 ×1、TUIC ×1。
 * 三个 VMess 用不同端口（端口由 pickPort 现挑），tag 也会跟着端口区分。
 * 文案里的 {n} 直接取这个数组长度，不再用「模板下拉项数 - 1」，
 * 否则一个模板建多个入站时数字会对不上。
 */
export const BUILD_ALL_PLAN: { type: string; alpn?: string[]; outJson?: any }[] = [
  { type: 'vmess', alpn: ['h2', 'http/1.1'] },
  { type: 'vmess', alpn: ['h2', 'http/1.1'] },
  { type: 'vmess', alpn: ['h2', 'http/1.1'] },
  // Hysteria2 默认带端口跳跃：
  //   面板侧 —— out_json.server_ports 会进订阅链接（mport=...）
  //   节点侧 —— node/core/port_hop.go 读到它就建 iptables DNAT，
  //             把整段 UDP 转到真正的监听端口
  // 20000:30000 是固定段：用户防火墙/安全组只需要放行一次这一段。
  { type: 'hysteria2', outJson: { server_ports: ['20000:30000'] } },
  { type: 'tuic', alpn: ['h3'] },
]
import Data from '@/store/modules/data'
import HttpUtils from '@/plugins/httputil'
import RandomUtil from '@/plugins/randomUtil'
import { createInbound } from '@/types/inbounds'
import { randomConfigs } from '@/types/clients'
import { i18n } from '@/locales'
import { push } from 'notivue'

export default {
  props: ['visible'],
  emits: ['close'],
  data() {
    return {
      loading: false,
      selected: 'all',
      form: {
        clientName: '',
        port: 0,
        sni: 'www.apple.com',
      },
      // Known reliable Reality handshake targets (TLS1.3 + HTTP/2, own infra).
      sniPresets: ['www.apple.com', 'addons.mozilla.org', 'www.amazon.com', 'www.tesla.com', 'www.microsoft.com', 'www.bing.com'],
    }
  },
  watch: {
    visible(v: boolean) {
      if (v) this.reset()
    },
  },
  computed: {
    // "Deploy to" — which server the created node lands on. Picking a remote
    // switches the panel context to it (reusing the central-management proxy).
    hasServers(): boolean {
      return (Data().servers || []).length > 0
    },
    serverOptions(): any[] {
      return [
        { title: i18n.global.t('server.local'), value: '' },
        ...(Data().servers || []).map((s: any) => ({ title: s.name, value: String(s.id) })),
      ]
    },
    deployTo: {
      get(): string { return Data().currentServer },
      set(v: string) { Data().setCurrentServer(v ?? '') },
    },
    templates() {
      const t = (k: string) => i18n.global.t('quickTemplate.' + k)
      return [
        { title: t('all'), value: 'all' },
        { title: t('vlessReality'), value: 'vless-reality' },
        { title: t('hysteria2'), value: 'hysteria2' },
        { title: t('tuic'), value: 'tuic' },
        { title: t('vmess'), value: 'vmess' },
      ]
    },
    descKey(): string {
      const map: any = {
        'all': 'allDesc',
        'vless-reality': 'vlessRealityDesc',
        'shadowsocks': 'shadowsocksDesc',
        'hysteria2': 'hysteria2Desc',
        'tuic': 'tuicDesc',
        'trojan': 'trojanDesc',
        'vmess': 'vmessDesc',
        'anytls': 'anytlsDesc',
      }
      return map[this.selected]
    },
    selectedTemplate(): any {
      // {n} in allDesc = how many protocols "★ All" actually builds, derived
      // from the template list (minus the "all" entry) so the copy never goes
      // stale when protocols are added/removed. Ignored by descs without {n}.
      return { desc: i18n.global.t('quickTemplate.' + this.descKey, { n: BUILD_ALL_PLAN.length }) }
    },
    needsSni(): boolean {
      // Everything except Shadowsocks needs a domain (Reality handshake target
      // for VLESS, certificate name for the self-signed protocols).
      return this.selected !== 'shadowsocks'
    },
    needsPort(): boolean {
      // "All" auto-assigns a distinct port per protocol.
      return this.selected !== 'all'
    },
  },
  methods: {
    reset() {
      this.selected = 'all'
      this.form = {
        clientName: 'user-' + RandomUtil.randomLowerAndNum(6),
        port: RandomUtil.randomIntRange(10000, 60000),
        sni: 'www.apple.com',
      }
      this.loading = false
    },
    closeModal() {
      this.$emit('close')
    },
    async create() {
      // Resolve and lock the client name so every step uses the same value.
      if (!this.form.clientName) this.form.clientName = 'user-' + RandomUtil.randomLowerAndNum(6)
      const clientName = this.form.clientName.trim()
      if (Data().clients.some((c: any) => c.name === clientName)) {
        push.error({ message: i18n.global.t('quickTemplate.failName') })
        return
      }
      const port = Number(this.form.port)
      if (this.needsPort && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        push.error({ message: i18n.global.t('error.invalidData') + ': ' + i18n.global.t('in.port') })
        return
      }

      this.loading = true
      try {
        let clientId: number | null = null
        switch (this.selected) {
          case 'all': clientId = await this.buildAll(clientName); break
          case 'vless-reality': clientId = await this.buildVlessReality(port, clientName); break
          case 'hysteria2': clientId = await this.buildSelfSigned(port, clientName, 'hysteria2', 'hysteria2', { hysteria2: { name: clientName, password: RandomUtil.randomSeq(10) } }); break
          case 'vmess': clientId = await this.buildSelfSigned(port, clientName, 'vmess', 'vmess', { vmess: { name: clientName, uuid: RandomUtil.randomUUID() } }, ['h2', 'http/1.1']); break
          case 'tuic': clientId = await this.buildSelfSigned(port, clientName, 'tuic', 'tuic', { tuic: { name: clientName, uuid: RandomUtil.randomUUID(), password: RandomUtil.randomSeq(10) } }, ['h3']); break
          case 'trojan': clientId = await this.buildSelfSigned(port, clientName, 'trojan', 'trojan', { trojan: { name: clientName, password: RandomUtil.randomSeq(10) } }); break
          case 'anytls': clientId = await this.buildSelfSigned(port, clientName, 'anytls', 'anytls', { anytls: { name: clientName, password: RandomUtil.randomSeq(10) } }); break
        }
        if (clientId) {
          push.success({ title: i18n.global.t('success'), message: i18n.global.t('quickTemplate.success') })
          this.closeModal()
        }
      } catch (e: any) {
        push.error({ message: i18n.global.t('error.invalidData') + ': ' + (e?.toString() ?? '') })
      } finally {
        this.loading = false
      }
    },

    // ---- low-level helpers ----------------------------------------------
    err(detail: string) {
      push.error({ message: i18n.global.t('error.invalidData') + ': ' + detail })
    },
    tagExists(tag: string): boolean {
      if (Data().inbounds.some((i: any) => i.tag === tag)) {
        push.error({ message: i18n.global.t('quickTemplate.failName') })
        return true
      }
      return false
    },
    sniOr(fallback: string): string {
      return (this.form.sni || fallback).trim()
    },
    newClientId(clientName: string): number | null {
      return Data().clients.find((c: any) => c.name === clientName)?.id ?? null
    },
    async genReality(): Promise<{ priv: string, pub: string } | null> {
      const kp = await HttpUtils.get('api/keypairs', { k: 'reality' })
      if (!kp.success) return null
      let priv = '', pub = ''
      kp.obj.forEach((line: string) => {
        if (line.startsWith('PrivateKey')) priv = line.substring(12)
        if (line.startsWith('PublicKey')) pub = line.substring(11)
      })
      return (priv && pub) ? { priv, pub } : null
    },
    async genSelfSigned(sni: string): Promise<{ cert: string[], key: string[] } | null> {
      const msg = await HttpUtils.get('api/keypairs', { k: 'tls', o: sni || "''" })
      if (!msg.success || !msg.obj || msg.obj.length === 0) return null
      const key: string[] = [], cert: string[] = []
      let inKey = false, inCert = false
      msg.obj.forEach((line: string) => {
        if (line === '-----BEGIN PRIVATE KEY-----') { inKey = true; inCert = false; key.push(line) }
        else if (line === '-----END PRIVATE KEY-----') { inKey = false; key.push(line) }
        else if (line === '-----BEGIN CERTIFICATE-----') { inCert = true; inKey = false; cert.push(line) }
        else if (line === '-----END CERTIFICATE-----') { inCert = false; cert.push(line) }
        else if (inKey) key.push(line)
        else if (inCert) cert.push(line)
      })
      return (key.length && cert.length) ? { cert, key } : null
    },
    async saveTls(tlsObj: any): Promise<number | null> {
      if (!await Data().save('tls', 'new', tlsObj)) return null
      return Data().tlsConfigs.find((t: any) => t.name === tlsObj.name)?.id ?? null
    },
    async saveInbound(inbound: any, rollbackTlsId?: number): Promise<number | null> {
      if (!await Data().save('inbounds', 'new', inbound)) {
        if (rollbackTlsId) await Data().save('tls', 'del', rollbackTlsId)
        return null
      }
      return Data().inbounds.find((i: any) => i.tag === inbound.tag)?.id ?? null
    },
    async saveClient(clientName: string, inboundIds: number[], config: any): Promise<number | null> {
      const client = {
        enable: true,
        name: clientName,
        config: config,
        inbounds: inboundIds,
        links: [],
        volume: 0,
        expiry: 0,
        up: 0,
        down: 0,
        desc: '',
        group: '',
      }
      if (!await Data().save('clients', 'new', client)) return null
      return this.newClientId(clientName)
    },

    // ---- inbound-only builders (return the new inbound id) ---------------
    async inboundReality(port: number, sni: string): Promise<number | null> {
      const tag = 'vless-reality-' + port
      if (this.tagExists(tag)) return null
      const kp = await this.genReality()
      if (!kp) { this.err('keypair'); return null }
      // Use a single non-empty hex short_id. The pre-generated share link picks
      // one short_id at random from the server list; an empty one (sid=) is
      // mishandled by some clients, so pin a concrete value for reliability.
      const sid = RandomUtil.randomShortId().find((s: string) => s.length >= 2) || 'a1b2c3d4'
      const tlsObj = {
        id: 0,
        name: 'reality-' + port + '-' + RandomUtil.randomLowerAndNum(4),
        server: {
          enabled: true,
          server_name: sni,
          reality: {
            enabled: true,
            handshake: { server: sni, server_port: 443 },
            private_key: kp.priv,
            short_id: [sid],
          },
        },
        client: {
          reality: { enabled: true, public_key: kp.pub, short_id: sid },
          utls: { enabled: true, fingerprint: 'chrome' },
        },
      }
      const tlsId = await this.saveTls(tlsObj)
      if (!tlsId) { this.err('TLS'); return null }
      const inbound: any = createInbound('vless', { id: 0, tag, listen: '::', listen_port: port, tls_id: tlsId })
      inbound.addrs = []
      inbound.out_json = {}
      return this.saveInbound(inbound, tlsId)
    },
    async inboundShadowsocks(port: number): Promise<number | null> {
      const tag = 'shadowsocks-' + port
      if (this.tagExists(tag)) return null
      const inbound: any = createInbound('shadowsocks', { id: 0, tag, listen: '::', listen_port: port })
      inbound.method = '2022-blake3-aes-256-gcm'
      inbound.password = RandomUtil.randomShadowsocksPassword(32)
      inbound.addrs = []
      inbound.out_json = {}
      return this.saveInbound(inbound)
    },
    /**
     * 找一个能复用的自签 TLS 配置。
     *
     * 以前每建一个自签入站就无脑 genSelfSigned + saveTls，一键建 5 个会留下
     * 5 条 TLS 记录 —— 其中 3 个 VMess 的三份证书内容一模一样，只是 id 不同。
     * 现在按「SNI + ALPN」复用：
     *   · ALPN 必须完全一致：TUIC 要 h3、VMess 要 h2/http1.1、
     *     Hysteria2 不设 —— 三者不能共用同一份，否则握手协商不上。
     *   · 只复用自签（有 certificate 且没有 acme）：ACME 是按域名签发的，
     *     混进来会让「换证书」这件事变得不可预期。
     *   · client.insecure 必须是 true：自签证书只有 insecure 才连得上，
     *     复用一份给别的用途配的 TLS 会直接握手失败。
     */
    findReusableTls(sni: string, alpn?: string[]): number | null {
      const norm = (v: any) => (Array.isArray(v) ? v.slice().sort().join(',') : '')
      const want = norm(alpn)
      const hit = (Data().tlsConfigs || []).find((t: any) => {
        const srv = t.server || {}
        if (!srv.enabled) return false
        if (srv.acme) return false
        if (!srv.certificate && !srv.certificate_path) return false
        if ((srv.server_name || '') !== sni) return false
        if (norm(srv.alpn) !== want) return false
        if (t.client?.insecure !== true) return false
        return true
      })
      return hit ? hit.id : null
    },
    async inboundSelfSigned(port: number, type: string, tagPrefix: string, sni: string, alpn?: string[], outJson?: any): Promise<number | null> {
      const tag = tagPrefix + '-' + port
      if (this.tagExists(tag)) return null

      // 先看有没有现成的同 SNI / 同 ALPN 自签配置
      let tlsId = this.findReusableTls(sni, alpn)
      // 只在**本次新建** TLS 时才允许失败回滚删掉它；
      // 复用别人的配置还在 rollbackTlsId 里传下去的话，保存失败会把
      // 别人正在用的证书一起删了。
      let tlsCreated = false
      if (!tlsId) {
        const ss = await this.genSelfSigned(sni)
        if (!ss) { this.err('cert'); return null }
        // TUIC/VMess need an ALPN on the TLS server or the handshake fails
        // ("server did not select an ALPN protocol"). prepareTls copies the
        // server alpn to the client side, so the share link carries it too.
        const server: any = { enabled: true, server_name: sni, certificate: ss.cert, key: ss.key }
        if (alpn && alpn.length) server.alpn = alpn
        const tlsObj = {
          id: 0,
          name: tagPrefix + '-' + port + '-' + RandomUtil.randomLowerAndNum(4),
          server,
          client: { enabled: true, insecure: true, server_name: sni },
        }
        const newId = await this.saveTls(tlsObj)
        if (!newId) { this.err('TLS'); return null }
        tlsId = newId
        tlsCreated = true
      }

      const inbound: any = createInbound(type, { id: 0, tag, listen: '::', listen_port: port, tls_id: tlsId })
      inbound.addrs = []
      inbound.out_json = outJson ?? {}
      return this.saveInbound(inbound, tlsCreated ? tlsId : undefined)
    },

    // ---- single-protocol templates --------------------------------------
    async buildVlessReality(port: number, clientName: string): Promise<number | null> {
      const id = await this.inboundReality(port, this.sniOr('www.apple.com'))
      if (!id) return null
      return this.saveClient(clientName, [id], { vless: { name: clientName, uuid: RandomUtil.randomUUID(), flow: 'xtls-rprx-vision' } })
    },
    async buildShadowsocks(port: number, clientName: string): Promise<number | null> {
      const id = await this.inboundShadowsocks(port)
      if (!id) return null
      return this.saveClient(clientName, [id], { shadowsocks: { name: clientName, password: RandomUtil.randomShadowsocksPassword(32) } })
    },
    async buildSelfSigned(port: number, clientName: string, type: string, tagPrefix: string, config: any, alpn?: string[]): Promise<number | null> {
      const id = await this.inboundSelfSigned(port, type, tagPrefix, this.sniOr('www.bing.com'), alpn)
      if (!id) return null
      return this.saveClient(clientName, [id], config)
    },

    // ---- all protocols, one shared client -------------------------------
    async buildAll(clientName: string): Promise<number | null> {
      const sni = this.sniOr('www.apple.com')
      const used = new Set<number>(Data().inbounds.map((i: any) => i.listen_port))
      const pickPort = (): number => {
        let p = 0
        do { p = RandomUtil.randomIntRange(10000, 60000) } while (used.has(p))
        used.add(p)
        return p
      }

      const ids: number[] = []
      const collect = (id: number | null) => { if (id) ids.push(id) }

      for (const step of BUILD_ALL_PLAN) {
        collect(await this.inboundSelfSigned(pickPort(), step.type, step.type, sni, step.alpn, step.outJson))
      }

      if (ids.length === 0) { this.err(i18n.global.t('objects.inbound')); return null }

      // One client across every created inbound. randomConfigs carries a
      // matching config for each protocol; unused keys are ignored.
      return this.saveClient(clientName, ids, randomConfigs(clientName))
    },
  },
}
</script>
