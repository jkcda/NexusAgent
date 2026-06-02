import request from '@/utils/http'

// 注册接口
export const register = (data: { username: string; email: string; password: string }) => {
  return request.post('/user/register', data)
}

// 登录接口
export const login = (data: { username: string; password: string }) => {
  return request.post('/user/login', data)
}

// 获取用户信息接口
export const getUserInfo = () => {
  return request.get('/user/info')
}

// 邮箱验证码验证
export const verifyEmail = (data: { email: string; code: string }) => {
  return request.post('/user/verify-email', data)
}

// 退出登录接口（清除对话历史）
export const logout = () => {
  return request.post('/user/logout')
}

// 上传用户头像
export const uploadAvatar = async (file: File): Promise<string> => {
  const formData = new FormData()
  formData.append('file', file)
  const baseURL = (import.meta.env as any).VITE_BASE_URL || ''
  const token = localStorage.getItem('token')
  const response = await fetch(`${baseURL}/api/upload/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  })
  const data = await response.json()
  if (!data.success) {
    throw new Error(data.message || '头像上传失败')
  }
  return data.result.url
}
