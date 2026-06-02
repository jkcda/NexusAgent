<template>
  <div class="session-list">
    <div class="session-header">
      <h3>对话列表</h3>
      <el-button type="primary" size="small" @click="$emit('create')">新对话</el-button>
    </div>
    <div class="session-search">
      <el-input
        v-model="searchText"
        placeholder="搜索对话..."
        size="small"
        clearable
        :prefix-icon="Search"
      />
    </div>
    <div class="session-items" v-loading="loading">
      <div
        v-for="s in filteredSessions"
        :key="s.id"
        :class="['session-item', { active: s.id === currentId }]"
        @click="$emit('select', s.id)"
      >
        <div class="session-title">{{ s.preview || '新对话' }}</div>
        <div class="session-meta">
          <span>{{ s.messageCount }} 条消息</span>
          <el-button
            class="session-delete"
            size="small"
            text
            type="danger"
            @click.stop="$emit('delete', s.id)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>
      <el-empty v-if="!loading && filteredSessions.length === 0" description="暂无对话" :image-size="40" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, Delete } from '@element-plus/icons-vue'

interface SessionItem {
  id: string
  preview: string
  messageCount: number
  lastActiveAt: string
}

const props = defineProps<{
  sessions: SessionItem[]
  currentId: string
  loading: boolean
}>()

defineEmits<{
  create: []
  select: [id: string]
  delete: [id: string]
}>()

const searchText = ref('')

const filteredSessions = computed(() => {
  if (!searchText.value) return props.sessions
  const q = searchText.value.toLowerCase()
  return props.sessions.filter(s => s.preview?.toLowerCase().includes(q))
})
</script>

<style scoped>
.session-list {
  width: 260px;
  background: #fff;
  border-right: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.session-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.session-header h3 {
  margin: 0;
  font-size: 15px;
  color: #333;
}

.session-search {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.session-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.session-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.15s;
  border-left: 3px solid transparent;
}

.session-item:hover {
  background: #f5f7fa;
}

.session-item.active {
  background: #e6f7ff;
  border-left-color: #1890ff;
}

.session-title {
  font-size: 13px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.session-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #999;
}

.session-delete {
  opacity: 0;
  transition: opacity 0.15s;
}

.session-item:hover .session-delete {
  opacity: 1;
}
</style>
