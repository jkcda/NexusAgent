<template>
  <div class="sidebar">
    <div class="sidebar-logo">
      <span class="logo-icon">R</span>
      <span class="logo-text">RAG 知识库</span>
    </div>
    <el-menu
      :default-active="activeMenu"
      background-color="#001529"
      text-color="rgba(255,255,255,0.65)"
      active-text-color="#fff"
      router
      :collapse="false"
    >
      <el-menu-item index="/chat">
        <el-icon><ChatDotRound /></el-icon>
        <span>对话</span>
      </el-menu-item>
      <el-menu-item index="/dashboard">
        <el-icon><DataAnalysis /></el-icon>
        <span>概览</span>
      </el-menu-item>
      <el-menu-item index="/kb">
        <el-icon><Collection /></el-icon>
        <span>知识库</span>
      </el-menu-item>
      <el-sub-menu index="admin" v-if="isAdmin">
        <template #title>
          <el-icon><Setting /></el-icon>
          <span>系统管理</span>
        </template>
        <el-menu-item index="/admin/settings">系统设置</el-menu-item>
        <el-menu-item index="/admin/users">用户管理</el-menu-item>
      </el-sub-menu>
    </el-menu>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/userStore'
import { ChatDotRound, Collection, Setting, DataAnalysis } from '@element-plus/icons-vue'

const route = useRoute()
const userStore = useUserStore()

const activeMenu = computed(() => {
  const path = route.path
  if (path.startsWith('/dashboard')) return '/dashboard'
  if (path.startsWith('/kb')) return '/kb'
  if (path.startsWith('/admin')) return '/admin/settings'
  return '/chat'
})

const isAdmin = computed(() => {
  const info = userStore.getUserInfo()
  return info?.role === 'admin'
})
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  height: 100vh;
  background: #001529;
  display: flex;
  flex-direction: column;
  position: fixed;
  left: 0;
  top: 0;
  z-index: 100;
}

.sidebar-logo {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.logo-icon {
  width: 32px;
  height: 32px;
  background: #1890ff;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.logo-text {
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}

.el-menu {
  border-right: none;
  flex: 1;
  overflow-y: auto;
}

.el-menu-item, .el-sub-menu__title {
  font-size: 14px;
}
</style>
