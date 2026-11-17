<template>
  <v-app style="overflow: auto;">
    <drawer :isMobile="isMobile" :displayDrawer="displayDrawer" @toggleDrawer="toggleDrawer" />
    <default-bar :isMobile="isMobile" @toggleDrawer="toggleDrawer" />
    <default-view />
  </v-app>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import DefaultBar from './AppBar.vue'
import Drawer from './Drawer.vue'
import DefaultView from './View.vue'
import { useDisplay } from 'vuetify'

const { smAndDown } = useDisplay()
const displayDrawer = ref(!smAndDown.value)

const toggleDrawer = () => {
  displayDrawer.value = !displayDrawer.value
}

// 原来是把 `displayDrawer.value = !smAndDown.value` 写在 computed 的 getter 里，
// 结果是每读一次 isMobile 就重置一次抽屉开关（桌面端手动关掉后会被重新打开）。
// 断点变化属于事件，应该用 watch 处理；computed 只负责派生值。
const isMobile = computed((): boolean => smAndDown.value)
watch(smAndDown, (v) => {
  displayDrawer.value = !v
})
</script>

<style>
/* 原来这里给所有 .v-card-subtitle 加了居中 + 灰色下边线，
   导致每张卡片的副标题都变成一条"分割线标题"，很廉价。层级交给排版处理。 */
.v-switch.v-input {
  padding-inline-start: 0.6rem;
}
</style>