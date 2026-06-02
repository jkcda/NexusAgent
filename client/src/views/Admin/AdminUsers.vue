<template>
  <div class="admin-users">
    <el-card shadow="hover">
      <template #header>
        <div class="card-header">
          <span>用户管理</span>
          <div class="header-actions">
            <el-button type="primary" @click="openCreateDialog">
              <el-icon><Plus /></el-icon>
              新增用户
            </el-button>
            <el-button @click="fetchUsers" :loading="loading">刷新</el-button>
          </div>
        </div>
      </template>

      <el-table
        :data="users"
        stripe
        v-loading="loading"
        style="width: 100%"
        empty-text="暂无用户数据"
      >
        <el-table-column prop="id" label="ID" width="80" align="center" />
        <el-table-column prop="username" label="用户名" min-width="140">
          <template #default="{ row }">
            <div class="username-cell">
              <el-icon><User /></el-icon>
              {{ row.username }}
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" min-width="200" />
        <el-table-column prop="role" label="角色" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : ''" effect="plain">
              {{ row.role === 'admin' ? '管理员' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="department" label="部门" min-width="120">
          <template #default="{ row }">
            {{ row.department || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="注册时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right" align="center">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="openEditDialog(row)">
              编辑
            </el-button>
            <el-button type="danger" size="small" link @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑用户' : '新增用户'"
      width="480px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="formRules"
        label-width="80px"
      >
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="密码" :prop="isEdit ? '' : 'password'">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="isEdit ? '留空则不修改密码' : '请输入密码'"
          />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" style="width: 100%">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="form.department" allow-create filterable clearable placeholder="选择或输入部门">
            <el-option v-for="d in departments" :key="d" :label="d" :value="d" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm" :loading="submitting">
          {{ isEdit ? '保存修改' : '创建用户' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { Plus, User } from '@element-plus/icons-vue'
import { getUsers, createUser, updateUser, deleteUser, getDepartments } from '@/apis/admin'

interface UserItem {
  id: number
  username: string
  email: string
  role: string
  department?: string
  created_at: string
}

const loading = ref(false)
const users = ref<UserItem[]>([])

const dialogVisible = ref(false)
const isEdit = ref(false)
const editingId = ref<number | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()

const departments = ref<string[]>([])
const form = ref({
  username: '',
  email: '',
  password: '',
  role: 'user',
  department: ''
})

const formRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度在3-20之间', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少6位', trigger: 'blur' }
  ],
  role: [
    { required: true, message: '请选择角色', trigger: 'change' }
  ]
}

const resetForm = () => {
  form.value = { username: '', email: '', password: '', role: 'user', department: '' }
  editingId.value = null
  isEdit.value = false
  formRef.value?.resetFields()
}

const openCreateDialog = () => {
  resetForm()
  dialogVisible.value = true
}

const openEditDialog = (row: UserItem) => {
  resetForm()
  isEdit.value = true
  editingId.value = row.id
  form.value.username = row.username
  form.value.email = row.email
  form.value.role = row.role
  form.value.department = row.department || ''
  dialogVisible.value = true
}

const fetchUsers = async () => {
  loading.value = true
  try {
    const res = await getUsers()
    if (res.data.success) {
      users.value = res.data.result.users || []
    } else {
      ElMessage.error(res.data.message || '获取用户列表失败')
    }
  } catch (err: any) {
    ElMessage.error(err.message || '网络错误')
  } finally {
    loading.value = false
  }
}

const submitForm = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const payload: any = {
      username: form.value.username,
      email: form.value.email,
      role: form.value.role,
      department: form.value.department || ''
    }
    if (form.value.password) {
      payload.password = form.value.password
    }

    if (isEdit.value && editingId.value) {
      if (!form.value.password) {
        delete payload.password
      }
      const res = await updateUser(editingId.value, payload)
      if (res.data.success) {
        ElMessage.success('更新用户成功')
        dialogVisible.value = false
        fetchUsers()
      } else {
        ElMessage.error(res.data.message || '更新失败')
      }
    } else {
      payload.password = form.value.password
      const res = await createUser(payload)
      if (res.data.success) {
        ElMessage.success('创建用户成功')
        dialogVisible.value = false
        fetchUsers()
      } else {
        ElMessage.error(res.data.message || '创建失败')
      }
    }
  } catch (err: any) {
    ElMessage.error(err.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

const handleDelete = async (row: UserItem) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除用户「${row.username}」吗？此操作不可恢复。`,
      '删除确认',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    )
    const res = await deleteUser(row.id)
    if (res.data.success) {
      ElMessage.success('删除用户成功')
      fetchUsers()
    } else {
      ElMessage.error(res.data.message || '删除失败')
    }
  } catch (err: any) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(err.message || '删除失败')
    }
  }
}

const formatTime = (time: string | null) => {
  if (!time) return ''
  const d = new Date(time)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const fetchDepartments = async () => {
  try {
    const res = await getDepartments()
    if (res.data.success) {
      departments.value = res.data.result.departments || []
    }
  } catch { /* 静默失败 */ }
}

onMounted(() => {
  fetchUsers()
  fetchDepartments()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 16px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.username-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-end;
  }

  :deep(.el-table) {
    font-size: 12px;
  }

  :deep(.el-dialog) {
    width: 90% !important;
  }
}
</style>
