import { defineStore } from 'pinia'
import { ref } from 'vue'
import { login } from '@/apis/user'

export const useUserStore = defineStore('user', () => { 
    // 用户信息
    const userInfo = ref<any>(null)
    
    // Token
    const token = ref<string>('')
    
    /**
     * 设置 Token
     * @param newToken JWT Token
     */
    const setToken = (newToken: string) => {
        token.value = newToken
        localStorage.setItem('token', newToken)
    }
    
    /**
     * 获取 Token
     */
    const getToken = (): string => {
        return token.value || localStorage.getItem('token') || ''
    }
    
    /**
     * 设置用户信息
     * @param info 用户信息对象
     */
    const setUserInfo = (info: any) => {
        userInfo.value = info
        localStorage.setItem('userInfo', JSON.stringify(info))
    }
    
    /**
     * 获取用户信息
     */
    const getUserInfo = (): any => {
        return userInfo.value || JSON.parse(localStorage.getItem('userInfo') || 'null')
    }
    
    /**
     * 清除用户信息（退出登录）
     */
    const clearUserInfo = () => {
        userInfo.value = null
        token.value = ''
        localStorage.removeItem('token')
        localStorage.removeItem('userInfo')
    }
    
    /**
     * 检查是否已登录
     */
    const isLoggedIn = (): boolean => {
        return !!getToken()
    }
    
    return {
        userInfo,
        token,
        setToken,
        getToken,
        setUserInfo,
        getUserInfo,
        clearUserInfo,
        isLoggedIn
    }
})
