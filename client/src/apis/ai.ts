import request from '@/utils/http'
import { resizeImageIfNeeded } from '@/utils/image'

interface UploadResult {
  name: string
  url: string
  type: string
  size: number
}

// 获取对话历史接口
export const getChatHistory = (sessionId: string) => {
  return request.get(`/ai/history?sessionId=${encodeURIComponent(sessionId)}`)
}

// AI 聊天接口（流式）
export const chatWithAI = (data: {
  message: string
  sessionId: string
  userId?: number | null
  files?: UploadResult[]
  kbId?: number
  model?: string
  agentId?: number | null
  initImage?: string
}) => {
  return request.post('/ai/chat', data)
}

// 获取用户的会话列表
export const getSessions = () => {
  return request.get('/ai/sessions')
}

// 删除对话历史接口
export const deleteChatHistory = (sessionId: string) => {
  return request.delete(`/ai/history?sessionId=${encodeURIComponent(sessionId)}`)
}

// 清空用户全部 RAG 记忆（管理员专用）
export const clearUserMemories = (userId: number) => {
  return request.delete(`/ai/memory?userId=${userId}`)
}

// 提交对话反馈（点赞/点踩）
export const submitFeedback = (data: {
  sessionId: string
  messageIndex: number
  rating: 'up' | 'down'
  comment?: string
}) => {
  return request.post('/ai/feedback', data)
}

// 上传文件（图片自动缩放到 4k 以内）
export const uploadFile = async (file: File): Promise<UploadResult> => {
  const resized = await resizeImageIfNeeded(file)
  const formData = new FormData()
  formData.append('file', resized)
  const baseURL = (import.meta.env as any).VITE_BASE_URL || ''
  const response = await fetch(`${baseURL}/api/upload`, {
    method: 'POST',
    body: formData
  })
  const data = await response.json()
  if (!data.success) {
    throw new Error(data.message || '上传失败')
  }
  return data.result
}
