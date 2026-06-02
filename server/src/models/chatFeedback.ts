import pool from '../utils/db.js'

let _tableReady = false
async function ensureTable() {
  if (_tableReady) return
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS chat_feedback (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(64) NOT NULL COMMENT '会话ID',
      message_index INT NOT NULL COMMENT '消息在会话中的序号',
      user_id INT NULL COMMENT '用户ID',
      rating ENUM('up','down') NOT NULL COMMENT '评价：up 好评，down 差评',
      comment TEXT NULL COMMENT '反馈备注',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_fb_session_id (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天反馈表'`)
  } catch {}
  _tableReady = true
}

export interface ChatFeedback {
  id: number
  session_id: string
  message_index: number
  user_id: number | null
  rating: 'up' | 'down'
  comment: string | null
  created_at: Date
}

export class ChatFeedbackModel {
  static async create(
    sessionId: string,
    messageIndex: number,
    userId: number | null,
    rating: 'up' | 'down',
    comment?: string
  ): Promise<number> {
    await ensureTable()
    const [result] = await pool.execute(
      'INSERT INTO chat_feedback (session_id, message_index, user_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
      [sessionId, messageIndex, userId, rating, comment || null]
    )
    return (result as any).insertId
  }

  static async exists(sessionId: string, messageIndex: number): Promise<boolean> {
    const [rows] = await pool.execute(
      'SELECT id FROM chat_feedback WHERE session_id = ? AND message_index = ? LIMIT 1',
      [sessionId, messageIndex]
    )
    return (rows as any[]).length > 0
  }

  static async getStats(): Promise<{ upCount: number; downCount: number; totalCount: number }> {
    const [rows] = await pool.execute(
      `SELECT
        SUM(rating = 'up') AS upCount,
        SUM(rating = 'down') AS downCount,
        COUNT(*) AS totalCount
      FROM chat_feedback`
    )
    const r = (rows as any[])[0]
    return {
      upCount: Number(r.upCount) || 0,
      downCount: Number(r.downCount) || 0,
      totalCount: Number(r.totalCount) || 0,
    }
  }

  static async getTodayStats(): Promise<{ upCount: number; downCount: number; totalCount: number }> {
    const [rows] = await pool.execute(
      `SELECT
        SUM(rating = 'up') AS upCount,
        SUM(rating = 'down') AS downCount,
        COUNT(*) AS totalCount
      FROM chat_feedback
      WHERE DATE(created_at) = CURDATE()`
    )
    const r = (rows as any[])[0]
    return {
      upCount: Number(r.upCount) || 0,
      downCount: Number(r.downCount) || 0,
      totalCount: Number(r.totalCount) || 0,
    }
  }
}
