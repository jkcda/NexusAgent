import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import Layout from '@/views/Layout/index.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login/index.vue'),
      meta: { title: '登录', guest: true },
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('@/views/Login/Register.vue'),
      meta: { title: '注册', guest: true },
    },
    {
      path: '/',
      component: Layout,
      redirect: '/chat',
      children: [
        {
          path: 'chat',
          component: () => import('@/views/Chat/index.vue'),
          meta: { title: '对话' },
        },
        {
          path: 'dashboard',
          component: () => import('@/views/Dashboard/index.vue'),
          meta: { title: '概览' },
        },
        {
          path: 'kb',
          component: () => import('@/views/KnowledgeBase/index.vue'),
          meta: { title: '知识库管理' },
        },
        {
          path: 'kb/:id',
          component: () => import('@/views/KnowledgeBase/detail.vue'),
          meta: { title: '知识库详情' },
        },
        {
          path: 'admin/settings',
          component: () => import('@/views/Admin/Settings.vue'),
          meta: { title: '系统设置' },
        },
        {
          path: 'admin/users',
          component: () => import('@/views/Admin/Users.vue'),
          meta: { title: '用户管理' },
        },
      ],
    },
  ],
})

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('token')

  // Guest pages (login, register) don't require auth
  if (to.meta.guest) {
    if (token) return next('/chat')
    return next()
  }

  // All other pages require auth
  if (!token) return next('/login')

  // Admin routes check
  if (to.path.startsWith('/admin')) {
    try {
      const info = JSON.parse(localStorage.getItem('userInfo') || '{}')
      if (info.role !== 'admin') {
        ElMessage.error('无管理员权限')
        return next('/chat')
      }
    } catch {
      return next('/login')
    }
  }

  next()
})

export default router
