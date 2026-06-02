<template>
  <div class="settings-page">
    <div class="page-header">
      <h2>系统设置</h2>
    </div>

    <el-tabs v-model="activeTab">
      <!-- 系统配置 -->
      <el-tab-pane label="系统配置" name="system">
        <el-card>
          <el-form label-width="140px" size="default">
            <el-form-item label="JWT 密钥">
              <el-input
                v-model="systemSettings.JWT_SECRET"
                type="password"
                show-password
                placeholder="用于签名和验证登录凭证"
              />
              <div class="form-tip">修改后所有用户需重新登录</div>
            </el-form-item>
            <el-form-item label="邮箱账号">
              <el-input
                v-model="systemSettings.EMAIL_USER"
                placeholder="QQ邮箱 SMTP 账号"
              />
            </el-form-item>
            <el-form-item label="邮箱授权码">
              <el-input
                v-model="systemSettings.EMAIL_PASS"
                type="password"
                show-password
                placeholder="QQ邮箱 SMTP 授权码"
              />
            </el-form-item>
            <el-form-item label="CORS 白名单">
              <el-input
                v-model="systemSettings.CORS_ORIGINS"
                placeholder="http://localhost:5173,http://localhost:5174"
              />
              <div class="form-tip">多个地址用逗号分隔</div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingSystem" @click="saveSystemSettings">
                保存系统配置
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- LLM 配置 -->
      <el-tab-pane label="LLM 配置" name="llm">
        <el-card>
          <el-form :model="llmForm" label-width="120px" size="default">
            <el-form-item label="供应商名称">
              <el-input v-model="llmForm.name" placeholder="如: OpenAI, Anthropic" />
            </el-form-item>
            <el-form-item label="API Key">
              <el-input v-model="llmForm.apiKey" type="password" show-password placeholder="sk-..." />
            </el-form-item>
            <el-form-item label="接口地址">
              <el-input v-model="llmForm.baseURL" placeholder="https://api.openai.com/v1" />
            </el-form-item>
            <el-form-item label="模型名称">
              <el-input v-model="llmForm.model" placeholder="gpt-4o, claude-sonnet-4-20250514" />
            </el-form-item>
            <el-form-item label="请求格式">
              <el-select v-model="llmForm.format">
                <el-option label="OpenAI 兼容" value="openai" />
                <el-option label="Anthropic SDK" value="anthropic" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingLLM" @click="saveLLM">保存配置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 图片生成配置 -->
      <el-tab-pane label="图片生成" name="image">
        <el-card>
          <el-form :model="imageForm" label-width="120px">
            <el-form-item label="供应商名称">
              <el-input v-model="imageForm.name" />
            </el-form-item>
            <el-form-item label="API Key">
              <el-input v-model="imageForm.apiKey" type="password" show-password />
            </el-form-item>
            <el-form-item label="接口地址">
              <el-input v-model="imageForm.baseURL" />
            </el-form-item>
            <el-form-item label="模型名称">
              <el-input v-model="imageForm.model" />
            </el-form-item>
            <el-form-item label="默认尺寸">
              <el-input v-model="imageForm.defaultSize" placeholder="1024x1024" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingImage" @click="saveImage">保存配置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- MCP 配置 -->
      <el-tab-pane label="MCP 服务" name="mcp">
        <el-card>
          <div v-if="loadingMcp" class="loading-state">加载中...</div>
          <div v-else-if="mcpServers.length === 0" class="empty-state">
            暂无 MCP Server 配置
          </div>
          <el-table v-else :data="mcpServers" style="width: 100%">
            <el-table-column prop="name" label="服务名称" />
            <el-table-column prop="status" label="状态">
              <template #default="{ row }">
                <el-tag :type="row.enabled ? 'success' : 'info'">
                  {{ row.enabled ? '已启用' : '已禁用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="toolCount" label="工具数量" width="100" />
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-switch
                  v-model="row.enabled"
                  :loading="row.toggling"
                  @change="(val: boolean) => toggleMcp(row, val)"
                />
              </template>
            </el-table-column>
          </el-table>
          <div v-if="mcpServers.length > 0" class="mcp-summary">
            共 {{ mcpServers.length }} 个服务，已启用 {{ mcpServers.filter(s => s.enabled).length }} 个
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { getCapabilities, updateLLMConfig, updateImageConfig, getSettings, updateSetting, getMcpStatus, toggleMcpServer } from '@/apis/admin'

const activeTab = ref('system')
const savingLLM = ref(false)
const savingImage = ref(false)
const savingSystem = ref(false)
const loadingMcp = ref(false)

interface McpServer {
  name: string
  enabled: boolean
  toolCount: number
  toggling?: boolean
}

const mcpServers = ref<McpServer[]>([])

const systemSettings = reactive({
  JWT_SECRET: '',
  EMAIL_USER: '',
  EMAIL_PASS: '',
  CORS_ORIGINS: '',
})

const llmForm = reactive({
  name: '',
  apiKey: '',
  baseURL: '',
  model: '',
  format: 'openai',
})

const imageForm = reactive({
  name: '',
  apiKey: '',
  baseURL: '',
  model: '',
  defaultSize: '1024x1024',
})

async function loadSystemSettings() {
  try {
    const res = await getSettings()
    if (res.data.success) {
      const settings = res.data.result.settings
      settings.forEach((item: any) => {
        if (item.key_name in systemSettings) {
          systemSettings[item.key_name as keyof typeof systemSettings] = item.masked === '（未配置）' ? '' : item.masked
        }
      })
    }
  } catch {}
}

async function saveSystemSettings() {
  savingSystem.value = true
  try {
    const promises = Object.entries(systemSettings)
      .filter(([_, value]) => value && value !== '****')
      .map(([key, value]) => updateSetting(key, value))
    await Promise.all(promises)
    ElMessage.success('系统配置已更新')
    loadSystemSettings()
  } catch {
    ElMessage.error('保存失败')
  } finally {
    savingSystem.value = false
  }
}

async function loadCapabilities() {
  try {
    const res = await getCapabilities()
    if (res.data.success) {
      const caps = res.data.result.capabilities
      if (caps.llm) {
        llmForm.name = caps.llm.name || ''
        llmForm.apiKey = caps.llm.apiKey || ''
        llmForm.baseURL = caps.llm.baseURL || ''
        llmForm.model = caps.llm.model || ''
        llmForm.format = caps.llm.format || 'openai'
      }
      if (caps.image) {
        imageForm.name = caps.image.name || ''
        imageForm.apiKey = caps.image.apiKey || ''
        imageForm.baseURL = caps.image.baseURL || ''
        imageForm.model = caps.image.model || ''
        imageForm.defaultSize = caps.image.defaultSize || '1024x1024'
      }
    }
  } catch {}
}

async function saveLLM() {
  savingLLM.value = true
  try {
    await updateLLMConfig({
      name: llmForm.name,
      apiKey: llmForm.apiKey,
      baseURL: llmForm.baseURL,
      model: llmForm.model,
      format: llmForm.format,
    })
    ElMessage.success('LLM 配置已更新')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    savingLLM.value = false
  }
}

async function saveImage() {
  savingImage.value = true
  try {
    await updateImageConfig({
      name: imageForm.name,
      apiKey: imageForm.apiKey,
      baseURL: imageForm.baseURL,
      model: imageForm.model,
      defaultSize: imageForm.defaultSize,
    })
    ElMessage.success('图片生成配置已更新')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    savingImage.value = false
  }
}

async function loadMcpStatus() {
  loadingMcp.value = true
  try {
    const res = await getMcpStatus()
    if (res.data.success) {
      mcpServers.value = res.data.result.servers.map((s: any) => ({
        name: s.name,
        enabled: s.enabled,
        toolCount: s.toolCount,
      }))
    }
  } catch {
    ElMessage.error('加载 MCP 状态失败')
  } finally {
    loadingMcp.value = false
  }
}

async function toggleMcp(server: McpServer, enabled: boolean) {
  server.toggling = true
  try {
    await toggleMcpServer(server.name, enabled)
    server.enabled = enabled
    ElMessage.success(`${enabled ? '启用' : '禁用'}成功`)
  } catch {
    server.enabled = !enabled
    ElMessage.error('操作失败')
  } finally {
    server.toggling = false
  }
}

onMounted(() => {
  loadSystemSettings()
  loadCapabilities()
  loadMcpStatus()
})
</script>

<style scoped>
.settings-page {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.page-header {
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 40px 0;
  color: #909399;
}

.mcp-summary {
  margin-top: 16px;
  text-align: right;
  color: #606266;
  font-size: 14px;
}
</style>
