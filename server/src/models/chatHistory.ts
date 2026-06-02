import  pool  from '../utils/db.js'

interface ChatHistory {
  id: number
  session_id: string
  user_id: number | null
  role: 'user' | 'assistant'
  content: string
  files?: string | null
  created_at: Date
}

export class ChatHistoryModel {
  // 保存对话历史
  static async create(
    sessionId: string,
    userId: number | null,
    role: 'user' | 'assistant',
    content: string,
    files?: string,
    kbId?: number,
    retrievedChunks?: string,
    agentId?: number | null,
    roomId?: number | null
  ) {
    const [result] = await pool.execute(
      'INSERT INTO chat_history (session_id, user_id, role, content, files, kb_id, retrieved_chunks, agent_id, room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [sessionId, userId, role, content, files || null, kbId || null, retrievedChunks || null, agentId || null, roomId || null]
    )
    return (result as any).insertId
  }

  // 获取对话历史 - 同时匹配 session_id 和 user_id
  static async getBySessionIdAndUserId(sessionId: string, userId: number | null) {
    let query = 'SELECT * FROM chat_history WHERE session_id = ?'
    let params: any[] = [sessionId]

    if (userId !== null) {
      // 匹配该用户的会话 + 历史遗留的匿名会话
      query += ' AND (user_id = ? OR user_id IS NULL)'
      params.push(userId)
    }

    query += ' ORDER BY created_at ASC'

    const [rows] = await pool.execute(query, params)
    return rows as ChatHistory[]
  }

  // 根据 session_id 删除对话历史
  static async deleteBySessionId(sessionId: string) {
    const [result] = await pool.execute(
      'DELETE FROM chat_history WHERE session_id = ?',
      [sessionId]
    )
    return (result as any).affectedRows
  }

  // 根据 user_id 删除该用户的所有对话历史
  static async deleteByUserId(userId: number) {
    const [result] = await pool.execute(
      'DELETE FROM chat_history WHERE user_id = ?',
      [userId]
    )
    return (result as any).affectedRows
  }

  // 根据 session_id 和 user_id 删除对话历史
  static async deleteBySessionIdAndUserId(sessionId: string, userId: number) {
    const [result] = await pool.execute(
      'DELETE FROM chat_history WHERE session_id = ? AND user_id = ?',
      [sessionId, userId]
    )
    return (result as any).affectedRows
  }

  // 获取所有用户的对话统计信息（管理员用）
  static async getUserChatStats() {
    const [rows] = await pool.execute(`
      SELECT
        u.id AS user_id,
        u.username,
        u.email,
        COUNT(DISTINCT ch.session_id) AS session_count,
        COUNT(ch.id) AS message_count,
        SUM(CASE WHEN ch.role = 'user' THEN 1 ELSE 0 END) AS user_message_count,
        SUM(CASE WHEN ch.role = 'assistant' THEN 1 ELSE 0 END) AS assistant_message_count,
        MAX(ch.created_at) AS last_active_at
      FROM users u
      LEFT JOIN chat_history ch ON u.id = ch.user_id
      GROUP BY u.id, u.username, u.email
      ORDER BY last_active_at DESC
    `)
    return rows
  }

  // 获取房间聊天历史（含用户名和角色信息）
  static async getByRoomId(roomId: number, limit: number = 100) {
    const [rows] = await pool.query(
      `SELECT ch.*, u.username AS user_username,
         a.name AS agent_name, a.avatar AS agent_avatar
       FROM chat_history ch
       LEFT JOIN users u ON ch.user_id = u.id
       LEFT JOIN ai_agents a ON ch.agent_id = a.id
       WHERE ch.room_id = ?
       ORDER BY ch.created_at ASC LIMIT ?`,
      [roomId, limit]
    )
    return rows as any[]
  }

  // 根据用户ID获取对话历史（管理员用）
  static async getByUserId(userId: number) {
    const [rows] = await pool.execute(
      'SELECT * FROM chat_history WHERE user_id = ? ORDER BY created_at ASC',
      [userId]
    )
    return rows as ChatHistory[]
  }

  // Dashboard 聚合统计
  static async getDashboardStats(): Promise<{
    userCount: number
    kbCount: number
    docCount: number
    chunkCount: number
    todaySessions: number
    todayMessages: number
    totalSessions: number
    totalMessages: number
  }> {
    const [userRows] = await pool.execute('SELECT COUNT(*) AS cnt FROM users')
    const [kbRows] = await pool.execute('SELECT COUNT(*) AS cnt, COALESCE(SUM(document_count),0) AS docs, COALESCE(SUM(chunk_count),0) AS chunks FROM knowledge_bases')
    const [msgRows] = await pool.execute(
      `SELECT
        COUNT(DISTINCT session_id) AS totalSessions,
        COUNT(*) AS totalMessages
      FROM chat_history`
    )
    const [todayRows] = await pool.execute(
      `SELECT
        COUNT(DISTINCT session_id) AS todaySessions,
        COUNT(*) AS todayMessages
      FROM chat_history
      WHERE DATE(created_at) = CURDATE()`
    )
    return {
      userCount: Number((userRows as any[])[0].cnt),
      kbCount: Number((kbRows as any[])[0].cnt),
      docCount: Number((kbRows as any[])[0].docs),
      chunkCount: Number((kbRows as any[])[0].chunks),
      todaySessions: Number((todayRows as any[])[0].todaySessions),
      todayMessages: Number((todayRows as any[])[0].todayMessages),
      totalSessions: Number((msgRows as any[])[0].totalSessions),
      totalMessages: Number((msgRows as any[])[0].totalMessages),
    }
  }

  // 获取用户的所有会话列表（含预览信息）
  static async getSessionsByUserId(userId: number | null) {
    if (userId !== null) {
      // 查询该用户的会话 + 历史遗留的匿名会话（user_id IS NULL）
      const [rows] = await pool.execute(`
        SELECT
          ch.session_id,
          MIN(ch.created_at) AS created_at,
          MAX(ch.created_at) AS last_active_at,
          COUNT(*) AS message_count,
          (SELECT c2.content FROM chat_history c2
           WHERE c2.session_id = ch.session_id AND c2.role = 'user'
           ORDER BY c2.created_at ASC LIMIT 1) AS first_message,
          MAX(ch.agent_id) AS agent_id,
          MAX(a.name) AS agent_name,
          MAX(a.avatar) AS agent_avatar
        FROM chat_history ch
        LEFT JOIN ai_agents a ON a.id = ch.agent_id
        WHERE (ch.user_id = ? OR ch.user_id IS NULL) AND ch.room_id IS NULL
        GROUP BY ch.session_id
        ORDER BY last_active_at DESC
      `, [userId])
      return rows
    } else {
      // 未登录用户：返回匿名会话
      const [rows] = await pool.execute(`
        SELECT
          ch.session_id,
          MIN(ch.created_at) AS created_at,
          MAX(ch.created_at) AS last_active_at,
          COUNT(*) AS message_count,
          (SELECT c2.content FROM chat_history c2
           WHERE c2.session_id = ch.session_id AND c2.role = 'user'
           ORDER BY c2.created_at ASC LIMIT 1) AS first_message,
          MAX(ch.agent_id) AS agent_id
        FROM chat_history ch
        WHERE ch.user_id IS NULL AND ch.room_id IS NULL
        GROUP BY ch.session_id
        ORDER BY last_active_at DESC
      `)
      return rows
    }
  }
}
