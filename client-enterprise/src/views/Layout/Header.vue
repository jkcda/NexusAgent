<template>
  <div class="layout-header">
    <div class="header-left">
      <h2>{{ title }}</h2>
    </div>
    <div class="header-right">
      <el-tag v-if="isAdmin" type="warning" size="small" effect="dark">管理员</el-tag>
      <el-tag v-if="department" type="info" size="small" effect="plain">{{ department }}</el-tag>
      <el-avatar
        class="user-avatar"
        :size="36"
        :src="avatarUrl"
        @click="triggerAvatarUpload"
      >
        {{ username?.charAt(0) || '用户' }}
      </el-avatar>
      <input
        ref="avatarInput"
        type="file"
        accept="image/*"
        style="display: none"
        @change="handleAvatarChange"
      />
      <span class="username">{{ username }}</span>
      <el-button type="danger" size="small" @click="handleLogout" :loading="logoutLoading">
        退出登录
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/userStore'
import { logout, uploadAvatar } from '@/apis/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const logoutLoading = ref(false)
const avatarInput = ref<HTMLInputElement | null>(null)

const title = computed(() => {
  const meta = route.meta?.title
  return meta || 'RAG 知识库系统'
})

const username = computed(() => {
  const info = userStore.getUserInfo()
  return info?.username || '用户'
})

const isAdmin = computed(() => {
  const info = userStore.getUserInfo()
  return info?.role === 'admin'
})

const department = computed(() => {
  const info = userStore.getUserInfo()
  return info?.department || ''
})

const avatarUrl = computed(() => {
  const info = userStore.getUserInfo()
  if (info?.avatar) {
    const baseURL = (import.meta.env as any).VITE_BASE_URL || ''
    return baseURL + info.avatar
  }
  return ''
})

function triggerAvatarUpload() {
  avatarInput.value?.click()
}

async function handleAvatarChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  try {
    const avatar = await uploadAvatar(file)
    const userInfo = userStore.getUserInfo()
    const updatedInfo = { ...userInfo, avatar }
    userStore.setUserInfo(updatedInfo)
    ElMessage.success('头像上传成功')
  } catch (error: any) {
    ElMessage.error(error.message || '头像上传失败')
  }

  target.value = ''
}

const handleLogout = async () => {
  try {
    logoutLoading.value = true
    await logout()
  } catch {}
  userStore.clearUserInfo()
  router.push('/login')
  ElMessage.success('已退出登录')
  logoutLoading.value = false
}
</script>

<style scoped>
.layout-header {
  height: var(--header-height);
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  position: sticky;
  top: 0;
  z-index: 50;
}

.header-left h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.username {
  color: #666;
  font-size: 14px;
}

.user-avatar {
  cursor: pointer;
  transition: opacity 0.2s;
}

.user-avatar:hover {
  opacity: 0.8;
}
</style>
