import { KnowledgeBaseModel } from '../models/knowledgeBase.js'
import { KbDocumentModel } from '../models/kbDocument.js'
import { KbChunkModel } from '../models/kbChunk.js'
import { chunkDocument } from './documentPipeline.js'
import { addDocuments, deleteDocumentsByDocId, similaritySearch } from './vectorStore.js'
import { cacheGet, cacheSet, cacheDel } from './cache.js'
import config from '../config/index.js'
import type { Document } from '@langchain/core/documents'

export async function createKnowledgeBase(
  userId: number,
  name: string,
  description?: string
): Promise<{ id: number; lancedbTableName: string }> {
  const tableName = `kb_${userId}_${Date.now()}`
  const id = await KnowledgeBaseModel.create(userId, name, description || null, tableName)
  await cacheDel(`kb:list:${userId}`)
  return { id, lancedbTableName: tableName }
}

export async function getUserKnowledgeBases(userId: number) {
  const key = `kb:list:${userId}`
  const cached = await cacheGet<any[]>(key)
  if (cached) return cached

  const kbs = await KnowledgeBaseModel.findByUserId(userId)
  await cacheSet(key, kbs, config.redis.ttl.kbList)
  return kbs
}

export async function getKnowledgeBase(kbId: number) {
  return KnowledgeBaseModel.findById(kbId)
}

export async function deleteKnowledgeBase(kbId: number): Promise<void> {
  const kb = await KnowledgeBaseModel.findById(kbId)
  if (!kb) throw new Error('知识库不存在')

  const { deleteVectorStore } = await import('./vectorStore.js')
  await deleteVectorStore(kb.lancedb_table_name)
  await KnowledgeBaseModel.delete(kbId)

  // Invalidate caches
  await cacheDel(`kb:list:${kb.user_id}`)
  await cacheDel(`kb:docs:${kbId}`)
  await cacheDel(`rag:${kbId}:*`)
}

export async function addDocumentToKB(
  kbId: number,
  filePath: string,
  filename: string,
  mimeType: string,
  fileSize: number
): Promise<{ docId: number; chunkCount: number }> {
  const kb = await KnowledgeBaseModel.findById(kbId)
  if (!kb) throw new Error('知识库不存在')

  const docId = await KbDocumentModel.create(kbId, filename, filePath, mimeType, fileSize)
  await KbDocumentModel.updateStatus(docId, 'processing')

  try {
    const { docs } = await chunkDocument(filePath, mimeType, { docId, kbId, filename })
    await addDocuments(kb.lancedb_table_name, docs)

    const chunks = docs.map((doc, i) => ({
      chunkIndex: i,
      contentPreview: doc.pageContent.slice(0, 500)
    }))
    await KbChunkModel.batchCreate(docId, kbId, chunks)

    await KbDocumentModel.updateStatus(docId, 'completed', docs.length)
    await KnowledgeBaseModel.incrementCounts(kbId, 1, docs.length)

    // Invalidate caches
    await cacheDel(`kb:docs:${kbId}`)
    await cacheDel(`kb:list:${kb.user_id}`)
    await cacheDel(`rag:${kbId}:*`)

    return { docId, chunkCount: docs.length }
  } catch (err: any) {
    await KbDocumentModel.updateStatus(docId, 'failed', 0, err.message)
    throw err
  }
}

export async function getKBDocuments(kbId: number) {
  const key = `kb:docs:${kbId}`
  const cached = await cacheGet<any[]>(key)
  if (cached) return cached

  const docs = await KbDocumentModel.findByKbId(kbId)
  await cacheSet(key, docs, config.redis.ttl.kbDocs)
  return docs
}

export async function removeDocumentFromKB(docId: number): Promise<void> {
  const result = await KbDocumentModel.delete(docId)
  if (!result) throw new Error('文档不存在')

  const kb = await KnowledgeBaseModel.findById(result.kbId)
  if (kb) {
    await deleteDocumentsByDocId(kb.lancedb_table_name, docId)
    await KnowledgeBaseModel.decrementCounts(result.kbId, 1, result.chunkCount)
    await cacheDel(`kb:docs:${result.kbId}`)
    await cacheDel(`rag:${result.kbId}:*`)
  }

  await KbChunkModel.deleteByDocId(docId)
}

export interface SearchResult {
  content: string
  source: string
  score: number
  docId: number
  chunkIndex: number
}

export async function searchInKB(kbId: number, query: string, topK?: number): Promise<SearchResult[]> {
  const kb = await KnowledgeBaseModel.findById(kbId)
  if (!kb) throw new Error('知识库不存在')

  const results = await similaritySearch(kb.lancedb_table_name, query, topK)
  if (results.length > 0) {
    console.log(`[searchInKB] 返回 ${results.length} 条，最高分=${results[0][1]?.toFixed(3) || 'N/A'}`)
  }
  return results.map(([doc, score]) => ({
    content: doc.pageContent,
    source: (doc.metadata.filename as string) || (doc.metadata.source as string) || 'unknown',
    score,
    docId: (doc.metadata.doc_id as number) || 0,
    chunkIndex: (doc.metadata.chunk_index as number) || 0
  }))
}
