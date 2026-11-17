<template>
  <RuleVue
    v-model="ruleModal.visible"
    :visible="ruleModal.visible"
    :index="ruleModal.index"
    :data="ruleModal.data"
    :clients="clients"
    :inTags="inboundTags"
    :outTags="outboundTags"
    :rsTags="rulesetTags"
    @close="closeRuleModal"
    @save="saveRuleModal"
  />
  <RulesetVue
    v-model="rulesetModal.visible"
    :visible="rulesetModal.visible"
    :index="rulesetModal.index"
    :data="rulesetModal.data"
    :outTags="outboundTags"
    @close="closeRulesetModal"
    @save="saveRulesetModal"
  />
  <RuleImport
    v-model="importRulesModal.visible"
    :visible="importRulesModal.visible"
    :existingRulesCount="rules.length"
    :existingRulesetsCount="rulesets.length"
    :existingRulesetTags="rulesetTags"
    @save="saveImportRule"
    @close="closeImportRule"
  />
  <RulesetImport
    v-model="importRulesetsModal.visible"
    :visible="importRulesetsModal.visible"
    :outTags="outboundTags"
    :rsTags="rulesetTags"
    @save="saveImportRulesets"
    @close="closeImportRulesets"
  />
  <v-row>
    <v-col cols="12" class="page-toolbar">
      <v-btn color="primary" @click="showRuleModal(-1)" style="margin: 0 5px;">{{ $t('rule.add') }}</v-btn>
      <v-btn color="primary" @click="showRulesetModal(-1)" style="margin: 0 5px;">{{ $t('ruleset.add') }}</v-btn>
      <v-menu v-model="actionMenu" :close-on-content-click="false" location="bottom center">
        <template v-slot:activator="{ props }">
          <v-btn v-bind="props" hide-details variant="text" icon :aria-label="$t('a11y.moreActions')">
            <v-icon icon="mdi-tools" color="primary" />
          </v-btn>
        </template>
        <v-list density="compact" nav>
          <v-list-item link @click="showImportRule">
            <template v-slot:prepend>
              <v-icon icon="mdi-routes"></v-icon>
            </template>
            <v-list-item-title>{{ $t('rule.import.rulesTitle') }}</v-list-item-title>
          </v-list-item>
          <v-list-item link @click="showImportRulesets">
            <template v-slot:prepend>
              <v-icon icon="mdi-download-multiple"></v-icon>
            </template>
            <v-list-item-title>{{ $t('rule.import.title') }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-btn color="primary" variant="elevated" @click="saveConfig" :loading="loading" :disabled="stateChange">
        {{ $t('actions.save') }}
      </v-btn>
    </v-col>
  </v-row>
  <v-row>
    <v-col class="v-card-subtitle" cols="12">{{ $t('basic.routing.title') }}</v-col>
    <v-col cols="12">
      <v-row>
        <v-col cols="12" sm="6" md="3" lg="2">
          <v-select hide-details :label="$t('basic.routing.defaultOut')" clearable
            @click:clear="delete route.final" :items="outboundTags" v-model="route.final"></v-select>
        </v-col>
        <v-col cols="12" sm="6" md="3" lg="2">
          <v-text-field v-model="route.default_interface" hide-details clearable
            @click:clear="delete route.default_interface" :label="$t('basic.routing.defaultIf')"></v-text-field>
        </v-col>
        <v-col cols="12" sm="6" md="3" lg="2">
          <v-text-field v-model.number="routeMark" hide-details type="number" min="0" :label="$t('basic.routing.defaultRm')"></v-text-field>
        </v-col>
        <v-col cols="12" sm="6" md="3" lg="2">
          <v-switch v-model="route.auto_detect_interface" color="primary" :label="$t('basic.routing.autoBind')" hide-details></v-switch>
        </v-col>
      </v-row>
    </v-col>
  </v-row>
  <v-row>
    <v-col class="v-card-subtitle" cols="12">{{ $t('rule.ruleset') }}</v-col>
    <v-col v-if="!rulesets.length" cols="12" class="list-empty">
      {{ $t('emptyList') }}
    </v-col>
    <div class="rules-ledger">
      <div v-for="(item, index) in <any[]>rulesets" :key="item.tag" class="ledger-row">
        <span class="ledger-mark" data-state="up" aria-hidden="true"></span>
        <span class="ledger-name" :title="item.tag">{{ item.tag }}</span>
        <span class="ledger-meta">
          {{ $t('ruleset.' + item.type) }}
          <span class="sep">·</span>{{ item.format }}
          <span class="sep">·</span>{{ $t('objects.outbound') }} {{ item.download_detour ?? '-' }}
          <span class="sep">·</span>{{ $t('actions.update') }} {{ item.update_interval ?? '-' }}
        </span>
        <div class="ledger-actions">
          <button type="button" class="ui-reset rs-btn" :title="$t('actions.edit')" @click="showRulesetModal(index)">
            <v-icon icon="mdi-file-edit" size="16" />
          </button>
          <button type="button" class="ui-reset rs-btn rs-btn--danger" :title="$t('actions.del')" @click="delRulesetOverlay[index] = true">
            <v-icon icon="mdi-file-remove" size="16" />
          </button>
        </div>
        <v-overlay v-model="delRulesetOverlay[index]" contained class="align-center justify-center">
          <v-card :title="$t('actions.del')">
            <v-card-text>{{ $t('confirm') }}</v-card-text>
            <v-card-actions>
              <v-btn variant="text" class="confirm-cancel" @click="delRulesetOverlay[index] = false">{{ $t('no') }}</v-btn>
              <v-btn color="error" variant="flat" @click="delRuleset(index)">{{ $t('yes') }}</v-btn>
            </v-card-actions>
          </v-card>
        </v-overlay>
      </div>
    </div>
  </v-row>
  <v-row>
    <v-col class="v-card-subtitle" cols="12">{{ $t('pages.rules') }}</v-col>
    <v-col v-if="!rules.length" cols="12" class="list-empty">
      {{ $t('emptyList') }}
    </v-col>
    <div class="rules-ledger">
      <div
        v-for="(item, index) in <any[]>rules"
        :key="item.id"
        class="ledger-row"
        draggable="true"
        @dragstart="onDragStart(index)"
        @dragover.prevent
        @drop="onDrop(index)"
      >
        <span class="ledger-mark" data-state="up" aria-hidden="true"></span>
        <span class="ledger-name">
          {{ index + 1 }} · {{ item.type != undefined ? $t('rule.logical') + ' (' + item.mode + ')' : $t('rule.simple') }}
        </span>
        <span class="ledger-meta">
          {{ $t('admin.action') }} {{ item.action }}
          <span class="sep">·</span>{{ $t('objects.outbound') }} {{ item.outbound ?? '-' }}
          <span class="sep">·</span>{{ $t('pages.rules') }} {{ item.rules ? item.rules.length : Object.keys(item).filter(r => !actionKeys.includes(r)).length }}
          <template v-if="item.invert">
            <span class="sep">·</span>{{ $t('rule.invert') }}
          </template>
        </span>
        <div class="ledger-actions">
          <button type="button" class="ui-reset rs-btn" :title="$t('actions.edit')" @click="showRuleModal(index)">
            <v-icon icon="mdi-file-edit" size="16" />
          </button>
          <button type="button" class="ui-reset rs-btn rs-btn--danger" :title="$t('actions.del')" @click="delRuleOverlay[index] = true">
            <v-icon icon="mdi-file-remove" size="16" />
          </button>
        </div>
        <v-overlay v-model="delRuleOverlay[index]" contained class="align-center justify-center">
          <v-card :title="$t('actions.del')">
            <v-card-text>{{ $t('confirm') }}</v-card-text>
            <v-card-actions>
              <v-btn variant="text" class="confirm-cancel" @click="delRuleOverlay[index] = false">{{ $t('no') }}</v-btn>
              <v-btn color="error" variant="flat" @click="delRule(index)">{{ $t('yes') }}</v-btn>
            </v-card-actions>
          </v-card>
        </v-overlay>
      </div>
    </div>
  </v-row>
</template>

<script lang="ts" setup>
import Data from '@/store/modules/data'
import { computed, ref, onBeforeMount } from 'vue'
import RuleVue from '@/layouts/modals/Rule.vue'
import RulesetVue from '@/layouts/modals/Ruleset.vue'
import RulesetImport from '@/layouts/modals/RulesetImport.vue'
import RuleImport from '@/layouts/modals/RuleImport.vue'
import { Config } from '@/types/config'
import { actionKeys, ruleset } from '@/types/rules'
import { FindDiff } from '@/plugins/utils'

const oldConfig = ref({})
const loading = ref(false)
const actionMenu = ref(false)
const appConfig = computed((): Config => {
  return <Config> Data().config
})

onBeforeMount(async () => {
  loading.value = true
  while (Data().lastLoad == 0) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  oldConfig.value = JSON.parse(JSON.stringify(Data().config))
  loading.value = false
})

const routeMark = computed({
  get() { return route.value.default_mark ?? 0 },
  set(v:number) { v>0 ? route.value.default_mark = v : delete appConfig.value.route.default_mark }
})

const stateChange = computed(() => FindDiff.deepCompare(appConfig.value, oldConfig.value))

const saveConfig = async () => {
  loading.value = true
  const success = await Data().save("config", "set", appConfig.value)
  if (success) {
    oldConfig.value = JSON.parse(JSON.stringify(Data().config))
    loading.value = false
  }
}

const clients = computed((): string[] => Data().clients.map((c:any) => c.name))
const route = computed((): any => appConfig.value.route ?? {})

const rules = computed((): any[] => {
  const data = route.value
  if (!data) return []
  if (!('rules' in data) || !Array.isArray(data.rules)) data.rules = []
  return data.rules
})

const rulesets = computed((): any[] => {
  const data = route.value
  if (!data) return []
  if (!('rule_set' in data) || !Array.isArray(data.rule_set)) data.rule_set = []
  return data.rule_set
})

const rulesetTags = computed((): string[] => rulesets.value.map((rs:any) => rs.tag))

const outboundTags = computed((): string[] => [
  ...Data().outbounds?.map((o:any) => o.tag),
  ...Data().endpoints?.map((e:any) => e.tag)
])

const inboundTags = computed((): string[] => [
  ...Data().inbounds?.map((o:any) => o.tag),
  ...Data().endpoints?.filter((e:any) => e.listen_port > 0).map((e:any) => e.tag)
])

let delRuleOverlay = ref([] as boolean[])
let delRulesetOverlay = ref([] as boolean[])

const ruleModal = ref({ visible: false, index: -1, data: "" })
const showRuleModal = (index: number) => {
  ruleModal.value.index = index
  ruleModal.value.data = index == -1 ? '' : JSON.stringify(rules.value[index])
  ruleModal.value.visible = true
}
const closeRuleModal = () => { ruleModal.value.visible = false }
const saveRuleModal = (data:any) => {
  if (ruleModal.value.index == -1) rules.value.push(data)
  else rules.value[ruleModal.value.index] = data
  ruleModal.value.visible = false
}
const delRule = (index: number) => { rules.value.splice(index, 1); delRuleOverlay.value[index] = false }

const rulesetModal = ref({ visible: false, index: -1, data: "" })
const showRulesetModal = (index: number) => {
  rulesetModal.value.index = index
  rulesetModal.value.data = index == -1 ? '' : JSON.stringify(rulesets.value[index])
  rulesetModal.value.visible = true
}
const closeRulesetModal = () => { rulesetModal.value.visible = false }
const saveRulesetModal = (data:ruleset) => {
  if (rulesetModal.value.index == -1) rulesets.value.push(data)
  else rulesets.value[rulesetModal.value.index] = data
  rulesetModal.value.visible = false
}
const delRuleset = (index: number) => { rulesets.value.splice(index, 1); delRulesetOverlay.value[index] = false }

const draggedItemIndex = ref(null)
const onDragStart = (index: any) => { draggedItemIndex.value = index }
const onDrop = (index: any) => {
  if (draggedItemIndex.value !== null) {
    const draggedItem = rules.value[draggedItemIndex.value]
    rules.value.splice(draggedItemIndex.value, 1)
    rules.value.splice(index, 0, draggedItem)
    draggedItemIndex.value = null
  }
}

const importRulesModal = ref({ visible: false })

function showImportRule() {
  importRulesModal.value.visible = true
}

function closeImportRule() {
  importRulesModal.value.visible = false
}

function saveImportRule(block: any, mode: 'merge' | 'replace', applyFinal: boolean) {
  if (mode === 'replace') {
    route.value.rules = block.rules ?? []
    route.value.rule_set = block.rule_set ?? []
  } else {
    const existingTags = new Set(rulesetTags.value)
    if (block.rules) rules.value.push(...block.rules)
    if (block.rule_set) {
      for (const rs of block.rule_set) {
        if (!existingTags.has(rs.tag)) rulesets.value.push(rs)
      }
    }
  }
  if (applyFinal && block.final) route.value.final = block.final
  importRulesModal.value.visible = false
}

const importRulesetsModal = ref({ visible: false })

function showImportRulesets() {
  importRulesetsModal.value.visible = true
}

function closeImportRulesets() {
  importRulesetsModal.value.visible = false
}

function saveImportRulesets(items: any[]) {
  rulesets.value.push(...items)
  importRulesetsModal.value.visible = false
}
</script>

<style scoped>
/* 规则页：两类列表都用账簿名录（DESIGN.md 的标志性动作），
   原来是一排 200px 宽的卡片，每个字段竖着占一行。 */
.rules-ledger {
  border: 1px solid var(--card-line);
  border-radius: 12px;
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  padding: 0 16px;
  margin-bottom: 4px;
  overflow: hidden;
  width: 100%;
}

.rules-ledger :deep(.ledger-row) {
  grid-template-columns: 14px minmax(0, 200px) minmax(0, 1fr) auto;
  padding-top: 10px;
  padding-bottom: 10px;
}

.rs-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--ink-3);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.rs-btn:hover {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  color: var(--ink);
}

.rs-btn--danger:hover {
  background: var(--error-soft);
  color: var(--error);
}
</style>
