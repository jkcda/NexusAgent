import axios from 'axios'

const http = axios.create({
    baseURL: (import.meta.env.VITE_BASE_URL || '') + '/api',
    timeout: 5000,
})
//请求拦截器
http.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token')
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }
        return config
    },
    (error) => {
        return Promise.reject(error)
    }
)

//响应拦截器
http.interceptors.response.use(
    (response) => {
        return response
    },
    (error) => {
        // 处理后端返回的错误
        if (error.response) {
            // 服务器返回错误状态码
            const { status, data } = error.response
            
            // 提取错误信息
            let errorMessage = '请求失败'
            if (data && data.message) {
                errorMessage = data.message
            } else if (data && data.error) {
                errorMessage = data.error
            }
            
            // 根据状态码处理
            switch (status) {
                case 400:
                    console.error('请求参数错误:', errorMessage)
                    break
                case 401:
                    console.error('未授权，请重新登录:', errorMessage)
                    // 可以在这里添加跳转到登录页的逻辑
                    break
                case 403:
                    console.error('拒绝访问:', errorMessage)
                    break
                case 404:
                    console.error('请求的资源不存在:', errorMessage)
                    break
                case 500:
                    console.error('服务器内部错误:', errorMessage)
                    break
                default:
                    console.error(`请求失败 (${status}):`, errorMessage)
            }
            
            // 将错误信息添加到 error 对象中，方便前端捕获
            error.message = errorMessage
        } else if (error.request) {
            // 请求已发出但没有收到响应
            console.error('网络错误，无法连接到服务器')
            error.message = '网络错误，无法连接到服务器'
        } else {
            // 请求配置出错
            console.error('请求配置错误:', error.message)
        }
        
        return Promise.reject(error)
    }
)
export default http