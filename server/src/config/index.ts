import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../utils/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 从 dist/config 回退两级到 server 根目录
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const SETTING_KEYS = [
  // 能力配置（以能力为中心，JSON 格式含 apiKey）
  'CAPABILITY_LLM',
  'CAPABILITY_EMBEDDING',
  'CAPABILITY_RERANK',
  'CAPABILITY_IMAGE',
  // 联网搜索
  'TAVILY_API_KEY',
  // 系统配置
  'EMAIL_USER',
  'EMAIL_PASS',
  'JWT_SECRET',
  'CLIENT_URL',
  // 视频处理
  'VIDEO_FPS',
] as const

type SettingKey = (typeof SETTING_KEYS)[number]

const settings = new Map<SettingKey, string>()

const ENV_MAP: Record<SettingKey, string | undefined> = {
  CAPABILITY_LLM: undefined,        // 不从 env 加载，由 Manager 自行 fallback
  CAPABILITY_EMBEDDING: undefined,
  CAPABILITY_RERANK: undefined,
  CAPABILITY_IMAGE: undefined,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASS: process.env.EMAIL_PASS,
  JWT_SECRET: process.env.JWT_SECRET,
  CLIENT_URL: process.env.CLIENT_URL,
  VIDEO_FPS: process.env.VIDEO_FPS,
}

export async function initDynamicConfig(): Promise<void> {
  try {
    const [rows] = await pool.execute(
      'SELECT key_name, value FROM system_settings'
    ) as [Array<{ key_name: string; value: string }>, any]

    for (const row of rows) {
      if (SETTING_KEYS.includes(row.key_name as SettingKey)) {
        settings.set(row.key_name as SettingKey, row.value)
      }
    }
    console.log(`[Config] 已从数据库加载 ${settings.size} 项动态配置`)
  } catch (e: any) {
    console.warn('[Config] 数据库读取失败，回退到环境变量:', e.message)
  }
}

export function getSetting(key: string): string {
  const k = key as SettingKey
  if (settings.has(k)) return settings.get(k)!
  return ENV_MAP[k] || ''
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const k = key as SettingKey
  if (!SETTING_KEYS.includes(k)) {
    throw new Error(`不允许修改配置项: ${key}`)
  }
  await pool.execute(
    'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [k, value]
  )
  settings.set(k, value)
  console.log(`[Config] 已更新: ${k}`)
}

export function getMaskedSettings(): { key_name: string; description: string; masked: string }[] {
  const desc: Record<SettingKey, string> = {
    CAPABILITY_LLM: '大语言模型能力配置（JSON，含 API Key / 格式 / 模型等）',
    CAPABILITY_EMBEDDING: '向量化能力配置（JSON，含 API Key / 模型等）',
    CAPABILITY_RERANK: '重排序能力配置（JSON，含 API Key / 模型等）',
    CAPABILITY_IMAGE: '图片生成能力配置（JSON，含 API Key / 模型 / 尺寸等）',
    TAVILY_API_KEY: 'Tavily API Key（联网搜索）',
    EMAIL_USER: 'QQ邮箱 SMTP 登录账号',
    EMAIL_PASS: 'QQ邮箱 SMTP 授权码',
    JWT_SECRET: 'JWT 签名密钥（用于签发和验证登录凭证）',
    CLIENT_URL: '前端访问地址（用于邮件验证链接，如 https://你的域名.com）',
    VIDEO_FPS: '视频帧提取频率（每秒提取的帧数，越大越密集，默认 2）',
  }
  return SETTING_KEYS
    .filter(k => !k.startsWith('CAPABILITY_')) // 能力配置在能力管理页面管理
    .map(k => {
    const val = getSetting(k)
    const masked = val.length > 8
      ? val.slice(0, 4) + '***' + val.slice(-4)
      : val ? '****' : '（未配置）'
    return { key_name: k, description: desc[k], masked }
  })
}

/** LLM 默认配置（首次使用或未保存时 fallback） */
export const defaultLLMConfig = {
  name: '魔搭社区',
  apiKey: process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '',
  format: 'openai' as const,
  baseURL: 'https://api-inference.modelscope.cn',
  model: 'Qwen/Qwen3.5-397B-A17B',
  requestTemplate: '',
}

/** 向量化默认配置（独立于 LLM，切换对话模型不影响向量检索） */
export const defaultEmbeddingConfig = {
  name: '本地模型',
  apiKey: process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '',
  baseURL: 'https://api-inference.modelscope.cn',
  model: 'BAAI/bge-small-zh-v1.5',
  forceAPI: false,
}

/** 重排序默认配置（独立于 LLM，切换对话模型不影响重排序） */
export const defaultRerankConfig = {
  name: '本地模型',
  apiKey: '',
  baseURL: '',
  model: '',
  forceAPI: false,
}

/** 图片生成默认配置 */
export const defaultImageConfig = {
  name: '火山引擎 ARK',
  apiKey: process.env.ARK_API_KEY || '',
  baseURL: 'https://ark.cn-beijing.volces.com',
  model: 'doubao-seedream-4-5-251128',
  requestTemplate: '',
  defaultSize: '2560x1440',
}

const config = {
  server: {
    port: process.env.PORT || 3000
  },

  database: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ai_chat'
  },

  jwt: {
    get secret() {
      return getSetting('JWT_SECRET') || 'default-secret-key'
    },
    expiresIn: '7d'
  },

  ai: {
    defaultModel: 'Qwen/Qwen3.5-397B-A17B',
    maxTokens: 16384,

    // 图片宽高比配置
    imageRatios: [
      { label: '1:1 正方形',   value: '2048x2048' },
      { label: '4:3 横版',     value: '2304x1728' },
      { label: '3:4 竖版',     value: '1728x2304' },
      { label: '16:9 宽屏',    value: '2560x1440' },
      { label: '9:16 手机',    value: '1440x2560' },
      { label: '3:2 经典摄影', value: '2496x1664' },
      { label: '2:3 竖版摄影', value: '1664x2496' },
      { label: '21:9 超宽屏',  value: '3024x1296' },
    ] as { label: string; value: string }[],
    defaultImageRatio: '2560x1440',
  },

  context: {
    maxChars: 30000,
    recentRounds: 5,         // 分层压缩：保留最近 N 轮完整对话
  },

  // ── 以下配置保持不变 ──
  rag: {
    chunkSize: 300,
    chunkOverlap: 100,
    topK: 5,
    retrievalTopK: 50,
    similarityThreshold: 0.5,
    enableQueryRewrite: true,
    queryRewriteMinLen: 15,
    enableLLMQueryRewrite: false,  // true=LLM 改写（费 token），false=仅规则去指代词
    enableHybridSearch: true,
    vectorWeight: 0.7,
    bm25Weight: 0.3,
    enableRerank: true,
    rerankTopK: 10,
    enableSmallToBig: true,
    windowBefore: 1,
    windowAfter: 2,
    maxExpandedChars: 3000,
  },

  embeddings: {
    modelName: 'Xenova/bge-small-zh-v1.5',  // 本地运行 ~100MB，低配服务器自动降级 API
    dimension: 512,
    batchSize: 100,
  },

  lancedb: {
    dataDir: './data/lancedb',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: Number(process.env.REDIS_DB) || 0,
    ttl: {
      embeddingQuery: 3600,
      embeddingDoc: 86400,
      kbList: 300,
      kbDocs: 300,
      ragResult: 600,
    },
  },

  upload: {
    maxImageSize: 10 * 1024 * 1024,
    maxDocSize: 20 * 1024 * 1024,
    maxVideoSize: 500 * 1024 * 1024,
    allowedImages: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedDocs: [
      'text/plain', 'text/markdown', 'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    allowedVideos: ['video/mp4', 'video/webm', 'video/quicktime'],
  },

  video: {
    maxDuration: Number(process.env.VIDEO_MAX_DURATION) || 1800,
    get fps() {
      return Number(getSetting('VIDEO_FPS')) || 2
    },
  },

  audio: {
    maxDurationSec: 120,
    maxFileSize: 10 * 1024 * 1024,
  },

  email: {
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER || '',
  },

  webSearch: {
    enabled: true,
    provider: 'tavily' as const,
    maxResults: 8,
  },

  workspace: {
    root: process.env.WORKSPACE_ROOT || './workspace',
  },
}

export default config
