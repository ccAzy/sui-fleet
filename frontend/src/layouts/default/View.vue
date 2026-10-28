<template>
  <v-main>
    <div class="page-shell">
      <router-view />
    </div>
  </v-main>
</template>

<script lang="ts" setup>
</script>

<style>
/* 宽屏上把内容收在一列里，避免卡片贴左边缘散开（Apple 的内容宽度约束） */
.page-shell {
  max-width: 1240px;
  margin: 0 auto;
  padding: 16px 20px 56px;
}

@media (max-width: 960px) {
  .page-shell {
    padding: 12px 12px 40px;
  }
}
</style>
