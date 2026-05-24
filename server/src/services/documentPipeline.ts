import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import config from '../config/index.js'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse')

// 解析文档为纯文本（从 ai.ts 提取）
export async function parseDocument(filePath: string, mimeType: string): Promise<string> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath)

  switch (mimeType) {
    case 'text/plain':
    case 'text/markdown':
    case 'application/json':
      return fs.readFileSync(absolutePath, 'utf-8')

    case 'application/pdf':
      try {
        const dataBuffer = fs.readFileSync(absolutePath)
        const data = await pdfParse(dataBuffer)
        return data.text
      } catch {
        return '[PDF 解析失败]'
      }

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      try {
        const mammoth = (await import('mammoth')).default
        const result = await mammoth.extractRawText({ path: absolutePath })
        return result.value
      } catch (e: any) {
        console.error(`[DOCX] 解析失败: ${absolutePath} — ${e.message || e}`)
        return '[DOCX 解析失败]'
      }

    case 'application/msword':
      return '[DOC 为旧版二进制格式，无法直接解析。请将文件另存为 DOCX 格式后重新上传]'

    default:
      return '[不支持预览的文档类型]'
  }
}

// 获取文本分割器
function getSplitter(): RecursiveCharacterTextSplitter {
  return new RecursiveCharacterTextSplitter({
    chunkSize: config.rag.chunkSize,
    chunkOverlap: config.rag.chunkOverlap,
    separators: ['\n\n', '\n', '。', '.', ' ', '']
  })
}

// 完整管道：解析 → 分块 → 返回 Document 数组（嵌入和存储由调用方处理）
export async function chunkDocument(
  filePath: string,
  mimeType: string,
  metadata: { docId: number; kbId: number; filename: string }
): Promise<{ docs: Document[]; fullText: string }> {
  const fullText = await parseDocument(filePath, mimeType)
  const splitter = getSplitter()

  const docs = await splitter.createDocuments(
    [fullText],
    [{ ...metadata, source: metadata.filename }]
  )

  // 为每个分块添加 chunk_index
  // 统一为蛇形命名，剔除多余字段，匹配 LanceDB 表 schema
  docs.forEach((doc, i) => {
    doc.metadata.doc_id = doc.metadata.docId
    doc.metadata.kb_id = doc.metadata.kbId
    delete doc.metadata.docId
    delete doc.metadata.kbId
    delete doc.metadata.source
    delete (doc.metadata as any).loc
    doc.metadata.chunk_index = i
  })

  return { docs, fullText }
}

// 轻量版本：处理聊天中的附件文件（不关联知识库，直接返回分块）
export async function chunkFileForChat(
  filePath: string,
  mimeType: string,
  filename: string
): Promise<Document[]> {
  const fullText = await parseDocument(filePath, mimeType)
  const splitter = getSplitter()

  const docs = await splitter.createDocuments(
    [fullText],
    [{ source: filename }]
  )

  return docs
}
