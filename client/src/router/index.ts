import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'

// Layout 是外壳组件，保持静态导入
import Layout from '@/views/Layout/index.vue'
import AuthLayout from '@/views/Auth/AuthLayout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // 前台路由 - 首页即根路径
    {
      path: '/',
      component: Layout,
      children: [
        {
          path: '',
          component: () => import('@/views/Home/home.vue'),
          meta: { title: '首页' }
        },
        {
          path: 'chat',
          component: () => import('@/views/Chat/index.vue'),
          meta: { title: 'AI对话' }
        },
        {
          path: 'knowledge-base',
          component: () => import('@/views/KnowledgeBase/index.vue'),
          meta: { title: '知识库' }
        },
        {
          path: 'agents',
          component: () => import('@/views/Agent/AgentManager.vue'),
          meta: { title: '角色管理', requiresAuth: true }
        },
        {
          path: 'rooms',
          component: () => import('@/views/Room/index.vue'),
          meta: { title: '聊天室', requiresAuth: true }
        },
        {
          path: 'room/:id',
          component: () => import('@/views/Room/RoomChat.vue'),
          meta: { title: '聊天室', requiresAuth: true }
        }
      ]
    },
    // 后台路由
    {
      path: '/admin',
      component: () => import('@/views/Admin/AdminLayout.vue'),
      redirect: '/admin/providers',
      children: [
        {
          path: 'dashboard',
          component: () => import('@/views/Admin/AdminDashboard.vue'),
          meta: { title: '对话统计', requiresAdmin: true }
        },
        {
          path: 'users',
          component: () => import('@/views/Admin/AdminUsers.vue'),
          meta: { title: '用户管理', requiresAdmin: true }
        },
        {
          path: 'api-keys',
          component: () => import('@/views/Admin/ApiKeys.vue'),
          meta: { title: 'API Key 管理', requiresAdmin: true }
        },
        {
          path: 'providers',
          component: () => import('@/views/Admin/Providers.vue'),
          meta: { title: '模型供应商配置' }
        }
      ]
    },
    // 认证页面（登录/注册）— 背景图 + 左侧介绍 + 右侧表单
    {
      path: '/auth',
      component: AuthLayout,
      children: [
        {
          path: 'login',
          name: 'Login',
          component: () => import('@/views/Login/login.vue'),
          meta: { title: '登录' }
        },
        {
          path: 'register',
          name: 'Register',
          component: () => import('@/views/Register/Register.vue'),
          meta: { title: '注册' }
        },
        {
          path: '',
          redirect: '/auth/login'
        }
      ]
    },
    {
      path: '/verify',
      component: () => import('@/views/Auth/VerifyEmail.vue'),
      meta: { title: '邮箱验证' }
    },
    // 旧路由重定向
    { path: '/login', redirect: '/auth/login' },
    { path: '/register', redirect: '/auth/register' },
  ],
})

// 路由守卫
// 作用：控制页面访问权限
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('token')
  const userInfoStr = localStorage.getItem('userInfo')

  // 游客可访问的页面（无需登录）
  const guestPages = ['/auth/login', '/auth/register', '/verify', '/login', '/register', '/', '/chat']

  // 检查是否需要登录
  if (!token && !guestPages.includes(to.path)) {
    return next('/auth/login')
  }

  // 检查是否需要管理员权限
  if (to.meta.requiresAdmin) {
    if (userInfoStr) {
      try {
        const userInfo = JSON.parse(userInfoStr)
        if (userInfo.role !== 'admin') {
          ElMessage.error('无管理员权限，无法访问后台')
          return next('/')
        }
      } catch {
        return next('/auth/login')
      }
    } else {
      return next('/auth/login')
    }
  }

  next()
})

export default router
