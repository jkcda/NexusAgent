import { Router, Request, Response } from 'express'
import { ApiResponse } from '../utils/response.js'
import { UserModel } from '../models/user.js'
import { ChatHistoryModel } from '../models/chatHistory.js'
import { providerManager } from '../providers/index.js'

const router = Router()

// POST /api/desktop/handshake
// Desktop app registers via machine fingerprint, no login required
router.post('/handshake', async (req: Request, res: Response) => {
  try {
    const { machineId } = req.body
    if (!machineId) return ApiResponse.badRequest(res, '缺少 machineId')

    const username = `desktop_${machineId}`
    const email = `${username}@desktop.local`

    let user = await UserModel.findByUsername(username)
    const isNew = !user
    if (isNew) {
      const { default: bcrypt } = await import('bcryptjs')
      const salt = await bcrypt.genSalt(10)
      const hash = await bcrypt.hash(machineId, salt)
      const userId = await UserModel.create({ username, email, password: hash, role: 'user' })
      user = await UserModel.findById(userId)

      // Migrate old desktop sessions from userId=1 (legacy hardcoded) to this machine's user
      if (user) {
        try {
          const pool = (await import('../utils/db.js')).default
          const [result] = await pool.execute(
            `UPDATE chat_history SET user_id = ? WHERE session_id LIKE 'desktop-%' AND user_id = 1`,
            [user!.id!]
          )
          const changed = (result as any).affectedRows || 0
          if (changed > 0) console.log(`[Desktop] Migrated ${changed} old desktop messages to user ${user.id}`)
        } catch (e: any) {
          console.warn('[Desktop] Migration skipped:', e.message)
        }
      }
    }

    ApiResponse.success(res, {
      userId: user!.id,
      username: user!.username,
      migrated: isNew,
    }, 'connected')
  } catch (err: any) {
    ApiResponse.internalServerError(res, 'handshake failed', err.message)
  }
})

// DELETE /api/desktop/sessions/:sessionId - 删除桌面端会话
router.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string
    const userId = parseInt(req.query.userId as string, 10) || null
    if (!sessionId || !userId) return ApiResponse.badRequest(res, '参数不完整')

    const deleted = await ChatHistoryModel.deleteBySessionIdAndUserId(sessionId, userId)
    ApiResponse.success(res, { deleted }, '会话已删除')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '删除失败', err.message)
  }
})

// GET /api/desktop/settings - 获取当前配置
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const caps = providerManager.getCapabilities()
    ApiResponse.success(res, { capabilities: caps })
  } catch (err: any) {
    ApiResponse.internalServerError(res, '获取配置失败', err.message)
  }
})

// PUT /api/desktop/settings - 更新 LLM 配置
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const { name, model, baseURL, apiKey, format, requestTemplate } = req.body
    await providerManager.saveLLMConfig({
      ...(name !== undefined ? { name } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(baseURL !== undefined ? { baseURL } : {}),
      ...(apiKey !== undefined && apiKey && !apiKey.includes('***') ? { apiKey } : {}),
      ...(format !== undefined ? { format } : {}),
      ...(requestTemplate !== undefined ? { requestTemplate } : {}),
    })
    ApiResponse.success(res, null, '配置已更新')
  } catch (err: any) {
    ApiResponse.internalServerError(res, '更新配置失败', err.message)
  }
})

export default router
