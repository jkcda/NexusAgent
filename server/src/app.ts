import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import http from 'http'
import { WebSocketServer } from 'ws'
import path from 'path'
import { fileURLToPath } from 'url'
import userRouter from './routes/user.js'
import adminRouter from './routes/admin.js'
import aiRouter from './routes/ai.js'
import uploadRouter from './routes/upload.js'
import knowledgeBaseRouter from './routes/knowledgeBase.js'
import voiceRouter from './routes/voice.js'
import mcpRouter from './routes/mcp.js'
import agentRouter from './routes/agent.js'
import roomRouter from './routes/room.js'
import config, { initDynamicConfig, getSetting } from './config/index.js'
import { rateLimiter } from './utils/rateLimit.js'
import fs from 'fs'

// 从数据库加载动态配置（API Key 等），失败时回退环境变量
initDynamicConfig()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// JWT_SECRET 检查
const jwtSecret = getSetting('JWT_SECRET')
if (!jwtSecret || jwtSecret === 'default-secret-key') {
  console.warn('⚠ 安全警告: JWT_SECRET 未配置或使用了默认值，请在后台 /admin/api-keys 中修改！')
}

const app = express()

// 安全中间件
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',').map(s => s.trim())
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(null, false)
  },
  credentials: true,
}))

app.use(express.json({ limit: '50mb' }))

// 全局限流: 每 IP 每分钟 100 请求，ai/chat 接口另有限流
app.use(rateLimiter({ windowMs: 60000, max: 100 }))

// AI 对话接口额外限流: 每 IP 每30秒 5 次
app.use('/api/ai/chat', rateLimiter({ windowMs: 30000, max: 5 }))

// 静态文件服务 — 上传文件访问
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

// 确保 LanceDB 数据目录存在
const lancedbDir = path.resolve(config.lancedb.dataDir)
if (!fs.existsSync(lancedbDir)) {
  fs.mkdirSync(lancedbDir, { recursive: true })
}

// 路由
app.use('/api/user', userRouter)
app.use('/api/admin', adminRouter)
app.use('/api/ai', aiRouter)
app.use('/api/kb', knowledgeBaseRouter)
app.use('/api', uploadRouter)
app.use('/api/agents', agentRouter)
app.use('/api/rooms', roomRouter)
app.use('/api/voice', voiceRouter)
app.use('/api/mcp', mcpRouter)

// 工作区文件下载
app.get('/api/fs/download', (req, res) => {
  const file = req.query.file as string
  if (!file) return res.status(400).json({ error: '缺少 file 参数' })
  const workspaceRoot = path.resolve(config.workspace.root)
  const abs = path.resolve(workspaceRoot, file)
  if (!abs.startsWith(workspaceRoot + path.sep) && abs !== workspaceRoot) {
    return res.status(403).json({ error: '路径越界' })
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '文件不存在' })
  res.download(abs)
})

// Multer 文件上传错误处理
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: '文件大小超出限制（图片10MB/文档20MB/视频500MB）' })
  }
  if (err.message?.startsWith('不支持的文件类型')) {
    return res.status(400).json({ success: false, message: err.message })
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, message: `文件上传错误: ${err.message}` })
  }
  console.error('未捕获的错误:', err)
  res.status(500).json({ success: false, message: '服务器内部错误' })
})

// 后台预加载语音识别模型（避免首次请求阻塞/OOM崩溃）
import('./services/videoProcessor.js').then(m => {
  m.preloadTranscriber()
}).catch(() => {})

// 后台预加载本地 embedding 模型
import('./services/embedding.js').then(m => {
  m.preloadEmbeddingModel()
}).catch(() => {})

// 初始化 MCP 连接（Playwright 浏览器）
import('./services/mcp.js').then(m => {
  m.initMCP()
}).catch(() => {})

// 创建 HTTP Server（供 Socket.IO 挂载）
const httpServer = http.createServer(app)

// 延迟加载 Socket.IO（避免循环依赖）
import('./services/socket.js').then(m => {
  m.initSocketIO(httpServer, allowedOrigins)
}).catch(err => {
  console.warn('[Socket.IO] 初始化失败:', err.message)
})

// 原生 WebSocket Server — 小程序专用
// 与 Socket.IO 分开端口，避免 upgrade 事件冲突
import { createServer } from 'http'
const wsHttpServer = createServer()
const wss = new WebSocketServer({ server: wsHttpServer, path: '/ws' })
import('./services/wsBridge.js').then(m => {
  m.initWsBridge(wss)
}).catch(err => {
  console.warn('[WS Bridge] 初始化失败:', err.message)
})
const WS_PORT = (process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 3001)
wsHttpServer.listen(WS_PORT, () => {
  console.log(`[WS Bridge] 小程序 WebSocket 服务运行在 ws://localhost:${WS_PORT}/ws`)
})

// 启动
const PORT = config.server.port
httpServer.listen(PORT, () => {
  console.log(`🚀 服务运行在 http://localhost:${PORT}`)
})