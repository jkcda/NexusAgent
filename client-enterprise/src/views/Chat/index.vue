<template>
  <div class="chat-wrapper">
    <SessionList
      :sessions="sessionList"
      :current-id="currentSessionId"
      :loading="loadingSessions"
      @create="createSession"
      @select="switchSession"
      @delete="deleteSession"
    />
    <ChatArea
      :messages="messages"
      :is-loading="isLoading"
      :loading-history="loadingHistory"
      :current-session-id="currentSessionId"
      :kb-list="kbList"
      :selected-kb-ids="selectedKbIds"
      :model-list="modelList"
      :selected-model="selectedModel"
      :loading-stage="loadingStage"
      :typing-message-index="typingMessageIndex"
      @send="handleSend"
      @clear="clearHistory"
      @update:kb-ids="selectedKbIds = $event"
      @update:model="onModelChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getChatHistory, deleteChatHistory, getSessions, uploadFile } from '@/apis/ai'
import { getKnowledgeBases, type KnowledgeBase } from '@/apis/knowledgeBase'
import { handleSSE } from '@/utils/sse'
import { useUserStore } from '@/stores/userStore'
import request from '@/utils/http'
import SessionList from './components/SessionList.vue'
import ChatArea from './components/ChatArea.vue'

interface FileAttachment {
  name: string
  url: string
  type: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  files?: FileAttachment[]
}

interface SessionItem {
  id: string
  preview: string
  messageCount: number
  lastActiveAt: string
}

const messages = ref<Message[]>([])
const isLoading = ref(false)
const loadingHistory = ref(false)
const loadingSessions = ref(false)
const currentSessionId = ref('')
const sessionList = ref<SessionItem[]>([])
const kbList = ref<KnowledgeBase[]>([])
const selectedKbIds = ref<number[]>([])
const selectedModel = ref('')
const modelList = ref<{ id: string; name: string }[]>([])
const loadingStage = ref('thinking')
const userStore = useUserStore()

// ── 打字机效果 ──
const typingMessageIndex = ref(-1)
let typewriterRafId = 0
let typewriterFullContent = ''
let typewriterTypedLen = 0
let typewriterMsgIndex = -1

function startTyping(msgIndex: number) {
  stopTyping()
  typewriterMsgIndex = msgIndex
  typingMessageIndex.value = msgIndex
  typewriterFullContent = ''
  typewriterTypedLen = 0

  const tick = () => {
    if (typewriterMsgIndex !== msgIndex) return
    const remaining = typewriterFullContent.length - typewriterTypedLen
    if (remaining <= 0) {
      typewriterRafId = requestAnimationFrame(tick)
      return
    }

    // 动态调速：积压多时加速，接近末尾时减速
    let charsPerFrame = 1 + Math.floor(Math.random() * 3)
    if (remaining > 300) charsPerFrame = 6
    else if (remaining > 100) charsPerFrame = 3
    else if (remaining < charsPerFrame) charsPerFrame = remaining

    typewriterTypedLen += charsPerFrame
    if (typewriterTypedLen > typewriterFullContent.length) {
      typewriterTypedLen = typewriterFullContent.length
    }

    const msg = messages.value[msgIndex]
    if (msg) msg.content = typewriterFullContent.slice(0, typewriterTypedLen)

    typewriterRafId = requestAnimationFrame(tick)
  }

  typewriterRafId = requestAnimationFrame(tick)
}

function stopTyping() {
  if (typewriterRafId) {
    cancelAnimationFrame(typewriterRafId)
    typewriterRafId = 0
  }
  typingMessageIndex.value = -1
  typewriterMsgIndex = -1
  typewriterFullContent = ''
  typewriterTypedLen = 0
}

function flushTyping() {
  if (typewriterMsgIndex >= 0) {
    const msg = messages.value[typewriterMsgIndex]
    if (msg) msg.content = typewriterFullContent
  }
  stopTyping()
}

const storageKey = `enterprise_sessions_${userStore.getUserInfo()?.id || 'anon'}`
const currentKey = `enterprise_current_${userStore.getUserInfo()?.id || 'anon'}`

function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function loadSessionList() {
  try {
    const raw = localStorage.getItem(storageKey)
    sessionList.value = raw ? JSON.parse(raw) : []
  } catch {
    sessionList.value = []
  }
}

function saveSessionList() {
  localStorage.setItem(storageKey, JSON.stringify(sessionList.value))
}

async function syncSessionsFromBackend() {
  try {
    const userId = userStore.getUserInfo()?.id
    if (!userId) return
    const res = await getSessions()
    if (res.data.success && res.data.result.sessions) {
      for (const bs of res.data.result.sessions) {
        if (!sessionList.value.some(s => s.id === bs.session_id)) {
          sessionList.value.push({
            id: bs.session_id,
            preview: bs.first_message?.slice(0, 30) || '新对话',
            messageCount: bs.message_count || 0,
            lastActiveAt: bs.last_active_at || bs.created_at,
          })
        }
      }
      sessionList.value.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
      saveSessionList()
    }
  } catch {}
}

async function loadHistory() {
  if (!currentSessionId.value) return
  loadingHistory.value = true
  try {
    const res = await getChatHistory(currentSessionId.value)
    if (res.data.success && res.data.result.messages) {
      messages.value = res.data.result.messages
    }
  } catch {
    ElMessage.error('加载历史消息失败')
  } finally {
    loadingHistory.value = false
  }
}

async function loadKBList() {
  try {
    const userId = userStore.getUserInfo()?.id
    if (!userId) return
    const res = await getKnowledgeBases()
    if (res.data.success) {
      kbList.value = res.data.result.knowledgeBases || []
    }
  } catch {}
}

async function loadModelList() {
  try {
    const res = await fetch('/api/ai/models')
    const data = await res.json()
    if (data.success) {
      modelList.value = data.result.models.map((m: any) => ({ id: m.id, name: m.name }))
      if (data.result.models.length > 0) {
        selectedModel.value = data.result.models[0].id
      }
    }
  } catch {}
}

async function init() {
  loadSessionList()
  await syncSessionsFromBackend()
  const saved = localStorage.getItem(currentKey)
  if (saved && sessionList.value.some(s => s.id === saved)) {
    currentSessionId.value = saved
    await loadHistory()
  } else if (sessionList.value.length > 0) {
    currentSessionId.value = sessionList.value[0].id
    localStorage.setItem(currentKey, currentSessionId.value)
    await loadHistory()
  }
  await loadKBList()
  await loadModelList()
}

function createSession() {
  const id = generateSessionId()
  const session: SessionItem = {
    id,
    preview: '新对话',
    messageCount: 0,
    lastActiveAt: new Date().toISOString(),
  }
  sessionList.value.unshift(session)
  saveSessionList()
  currentSessionId.value = id
  localStorage.setItem(currentKey, id)
  messages.value = []
}

async function switchSession(id: string) {
  if (id === currentSessionId.value) return
  stopTyping()
  currentSessionId.value = id
  localStorage.setItem(currentKey, id)
  messages.value = []
  await loadHistory()
}

async function deleteSession(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此对话吗？', '确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch { return }

  try {
    await deleteChatHistory(id)
  } catch {}

  sessionList.value = sessionList.value.filter(s => s.id !== id)
  saveSessionList()

  if (id === currentSessionId.value) {
    if (sessionList.value.length > 0) {
      await switchSession(sessionList.value[0].id)
    } else {
      currentSessionId.value = ''
      localStorage.removeItem(currentKey)
      messages.value = []
    }
  }
}

function updateSessionMeta() {
  const sess = sessionList.value.find(s => s.id === currentSessionId.value)
  if (sess) {
    sess.messageCount += 2
    sess.lastActiveAt = new Date().toISOString()
    saveSessionList()
  }
}

async function handleSend(content: string, files: File[], forceKbRetrieval: boolean = true, webSearchEnabled: boolean = false) {
  if (!currentSessionId.value) {
    createSession()
  }

  // Upload files if any
  let uploadedFiles: FileAttachment[] = []
  for (const file of files) {
    try {
      const result = await uploadFile(file)
      uploadedFiles.push({ name: result.name, url: result.url, type: result.type })
    } catch {
      ElMessage.error(`文件 ${file.name} 上传失败`)
    }
  }

  const sess = sessionList.value.find(s => s.id === currentSessionId.value)
  if (sess && !sess.preview && content) {
    sess.preview = content.slice(0, 30)
  }

  messages.value.push({
    role: 'user',
    content: content || '',
    files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
  })

  isLoading.value = true
  loadingStage.value = 'thinking'

  try {
    const userId = userStore.getUserInfo()?.id || null
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: content,
        sessionId: currentSessionId.value,
        userId,
        files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
        kbIds: selectedKbIds.value.length > 0 ? selectedKbIds.value : undefined,
        model: selectedModel.value || undefined,
        forceKbRetrieval,
        webSearchEnabled,
      }),
    })

    if (!response.ok) throw new Error('网络请求失败')

    const msgIndex = messages.value.length
    messages.value.push({ role: 'assistant', content: '' })

    let typingStarted = false

    await handleSSE(
      response,
      (chunk) => {
        // 首个文本 chunk 到达时启动打字机
        if (!typingStarted) {
          typingStarted = true
          startTyping(msgIndex)
          loadingStage.value = 'composing'
        }
        // 将 chunk 追加到打字机缓冲区
        typewriterFullContent += chunk
      },
      (error) => {
        stopTyping()
        ElMessage.error(error.message || '请求失败')
        isLoading.value = false
      },
      () => {
        // SSE 结束：等待打字机消费完剩余内容
        const waitFlush = () => {
          if (typewriterTypedLen >= typewriterFullContent.length) {
            flushTyping()
            isLoading.value = false
            updateSessionMeta()
            return
          }
          // 还有剩余内容，加速消费
          if (typewriterFullContent.length - typewriterTypedLen > 50) {
            typewriterTypedLen = Math.min(
              typewriterTypedLen + 20,
              typewriterFullContent.length
            )
          }
          requestAnimationFrame(waitFlush)
        }
        requestAnimationFrame(waitFlush)
      },
      (event) => {
        if (event.type === 'tool_call') {
          const stageMap: Record<string, string> = {
            search_web: 'searching',
            query_knowledge_base: 'retrieving_kb',
            recall_memory: 'recalling',
          }
          loadingStage.value = stageMap[event.tool || ''] || 'thinking'
        }
        if (event.type === 'tool_result') {
          loadingStage.value = 'composing'
        }
      }
    )
  } catch (err: any) {
    stopTyping()
    ElMessage.error(err.message || '发送失败')
    isLoading.value = false
  }
}

async function clearHistory() {
  if (!currentSessionId.value) return
  try {
    await ElMessageBox.confirm('确定要清空当前对话吗？', '确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch { return }

  try {
    const res = await deleteChatHistory(currentSessionId.value)
    if (res.data.success) {
      messages.value = []
      const sess = sessionList.value.find(s => s.id === currentSessionId.value)
      if (sess) {
        sess.messageCount = 0
        saveSessionList()
      }
      ElMessage.success('对话已清空')
    }
  } catch {
    ElMessage.error('清空失败')
  }
}

function onModelChange(val: string) {
  selectedModel.value = val
}

onMounted(() => init())
</script>

<style scoped>
.chat-wrapper {
  display: flex;
  height: 100%;
  gap: 0;
  background: #f0f2f5;
  border-radius: 8px;
  overflow: hidden;
}
</style>
