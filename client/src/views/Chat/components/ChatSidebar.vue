<template>
  <div class="chat-sidebar" :class="{ collapsed, 'mobile-open': mobileOpen }">
    <div class="sidebar-header">
      <el-popover placement="bottom-start" :width="220" trigger="click">
        <template #reference>
          <el-button type="primary" class="new-chat-btn">
            <el-icon><Plus /></el-icon>
            新对话
          </el-button>
        </template>
        <div class="new-chat-popover">
          <p class="popover-title">选择对话角色</p>
          <div class="popover-option" @click="onSelectAgent(null)">
            <img :src="'/images/character-avatar.png'" class="option-avatar" />
            <div class="option-info">
              <span class="option-name">✦ 奈克瑟 NEXUS</span>
              <span class="option-desc">跨宇宙魔法情报员</span>
            </div>
          </div>
          <div
            v-for="agent in agentList"
            :key="agent.id"
            class="popover-option"
            @click="onSelectAgent(agent)"
          >
            <img v-if="agent.avatar" :src="agent.avatar" class="option-avatar" />
            <div v-else class="option-avatar placeholder">{{ agent.name.slice(0, 1) }}</div>
            <div class="option-info">
              <span class="option-name">{{ agent.name }}</span>
              <span class="option-desc">自定义角色</span>
            </div>
          </div>
        </div>
      </el-popover>
    </div>
    <div class="nexus-card">
      <img :src="'/images/character-avatar.png'" class="nexus-avatar" />
      <div class="nexus-info">
        <span class="nexus-name">奈克瑟 NEXUS</span>
        <span class="nexus-level">跨宇宙魔法情报员</span>
      </div>
    </div>
    <div class="session-search">
      <el-input
        v-model="searchQuery"
        placeholder="搜索会话..."
        size="small"
        clearable
        :prefix-icon="Search"
      />
    </div>
    <div class="session-list">
      <div
        v-for="sess in filteredSessions"
        :key="sess.id"
        :class="['session-item', { active: sess.id === currentSessionId }]"
        @click="$emit('selectSession', sess.id)"
      >
        <div class="session-preview">
          <img v-if="sess.agentAvatar" :src="sess.agentAvatar" class="session-agent-avatar" />
          <img v-else-if="sess.agentId" :src="'/images/character-avatar.png'" class="session-agent-avatar" />
          {{ sess.preview || '新对话' }}
        </div>
        <div class="session-meta">
          <span>{{ sess.messageCount }} 条消息</span>
          <span v-if="sess.agentName" class="session-agent-tag">{{ sess.agentName }}</span>
          <el-button
            class="delete-session-btn"
            size="small"
            text
            type="danger"
            @click.stop="$emit('deleteSession', sess.id)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>
      <div v-if="sessionList.length === 0" class="empty-sessions">
        <p class="empty-welcome">{{ welcomeLine }}</p>
        <p class="empty-hint">点击上方按钮开始对话</p>
      </div>
    </div>

    <!-- MCP 工具配置 -->
    <div class="mcp-panel">
      <div class="mcp-header" @click="mcpExpanded = !mcpExpanded">
        <span class="mcp-title">🔌 MCP 工具</span>
        <span class="mcp-total">{{ mcpServers.filter(s => s.enabled).length }}/{{ mcpServers.length }} 在线</span>
        <el-icon :class="{ rotated: mcpExpanded }"><ArrowRight /></el-icon>
      </div>
      <div v-if="mcpExpanded" class="mcp-list">
        <div
          v-for="srv in mcpServers"
          :key="srv.name"
          class="mcp-item"
        >
          <div class="mcp-item-info">
            <span class="mcp-icon">{{ srv.icon }}</span>
            <div class="mcp-item-detail">
              <span class="mcp-label">{{ srv.label }}</span>
              <span class="mcp-tools">{{ srv.toolCount }} 个工具</span>
            </div>
          </div>
          <el-switch
            :model-value="srv.enabled"
            size="small"
            @change="(val: boolean) => handleToggle(srv.name, val)"
          />
        </div>
        <div class="mcp-restart-hint" v-if="toggleNote">{{ toggleNote }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, Delete, ArrowRight, Search } from '@element-plus/icons-vue'
import { ref, computed, onMounted } from 'vue'

interface SessionItem {
  id: string
  preview: string
  messageCount: number
  lastActiveAt: string
  agentId?: number | null
  agentName?: string | null
  agentAvatar?: string | null
}

interface McpServer {
  name: string
  label: string
  icon: string
  enabled: boolean
  toolCount: number
}

interface AgentItem {
  id: number
  name: string
  avatar: string | null
  greeting?: string | null
}

const welcomeLine = computed(() => '✦ 指挥官，数据之海已同步。开始新的对话吧。')

const searchQuery = ref('')
const filteredSessions = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return props.sessionList
  return props.sessionList.filter(s =>
    (s.preview || '新对话').toLowerCase().includes(q) ||
    (s.agentName || '').toLowerCase().includes(q)
  )
})

// MCP state
const mcpExpanded = ref(false)
const mcpServers = ref<McpServer[]>([])
const toggleNote = ref('')

async function fetchMcpStatus() {
  try {
    const res = await fetch('/api/mcp/status')
    const data = await res.json()
    if (data.success) {
      mcpServers.value = data.result.servers
    }
  } catch { /* 静默失败 */ }
}

async function handleToggle(name: string, enabled: boolean) {
  try {
    const res = await fetch('/api/mcp/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, enabled }),
    })
    const data = await res.json()
    if (data.success) {
      toggleNote.value = data.result.note || '变更将在服务重启后生效'
      setTimeout(() => toggleNote.value = '', 4000)
      const srv = mcpServers.value.find(s => s.name === name)
      if (srv) srv.enabled = enabled
    }
  } catch {
    toggleNote.value = '操作失败，请检查服务状态'
    setTimeout(() => toggleNote.value = '', 3000)
  }
}

onMounted(() => fetchMcpStatus())

const props = defineProps<{
  sessionList: SessionItem[]
  currentSessionId: string
  collapsed: boolean
  mobileOpen?: boolean
  agentList: AgentItem[]
}>()

const emit = defineEmits<{
  createSession: []
  createSessionWithAgent: [agent: AgentItem | null]
  selectSession: [sessionId: string]
  deleteSession: [sessionId: string]
}>()

function onSelectAgent(agent: AgentItem | null) {
  emit('createSessionWithAgent', agent)
}
</script>

<style scoped>
.chat-sidebar {
  width: 260px;
  background: var(--color-bg-card);
  display: flex;
  flex-direction: column;
  border-right: var(--border-thin) var(--color-border);
  transition: width 0.3s;
  flex-shrink: 0;
}

.chat-sidebar.collapsed {
  width: 0;
  overflow: hidden;
  border-right: none;
}

.sidebar-header {
  padding: var(--space-md);
  border-bottom: var(--border-thin) var(--color-border);
}

.new-chat-btn {
  width: 100%;
}

.new-chat-popover {
  max-height: 320px;
  overflow-y: auto;
}

.popover-title {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 8px 0;
  padding: 0 4px;
}

.popover-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.popover-option:hover {
  background: var(--color-primary-light);
}

.option-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--color-border);
  flex-shrink: 0;
}

.option-avatar.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-input);
  font-weight: 700;
  color: var(--color-text-muted);
  border-radius: 50%;
}

.option-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.option-name {
  font-size: 13px;
  color: var(--color-text-primary);
  white-space: nowrap;
}

.option-desc {
  font-size: 11px;
  color: var(--color-text-muted);
}

.nexus-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  margin: 0 8px 8px;
  background: var(--color-bg-input);
  border-radius: var(--radius-md);
  border: var(--border-thin) var(--color-border);
}

.nexus-avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-lg);
  border: 2px solid var(--color-magic-gold);
  box-shadow: var(--shadow-gold-glow);
  object-fit: cover;
  flex-shrink: 0;
}

.nexus-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nexus-name {
  font-family: var(--font-pixel);
  font-size: 9px;
  color: var(--color-magic-gold);
  white-space: nowrap;
}

.nexus-level {
  font-size: 11px;
  color: var(--color-text-muted);
}

.session-search {
  padding: 8px 12px 4px;
}

.session-search :deep(.el-input__wrapper) {
  background: var(--color-bg-input);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm);
}

.session-item {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  margin-bottom: 4px;
  transition: background var(--transition-fast);
  border-left: 3px solid transparent;
}

.session-item:hover {
  background: var(--color-primary-light);
}

.session-item.active {
  background: var(--color-primary-light);
  border-left: 3px solid var(--color-magic-gold);
}

.session-preview {
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-agent-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.session-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.session-agent-tag {
  font-size: 10px;
  color: var(--color-magic-gold);
  background: var(--color-bg-input);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-session-btn {
  opacity: 0;
  transition: opacity 0.15s;
  padding: 2px;
  font-size: 14px;
}

.session-item:hover .delete-session-btn {
  opacity: 1;
}

.empty-sessions {
  text-align: center;
  padding: 20px 12px;
  color: var(--color-text-muted);
  font-size: var(--font-size-base);
}

.empty-welcome {
  color: var(--color-magic-gold);
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 8px;
  text-shadow: 0 0 6px var(--color-gold-glow);
}

.empty-hint {
  font-size: 12px;
  color: var(--color-text-muted);
}

.mcp-panel {
  border-top: var(--border-thin) var(--color-border);
  padding: 8px 12px;
  flex-shrink: 0;
}

.mcp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 6px 4px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.mcp-header:hover {
  background: var(--color-primary-light);
}

.mcp-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  flex: 0 0 auto;
}

.mcp-total {
  font-size: 10px;
  color: var(--color-magic-gold);
  flex: 1;
  text-align: right;
  margin-right: 4px;
}

.mcp-header .el-icon {
  font-size: 12px;
  transition: transform 0.2s;
  color: var(--color-text-muted);
}

.mcp-header .el-icon.rotated {
  transform: rotate(90deg);
}

.mcp-list {
  padding: 4px 0;
}

.mcp-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 4px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.mcp-item:hover {
  background: var(--color-primary-light);
}

.mcp-item-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.mcp-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.mcp-item-detail {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.mcp-label {
  font-size: 12px;
  color: var(--color-text-primary);
  white-space: nowrap;
}

.mcp-tools {
  font-size: 10px;
  color: var(--color-text-muted);
}

.mcp-restart-hint {
  font-size: 10px;
  color: var(--color-magic-gold);
  text-align: center;
  padding: 4px;
  margin-top: 4px;
}

@media (max-width: 768px) {
  .chat-sidebar {
    position: fixed;
    top: 0;
    left: -280px;
    width: 260px;
    height: 100vh;
    height: 100dvh;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    z-index: 60;
    transition: left 0.3s ease;
    box-shadow: var(--shadow-card);
  }

  .chat-sidebar.mobile-open {
    left: 0;
  }

  .chat-sidebar.collapsed {
    width: 260px;
    overflow: visible;
    border-right: var(--border-thin) var(--color-border);
  }
}
</style>
