import pool from '../utils/db.js'

export interface KnowledgeBase {
  id: number
  user_id: number
  name: string
  description: string | null
  lancedb_table_name: string
  document_count: number
  chunk_count: number
  created_at: Date
  updated_at: Date
}

export class KnowledgeBaseModel {
  static async create(userId: number, name: string, description: string | null, lancedbTableName: string): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO knowledge_bases (user_id, name, description, lancedb_table_name) VALUES (?, ?, ?, ?)',
      [userId, name, description || null, lancedbTableName]
    )
    return (result as any).insertId
  }

  static async findByUserId(userId: number): Promise<KnowledgeBase[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM knowledge_bases WHERE user_id = ? ORDER BY updated_at DESC',
      [userId]
    )
    return rows as KnowledgeBase[]
  }

  static async findAll(): Promise<KnowledgeBase[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM knowledge_bases ORDER BY updated_at DESC'
    )
    return rows as KnowledgeBase[]
  }

  static async findById(id: number): Promise<KnowledgeBase | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM knowledge_bases WHERE id = ?',
      [id]
    )
    return (rows as KnowledgeBase[])[0] || null
  }

  static async delete(id: number): Promise<number> {
    const [result] = await pool.execute(
      'DELETE FROM knowledge_bases WHERE id = ?',
      [id]
    )
    return (result as any).affectedRows
  }

  static async incrementCounts(id: number, docDelta: number, chunkDelta: number): Promise<void> {
    await pool.execute(
      'UPDATE knowledge_bases SET document_count = document_count + ?, chunk_count = chunk_count + ? WHERE id = ?',
      [docDelta, chunkDelta, id]
    )
  }

  static async decrementCounts(id: number, docDelta: number, chunkDelta: number): Promise<void> {
    await pool.execute(
      'UPDATE knowledge_bases SET document_count = GREATEST(0, document_count - ?), chunk_count = GREATEST(0, chunk_count - ?) WHERE id = ?',
      [docDelta, chunkDelta, id]
    )
  }
}
