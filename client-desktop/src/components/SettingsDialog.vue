<template>
  <el-dialog v-model="visible" title="API 配置" width="500px" :close-on-click-modal="false">
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item label="供应商名称">
        <el-input v-model="form.name" placeholder="如 魔搭社区" />
      </el-form-item>
      <el-form-item label="API Key">
        <el-input v-model="form.apiKey" type="password" show-password placeholder="sk-..." />
      </el-form-item>
      <el-form-item label="Base URL">
        <el-input v-model="form.baseURL" placeholder="https://api-inference.modelscope.cn" />
      </el-form-item>
      <el-form-item label="模型">
        <el-input v-model="form.model" placeholder="Qwen/Qwen3.5-397B-A17B" />
      </el-form-item>
      <el-form-item label="格式">
        <el-select v-model="form.format">
          <el-option label="OpenAI" value="openai" />
          <el-option label="Anthropic" value="anthropic" />
        </el-select>
      </el-form-item>
      <el-form-item label="请求模板（JSON，可选）">
        <el-input
          v-model="form.requestTemplate"
          type="textarea"
          :rows="4"
          placeholder='{"model":"{{model}}","messages":[...]} 留空使用默认格式'
        />
      </el-form-item>
      <div class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="save" :loading="saving">保存</el-button>
      </div>
    </el-form>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { Setting } from '@element-plus/icons-vue'

const visible = ref(false)
const saving = ref(false)

const form = reactive({
  name: '',
  apiKey: '',
  baseURL: '',
  model: '',
  format: 'openai' as string,
  requestTemplate: '',
})

async function load() {
  try {
    const resp = await fetch('/api/desktop/settings')
    const data = await resp.json()
    if (data.success && data.result) {
      form.name = data.result.name || ''
      form.apiKey = data.result.apiKey || ''
      form.baseURL = data.result.baseURL || ''
      form.model = data.result.model || ''
      form.format = data.result.format || 'openai'
      form.requestTemplate = data.result.requestTemplate || ''
    }
  } catch { /* server offline */ }
}

async function save() {
  saving.value = true
  try {
    const resp = await fetch('/api/desktop/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await resp.json()
    if (data.success) {
      ElMessage.success('配置已保存，重新对话后生效')
      visible.value = false
    } else {
      ElMessage.error(data.message || '保存失败')
    }
  } catch {
    ElMessage.error('无法连接到后端')
  } finally {
    saving.value = false
  }
}

defineExpose({ open: () => { visible.value = true; load() } })
</script>

<style scoped>
.dialog-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
