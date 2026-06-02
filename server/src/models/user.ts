import pool from '../utils/db.js'

export interface User {
  id?: number
  username: string
  email: string
  password: string
  role?: 'admin' | 'user'
  email_verified?: number
  department?: string
  avatar?: string | null
  created_at?: Date
}

let wechatTableReady = false
async function ensureWechatTable() {
  if (wechatTableReady) return
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS wechat_users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      openid VARCHAR(100) NOT NULL UNIQUE,
      unionid VARCHAR(100) NULL,
      user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wu_openid (openid),
      INDEX idx_wu_user_id (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  } catch {}
  wechatTableReady = true
}

export class UserModel {
  // 创建已验证用户（邮箱验证通过后调用）
  static async createVerified(user: { username: string; email: string; password: string; role?: string }): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO users (username, email, password, role, email_verified) VALUES (?, ?, ?, ?, 1)',
      [user.username, user.email, user.password, user.role || 'user']
    )
    return (result as any).insertId
  }

  // 管理员直接创建用户（跳过验证）
  static async create(user: { username: string; email: string; password: string; role?: string; department?: string }): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO users (username, email, password, role, email_verified, department) VALUES (?, ?, ?, ?, 1, ?)',
      [user.username, user.email, user.password, user.role || 'user', user.department || '']
    )
    return (result as any).insertId
  }

  // 创建微信登录用户（邮箱/密码占位，跳过验证）
  static async createWechatUser(openid: string): Promise<{ id: number; username: string }> {
    await ensureWechatTable()
    const shortId = openid.slice(-8)
    const username = `wx_用户${shortId}`
    const email = `wx_${shortId}@wechat.local`
    const { default: bcrypt } = await import('bcryptjs')
    const randomPwd = `wx_${Math.random().toString(36).slice(2)}${Date.now()}`
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(randomPwd, salt)

    const [result] = await pool.execute(
      'INSERT INTO users (username, email, password, role, email_verified) VALUES (?, ?, ?, ?, 1)',
      [username, email, hashedPassword, 'user']
    )
    const userId = (result as any).insertId

    await pool.execute(
      'INSERT INTO wechat_users (openid, user_id) VALUES (?, ?)',
      [openid, userId]
    )

    return { id: userId, username }
  }

  // 根据 openid 查找用户
  static async findByOpenid(openid: string): Promise<User | null> {
    await ensureWechatTable()
    const [rows] = await pool.execute(
      `SELECT u.* FROM users u
       INNER JOIN wechat_users wu ON u.id = wu.user_id
       WHERE wu.openid = ?`,
      [openid]
    )
    return (rows as User[])[0] || null
  }

  static async findByUsername(username: string): Promise<User | null> {
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username])
    return (rows as User[])[0] || null
  }

  static async findByEmail(email: string): Promise<User | null> {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email])
    return (rows as User[])[0] || null
  }

  static async findById(id: number): Promise<User | null> {
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id])
    return (rows as User[])[0] || null
  }
}
