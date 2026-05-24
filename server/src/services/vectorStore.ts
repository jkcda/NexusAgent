import { LanceDB } from '@langchain/community/vectorstores/lancedb'
import { Document } from '@langchain/core/documents'
import { getEmbeddings } from './embedding.js'
import config from '../config/index.js'
import { connect } from '@lancedb/lancedb'
import path from 'path'
import fs from 'fs'
import type { Connection, Table } from '@lancedb/lancedb'

let _connection: Connection | null = null

export async function getLanceConnection(): Promise<Connection> {
  if (!_connection) {
    const dataDir = path.resolve(config.lancedb.dataDir)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    _connection = await connect(dataDir)
  }
  return _connection
}

export async function getVectorStore(tableName: string): Promise<LanceDB> {
  const embeddings = getEmbeddings()
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()

  if (tableNames.includes(tableName)) {
    const table = await conn.openTable(tableName)
    return new LanceDB(embeddings, { table })
  }

  // 创建空表（维度从 embedding 模型配置读取，默认 768 = bge-base-zh-v1.5）
  const dim = config.embeddings.dimension || 768
  const table = await conn.createTable(tableName, [
    { vector: Array(dim).fill(0), text: '', doc_id: 0, kb_id: 0, filename: '', chunk_index: 0 }
  ])
  // 删除初始占位行
  await table.delete('doc_id = 0')
  return new LanceDB(embeddings, { table })
}

export async function createVectorStore(tableName: string): Promise<LanceDB> {
  return getVectorStore(tableName)
}

/**
 * 通用建表/打开表（供 memoryService 等非KB场景使用）
 * 返回原生 LanceDB Table，不含 LangChain 包装
 */
export async function getOrCreateTable(tableName: string, dimension?: number): Promise<Table> {
  const dim = dimension || config.embeddings.dimension || 768
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()

  if (tableNames.includes(tableName)) {
    return conn.openTable(tableName)
  }

  const table = await conn.createTable(tableName, [
    { vector: Array(dim).fill(0), text: '', session_id: '', created_at: '' }
  ])
  await table.delete("session_id = ''")
  return table
}

/**
 * 原生向量搜索（不依赖 LangChain 包装）
 * 接收已嵌入的查询向量，返回原始结果数组
 */
export async function searchInTable(
  tableName: string,
  queryVector: number[],
  limit: number = 10
): Promise<any[]> {
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()
  if (!tableNames.includes(tableName)) return []

  const table = await conn.openTable(tableName)
  return table.search(queryVector).limit(limit).toArray()
}

export async function addDocuments(
  tableName: string,
  docs: Document[]
): Promise<void> {
  const store = await getVectorStore(tableName)
  await store.addDocuments(docs)
}

export async function similaritySearch(
  tableName: string,
  query: string,
  k: number = config.rag.topK
): Promise<[Document, number][]> {
  // 绕过 LangChain 的 broken similaritySearchWithScore（LanceDB 0.27 返回 _distance 而非 score）
  const embeddings = getEmbeddings()
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()
  if (!tableNames.includes(tableName)) return []

  const queryVector = await embeddings.embedQuery(query)
  const table = await conn.openTable(tableName)
  const raw = await table.search(queryVector).limit(k).toArray()

  return raw.map((item: any) => {
    const metadata: Record<string, any> = {}
    for (const key of Object.keys(item)) {
      if (key !== 'vector' && key !== '_distance') {
        metadata[key] = item[key]
      }
    }
    const distance = item._distance ?? 1
    const score = 1 - Math.min(distance, 1)
    return [new Document({ pageContent: item.text || '', metadata }), score]
  })
}

export async function deleteVectorStore(tableName: string): Promise<void> {
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()
  if (tableNames.includes(tableName)) {
    await conn.dropTable(tableName)
  }
}

export async function getAdjacentChunks(
  tableName: string,
  docId: number,
  centerChunkIndex: number,
  before: number,
  after: number
): Promise<{ text: string; chunkIndex: number }[]> {
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()
  if (!tableNames.includes(tableName)) return []

  const table = await conn.openTable(tableName)
  const minIdx = Math.max(0, centerChunkIndex - before)
  const maxIdx = centerChunkIndex + after

  const results = await table
    .query()
    .where(`doc_id = ${docId} AND chunk_index >= ${minIdx} AND chunk_index <= ${maxIdx}`)
    .toArray()

  return (results as any[])
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .map(r => ({ text: r.text as string, chunkIndex: r.chunk_index as number }))
}

export async function deleteDocumentsByDocId(
  tableName: string,
  docId: number
): Promise<void> {
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()
  if (!tableNames.includes(tableName)) return

  const table = await conn.openTable(tableName)
  await table.delete(`doc_id = ${docId}`)
}
