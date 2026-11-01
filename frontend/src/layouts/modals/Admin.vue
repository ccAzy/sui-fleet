<template>
  <v-dialog transition="dialog-bottom-transition" width="400">
    <v-card class="rounded-lg">
      <v-card-title>
        {{ $t('admin.changeCred') + " " + user.username }}
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <v-row>
          <v-col>
            <v-text-field v-model="newData.oldPass" :label="$t('admin.oldPass')" :rules="passwordRules" type="password" required></v-text-field>
          </v-col>
        </v-row>
        <v-row>
          <v-col>
            <v-text-field v-model="newData.newUsername" :label="$t('admin.newUname')" :rules="usernameRules" required></v-text-field>
          </v-col>
        </v-row>
        <v-row>
          <v-col>
            <v-text-field v-model="newData.newPass" :label="$t('admin.newPass')" :rules="passwordRules" type="password" required></v-text-field>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          color="primary"
          variant="outlined"
          @click="closeModal"
        >
          {{ $t('actions.close') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          @click="saveChanges"
        >
          {{ $t('actions.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { i18n } from '@/locales'
import { push } from 'notivue'

export default {
  props: ['visible', 'user'],
  data() {
    return {
      newData: {
        id: 0,
        oldPass: "",
        newUsername: "",
        newPass: ""
      },
      usernameRules: [
        (value: string) => {
          if (value?.length > 0) return true
          return i18n.global.t('login.unRules')
        },
      ],
      passwordRules: [
        (value: string) => {
          if (value?.length > 0) return true
          return i18n.global.t('login.pwRules')
        },
      ]
    }
  },
  methods: {
    resetData() {
      this.newData.id = this.$props.user.id
      this.newData.oldPass = ""
      // 默认带出当前用户名：只想改密码的人不必先猜「用户名也得重填」，
      // 而原来的空值 + saveChanges 的空值 return 会让保存静默无反应。
      this.newData.newUsername = String(this.$props.user?.username ?? "")
      this.newData.newPass = ""
    },
    closeModal() {
      this.resetData() // reset
      this.$emit('close')
    },
    saveChanges() {
      if (this.newData.oldPass == '' || this.newData.newUsername == '' || this.newData.newPass == '') {
        // 原来直接 return：点了保存什么都不发生，用户以为按钮坏了
        push.error({ title: i18n.global.t('error'), message: i18n.global.t('admin.fillAllFields') })
        return
      }
      this.$emit('save', this.newData)
    },
  },
  watch: {
    visible(newValue) {
      if (newValue) {
        this.resetData()
      }
    },
  },
}
</script>