import pluginVue from 'eslint-plugin-vue'
import tsParser from '@typescript-eslint/parser'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'scripts/**'],
  },
  ...pluginVue.configs['flat/essential'],
  {
    // .vue：外层由 vue-eslint-parser 处理模板，<script lang="ts"> 交给 TS 解析器
    files: ['**/*.vue'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { parser: tsParser, extraFileExtensions: ['.vue'] },
    },
  },
  {
    // 纯 .ts / .d.ts：直接换解析器，否则会被 vue-eslint-parser 解错
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  {
    rules: {
      // 视图组件都是单名（Basics.vue / Rules.vue / Tls.vue），这条在本项目是纯噪音
      'vue/multi-word-component-names': 'off',

      // 200+ 处表单组件直接编辑父级传入的配置对象（如 props.data.xxx = ...），
      // 全项目一致的模式，属于架构选择而非偶发 bug——详见 CONTRIBUTING.md
      // 「表单组件的数据流约定」。重写成 props/emit 需要重写所有协议表单组件，
      // 风险远大于收益，所以降为 warn：新代码能看到提示，但不阻塞 CI。
      'vue/no-mutating-props': 'warn',

      // Vuetify 数据表格用 `v-slot:item.calories` 定制列，这个点号是 Vuetify 的
      // 约定写法，不是 Vue 的 slot 修饰符，规则在这里是误报。
      'vue/valid-v-slot': 'off',
    },
  },
]
