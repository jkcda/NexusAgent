<template>
  <div class="kb-wrapper">
    <!-- 移动端遮罩 -->
    <div v-if="mobileSidebarOpen" class="mobile-sidebar-overlay" @click="mobileSidebarOpen = false"></div>

    <KBList
      :kbList="kbList"
      :selectedKbId="selectedKbId"
      :loading="loadingList"
      :mobile-open="mobileSidebarOpen"
      @select="selectKBAndClose"
      @create="showCreateDialog = true"
      @delete="handleDeleteKB"
    />
    <div class="kb-main">
      <div class="kb-main-header-mobile">
        <el-button size="small" text @click="mobileSidebarOpen = true">
          <el-icon :size="18"><Menu /></el-icon>
          <span>{{ selectedKB?.name || '知识库' }}</span>
        </el-button>
        <el-button size="small" type="primary" circle @click="showCreateDialog = true">
          <el-icon :size="18"><Plus /></el-icon>
        </el-button>
      </div>
      <KBDocumentList
        v-if="selectedKbId"
        :kbId="selectedKbId"
        :kbName="selectedKB?.name || ''"
        @uploaded="loadKBList"
        @deleted="loadKBList"
      />
      <div v-else class="kb-empty">
        <el-empty description="选择一个知识库或创建新的知识库">
          <el-button type="primary" @click="showCreateDialog = true">新建知识库</el-button>
        </el-empty>
      </div>
    </div>

    <!-- 创建知识库对话框 -->
    <el-dialog v-model="showCreateDialog" title="新建知识库" width="450px">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="createForm.name" placeholder="请输入知识库名称" maxlength="50" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="createForm.description"
            type="textarea"
            :rows="3"
            placeholder="可选项，简要描述知识库用途"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Menu, Plus } from '@element-plus/icons-vue'
import { getKnowledgeBases, createKnowledgeBase, deleteKnowledgeBase, type KnowledgeBase } from '@/apis/knowledgeBase'
import KBList from './components/KBList.vue'
import KBDocumentList from './components/KBDocumentList.vue'

const kbList = ref<KnowledgeBase[]>([])
const selectedKbId = ref<number | null>(null)
const loadingList = ref(false)
const creating = ref(false)
const showCreateDialog = ref(false)
const mobileSidebarOpen = ref(false)

const createForm = ref({ name: '', description: '' })

const selectedKB = ref<KnowledgeBase | null>(null)

const loadKBList = async () => {
  loadingList.value = true
  try {
    const res = await getKnowledgeBases()
    if (res.data.success) {
      kbList.value = res.data.result.knowledgeBases || []
      if (kbList.value.length > 0 && !selectedKbId.value) {
        selectKB(kbList.value[0])
      }
    }
  } catch {
    ElMessage.error('获取知识库列表失败')
  } finally {
    loadingList.value = false
  }
}

const selectKB = (kb: KnowledgeBase) => {
  selectedKbId.value = kb.id
  selectedKB.value = kb
}

const selectKBAndClose = (kb: KnowledgeBase) => {
  selectKB(kb)
  mobileSidebarOpen.value = false
}

const handleCreate = async () => {
  if (!createForm.value.name.trim()) {
    ElMessage.warning('请输入知识库名称')
    return
  }
  creating.value = true
  try {
    await createKnowledgeBase({
      name: createForm.value.name.trim(),
      description: createForm.value.description.trim() || undefined
    })
    ElMessage.success('知识库创建成功')
    showCreateDialog.value = false
    createForm.value = { name: '', description: '' }
    await loadKBList()
  } catch {
    ElMessage.error('创建知识库失败')
  } finally {
    creating.value = false
  }
}

const handleDeleteKB = async (kb: KnowledgeBase) => {
  mobileSidebarOpen.value = false
  try {
    await ElMessageBox.confirm(
      `确定要删除知识库「${kb.name}」吗？所有文档将被永久删除。`,
      '删除确认',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  try {
    await deleteKnowledgeBase(kb.id)
    ElMessage.success('知识库已删除')
    if (selectedKbId.value === kb.id) {
      selectedKbId.value = null
      selectedKB.value = null
    }
    await loadKBList()
  } catch {
    ElMessage.error('删除知识库失败')
  }
}

onMounted(() => {
  loadKBList()
})
</script>

<style scoped>
.kb-wrapper {
  display: flex;
  height: 100%;
  position: relative;
}

.kb-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}

.kb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.kb-main-header-mobile {
  display: none;
}

.mobile-sidebar-overlay {
  display: none;
}

@media (max-width: 768px) {
  .mobile-sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--color-bg-overlay);
    z-index: 50;
  }

  .kb-main-header-mobile {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--color-bg-card);
    border-bottom: var(--border-thin) var(--color-border);
  }

  .kb-main-header-mobile .el-button {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    color: var(--color-text-primary);
  }

  .kb-empty .el-empty {
    padding: 20px;
  }
}
</style>
