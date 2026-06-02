<template>
  <div class="layout-header">
    <div class="header-logo">
      <img :src="'/images/logo.png'" alt="logo" class="logo-img" v-show="logoExists" @error="onLogoError" />
      <h1>奈克瑟 NEXUS</h1>
    </div>

    <div class="mobile-menu-btn" @click="mobileMenuOpen = !mobileMenuOpen">
      <el-icon :size="22"><Menu v-if="!mobileMenuOpen" /><Close v-else /></el-icon>
    </div>

    <div v-if="mobileMenuOpen" class="mobile-overlay" @click="mobileMenuOpen = false"></div>

    <div class="header-nav" :class="{ 'mobile-open': mobileMenuOpen }">
      <router-link to="/" @click="mobileMenuOpen = false">首页</router-link>
      <router-link to="/chat" @click="mobileMenuOpen = false">AI 对话</router-link>
      <router-link to="/knowledge-base" @click="mobileMenuOpen = false">知识库</router-link>
      <router-link to="/agents" @click="mobileMenuOpen = false">角色扮演</router-link>
      <router-link to="/rooms" @click="mobileMenuOpen = false">聊天室</router-link>
      <router-link v-if="userInfo" to="/admin/providers" @click="mobileMenuOpen = false">能力配置</router-link>
      <router-link v-if="isAdmin" to="/admin/dashboard" class="admin-link" @click="mobileMenuOpen = false">后台管理</router-link>

      <div class="mobile-user-actions">
        <template v-if="userInfo">
          <span class="mobile-username">{{ userInfo.username }}</span>
          <el-button type="danger" size="small" @click="handleLogout" :loading="logoutLoading">
            退出登录
          </el-button>
        </template>
        <template v-else>
          <span v-if="isGuestPage" class="guest-badge">游客模式</span>
          <router-link to="/login" @click="mobileMenuOpen = false">登录</router-link>
          <router-link to="/register" @click="mobileMenuOpen = false">注册</router-link>
        </template>
      </div>
    </div>

    <div class="header-user">
      <div v-if="userInfo" class="user-info">
        <el-avatar
          class="user-avatar"
          :size="32"
          :src="avatarUrl"
          @click="triggerAvatarUpload"
        >
          {{ userInfo.username?.charAt(0) || '用' }}
        </el-avatar>
        <input
          ref="avatarInput"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleAvatarChange"
        />
        <span class="username">{{ userInfo.username }}</span>
        <el-button
          type="danger"
          size="small"
          @click="handleLogout"
          :loading="logoutLoading"
        >
          退出登录
        </el-button>
      </div>
      <div v-else class="login-register">
        <span v-if="isGuestPage" class="guest-badge">游客模式</span>
        <router-link to="/login">登录</router-link>
        <router-link to="/register">注册</router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Menu, Close } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/userStore'
import { logout, uploadAvatar } from '@/apis/user'

const userStore = useUserStore()
const router = useRouter()
const route = useRoute()
const userInfo = ref<any>(null)
const logoutLoading = ref(false)
const isAdmin = ref(false)
const mobileMenuOpen = ref(false)
const isGuestPage = computed(() => !userInfo.value && route.path === '/chat')
const logoExists = ref(true)
const avatarInput = ref<HTMLInputElement | null>(null)

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
    const userInfoData = userStore.getUserInfo()
    userStore.setUserInfo({ ...userInfoData, avatar })
    ElMessage.success('头像上传成功')
  } catch (error: any) {
    ElMessage.error(error.message || '头像上传失败')
  }

  target.value = ''
}

const onLogoError = () => {
  logoExists.value = false
}

const loadUserInfo = () => {
  userInfo.value = userStore.getUserInfo()
  isAdmin.value = userInfo.value?.role === 'admin'
}

const handleLogout = async () => {
  try {
    logoutLoading.value = true
    await logout()
  } catch {}
  userStore.clearUserInfo()
  router.push('/auth/login')
  ElMessage.success('退出登录成功')
  logoutLoading.value = false
}

onMounted(() => {
  loadUserInfo()
})
</script>

<style scoped>
.layout-header {
  background: var(--color-bg-card);
  padding: 15px 20px;
  box-shadow: var(--shadow-card);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: var(--border-thin) var(--color-border);
  position: relative;
  z-index: 10;
}

.header-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-img {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: var(--radius-lg);
  border: var(--border-game) var(--color-magic-gold);
  box-shadow: var(--shadow-gold-glow);
}

.header-logo h1 {
  margin: 0;
  font-family: var(--font-pixel);
  font-size: 13px;
  color: var(--color-magic-gold);
  text-shadow: 0 0 10px var(--color-gold-glow);
  letter-spacing: 1px;
  image-rendering: pixelated;
}

.header-nav {
  display: flex;
  gap: 4px;
}

.header-nav a {
  text-decoration: none;
  color: var(--color-text-secondary);
  font-weight: 500;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-normal);
  border: var(--border-game) transparent;
}

.header-nav a:hover {
  background: var(--color-primary);
  color: var(--color-silver);
  border-color: var(--color-primary);
  box-shadow: var(--shadow-glow);
}

.header-nav a.router-link-exact-active {
  background: var(--color-primary);
  color: var(--color-silver);
  border-color: var(--color-primary);
}

.admin-link {
  background: var(--color-magic-gold) !important;
  color: #1a1a2e !important;
  font-weight: 600 !important;
}

.admin-link:hover {
  box-shadow: var(--shadow-gold-glow) !important;
}

.admin-link.router-link-exact-active {
  background: var(--color-magic-gold) !important;
  color: #1a1a2e !important;
}

.header-user {
  display: flex;
  align-items: center;
  gap: 15px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.username {
  font-weight: 500;
  color: var(--color-text-primary);
}

.login-register {
  display: flex;
  gap: 15px;
}

.login-register a {
  text-decoration: none;
  color: var(--color-primary);
  font-weight: 500;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-normal);
  border: var(--border-game) transparent;
}

.login-register a:hover {
  background: var(--color-primary);
  color: var(--color-silver);
  box-shadow: var(--shadow-glow);
}

.guest-badge {
  font-size: 12px;
  color: var(--color-magic-gold);
  background: rgba(212, 175, 55, 0.1);
  padding: 4px 12px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.3);
}

.user-avatar {
  cursor: pointer;
  transition: opacity 0.2s;
  border: 1px solid var(--color-border);
}

.user-avatar:hover {
  opacity: 0.8;
}

.mobile-menu-btn {
  display: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  padding: 4px;
}

.mobile-overlay {
  display: none;
}

.mobile-user-actions {
  display: none;
}

@media (max-width: 768px) {
  .layout-header {
    padding: 10px 15px;
  }

  .header-logo h1 {
    font-size: 10px;
  }

  .mobile-menu-btn {
    display: flex;
    align-items: center;
  }

  .header-nav {
    position: fixed;
    top: 0;
    right: -280px;
    width: 260px;
    height: 100vh;
    height: 100dvh;
    background: var(--color-bg-card);
    flex-direction: column;
    padding: 60px 20px 20px;
    gap: 0;
    z-index: 1000;
    transition: right 0.3s ease;
    box-shadow: -2px 0 12px rgba(0, 0, 0, 0.4);
    border-left: var(--border-thin) var(--color-border);
  }

  .header-nav.mobile-open {
    right: 0;
  }

  .header-nav a {
    padding: 12px 16px;
    border-radius: var(--radius-md);
    width: 100%;
    font-size: 15px;
  }

  .header-nav a + a {
    margin-top: 4px;
  }

  .mobile-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--color-bg-overlay);
    z-index: 999;
  }

  .mobile-user-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 24px;
    padding-top: 24px;
    border-top: var(--border-thin) var(--color-border);
  }

  .mobile-username {
    font-size: 14px;
    color: var(--color-text-secondary);
    font-weight: 500;
  }

  .mobile-user-actions a {
    text-align: center;
    color: var(--color-primary) !important;
  }

  .header-user {
    display: none;
  }
}
</style>
