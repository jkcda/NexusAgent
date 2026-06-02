import request from '@/utils/http'

// 获取后台首页数据
export const getDashboard = () => {
  return request.get('/admin/dashboard')
}

// 获取所有用户对话统计
export const getUserChatStats = () => {
  return request.get('/admin/chat-stats')
}

// 获取指定用户的对话历史详情
export const getUserChatHistory = (userId: number) => {
  return request.get(`/admin/chat-history/${userId}`)
}

// 获取用户列表
export const getUsers = () => {
  return request.get('/admin/users')
}

// 创建用户
export const createUser = (data: {
  username: string
  email: string
  password: string
  role?: string
  department?: string
}) => {
  return request.post('/admin/users', data)
}

// 更新用户
export const updateUser = (id: number, data: {
  username?: string
  email?: string
  password?: string
  role?: string
  department?: string
}) => {
  return request.put(`/admin/users/${id}`, data)
}

// 获取部门列表
export const getDepartments = () => {
  return request.get('/admin/departments')
}

// 获取反馈统计
export const getFeedbackStats = () => {
  return request.get('/admin/feedback-stats')
}

// 删除用户
export const deleteUser = (id: number) => {
  return request.delete(`/admin/users/${id}`)
}

// 获取系统配置列表（脱敏）
export const getSettings = () => {
  return request.get('/admin/settings')
}

// 更新系统配置
export const updateSetting = (key_name: string, value: string) => {
  return request.put('/admin/settings', { key_name, value })
}

// 获取能力配置（LLM / 图片生成）
export const getCapabilities = () => {
  return request.get('/admin/capabilities')
}

// 更新 LLM 能力配置
export const updateLLMConfig = (data: {
  name?: string
  apiKey?: string
  format?: string
  baseURL?: string
  model?: string
  requestTemplate?: string
}) => {
  return request.put('/admin/capabilities/llm', data)
}

// 更新向量化能力配置
export const updateEmbeddingConfig = (data: {
  name?: string
  apiKey?: string
  baseURL?: string
  model?: string
  forceAPI?: boolean
}) => {
  return request.put('/admin/capabilities/embedding', data)
}

// 更新重排序能力配置
export const updateRerankConfig = (data: {
  name?: string
  apiKey?: string
  baseURL?: string
  model?: string
  forceAPI?: boolean
}) => {
  return request.put('/admin/capabilities/rerank', data)
}

// 更新图片生成能力配置
export const updateImageConfig = (data: {
  name?: string
  apiKey?: string
  baseURL?: string
  model?: string
  requestTemplate?: string
  defaultSize?: string
}) => {
  return request.put('/admin/capabilities/image', data)
}
