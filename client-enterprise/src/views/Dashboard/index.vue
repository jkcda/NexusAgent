<template>
  <div class="dashboard">
    <h2>运营概览</h2>

    <el-row :gutter="20" class="stat-row">
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-value">{{ stats.userCount }}</div>
            <div class="stat-label">用户总数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-value">{{ stats.kbCount }}</div>
            <div class="stat-label">知识库</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-value">{{ stats.todaySessions }}</div>
            <div class="stat-label">今日对话</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card">
            <div class="stat-value">{{ stats.todayMessages }}</div>
            <div class="stat-label">今日消息</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="stat-row">
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card secondary">
            <div class="stat-value">{{ stats.docCount }}</div>
            <div class="stat-label">文档总数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card secondary">
            <div class="stat-value">{{ stats.chunkCount }}</div>
            <div class="stat-label">分块总数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card secondary">
            <div class="stat-value">{{ stats.totalSessions }}</div>
            <div class="stat-label">历史对话</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card secondary">
            <div class="stat-value">{{ stats.totalMessages }}</div>
            <div class="stat-label">历史消息</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <h3 style="margin-top:28px">反馈概况</h3>
    <el-row :gutter="20" class="stat-row">
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card feedback">
            <div class="stat-value up">{{ feedback.upCount }}</div>
            <div class="stat-label">好评 👍</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card feedback">
            <div class="stat-value down">{{ feedback.downCount }}</div>
            <div class="stat-label">差评 👎</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card feedback">
            <div class="stat-value">{{ feedback.totalCount }}</div>
            <div class="stat-label">总反馈数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <div class="stat-card feedback">
            <div class="stat-value" :class="feedback.upRate >= 80 ? 'up' : feedback.upRate >= 50 ? '' : 'down'">
              {{ feedback.upRate }}%
            </div>
            <div class="stat-label">好评率</div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getDashboard } from '@/apis/admin'
import { getFeedbackStats } from '@/apis/admin'

const stats = ref({
  userCount: 0, kbCount: 0, docCount: 0, chunkCount: 0,
  todaySessions: 0, todayMessages: 0,
  totalSessions: 0, totalMessages: 0,
})

const feedback = ref({
  upCount: 0, downCount: 0, totalCount: 0, upRate: 0,
})

onMounted(async () => {
  try {
    const res = await getDashboard()
    if (res.data.success) Object.assign(stats.value, res.data.result)
  } catch {}
  try {
    const res = await getFeedbackStats()
    if (res.data.success) {
      const { all } = res.data.result
      feedback.value.upCount = all.upCount
      feedback.value.downCount = all.downCount
      feedback.value.totalCount = all.totalCount
      feedback.value.upRate = all.totalCount > 0
        ? Math.round((all.upCount / all.totalCount) * 100)
        : 0
    }
  } catch {}
})
</script>

<style scoped>
.dashboard {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}

.stat-row {
  margin-bottom: 16px;
}

.stat-card {
  text-align: center;
  padding: 16px 10px;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #1890ff;
}

.secondary .stat-value {
  font-size: 26px;
  color: #52c41a;
}

.feedback .stat-value {
  font-size: 28px;
}

.stat-value.up { color: #52c41a; }
.stat-value.down { color: #ff4d4f; }

.stat-label {
  font-size: 13px;
  color: #999;
  margin-top: 6px;
}
</style>
