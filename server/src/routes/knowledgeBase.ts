import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { adminMiddleware } from '../middleware/admin.js'
import { ApiResponse } from '../utils/response.js'
import * as kbService from '../services/knowledgeBase.js'
import { isOfficeMime, convertToPdf } from '../services/officePreview.js'
import { parseDocumentPreview } from '../services/documentPipeline.js'
import { searchAcrossKBs } from '../services/ragChain.js'
import multer from 'multer'
import path from 'path'
import fs from 'fs'

const router = Router()

// 文件上传配置
const uploadDir = path.join(process.cwd(), 'uploads', 'kb')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '_' + Math.round(Math.random() * 1e9)
    const ext = path.extname(file.originalname)
    cb(null, uniqueSuffix + ext)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/plain', 'text/markdown', 'application/json', 'text/html',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('不支持的文件类型'))
    }
  }
})

// 所有路由需要认证
router.use(authMiddleware as any)

// 创建知识库
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body
    if (!name || name.trim().length === 0) {
      return ApiResponse.badRequest(res, '知识库名称不能为空')
    }
    const result = await kbService.createKnowledgeBase(req.user!.id, name.trim(), description)
    return ApiResponse.created(res, result, '知识库创建成功')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '创建知识库失败', err.message)
  }
})

// 获取用户的知识库列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const kbs = await kbService.getUserKnowledgeBases(req.user!.id)
    return ApiResponse.success(res, { knowledgeBases: kbs }, '获取知识库列表成功')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '获取知识库列表失败', err.message)
  }
})

// 获取全部知识库（全局查看，admin 可用）
router.get('/all', async (req: Request, res: Response) => {
  try {
    const kbs = await kbService.getAllKnowledgeBases()
    return ApiResponse.success(res, { knowledgeBases: kbs }, '获取全部知识库成功')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '获取知识库列表失败', err.message)
  }
})

// 获取知识库详情
router.get('/:kbId', async (req: Request, res: Response) => {
  try {
    const kb = await kbService.getKnowledgeBase(Number(req.params.kbId))
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')
    if (kb.user_id !== req.user!.id) return ApiResponse.forbidden(res, '无权访问此知识库')
    return ApiResponse.success(res, { knowledgeBase: kb })
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '获取知识库详情失败', err.message)
  }
})

// 删除知识库
router.delete('/:kbId', async (req: Request, res: Response) => {
  try {
    const kb = await kbService.getKnowledgeBase(Number(req.params.kbId))
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')
    if (kb.user_id !== req.user!.id) return ApiResponse.forbidden(res, '无权删除此知识库')
    await kbService.deleteKnowledgeBase(Number(req.params.kbId))
    return ApiResponse.success(res, null, '知识库已删除')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '删除知识库失败', err.message)
  }
})

// 上传文档到知识库
router.post('/:kbId/documents', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const kbId = Number(req.params.kbId)
    const kb = await kbService.getKnowledgeBase(kbId)
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')
    if (kb.user_id !== req.user!.id) return ApiResponse.forbidden(res, '无权操作此知识库')

    const files = req.files as Express.Multer.File[]
    if (!files || files.length === 0) {
      return ApiResponse.badRequest(res, '请选择要上传的文件')
    }

    const results = []
    for (const file of files) {
      // 修复 multer 中文文件名乱码：busboy 按 latin1 解析，需转回 utf8
      let filename = file.originalname
      if (/[\u0080-\u00ff]/.test(filename)) {
        filename = Buffer.from(filename, 'latin1').toString('utf8')
      }
      const result = await kbService.addDocumentToKB(
        kbId, file.path, filename, file.mimetype, file.size
      )
      results.push({
        id: result.docId,
        filename,
        chunkCount: result.chunkCount,
        duplicate: (result as any).duplicate || false,
        version: (result as any).version
      })
    }

    return ApiResponse.created(res, { documents: results }, `成功上传 ${results.length} 个文档`)
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '上传文档失败', err.message)
  }
})

// 获取知识库中的文档列表
router.get('/:kbId/documents', async (req: Request, res: Response) => {
  try {
    const kbId = Number(req.params.kbId)
    const kb = await kbService.getKnowledgeBase(kbId)
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')
    if (kb.user_id !== req.user!.id) return ApiResponse.forbidden(res, '无权访问此知识库')

    const docs = await kbService.getKBDocuments(kbId)
    return ApiResponse.success(res, { documents: docs })
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '获取文档列表失败', err.message)
  }
})

// 删除知识库中的文档
router.delete('/:kbId/documents/:docId', async (req: Request, res: Response) => {
  try {
    const kbId = Number(req.params.kbId)
    const docId = Number(req.params.docId)

    const kb = await kbService.getKnowledgeBase(kbId)
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')
    if (kb.user_id !== req.user!.id) return ApiResponse.forbidden(res, '无权操作此知识库')

    await kbService.removeDocumentFromKB(docId)
    return ApiResponse.success(res, null, '文档已删除')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '删除文档失败', err.message)
  }
})

// 获取文档的所有版本
router.get('/:kbId/documents/:docId/versions', async (req: Request, res: Response) => {
  try {
    const kbId = Number(req.params.kbId)
    const docId = Number(req.params.docId)

    const kb = await kbService.getKnowledgeBase(kbId)
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')

    const { KbDocumentModel } = await import('../models/kbDocument.js')
    const versions = await KbDocumentModel.findVersionsByDocId(docId)
    return ApiResponse.success(res, { versions })
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '获取版本列表失败', err.message)
  }
})

// 恢复文档到指定版本
router.post('/:kbId/documents/:docId/restore', async (req: Request, res: Response) => {
  try {
    const kbId = Number(req.params.kbId)
    const docId = Number(req.params.docId)

    const kb = await kbService.getKnowledgeBase(kbId)
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')

    const { KbDocumentModel } = await import('../models/kbDocument.js')
    const restored = await KbDocumentModel.restoreVersion(docId)
    if (!restored) return ApiResponse.notFound(res, '文档版本不存在')

    return ApiResponse.success(res, null, '已恢复到指定版本')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '恢复版本失败', err.message)
  }
})

// 删除文档的指定版本（不能删除最新版本）
router.delete('/:kbId/documents/:docId/versions/:versionId', async (req: Request, res: Response) => {
  try {
    const kbId = Number(req.params.kbId)
    const docId = Number(req.params.versionId)

    const kb = await kbService.getKnowledgeBase(kbId)
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')

    const { KbDocumentModel } = await import('../models/kbDocument.js')
    const deleted = await KbDocumentModel.deleteVersion(docId)
    if (!deleted) return ApiResponse.badRequest(res, '无法删除最新版本或版本不存在')

    return ApiResponse.success(res, null, '版本已删除')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '删除版本失败', err.message)
  }
})

// 在知识库中检索（走完整管线：向量 → 混合检索 → 重排序）
router.post('/:kbId/search', async (req: Request, res: Response) => {
  try {
    const kbId = Number(req.params.kbId)
    const { query } = req.body

    if (!query || query.trim().length === 0) {
      return ApiResponse.badRequest(res, '检索内容不能为空')
    }

    const kb = await kbService.getKnowledgeBase(kbId)
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')
    if (kb.user_id !== req.user!.id) return ApiResponse.forbidden(res, '无权访问此知识库')

    const { retrieveFromKB } = await import('../services/ragChain.js')
    const result = await retrieveFromKB(query.trim(), kbId)
    return ApiResponse.success(res, { chunks: result.chunks }, '检索完成')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '检索失败', err.message)
  }
})

// 预览文档内容
router.get('/:kbId/documents/:docId/preview', async (req: Request, res: Response) => {
  try {
    const kbId = Number(req.params.kbId)
    const docId = Number(req.params.docId)

    const kb = await kbService.getKnowledgeBase(kbId)
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')
    if (kb.user_id !== req.user!.id) return ApiResponse.forbidden(res, '无权访问此知识库')

    const { KbDocumentModel } = await import('../models/kbDocument.js')
    const doc = await KbDocumentModel.findById(docId)
    if (!doc) return ApiResponse.notFound(res, '文档不存在')

    // Office 文档优先尝试转 PDF（保留图片/排版）
    if (isOfficeMime(doc.file_type)) {
      const pdfPath = await convertToPdf(doc.file_path)
      if (pdfPath) {
        const pdfUrl = '/' + pdfPath.replace(/\\/g, '/')
        return ApiResponse.success(res, {
          filename: doc.filename,
          fileType: doc.file_type,
          fileSize: doc.file_size,
          format: 'pdf',
          pdfUrl,
        }, '预览成功（已转 PDF）')
      }
    }

    const { content, format } = await parseDocumentPreview(doc.file_path, doc.file_type)
    return ApiResponse.success(res, {
      filename: doc.filename,
      fileType: doc.file_type,
      fileSize: doc.file_size,
      content,
      format,
    }, '预览成功')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '预览文档失败', err.message)
  }
})

// 下载文档（使用原文件名）
router.get('/:kbId/documents/:docId/download', async (req: Request, res: Response) => {
  try {
    const docId = Number(req.params.docId)

    const { KbDocumentModel } = await import('../models/kbDocument.js')
    const doc = await KbDocumentModel.findById(docId)
    if (!doc) return ApiResponse.notFound(res, '文档不存在')

    const filePath = path.isAbsolute(doc.file_path) ? doc.file_path : path.join(process.cwd(), doc.file_path)
    if (!fs.existsSync(filePath)) {
      return ApiResponse.notFound(res, '文件不存在')
    }

    const filename = encodeURIComponent(doc.filename)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.setHeader('Content-Type', doc.file_type || 'application/octet-stream')
    const stream = fs.createReadStream(filePath)
    stream.pipe(res)
  } catch (err: any) {
    ApiResponse.internalServerError(res, '下载失败', err.message)
  }
})

// 调试：查看知识库分块数据
router.get('/:kbId/chunks', async (req: Request, res: Response) => {
  try {
    const kbId = Number(req.params.kbId)
    const docId = req.query.docId ? Number(req.query.docId) : undefined
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const offset = Number(req.query.offset) || 0

    const kb = await kbService.getKnowledgeBase(kbId)
    if (!kb) return ApiResponse.notFound(res, '知识库不存在')
    if (kb.user_id !== req.user!.id) return ApiResponse.forbidden(res, '无权访问此知识库')

    const { getLanceConnection } = await import('../services/vectorStore.js')
    const conn = await getLanceConnection()
    const tableName = `kb_${kbId}`
    const tableNames = await conn.tableNames()

    if (!tableNames.includes(tableName)) {
      return ApiResponse.success(res, { chunks: [], total: 0, tableName }, '该知识库暂无向量数据')
    }

    const table = await conn.openTable(tableName)
    let query = table.query()
    if (docId !== undefined) {
      query = query.where(`doc_id = ${docId}`)
    }
    const allRows = await query.toArray()
    const total = allRows.length

    // 分页 + 去掉 vector 字段（太大）
    const rows = allRows.slice(offset, offset + limit).map((row: any) => {
      const { vector, ...rest } = row
      return {
        ...rest,
        text_preview: (row.text || '').slice(0, 300),
        text_length: (row.text || '').length,
        vector_dimension: Array.isArray(vector) ? vector.length : 0,
      }
    })

    return ApiResponse.success(res, { chunks: rows, total, tableName, offset, limit }, '分块数据')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '查询分块失败', err.message)
  }
})

// 调试：查看所有向量表
router.get('/debug/tables', async (_req: Request, res: Response) => {
  try {
    const { getLanceConnection } = await import('../services/vectorStore.js')
    const conn = await getLanceConnection()
    const tableNames = await conn.tableNames()

    const tables = []
    for (const name of tableNames) {
      try {
        const table = await conn.openTable(name)
        const count = (await table.query().toArray()).length
        tables.push({ name, count })
      } catch {
        tables.push({ name, count: -1 })
      }
    }

    return ApiResponse.success(res, { tables }, '向量表列表')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '查询失败', err.message)
  }
})

// 多知识库联合检索
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, kbIds } = req.body
    if (!query || query.trim().length === 0) {
      return ApiResponse.badRequest(res, '检索内容不能为空')
    }
    if (!Array.isArray(kbIds) || kbIds.length === 0) {
      return ApiResponse.badRequest(res, '请选择至少一个知识库')
    }
    const ctx = await searchAcrossKBs(query.trim(), kbIds as number[])
    return ApiResponse.success(res, { chunks: ctx.chunks }, '检索完成')
  } catch (err: any) {
    return ApiResponse.internalServerError(res, '联合检索失败', err.message)
  }
})

export default router
