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

// ── 索引建立 ──

async function ensureKBIndices(table: Table) {
  try {
    await table.createIndex('vector')
    console.log(`[VectorStore] IVF_PQ 向量索引已建立: ${table.name}`)
  } catch (e: any) {
    if (!e.message?.includes('already exists')) {
      console.warn(`[VectorStore] 向量索引建立跳过: ${e.message || e}`)
    }
  }

  const scalarCols = ['doc_id', 'chunk_index', 'kb_id']
  for (const col of scalarCols) {
    try {
      await table.createIndex(col)
    } catch {
      // 列不存在或索引已存在，跳过
    }
  }
}

async function ensureMemoryIndices(table: Table) {
  try {
    await table.createIndex('vector')
  } catch {}

  try {
    await table.createIndex('session_id')
  } catch {}
}
// ── 表管理 ──

export async function getVectorStore(tableName: string): Promise<LanceDB> {
  const embeddings = getEmbeddings()
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()

  if (tableNames.includes(tableName)) {
    const table = await conn.openTable(tableName)
    return new LanceDB(embeddings, { table })
  }

  const dim = config.embeddings.dimension || 768
  const table = await conn.createTable(tableName, [
    { vector: Array(dim).fill(0), text: '', doc_id: 0, kb_id: 0, filename: '', chunk_index: 0 }
  ])
  await table.delete('doc_id = 0')
  ensureKBIndices(table) // 异步建索引，不阻塞
  return new LanceDB(embeddings, { table })
}

export async function createVectorStore(tableName: string): Promise<LanceDB> {
  return getVectorStore(tableName)
}

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
  ensureMemoryIndices(table)
  return table
}

// ── 搜索 ──

export async function searchInTable(
  tableName: string,
  queryVector: number[],
  limit: number = 10
): Promise<any[]> {
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()
  if (!tableNames.includes(tableName)) return []

  const table = await conn.openTable(tableName)
  return table.search(queryVector).limit(limit).refineFactor(2).toArray()
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
  const embeddings = getEmbeddings()
  const conn = await getLanceConnection()
  const tableNames = await conn.tableNames()
  if (!tableNames.includes(tableName)) return []

  const queryVector = await embeddings.embedQuery(query)
  const queryNorm = Math.sqrt(queryVector.reduce((s, x) => s + x * x, 0))

  const table = await conn.openTable(tableName)
  const raw = await table.search(queryVector).limit(k).refineFactor(2).toArray()

  return raw.map((item: any) => {
    const metadata: Record<string, any> = {}
    for (const key of Object.keys(item)) {
      if (key !== 'vector' && key !== '_distance') {
        metadata[key] = item[key]
      }
    }
    let score = 0
    const vec = item.vector as number[] | undefined
    if (vec && queryNorm > 0) {
      const vecNorm = Math.sqrt(Array.from(vec).reduce((s: number, x: number) => s + x * x, 0))
      if (vecNorm > 0) {
        const dot = Array.from(vec).reduce((s: number, x: number, i: number) => s + x * queryVector[i], 0)
        score = (dot / (queryNorm * vecNorm) + 1) / 2
      }
    }
    return [new Document({ pageContent: item.text || '', metadata }), score]
  })
}

// ── 清理 ──

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
