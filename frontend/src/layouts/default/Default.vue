<template>
  <v-app style="overflow: auto;">
    <drawer :isMobile="isMobile" :displayDrawer="displayDrawer" @toggleDrawer="toggleDrawer" />
    <default-bar :isMobile="isMobile" @toggleDrawer="toggleDrawer" />
    <default-view />
  </v-app>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import DefaultBar from './AppBar.vue'
import Drawer from './Drawer.vue'
import DefaultView from './View.vue'
import { useDisplay } from 'vuetify'

const { smAndDown } = useDisplay()
const displayDrawer = ref(false)

const toggleDrawer = () => {
  displayDrawer.value = !displayDrawer.value
}

const isMobile = computed( ():boolean =>{
  displayDrawer.value = !smAndDown.value
  return smAndDown.value
})
</script>

<style>
/* 原来这里给所有 .v-card-subtitle 加了居中 + 灰色下边线，
   导致每张卡片的副标题都变成一条"分割线标题"，很廉价。层级交给排版处理。 */
.v-switch.v-input {
  padding-inline-start: 0.6rem;
}
</style>