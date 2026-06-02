<template>
  <div class="kb-detail">
    <div class="page-header">
      <el-button @click="goBack">&lt; 返回列表</el-button>
      <h2>{{ kbName }}</h2>
    </div>

    <!-- Upload -->
    <el-card class="section">
      <template #header>
        <span>文档管理</span>
      </template>
      <el-upload
        ref="uploadRef"
        class="upload-area"
        drag
        multiple
        :accept="'.txt,.md,.json,.html,.pdf,.doc,.docx,.xlsx,.pptx'"
        :auto-upload="false"
        :file-list="fileList"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
      >
        <el-icon class="el-icon--upload" :size="40"><UploadFilled /></el-icon>
        <div class="el-upload__text">
          拖拽文件到此处 或 <em>点击选择</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            支持 TXT / MD / JSON / HTML / PDF / DOC / DOCX / XLSX / PPTX，单文件最大 20MB
          </div>
        </template>
      </el-upload>
      <div v-if="fileList.length > 0" style="margin-top:12px;text-align:right">
        <el-button @click="clearFiles">清空</el-button>
        <el-button type="primary" :loading="uploading" @click="startUpload">开始上传 ({{ fileList.length }} 个文件)</el-button>
      </div>

      <el-table :data="documents" v-loading="loadingDocs" stripe style="width: 100%">
        <el-table-column prop="filename" label="文件名" min-width="200" />
        <el-table-column label="类型" width="70">
          <template #default="{ row }">
            {{ typeLabel(row.file_type) }}
          </template>
        </el-table-column>
        <el-table-column label="大小" width="100">
          <template #default="{ row }">
            {{ formatSize(row.file_size) }}
          </template>
        </el-table-column>
        <el-table-column prop="chunk_count" label="分块数" width="80" align="center" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="上传时间" width="170">
          <template #default="{ row }">
            {{ new Date(row.created_at).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="handlePreview(row)">预览</el-button>
            <el-button size="small" type="warning" link @click="openVersionDrawer(row)">版本</el-button>
            <el-button size="small" type="danger" @click="handleDeleteDoc(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Search test -->
    <el-card class="section">
      <template #header>
        <span>检索测试</span>
      </template>
      <div class="search-row">
        <el-input v-model="searchQuery" placeholder="输入搜索关键词..." @keydown.enter="handleSearch" />
        <el-button type="primary" :loading="searching" @click="handleSearch">搜索</el-button>
      </div>
      <div v-if="searchResults.length > 0" class="search-results">
        <div v-for="(chunk, i) in searchResults" :key="i" class="search-item">
          <div class="search-meta">
            <span class="search-source">{{ chunk.source }}</span>
            <el-tag size="small" type="warning">相关度: {{ (chunk.score * 100).toFixed(0) }}%</el-tag>
          </div>
          <p class="search-content">{{ chunk.content }}</p>
        </div>
      </div>
    </el-card>

    <!-- Upload progress -->
    <el-dialog v-model="uploadDialogVisible" title="上传进度" width="400px" :close-on-click-modal="false" :close-on-press-escape="false" center>
      <div style="padding:10px">
        <p v-for="(f, i) in uploadFiles" :key="i" style="margin:6px 0;font-size:13px;color:#666">
          {{ f.name }}
          <el-tag v-if="f.done" size="small" type="success" style="margin-left:6px">完成</el-tag>
          <el-tag v-else-if="f.error" size="small" type="danger" style="margin-left:6px">失败</el-tag>
          <span v-else style="margin-left:6px;color:#999">处理中...</span>
        </p>
        <div v-if="!uploading" style="text-align:center;margin-top:16px">
          <el-button type="primary" @click="finishUpload">完成</el-button>
        </div>
      </div>
    </el-dialog>

    <!-- Preview -->
    <el-dialog v-model="previewVisible" :title="previewTitle" width="800px" top="30px">
      <template #header>
        <span>{{ previewTitle }}</span>
        <el-button v-if="previewDownloadUrl" size="small" style="margin-left:12px" @click="downloadFile">
          <el-icon><Download /></el-icon> 下载原文件
        </el-button>
      </template>
      <div class="preview-body">
        <iframe v-if="previewIsPdf" :src="previewDownloadUrl" style="width:100%;height:70vh;border:none;border-radius:4px" />
        <div v-else v-html="previewContent"></div>
      </div>
    </el-dialog>

    <!-- Version Management -->
    <el-drawer v-model="versionDrawerVisible" :title="`版本管理 - ${versionDocFilename}`" size="450px">
      <div v-if="versionLoading" style="text-align:center;padding:40px">
        <el-icon class="is-loading" :size="30"><Loading /></el-icon>
      </div>
      <div v-else-if="versionList.length === 0" style="text-align:center;padding:40px;color:#999">
        暂无版本记录
      </div>
      <div v-else class="version-list">
        <div v-for="v in versionList" :key="v.id" class="version-item">
          <div class="version-info">
            <div class="version-header">
              <el-tag v-if="v.is_latest === 1" type="success" size="small">当前版本</el-tag>
              <span class="version-num">v{{ v.version }}</span>
              <span class="version-time">{{ new Date(v.created_at).toLocaleString() }}</span>
            </div>
            <div class="version-name">{{ v.filename }}</div>
            <div class="version-size">{{ formatSize(v.file_size) }}</div>
          </div>
          <div class="version-actions">
            <el-button size="small" @click="previewVersion(v)">预览</el-button>
            <el-button v-if="v.is_latest !== 1" size="small" type="warning" @click="restoreVersion(v)">恢复</el-button>
            <el-button v-if="v.is_latest !== 1" size="small" type="danger" @click="deleteVersion(v)">删除</el-button>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, Download, Loading } from '@element-plus/icons-vue'
import type { UploadInstance, UploadFile } from 'element-plus'
import {
  getKBDocuments,
  uploadDocumentsToKB,
  deleteKBDocument,
  searchKB,
  getKnowledgeBase,
  previewDocument,
  getDocumentVersions,
  restoreDocumentVersion,
  deleteDocumentVersion,
  type KbDocument,
  type KbDocumentVersion,
  type SearchChunk,
} from '@/apis/knowledgeBase'

const route = useRoute()
const router = useRouter()
const kbId = Number(route.params.id)
const kbName = ref('加载中...')
const documents = ref<KbDocument[]>([])
const loadingDocs = ref(false)
const uploadDialogVisible = ref(false)
const uploading = ref(false)
const searchQuery = ref('')
const searching = ref(false)
const searchResults = ref<SearchChunk[]>([])
const uploadRef = ref<UploadInstance>()
const fileList = ref<UploadFile[]>([])
const uploadFiles = ref<{ name: string; done: boolean; error: boolean }[]>([])
const previewVisible = ref(false)
const previewTitle = ref('')
const previewContent = ref('')
const previewDownloadUrl = ref('')
const previewIsPdf = ref(false)
const previewDocId = ref(0)
const versionDrawerVisible = ref(false)
const versionDocFilename = ref('')
const versionList = ref<KbDocumentVersion[]>([])
const versionLoading = ref(false)
const versionDocIdForPreview = ref(0)

async function loadKB() {
  try {
    const res = await getKnowledgeBase(kbId)
    if (res.data.success) {
      kbName.value = res.data.result.knowledgeBase.name
    }
  } catch {}
}

async function loadDocs() {
  loadingDocs.value = true
  try {
    const res = await getKBDocuments(kbId)
    if (res.data.success) {
      documents.value = res.data.result.documents || []
    }
  } catch {
    ElMessage.error('获取文档列表失败')
  } finally {
    loadingDocs.value = false
  }
}

function handleFileChange(_file: UploadFile, files: UploadFile[]) {
  fileList.value = files
}

function handleFileRemove(_file: UploadFile, files: UploadFile[]) {
  fileList.value = files
}

function clearFiles() {
  fileList.value = []
  uploadRef.value?.clearFiles()
}

async function startUpload() {
  const rawFiles = fileList.value
    .filter(f => f.raw)
    .map(f => f.raw!)

  if (rawFiles.length === 0) {
    ElMessage.warning('请选择文件')
    return
  }

  uploadDialogVisible.value = true
  uploading.value = true
  uploadFiles.value = rawFiles.map(f => ({ name: f.name, done: false, error: false }))

  // Upload in batches of 10 (backend limit)
  const batchSize = 10
  for (let i = 0; i < rawFiles.length; i += batchSize) {
    const batch = rawFiles.slice(i, i + batchSize)
    try {
      await uploadDocumentsToKB(kbId, batch)
      for (let j = i; j < i + batch.length && j < uploadFiles.value.length; j++) {
        uploadFiles.value[j].done = true
      }
    } catch (err: any) {
      for (let j = i; j < i + batch.length && j < uploadFiles.value.length; j++) {
        uploadFiles.value[j].error = true
      }
      ElMessage.error(err.message || `第 ${i + 1} 批上传失败`)
    }
  }

  uploading.value = false
}

function finishUpload() {
  uploadDialogVisible.value = false
  uploading.value = false
  uploadFiles.value = []
  clearFiles()
  loadDocs()
}

async function handleDeleteDoc(docId: number) {
  try {
    await ElMessageBox.confirm('确定删除此文档吗？', '确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch { return }
  try {
    await deleteKBDocument(kbId, docId)
    ElMessage.success('已删除')
    await loadDocs()
  } catch {
    ElMessage.error('删除失败')
  }
}

async function handlePreview(doc: KbDocument) {
  previewTitle.value = doc.filename
  previewVisible.value = true
  previewContent.value = ''
  previewDownloadUrl.value = `/uploads/kb/${doc.file_path.split(/[/\\]/).pop()}`
  previewDocId.value = doc.id

  // 原生 PDF：浏览器直接 iframe 预览，无需调 API
  if (doc.file_type === 'application/pdf') {
    previewIsPdf.value = true
    previewContent.value = ''
    return
  }

  previewIsPdf.value = false
  previewContent.value = '<div class="preview-loading"><div class="loading-spinner"></div><p>正在转换文档...</p></div>'
  try {
    const res = await previewDocument(kbId, doc.id)
    if (res.data.success) {
      const result = res.data.result
      if (result.format === 'pdf') {
        // Office 文档已转 PDF
        previewIsPdf.value = true
        previewDownloadUrl.value = result.pdfUrl
        previewContent.value = ''
      } else if (result.format === 'html') {
        previewContent.value = `<div class="rich-preview">${result.content}</div>`
      } else {
        const escaped = result.content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        previewContent.value = `<pre style="white-space:pre-wrap;font-size:13px;line-height:1.7;max-height:60vh;overflow-y:auto;padding:16px;background:#fafafa;border-radius:4px">${escaped}</pre>`
      }
    }
  } catch {
    previewContent.value = '<div style="text-align:center;padding:40px;color:#999">预览失败</div>'
  }
}

function downloadFile() {
  if (previewDocId.value) {
    const baseURL = (import.meta.env as any).VITE_BASE_URL || ''
    const token = localStorage.getItem('token')
    fetch(`${baseURL}/api/kb/${kbId}/documents/${previewDocId.value}/download`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.blob())
      .then(blob => {
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = previewTitle.value || '下载文件'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
      })
      .catch(() => ElMessage.error('下载失败'))
  }
}

async function openVersionDrawer(doc: KbDocument) {
  versionDocFilename.value = doc.filename
  versionDocIdForPreview.value = doc.id
  versionDrawerVisible.value = true
  versionLoading.value = true
  try {
    const res = await getDocumentVersions(kbId, doc.id)
    if (res.data.success) {
      versionList.value = res.data.result.versions || []
    }
  } catch {
    ElMessage.error('获取版本列表失败')
  } finally {
    versionLoading.value = false
  }
}

async function previewVersion(v: KbDocumentVersion) {
  previewTitle.value = v.filename
  previewVisible.value = true
  previewContent.value = ''
  previewDownloadUrl.value = `/uploads/kb/${v.file_path.split(/[/\\]/).pop()}`
  previewDocId.value = v.id

  if (v.file_type === 'application/pdf') {
    previewIsPdf.value = true
    return
  }

  previewIsPdf.value = false
  previewContent.value = '<div class="preview-loading"><div class="loading-spinner"></div><p>正在转换文档...</p></div>'
  try {
    const res = await previewDocument(kbId, v.id)
    if (res.data.success) {
      const result = res.data.result
      if (result.format === 'pdf') {
        previewIsPdf.value = true
        previewDownloadUrl.value = result.pdfUrl
        previewContent.value = ''
      } else if (result.format === 'html') {
        previewContent.value = `<div class="rich-preview">${result.content}</div>`
      } else {
        const escaped = result.content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        previewContent.value = `<pre style="white-space:pre-wrap;font-size:13px;line-height:1.7;max-height:60vh;overflow-y:auto;padding:16px;background:#fafafa;border-radius:4px">${escaped}</pre>`
      }
    }
  } catch {
    previewContent.value = '<div style="text-align:center;padding:40px;color:#999">预览失败</div>'
  }
}

async function restoreVersion(v: KbDocumentVersion) {
  try {
    await ElMessageBox.confirm(`确定恢复到 v${v.version} 版本吗？`, '确认恢复', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch { return }

  try {
    await restoreDocumentVersion(kbId, v.id)
    ElMessage.success('已恢复到指定版本')
    versionDrawerVisible.value = false
    await loadDocs()
  } catch {
    ElMessage.error('恢复版本失败')
  }
}

async function deleteVersion(v: KbDocumentVersion) {
  try {
    await ElMessageBox.confirm(`确定删除 v${v.version} 版本吗？`, '确认删除', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch { return }

  try {
    await deleteDocumentVersion(kbId, v.id, v.id)
    ElMessage.success('版本已删除')
    await openVersionDrawer({ id: versionDocIdForPreview.value, filename: versionDocFilename.value } as KbDocument)
  } catch {
    ElMessage.error('删除版本失败')
  }
}

async function handleSearch() {
  if (!searchQuery.value.trim()) return
  searching.value = true
  try {
    const res = await searchKB(kbId, searchQuery.value.trim())
    if (res.data.success) {
      searchResults.value = res.data.result.chunks || []
    }
  } catch {
    ElMessage.error('检索失败')
  } finally {
    searching.value = false
  }
}

function goBack() {
  router.push('/kb')
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function typeLabel(mime: string) {
  const map: Record<string, string> = {
    'text/plain': 'TXT',
    'text/markdown': 'MD',
    'application/json': 'JSON',
    'text/html': 'HTML',
    'application/pdf': 'PDF',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  }
  return map[mime] || mime.split('/').pop()?.toUpperCase() || mime
}

function statusType(status: string) {
  switch (status) {
    case 'completed': return 'success'
    case 'processing': return 'warning'
    case 'failed': return 'danger'
    default: return 'info'
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'pending': return '等待处理'
    case 'processing': return '处理中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return status
  }
}

onMounted(() => {
  loadKB()
  loadDocs()
})
</script>

<style scoped>
.kb-detail {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.section {
  margin-bottom: 20px;
}

.upload-area {
  width: 100%;
}

.upload-area :deep(.el-upload) {
  width: 100%;
}

.upload-area :deep(.el-upload-dragger) {
  width: 100%;
  padding: 30px;
}

.search-row {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.search-results {
  margin-top: 8px;
}

.search-item {
  padding: 12px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  margin-bottom: 8px;
}

.search-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.search-source {
  font-size: 12px;
  color: #999;
}

.search-content {
  margin: 0;
  font-size: 13px;
  color: #333;
  line-height: 1.6;
  white-space: pre-wrap;
}

.preview-body {
  min-height: 200px;
}

.preview-body :deep(.preview-loading) {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #999;
  font-size: 14px;
  gap: 16px;
}

.preview-body :deep(.loading-spinner) {
  width: 36px;
  height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: #1890ff;
  border-radius: 50%;
  animation: preview-spin 0.8s linear infinite;
}

@keyframes preview-spin {
  to { transform: rotate(360deg); }
}

.preview-body :deep(.rich-preview) {
  max-height: 60vh;
  overflow-y: auto;
  padding: 16px;
  background: #fafafa;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.7;
  color: #333;
}

.preview-body :deep(.rich-preview table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
  font-size: 13px;
}

.preview-body :deep(.rich-preview th),
.preview-body :deep(.rich-preview td) {
  border: 1px solid #ddd;
  padding: 6px 10px;
  text-align: left;
}

.preview-body :deep(.rich-preview th) {
  background: #f0f0f0;
  font-weight: 600;
}

.preview-body :deep(.rich-preview h1),
.preview-body :deep(.rich-preview h2),
.preview-body :deep(.rich-preview h3),
.preview-body :deep(.rich-preview h4) {
  margin: 16px 0 8px;
  color: #222;
}

.preview-body :deep(.rich-preview p) {
  margin: 0 0 8px;
}

.preview-body :deep(.rich-preview ul),
.preview-body :deep(.rich-preview ol) {
  margin: 6px 0;
  padding-left: 20px;
}

.preview-body :deep(.rich-preview li) {
  margin: 3px 0;
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.version-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  gap: 12px;
}

.version-info {
  flex: 1;
  min-width: 0;
}

.version-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.version-num {
  font-weight: 600;
  color: #333;
}

.version-time {
  font-size: 12px;
  color: #999;
}

.version-name {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.version-size {
  font-size: 12px;
  color: #999;
}

.version-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
</style>
