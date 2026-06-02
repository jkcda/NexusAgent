<template>
  <div class="chat-area">
    <!-- Header -->
    <div class="chat-header">
      <h2>RAG 对话</h2>
      <div class="header-actions">
        <!-- Token 上下文圈 -->
        <el-tooltip
          v-if="currentSessionId && messages.length > 0"
          placement="bottom"
          :content="contextTooltip"
          raw-content
        >
          <div class="ctx-gauge" :style="{ '--pct': contextPercent }">
            <svg viewBox="0 0 36 36" class="ctx-ring">
              <path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path class="ring-fill" :class="ctxColor" stroke-dasharray="100, 100" :style="{ strokeDashoffset: 100 - contextPercent }" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
            <span class="ctx-label">{{ contextPercent }}%</span>
          </div>
        </el-tooltip>
        <el-button v-if="currentSessionId" size="small" @click="$emit('clear')">清空对话</el-button>
      </div>
    </div>

    <!-- Messages -->
    <div class="chat-messages" ref="messagesRef">
      <div v-if="!currentSessionId" class="empty-state">
        <p>选择一个对话或创建新对话开始使用</p>
      </div>
      <template v-else>
        <div v-if="loadingHistory" class="loading-hint">加载历史消息...</div>
        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="['msg', msg.role, { streaming: isLoading && i === typingMessageIndex }]"
          v-show="msg.content || msg.role === 'user'"
        >
          <div class="msg-avatar">
            <el-avatar v-if="msg.role === 'assistant'" :size="32" style="background: #1890ff">AI</el-avatar>
            <el-avatar v-else :size="32" :src="userAvatarUrl" :style="msg.role === 'user' && !userAvatarUrl ? { background: '#52c41a' } : {}">
              <el-icon v-if="msg.role === 'user' && !userAvatarUrl"><UserFilled /></el-icon>
            </el-avatar>
          </div>
          <div class="msg-body">
            <div class="msg-content" v-html="renderMarkdown(msg.content)"></div>
            <!-- Files -->
            <div v-if="msg.files?.length" class="msg-files">
              <div v-for="(f, fi) in msg.files" :key="fi" class="msg-file">
                <img v-if="f.type.startsWith('image/')" :src="f.url" class="msg-img" />
                <a v-else :href="f.url" target="_blank">{{ f.name }}</a>
              </div>
            </div>
            <!-- RAG sources -->
            <div v-if="(msg as any).retrievedChunks?.length" class="msg-sources">
              <el-tag
                v-for="(chunk, ci) in (msg as any).retrievedChunks"
                :key="ci"
                size="small"
                type="info"
              >
                {{ chunk.source }} ({{ (chunk.score * 100).toFixed(0) }}%)
              </el-tag>
            </div>
            <!-- Feedback buttons (AI only) -->
            <div v-if="msg.role === 'assistant' && currentSessionId && msg.content" class="msg-feedback">
              <span
                :class="['fb-btn', { active: fbState(i, 'up') }]"
                @click="submitFeedback(i, 'up')"
                title="有帮助"
              >👍</span>
              <span
                :class="['fb-btn', { active: fbState(i, 'down') }]"
                @click="submitFeedback(i, 'down')"
                title="不满意"
              >👎</span>
            </div>
          </div>
        </div>
        <!-- Loading 气泡：没有内容时显示，有内容后自动隐藏 -->
        <div v-if="isLoading && !hasStreamingContent" class="msg assistant">
          <div class="msg-avatar">
            <el-avatar :size="32" style="background: #1890ff">AI</el-avatar>
          </div>
          <div class="msg-body">
            <div class="loading-text">{{ loadingText }}</div>
          </div>
        </div>
      </template>
    </div>

    <!-- 输入区域Input area -->
    <div class="chat-input" v-if="currentSessionId">
      <!-- Toolbar -->
      <div class="input-toolbar">
        <el-tooltip content="开启后每次对话自动检索知识库" placement="top">
          <div class="kb-switch">
            <el-switch v-model="forceKb" size="small" />
            <span class="kb-switch-label">知识库</span>
          </div>
        </el-tooltip>
        <el-tooltip content="开启后自动联网搜索补充信息" placement="top">
          <div class="kb-switch">
            <el-switch v-model="webSearch" size="small" />
            <span class="kb-switch-label">联网搜索</span>
          </div>
        </el-tooltip>
        <el-select
          v-if="kbList.length > 0"
          v-model="localKbIds"
          placeholder="关联知识库（可多选）"
          clearable
          multiple
          collapse-tags
          collapse-tags-tooltip
          size="small"
          style="width: 200px"
          @change="$emit('update:kbIds', $event ?? [])"
        >
          <el-option v-for="kb in kbList" :key="kb.id" :label="kb.name" :value="kb.id" />
        </el-select>
        <el-select
          v-if="modelList.length > 0"
          v-model="localModel"
          size="small"
          style="width: 140px"
          @change="$emit('update:model', $event)"
        >
          <el-option v-for="m in modelList" :key="m.id" :label="m.name" :value="m.id" />
        </el-select>
        <el-upload
          :show-file-list="false"
          :auto-upload="false"
          multiple
          accept="image/*,.txt,.pdf,.doc,.docx,.md"
          :on-change="handleFileSelect"
        >
          <el-button size="small">
            <el-icon><Paperclip /></el-icon>
          </el-button>
        </el-upload>
      </div>
      <!-- Selected files preview -->
      <div v-if="selectedFiles.length > 0" class="file-preview">
        <el-tag
          v-for="(f, i) in selectedFiles"
          :key="i"
          closable
          size="small"
          @close="removeFile(i)"
        >
          {{ f.name }}
        </el-tag>
      </div>
      <!-- Input -->
      <div class="input-row">
        <el-input
          v-model="inputText"
          type="textarea"
          :rows="3"
          placeholder="输入您的问题... (Enter 发送, Shift+Enter 换行)"
          @keydown.enter.exact.prevent="handleSend"
        />
        <el-button type="primary" :loading="isLoading" @click="handleSend" class="send-btn">
          发送
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { UserFilled, Paperclip } from '@element-plus/icons-vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { submitFeedback as submitFeedbackApi } from '@/apis/ai'
import { useUserStore } from '@/stores/userStore'

const userStore = useUserStore()

marked.setOptions({ breaks: true, gfm: true })

interface FileAttachment {
  name: string
  url: string
  type: string
}

interface KbItem {
  id: number
  name: string
}

interface ModelItem {
  id: string
  name: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  files?: FileAttachment[]
  retrievedChunks?: { source: string; score: number }[]
}

const props = defineProps<{
  messages: Message[]
  isLoading: boolean
  loadingHistory: boolean
  currentSessionId: string
  kbList: KbItem[]
  selectedKbIds: number[]
  modelList: ModelItem[]
  selectedModel: string
  loadingStage: string
  typingMessageIndex: number
}>()

const emit = defineEmits<{
  send: [content: string, files: File[], forceKbRetrieval: boolean, webSearchEnabled: boolean]
  clear: []
  'update:kbIds': [ids: number[]]
  'update:model': [id: string]
}>()

const inputText = ref('')
const messagesRef = ref<HTMLElement>()
const selectedFiles = ref<{ file: File; name: string }[]>([])
const forceKb = ref(true)
const webSearch = ref(false)

const localKbIds = ref<number[]>([...props.selectedKbIds])
const localModel = ref(props.selectedModel)

watch(() => props.selectedKbIds, v => { localKbIds.value = [...v] })
watch(() => props.selectedModel, v => localModel.value = v)

const loadingText = computed(() => {
  const map: Record<string, string> = {
    thinking: 'AI 思考中...',
    searching: '正在搜索...',
    retrieving_kb: '正在检索知识库...',
    recalling: '正在回忆上下文...',
    composing: '正在生成回答...',
  }
  return map[props.loadingStage] || '处理中...'
})

// 检查是否有正在流式输出的内容（用于区分loading状态和打字机状态）
const hasStreamingContent = computed(() => {
  const lastMsg = props.messages[props.messages.length - 1]
  return lastMsg?.role === 'assistant' && !!lastMsg?.content?.trim()
})

// ── Token 上下文可视化 ──
const CTX_BUDGET = 110000
const ctxStats = ref({ tokens: 0, hasSummary: false })
const ctxLoading = ref(false)

async function fetchContextStats() {
  if (!props.currentSessionId) return
  ctxLoading.value = true
  try {
    const res = await fetch(`/api/ai/context-stats?sessionId=${encodeURIComponent(props.currentSessionId)}`)
    const data = await res.json()
    if (data.success) {
      ctxStats.value = {
        tokens: data.result.totalUsed || data.result.historyTokens,
        hasSummary: data.result.hasSummary,
      }
    }
  } catch {} finally {
    ctxLoading.value = false
  }
}

watch(() => props.messages.length, () => fetchContextStats())

const contextPercent = computed(() => Math.min(100, Math.round((ctxStats.value.tokens / CTX_BUDGET) * 100)))

const userAvatarUrl = computed(() => {
  const info = userStore.getUserInfo()
  if (info?.avatar) {
    const baseURL = (import.meta.env as any).VITE_BASE_URL || ''
    return baseURL + info.avatar
  }
  return ''
})

const ctxColor = computed(() => {
  if (contextPercent.value > 80) return 'ctx-danger'
  if (contextPercent.value > 50) return 'ctx-warn'
  return 'ctx-safe'
})

const contextTooltip = computed(() => {
  const used = ctxStats.value.tokens.toLocaleString()
  const budget = CTX_BUDGET.toLocaleString()
  const pct = contextPercent.value
  const summaryNote = ctxStats.value.hasSummary ? '<br>已启用历史摘要压缩' : ''
  const warnNote = pct > 80 ? '<br><b style="color:#e74c3c">接近上限，将触发压缩</b>' : ''
  return `上下文: ${used} / ${budget} tokens (${pct}%)${summaryNote}${warnNote}`
})


watch(() => props.messages.length, () => scrollToBottom())
watch(() => props.isLoading, () => scrollToBottom())

function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

// 反馈状态（sessionId:msgIndex → 'up'|'down'）
const feedbackState = ref<Record<string, 'up' | 'down'>>({})

function fbKey(msgIndex: number) {
  return `${props.currentSessionId}_${msgIndex}`
}

function fbState(msgIndex: number, rating: 'up' | 'down') {
  return feedbackState.value[fbKey(msgIndex)] === rating
}

async function submitFeedback(msgIndex: number, rating: 'up' | 'down') {
  const key = fbKey(msgIndex)
  if (feedbackState.value[key]) return  // 已提交
  feedbackState.value[key] = rating
  try {
    await submitFeedbackApi({ sessionId: props.currentSessionId, messageIndex: msgIndex, rating })
  } catch {
    delete feedbackState.value[key]
  }
}

function handleFileSelect(uploadFile: any) {
  selectedFiles.value.push({ file: uploadFile.raw, name: uploadFile.name })
}

function removeFile(index: number) {
  selectedFiles.value.splice(index, 1)
}

async function handleSend() {
  const text = inputText.value.trim()
  const files = selectedFiles.value.map(f => f.file)

  if (!text && files.length === 0) return

  emit('send', text, files, forceKb.value, webSearch.value)
  inputText.value = ''
  selectedFiles.value = []
}

function renderMarkdown(content: string): string {
  if (!content) return ''
  const raw = marked.parse(content) as string
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','b','strong','i','em','u','s','a','ul','ol','li','pre','code','blockquote','hr','img','table','thead','tbody','tr','th','td','span','div'],
    ALLOWED_ATTR: ['href','target','src','alt','class'],
  })
}
</script>

<style scoped>
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Token 上下文圈 */
.ctx-gauge {
  position: relative;
  width: 28px;
  height: 28px;
  cursor: pointer;
}

.ctx-ring {
  width: 100%;
  height: 100%;
}

.ring-bg {
  fill: none;
  stroke: #eee;
  stroke-width: 3;
}

.ring-fill {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s, stroke 0.3s;
}

.ring-fill.ctx-safe { stroke: #67c23a; }
.ring-fill.ctx-warn  { stroke: #e6a23c; }
.ring-fill.ctx-danger { stroke: #e74c3c; }

.ctx-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  color: #666;
}

.chat-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 14px;
}

.loading-hint {
  text-align: center;
  color: #999;
  padding: 20px;
  font-size: 13px;
}

.msg {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.msg.user {
  flex-direction: row-reverse;
}

.msg-avatar {
  flex-shrink: 0;
}

.msg-body {
  max-width: 70%;
  min-width: 0;
}

.msg.user .msg-body {
  background: #e6f7ff;
  border-radius: 8px 2px 8px 8px;
  padding: 10px 14px;
}

.msg.assistant .msg-body {
  background: #fafafa;
  border-radius: 2px 8px 8px 8px;
  padding: 10px 14px;
}

.msg-content {
  font-size: 14px;
  line-height: 1.7;
  word-wrap: break-word;
}

.msg-content :deep(pre) {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 13px;
}

.msg-content :deep(code) {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 13px;
}

.msg-content :deep(blockquote) {
  border-left: 3px solid #1890ff;
  padding-left: 12px;
  color: #666;
  margin: 8px 0;
}

.msg-content :deep(a) {
  color: #1890ff;
}

.msg-content :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}

.msg-files {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.msg-img {
  max-width: 200px;
  max-height: 200px;
  border-radius: 6px;
  object-fit: cover;
}

.msg-sources {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.loading-text {
  color: #999;
  font-size: 13px;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.chat-input {
  border-top: 1px solid #f0f0f0;
  padding: 16px 20px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
}

.input-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  align-items: center;
}

.kb-switch {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.kb-switch-label {
  font-size: 12px;
  color: #666;
}

.file-preview {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.input-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.send-btn {
  flex-shrink: 0;
  height: 74px;
}

.msg-feedback {
  margin-top: 6px;
  display: flex;
  gap: 8px;
}

.fb-btn {
  cursor: pointer;
  font-size: 14px;
  opacity: 0.4;
  user-select: none;
  transition: opacity 0.15s;
}

.fb-btn:hover, .fb-btn.active {
  opacity: 1;
}
</style>
