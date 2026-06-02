<template>
  <div class="kb-docs">
    <div class="kb-docs-header">
      <h3>{{ kbName }}</h3>
    </div>

    <!-- 拖拽上传区域 -->
    <div class="upload-area-wrapper">
      <el-upload
        ref="uploadRef"
        class="nexus-upload"
        drag
        multiple
        :auto-upload="false"
        :file-list="fileList"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
        :accept="'.txt,.md,.json,.html,.pdf,.doc,.docx,.xlsx,.pptx'"
      >
        <div class="drop-rune">⬡</div>
        <div class="el-upload__text">
          拖拽文件到此处 或 <em>点击选择</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            TXT · MD · JSON · HTML · PDF · DOC · DOCX · XLSX · PPTX（≤20MB）
          </div>
        </template>
      </el-upload>
      <div v-if="fileList.length > 0" class="upload-actions-bar">
        <el-button size="small" @click="clearFiles">清空</el-button>
        <el-button size="small" type="primary" :loading="uploading" @click="startUpload">
          开始上传 ({{ fileList.length }} 个文件)
        </el-button>
      </div>
    </div>

    <!-- 检索框 -->
    <div class="search-bar">
      <el-input
        v-model="searchQuery"
        placeholder="在知识库中搜索..."
        size="small"
        clearable
        @keydown.enter="handleSearch"
      >
        <template #append>
          <el-button :loading="searching" @click="handleSearch">搜索</el-button>
        </template>
      </el-input>
    </div>

    <!-- 检索结果 -->
    <div v-if="searchResults.length > 0" class="search-results">
      <div class="search-results-header">
        <span>检索结果 ({{ searchResults.length }})</span>
        <el-button size="small" text @click="searchResults = []; searchQuery = ''">清除</el-button>
      </div>
      <div
        v-for="(chunk, i) in searchResults"
        :key="i"
        class="search-result-item"
      >
        <div class="chunk-source">{{ chunk.source }} <span class="chunk-score">匹配 {{ chunk.score.toFixed(3) }}</span></div>
        <div class="chunk-content">{{ chunk.content }}</div>
      </div>
    </div>

    <!-- 文档列表 -->
    <div class="doc-list" v-loading="loading">
      <div
        v-for="doc in documents"
        :key="doc.id"
        class="doc-item"
      >
        <div class="doc-info">
          <el-icon class="doc-icon"><Document /></el-icon>
          <div class="doc-details">
            <div class="doc-name">{{ doc.filename }}</div>
            <div class="doc-meta">
              <el-tag :type="statusTagType(doc.status)" size="small">{{ statusLabel(doc.status) }}</el-tag>
              <span v-if="doc.chunk_count > 0">{{ doc.chunk_count }} 分块</span>
              <span>{{ formatSize(doc.file_size) }}</span>
              <span>{{ new Date(doc.created_at).toLocaleDateString() }}</span>
            </div>
            <div v-if="doc.error_message" class="doc-error">{{ doc.error_message }}</div>
          </div>
        </div>
        <div class="doc-actions">
          <el-button size="small" type="primary" link @click="handlePreview(doc)">预览</el-button>
          <el-button size="small" type="warning" link @click="openVersionDrawer(doc)">版本</el-button>
          <el-button size="small" text @click="triggerVersionUpload(doc)">
            <el-icon><UploadFilled /></el-icon>
          </el-button>
          <el-button size="small" text type="danger" @click="handleDelete(doc.id)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>

      <el-empty v-if="!loading && documents.length === 0" description="暂无文档，点击上方按钮上传" :image-size="60" />
    </div>

    <!-- 上传进度 -->
    <el-dialog v-model="uploadDialogVisible" title="上传进度" width="400px" :close-on-click-modal="false" :close-on-press-escape="false" center>
      <div style="padding:10px">
        <p v-for="(f, i) in uploadFiles" :key="i" style="margin:6px 0;font-size:13px;color:var(--color-text-secondary)">
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

    <!-- 文档预览 -->
    <el-dialog v-model="previewVisible" :title="previewTitle" width="800px" top="30px" class="preview-dialog">
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

    <!-- 版本管理 -->
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

    <!-- 隐藏文件输入：逐文档上传新版本 -->
    <input
      ref="versionUploadInput"
      type="file"
      style="display:none"
      accept=".txt,.md,.json,.html,.pdf,.doc,.docx,.xlsx,.pptx"
      @change="onVersionFileSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, Delete, Download, Loading, UploadFilled } from '@element-plus/icons-vue'
import type { UploadInstance, UploadFile } from 'element-plus'
import {
  getKBDocuments,
  uploadDocumentsToKB,
  deleteKBDocument,
  searchKB,
  previewDocument,
  getDocumentVersions,
  restoreDocumentVersion,
  deleteDocumentVersion,
  type KbDocument,
  type KbDocumentVersion,
  type SearchChunk
} from '@/apis/knowledgeBase'

const props = defineProps<{
  kbId: number
  kbName: string
}>()

const emit = defineEmits<{
  uploaded: []
  deleted: []
}>()

const documents = ref<KbDocument[]>([])
const loading = ref(false)
const uploading = ref(false)
const uploadDialogVisible = ref(false)
const searching = ref(false)
const searchQuery = ref('')
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
const versionUploadInput = ref<HTMLInputElement>()
const versionUploadTarget = ref<KbDocument | null>(null)

const loadDocuments = async () => {
  loading.value = true
  try {
    const res = await getKBDocuments(props.kbId)
    if (res.data.success) {
      documents.value = res.data.result.documents || []
    }
  } catch {
    ElMessage.error('获取文档列表失败')
  } finally {
    loading.value = false
  }
}

const handleFileChange = (_file: UploadFile, files: UploadFile[]) => {
  fileList.value = files
}

const handleFileRemove = (_file: UploadFile, files: UploadFile[]) => {
  fileList.value = files
}

const clearFiles = () => {
  fileList.value = []
  uploadRef.value?.clearFiles()
}

const startUpload = async () => {
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

  // 分批上传（后端限制每批10个）
  const batchSize = 10
  for (let i = 0; i < rawFiles.length; i += batchSize) {
    const batch = rawFiles.slice(i, i + batchSize)
    try {
      await uploadDocumentsToKB(props.kbId, batch)
      for (let j = i; j < i + batch.length && j < uploadFiles.value.length; j++) {
        uploadFiles.value[j]!.done = true
      }
    } catch (err: any) {
      for (let j = i; j < i + batch.length && j < uploadFiles.value.length; j++) {
        uploadFiles.value[j]!.error = true
      }
      ElMessage.error(err.message || `第 ${Math.floor(i / batchSize) + 1} 批上传失败`)
    }
  }

  uploading.value = false
}

const finishUpload = () => {
  uploadDialogVisible.value = false
  uploading.value = false
  uploadFiles.value = []
  clearFiles()
  loadDocuments()
}

const handleDelete = async (docId: number) => {
  try {
    await ElMessageBox.confirm('确定要删除此文档吗？', '删除确认', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  try {
    await deleteKBDocument(props.kbId, docId)
    ElMessage.success('文档已删除')
    await loadDocuments()
    emit('deleted')
  } catch {
    ElMessage.error('删除文档失败')
  }
}

const triggerVersionUpload = (doc: KbDocument) => {
  versionUploadTarget.value = doc
  versionUploadInput.value?.click()
}

const onVersionFileSelected = async () => {
  const input = versionUploadInput.value
  if (!input?.files?.length) return
  const file = input.files[0]
  const target = versionUploadTarget.value
  if (!target) return

  try {
    await uploadDocumentsToKB(props.kbId, [file!])
    ElMessage.success('新版本已上传')
    await loadDocuments()
    emit('uploaded')
  } catch {
    ElMessage.error('上传新版本失败')
  } finally {
    input.value = ''
    versionUploadTarget.value = null
  }
}

const handleSearch = async () => {
  if (!searchQuery.value.trim()) return
  searching.value = true
  try {
    const res = await searchKB(props.kbId, searchQuery.value.trim())
    if (res.data.success) {
      searchResults.value = res.data.result.chunks || []
    }
  } catch {
    ElMessage.error('检索失败')
  } finally {
    searching.value = false
  }
}

const handlePreview = async (doc: KbDocument) => {
  previewTitle.value = doc.filename
  previewVisible.value = true
  previewContent.value = ''
  previewDownloadUrl.value = `/uploads/kb/${doc.file_path.split(/[/\\]/).pop()}`
  previewDocId.value = doc.id

  if (doc.file_type === 'application/pdf') {
    previewIsPdf.value = true
    previewContent.value = ''
    return
  }

  previewIsPdf.value = false
  previewContent.value = '<div class="preview-loading"><div class="loading-spinner"></div><p>正在转换文档...</p></div>'
  try {
    const res = await previewDocument(props.kbId, doc.id)
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

const downloadFile = () => {
  if (previewDocId.value) {
    const baseURL = (import.meta.env as any).VITE_BASE_URL || ''
    const token = localStorage.getItem('token')
    fetch(`${baseURL}/api/kb/${props.kbId}/documents/${previewDocId.value}/download`, {
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

const openVersionDrawer = async (doc: KbDocument) => {
  versionDocFilename.value = doc.filename
  versionDocIdForPreview.value = doc.id
  versionDrawerVisible.value = true
  versionLoading.value = true
  try {
    const res = await getDocumentVersions(props.kbId, doc.id)
    if ((res as any).data.success) {
      versionList.value = (res as any).data.result.versions || []
    }
  } catch {
    ElMessage.error('获取版本列表失败')
  } finally {
    versionLoading.value = false
  }
}

const previewVersion = async (v: KbDocumentVersion) => {
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
    const res = await previewDocument(props.kbId, v.id)
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

const restoreVersion = async (v: KbDocumentVersion) => {
  try {
    await ElMessageBox.confirm(`确定恢复到 v${v.version} 版本吗？`, '确认恢复', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch { return }

  try {
    await restoreDocumentVersion(props.kbId, v.id)
    ElMessage.success('已恢复到指定版本')
    versionDrawerVisible.value = false
    await loadDocuments()
  } catch {
    ElMessage.error('恢复版本失败')
  }
}

const deleteVersion = async (v: KbDocumentVersion) => {
  try {
    await ElMessageBox.confirm(`确定删除 v${v.version} 版本吗？`, '确认删除', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch { return }

  try {
    await deleteDocumentVersion(props.kbId, versionDocIdForPreview.value, v.id)
    ElMessage.success('版本已删除')
    versionLoading.value = true
    try {
      const res = await getDocumentVersions(props.kbId, versionDocIdForPreview.value)
      if ((res as any).data.success) {
        versionList.value = (res as any).data.result.versions || []
      }
    } catch { /* keep existing list */ }
    finally { versionLoading.value = false }
  } catch {
    ElMessage.error('删除版本失败')
  }
}

const statusTagType = (status: string) => {
  switch (status) {
    case 'completed': return 'success'
    case 'processing': return 'warning'
    case 'failed': return 'danger'
    default: return 'info'
  }
}

const statusLabel = (status: string) => {
  switch (status) {
    case 'pending': return '等待处理'
    case 'processing': return '处理中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return status
  }
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

onMounted(() => {
  loadDocuments()
})
</script>

<style scoped>
.kb-docs {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-card);
}

.kb-docs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: var(--border-thin) var(--color-border);
}

.kb-docs-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--color-text-primary);
}

/* ── Nexus 拖拽上传区 ── */
.upload-area-wrapper {
  padding: 12px 24px;
  border-bottom: var(--border-thin) var(--color-border);
}

.nexus-upload {
  width: 100%;
}

.nexus-upload :deep(.el-upload) {
  width: 100%;
}

.nexus-upload :deep(.el-upload-dragger) {
  width: 100%;
  padding: 28px 20px;
  background: var(--color-bg-elevated, rgba(255, 255, 255, 0.03));
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition-normal), background var(--transition-normal), box-shadow var(--transition-normal);
}

.nexus-upload :deep(.el-upload-dragger:hover) {
  border-color: var(--color-magic-gold);
  background: rgba(212, 175, 55, 0.04);
  box-shadow: 0 0 20px rgba(212, 175, 55, 0.08);
}

.nexus-upload :deep(.el-upload-dragger.is-dragover) {
  border-color: var(--color-magic-gold);
  background: rgba(212, 175, 55, 0.08);
  box-shadow: 0 0 28px rgba(212, 175, 55, 0.18);
}

.nexus-upload :deep(.el-upload-dragger .el-icon--upload) {
  display: none;
}

.drop-rune {
  font-size: 32px;
  color: var(--color-magic-gold);
  opacity: 0.6;
  margin-bottom: 4px;
  text-shadow: 0 0 12px var(--color-gold-glow);
}

.nexus-upload :deep(.el-upload__text) {
  font-family: var(--font-pixel);
  font-size: 13px;
  color: var(--color-text-primary);
  letter-spacing: 1px;
}

.nexus-upload :deep(.el-upload__text em) {
  color: var(--color-magic-gold);
  font-style: normal;
}

.nexus-upload :deep(.el-upload__tip) {
  font-size: 11px;
  color: var(--color-text-muted);
  opacity: 0.6;
  margin-top: 12px;
}

/* ── 文件操作栏 ── */
.upload-actions-bar {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

.search-bar {
  padding: 12px 24px;
  background: var(--color-bg-input);
  border-bottom: var(--border-thin) var(--color-border);
}

.search-results {
  padding: 12px 24px;
  background: var(--color-primary-light);
  border-bottom: var(--border-thin) var(--color-primary);
}

.search-results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--color-magic-gold);
  font-weight: 500;
}

.search-result-item {
  background: var(--color-bg-card);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin-bottom: 8px;
  border: var(--border-thin) var(--color-border);
}

.chunk-source {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.chunk-content {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
}

.doc-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

.doc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
}

.doc-item:hover {
  background: var(--color-primary-light);
}

.doc-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.doc-icon {
  font-size: 24px;
  color: var(--color-primary);
  flex-shrink: 0;
}

.doc-details {
  flex: 1;
  min-width: 0;
}

.doc-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.doc-error {
  font-size: 12px;
  color: var(--color-danger);
  margin-top: 4px;
}

.doc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 12px;
}

.upload-progress {
  text-align: center;
  padding: 20px;
}

.upload-progress p {
  margin-top: 12px;
  color: var(--color-text-secondary);
}

.upload-hint {
  font-size: 12px;
  color: var(--color-text-muted) !important;
}

/* Preview */
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
  border-top-color: var(--color-primary, #1890ff);
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

/* Version drawer */
.version-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 12px;
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
  color: var(--color-text-primary);
}

.version-time {
  font-size: 12px;
  color: #999;
}

.version-name {
  font-size: 13px;
  color: var(--color-text-secondary);
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

@media (max-width: 768px) {
  .kb-docs-header {
    padding: 12px 16px;
  }

  .kb-docs-header h3 {
    font-size: 14px;
  }

  .search-bar {
    padding: 10px 16px;
  }

  .doc-list {
    padding: 12px 16px;
  }

  .doc-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .doc-meta {
    flex-wrap: wrap;
    gap: 4px;
  }

  .doc-actions {
    margin-left: 0;
  }

  .search-results {
    padding: 10px 16px;
  }

  .upload-area-wrapper {
    padding: 8px 16px;
  }

  .upload-actions-bar {
    justify-content: center;
  }
}
</style>
