import pool from '../utils/db.js'
import * as crypto from 'crypto'
import * as fs from 'fs'

export interface KbDocument {
  id: number
  kb_id: number
  filename: string
  file_path: string
  file_type: string
  file_size: number
  chunk_count: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message: string | null
  user_id: number | null
  file_hash: string
  version: number
  is_latest: number
  created_at: Date
  updated_at: Date
}

export class KbDocumentModel {
  static async create(kbId: number, filename: string, filePath: string, fileType: string, fileSize: number, userId?: number): Promise<{ docId: number; isDuplicate: boolean; version: number }> {
    const fileHash = await this.calculateFileHash(filePath)

    // 1. 精确去重：同一KB、同一文件名、同一hash → 跳过上传
    const duplicate = await this.findDuplicate(kbId, filename, fileHash)
    if (duplicate) return { docId: duplicate.id, isDuplicate: true, version: duplicate.version }

    // 2. 按文件名匹配：同一KB、同一文件名 → 新版本
    const existing = await this.findLatestByName(kbId, filename)

    let version = 1
    if (existing) {
      await pool.execute(
        'UPDATE kb_documents SET is_latest = 0 WHERE id = ?',
        [existing.id]
      )
      version = existing.version + 1
    }

    const [result] = await pool.execute(
      'INSERT INTO kb_documents (kb_id, filename, file_path, file_type, file_size, user_id, file_hash, version, is_latest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
      [kbId, filename, filePath, fileType, fileSize, userId || null, fileHash, version]
    )
    return { docId: (result as any).insertId, isDuplicate: false, version }
  }

  static async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5')
      const stream = fs.createReadStream(filePath)
      stream.on('data', data => hash.update(data))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }

  static async findDuplicate(kbId: number, filename: string, fileHash: string): Promise<KbDocument | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM kb_documents WHERE kb_id = ? AND filename = ? AND file_hash = ? AND is_latest = 1',
      [kbId, filename, fileHash]
    )
    return (rows as KbDocument[])[0] || null
  }

  static async findLatestByName(kbId: number, filename: string): Promise<KbDocument | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM kb_documents WHERE kb_id = ? AND filename = ? AND is_latest = 1',
      [kbId, filename]
    )
    return (rows as KbDocument[])[0] || null
  }

  static async findLatestByHash(fileHash: string): Promise<KbDocument | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM kb_documents WHERE file_hash = ? AND is_latest = 1',
      [fileHash]
    )
    return (rows as KbDocument[])[0] || null
  }

  static async findVersionsByHash(fileHash: string): Promise<KbDocument[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM kb_documents WHERE file_hash = ? ORDER BY version DESC',
      [fileHash]
    )
    return rows as KbDocument[]
  }

  static async findByKbId(kbId: number, latestOnly = true): Promise<KbDocument[]> {
    const sql = latestOnly
      ? 'SELECT * FROM kb_documents WHERE kb_id = ? AND is_latest = 1 ORDER BY created_at DESC'
      : 'SELECT * FROM kb_documents WHERE kb_id = ? ORDER BY created_at DESC'
    const [rows] = await pool.execute(sql, [kbId])
    return rows as KbDocument[]
  }

  static async findById(id: number): Promise<KbDocument | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM kb_documents WHERE id = ?',
      [id]
    )
    return (rows as KbDocument[])[0] || null
  }

  static async updateStatus(id: number, status: string, chunkCount?: number, errorMessage?: string): Promise<void> {
    const fields: string[] = ['status = ?']
    const params: any[] = [status]

    if (chunkCount !== undefined) {
      fields.push('chunk_count = ?')
      params.push(chunkCount)
    }
    if (errorMessage !== undefined) {
      fields.push('error_message = ?')
      params.push(errorMessage)
    }

    params.push(id)
    await pool.execute(`UPDATE kb_documents SET ${fields.join(', ')} WHERE id = ?`, params)
  }

  static async delete(id: number): Promise<{ kbId: number; chunkCount: number; filePath: string } | null> {
    const doc = await this.findById(id)
    if (!doc) return null

    await pool.execute('DELETE FROM kb_documents WHERE id = ?', [id])
    return { kbId: doc.kb_id, chunkCount: doc.chunk_count, filePath: doc.file_path }
  }

  static async findVersionsByDocId(docId: number): Promise<KbDocument[]> {
    const doc = await this.findById(docId)
    if (!doc) return []
    return this.findVersionsByName(doc.kb_id, doc.filename)
  }

  static async findVersionsByName(kbId: number, filename: string): Promise<KbDocument[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM kb_documents WHERE kb_id = ? AND filename = ? ORDER BY version DESC',
      [kbId, filename]
    )
    return rows as KbDocument[]
  }

  static async restoreVersion(docId: number): Promise<boolean> {
    const doc = await this.findById(docId)
    if (!doc) return false
    if (doc.is_latest === 1) return true

    await pool.execute(
      'UPDATE kb_documents SET is_latest = 0 WHERE kb_id = ? AND filename = ?',
      [doc.kb_id, doc.filename]
    )
    await pool.execute(
      'UPDATE kb_documents SET is_latest = 1 WHERE id = ?',
      [docId]
    )
    return true
  }

  static async deleteVersion(docId: number): Promise<boolean> {
    const doc = await this.findById(docId)
    if (!doc) return false
    if (doc.is_latest === 1) return false

    await pool.execute('DELETE FROM kb_documents WHERE id = ?', [docId])
    return true
  }
}
