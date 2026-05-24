import express from 'express'
import fs from 'fs'
import path from 'path'
import { chatWithAIStream } from '../services/ai.js'
import { ChatHistoryModel } from '../models/chatHistory.js'
import { commitMemoryPair, forgetSession, forgetAllMemories } from '../services/memoryService.js'
import { clearSessionCache } from '../services/ragChain.js'
import { ApiResponse } from '../utils/response.js'
import { authMiddleware } from '../middleware/auth.js'
import { adminMiddleware } from '../middleware/admin.js'
import { UserModel } from '../models/user.js'
import config, { getSetting } from '../config/index.js'
import { providerManager } from '../providers/index.js'
import { getGuestRemaining, consumeGuestQuota, MAX_GUEST_QUESTIONS } from '../services/guestLimit.js'

const router = express.Router()

// GET /api/ai/guest-status - 查询游客剩余次数
router.get('/guest-status', (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
  const remaining = getGuestRemaining(clientIp)
  ApiResponse.success(res, { remaining, max: MAX_GUEST_QUESTIONS })
})

// POST /api/ai/chat - AI对话（统一入口：Agent 工具调用 + 多模态流式）
router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId, userId, files, kbId, maxVideoFrames, model, agentId } = req.body

    if (!message && (!files || files.length === 0)) {
      return ApiResponse.badRequest(res, '请输入消息内容或上传文件')
    }

    if (!sessionId) {
      return ApiResponse.badRequest(res, '请提供会话ID')
    }

    // 游客限流：未登录用户通过 IP 限制 10 次
    if (!userId) {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
      const remaining = getGuestRemaining(clientIp)
      if (remaining <= 0) {
        return ApiResponse.badRequest(res, '游客提问次数已用完（10次），请注册账号后继续使用')
      }
    }

    // SSE 流式
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.flushHeaders()

    try {
      // 查询用户角色（管理员可用 admin_* 工具）
      let userRole: string | undefined
      if (userId) {
        try {
          const u = await UserModel.findById(Number(userId))
          userRole = u?.role
        } catch {}
      }

      const { stream, sessionId: returnedSessionId, agentMode } = await chatWithAIStream(
        message || '',
        sessionId,
        userId,
        files && files.length > 0 ? files : undefined,
        kbId || undefined,
        true, // webSearch — Agent 自主决定
        maxVideoFrames || undefined,
        model || undefined,
        userRole,
        agentId || undefined
      )

      let assistantContent = ''

      if (agentMode) {
        // Agent 流式：事件已结构化，直接发射 SSE
        for await (const event of stream) {
          // chatStreamRaw 直接吐文本内容（请求模板路径）
          if (typeof event === 'string') {
            assistantContent += event
            res.write(`data: ${JSON.stringify({ content: event })}\n\n`)
            continue
          }
          switch (event.type) {
            case 'content':
              assistantContent += event.content || ''
              res.write(`data: ${JSON.stringify({ content: event.content })}\n\n`)
              break
            case 'tool_call':
              res.write(`data: ${JSON.stringify({ type: 'tool_call', tool: event.tool, args: event.args })}\n\n`)
              break
            case 'tool_result':
              res.write(`data: ${JSON.stringify({ type: 'tool_result', tool: event.tool, ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}) })}\n\n`)
              break
            case 'done':
              break
            case 'error':
              res.write(`data: ${JSON.stringify({ error: event.error })}\n\n`)
              break
          }
        }
      } else {
        // 多模态：原有 Anciptic SDK 流式
        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            const content = (event.delta as any)?.text
            if (content) {
              assistantContent += content
              res.write(`data: ${JSON.stringify({ content })}\n\n`)
            }
          }
        }
      }

      // 游客消耗配额
      if (!userId) {
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
        consumeGuestQuota(clientIp)
      }

      // 保存助手消息
      if (assistantContent) {
        await ChatHistoryModel.create(
          returnedSessionId,
          userId || null,
          'assistant',
          assistantContent,
          undefined,
          kbId || undefined,
          undefined,
          agentId || undefined
        )

        if (userId) {
          commitMemoryPair(userId, returnedSessionId, assistantContent).catch(() => {})
        }
      }

      res.write('data: [DONE]\n\n')
      res.end()
    } catch (error: any) {
      let errMsg: string = error.message || '未知错误'
      if (errMsg.includes('terminated') || errMsg.includes('abort')) {
        errMsg = '连接中断，请重试。如上传图片过大，请压缩后再试。'
      } else if (errMsg.includes('DataInspectionFailed') || errMsg.includes('inappropriate')) {
        errMsg = '内容审核拦截：回复因包含敏感内容被服务商拦截，请重新措辞后重试。'
      }
      res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`)
      res.end()
    }
  } catch (error: any) {
    ApiResponse.internalServerError(res, '服务器错误', error.message)
  }
})

// GET /api/ai/sessions - 获取用户的会话列表（需登录）
router.get('/sessions', authMiddleware as any, async (req, res) => {
  try {
    const uid = req.user!.id
    const sessions = await ChatHistoryModel.getSessionsByUserId(uid)
    const formatted = (sessions as any[]).map(s => ({
      session_id: s.session_id,
      created_at: s.created_at,
      last_active_at: s.last_active_at,
      message_count: s.message_count,
      first_message: s.first_message,
      agent_id: s.agent_id || null,
      agent_name: s.agent_name || null,
      agent_avatar: s.agent_avatar || null
    }))
    ApiResponse.success(res, { sessions: formatted }, '获取会话列表成功')
  } catch (error: any) {
    ApiResponse.internalServerError(res, '服务器错误', error.message)
  }
})

// GET /api/ai/history - 获取对话历史（需登录）
router.get('/history', authMiddleware as any, async (req, res) => {
  try {
    const { sessionId } = req.query

    if (!sessionId) {
      return ApiResponse.badRequest(res, '请提供会话ID')
    }

    const history = await ChatHistoryModel.getBySessionIdAndUserId(
      sessionId as string,
      req.user!.id
    )

    const messages = history.map(item => ({
      role: item.role,
      content: item.content,
      files: item.files ? (typeof item.files === 'string' ? JSON.parse(item.files) : item.files) : undefined,
      retrievedChunks: (item as any).retrieved_chunks
        ? (typeof (item as any).retrieved_chunks === 'string' ? JSON.parse((item as any).retrieved_chunks) : (item as any).retrieved_chunks)
        : undefined
    }))

    ApiResponse.success(res, { messages }, '获取对话历史成功')
  } catch (error: any) {
    ApiResponse.internalServerError(res, '服务器错误', error.message)
  }
})

// DELETE /api/ai/history - 删除对话历史（含关联文件，需登录）
router.delete('/history', authMiddleware as any, async (req, res) => {
  try {
    const { sessionId } = req.query

    if (!sessionId) {
      return ApiResponse.badRequest(res, '请提供会话ID')
    }

    // 删除关联的上传文件
    try {
      const history = await ChatHistoryModel.getBySessionIdAndUserId(
        sessionId as string,
        req.user!.id
      )
      for (const msg of history) {
        if (msg.files) {
          const files = typeof msg.files === 'string' ? JSON.parse(msg.files) : msg.files
          for (const f of (files as any[] || [])) {
            if (f.url) {
              const filePath = path.join(process.cwd(), f.url)
              fs.unlink(filePath, () => {})
            }
          }
        }
      }
    } catch {}

    await ChatHistoryModel.deleteBySessionId(sessionId as string)
    clearSessionCache(sessionId as string)

    let memoryCleared = false
    if (req.user!.id) {
      try {
        await forgetSession(Number(req.user!.id), sessionId as string)
        memoryCleared = true
      } catch {}
    }

    ApiResponse.success(res, null, memoryCleared ? '对话历史已清空（含文件和RAG记忆）' : '对话历史已清空')
  } catch (error: any) {
    ApiResponse.internalServerError(res, '服务器错误', error.message)
  }
})

// DELETE /api/ai/memory - 清空用户全部 RAG 记忆（管理员专用）
router.delete('/memory', authMiddleware as any, adminMiddleware as any, async (req, res) => {
  try {
    const { userId } = req.query
    if (!userId) return ApiResponse.badRequest(res, '请提供用户ID')
    await forgetAllMemories(Number(userId))
    ApiResponse.success(res, null, `用户 ${userId} 的 RAG 记忆已全部清空`)
  } catch (error: any) {
    ApiResponse.internalServerError(res, '清空记忆失败', error.message)
  }
})

// GET /api/ai/models - 获取可用配置
router.get('/models', (_req, res) => {
  const llmCfg = providerManager.getLLMConfig()
  const imgCfg = providerManager.getImageConfig()
  // 向后兼容：返回 models 列表（只有当前配置的模型）
  ApiResponse.success(res, {
    llm: { name: llmCfg.name, model: llmCfg.model, format: llmCfg.format, baseURL: llmCfg.baseURL },
    image: { name: imgCfg.name, model: imgCfg.model, baseURL: imgCfg.baseURL, defaultSize: imgCfg.defaultSize },
    models: [{
      id: llmCfg.model,
      name: llmCfg.name ? `${llmCfg.name} - ${llmCfg.model}` : llmCfg.model,
      type: 'multimodal',
      desc: '当前配置的 LLM 模型',
    }],
    imageRatios: config.ai.imageRatios,
  }, '获取配置成功')
})

// POST /api/ai/image - 文生图（需登录）
router.post('/image', authMiddleware as any, async (req, res) => {
  try {
    const { prompt, sessionId, size } = req.body
    if (!prompt) return ApiResponse.badRequest(res, '请提供图片描述')

    const imgCfg = providerManager.getImageConfig()
    console.log(`[ImageGen] 供应商: ${imgCfg.name}, 模型: ${imgCfg.model}, prompt: "${prompt.slice(0, 80)}..."`)

    const uid = req.user!.id
    // 保存用户 prompt 到数据库
    if (sessionId) {
      try {
        await ChatHistoryModel.create(sessionId, uid, 'user', prompt)
      } catch (e: any) {
        console.error('[ImageGen] 保存用户消息失败:', e.message)
      }
    }

    const imageUrl = await providerManager.generateImage(prompt, size || imgCfg.defaultSize)
    if (imageUrl) {
      if (sessionId) {
        try {
          await ChatHistoryModel.create(sessionId, uid, 'assistant', `[生成图片](${imageUrl})`)
        } catch {}
      }
      return ApiResponse.success(res, { imageUrl }, '图片生成成功')
    }
    return ApiResponse.internalServerError(res, '图片生成返回为空')
  } catch (error: any) {
    console.error('[ImageGen] 失败:', error.message)
    ApiResponse.internalServerError(res, '图片生成失败', error.message)
  }
})

export default router
