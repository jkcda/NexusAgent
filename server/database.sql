-- ============================================
-- NEXUS 数据库初始化脚本
-- 用法: mysql -u root -p project < database.sql
-- ============================================

-- 用户表
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '用户 ID',
  `username` VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  `email` VARCHAR(100) NOT NULL UNIQUE COMMENT '邮箱',
  `password` VARCHAR(255) NOT NULL COMMENT '密码（加密后）',
  `role` ENUM('admin', 'user') DEFAULT 'user' COMMENT '用户角色',
  `avatar` VARCHAR(500) DEFAULT NULL COMMENT '用户头像 URL',
  `department` VARCHAR(100) DEFAULT NULL COMMENT '部门',
  `email_verified` TINYINT(1) DEFAULT 0 COMMENT '邮箱是否已验证',
  `verification_token` VARCHAR(100) NULL COMMENT '邮箱验证令牌',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 对话历史表
CREATE TABLE IF NOT EXISTS `chat_history` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '对话历史 ID',
  `session_id` VARCHAR(100) NOT NULL COMMENT '会话 ID',
  `user_id` INT NULL COMMENT '用户 ID',
  `role` ENUM('user', 'assistant') NOT NULL COMMENT '角色',
  `content` TEXT NOT NULL COMMENT '对话内容',
  `content_hash` VARCHAR(64) NULL COMMENT '内容哈希',
  `files` JSON NULL COMMENT '附件列表 [{name, url, type}]',
  `kb_id` INT NULL COMMENT '关联的知识库 ID',
  `agent_id` INT DEFAULT NULL COMMENT '关联AI角色ID',
  `room_id` INT DEFAULT NULL COMMENT '关联房间ID',
  `retrieved_chunks` JSON NULL COMMENT '检索到的分块摘要 [{source, score}]',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX `idx_session_id` (`session_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_chat_agent_id` (`agent_id`),
  INDEX `idx_chat_room_id` (`room_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话历史表';

-- 知识库表
CREATE TABLE IF NOT EXISTS `knowledge_bases` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '知识库 ID',
  `user_id` INT NOT NULL COMMENT '所属用户 ID',
  `name` VARCHAR(200) NOT NULL COMMENT '知识库名称',
  `description` TEXT NULL COMMENT '知识库描述',
  `lancedb_table_name` VARCHAR(100) NOT NULL COMMENT 'LanceDB 表名',
  `document_count` INT DEFAULT 0 COMMENT '文档数量',
  `chunk_count` INT DEFAULT 0 COMMENT '分块总数',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_kb_user_id` (`user_id`),
  UNIQUE INDEX `uk_kb_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库表';

-- 知识库文档表（支持版本管理）
CREATE TABLE IF NOT EXISTS `kb_documents` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '文档 ID',
  `kb_id` INT NOT NULL COMMENT '所属知识库 ID',
  `filename` VARCHAR(500) NOT NULL COMMENT '原始文件名',
  `file_path` VARCHAR(1000) NOT NULL COMMENT '文件存储路径',
  `file_type` VARCHAR(100) NOT NULL COMMENT 'MIME 类型',
  `file_size` BIGINT NOT NULL COMMENT '文件大小（字节）',
  `chunk_count` INT DEFAULT 0 COMMENT '分块数量',
  `status` ENUM('pending','processing','completed','failed') DEFAULT 'pending' COMMENT '处理状态',
  `error_message` TEXT NULL COMMENT '错误信息',
  `user_id` INT DEFAULT NULL COMMENT '上传用户 ID',
  `file_hash` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '文件内容 hash',
  `version` INT DEFAULT 1 COMMENT '版本号',
  `is_latest` TINYINT(1) DEFAULT 1 COMMENT '1=最新版本',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `idx_kb_doc_kb_id` (`kb_id`),
  INDEX `idx_file_hash` (`file_hash`),
  INDEX `idx_file_hash_latest` (`file_hash`, `is_latest`),
  INDEX `idx_kb_latest` (`kb_id`, `is_latest`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库文档表（支持版本管理）';

-- 知识库分块表
CREATE TABLE IF NOT EXISTS `kb_chunks` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '分块 ID',
  `doc_id` INT NOT NULL COMMENT '所属文档 ID',
  `kb_id` INT NOT NULL COMMENT '所属知识库 ID',
  `chunk_index` INT NOT NULL COMMENT '分块序号',
  `content_preview` VARCHAR(500) NULL COMMENT '分块内容预览',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  FOREIGN KEY (`doc_id`) REFERENCES `kb_documents`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON DELETE CASCADE,
  INDEX `idx_kb_chunk_doc_id` (`doc_id`),
  INDEX `idx_kb_chunk_kb_id` (`kb_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库分块表';

-- 系统配置表
CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `key_name` VARCHAR(100) NOT NULL UNIQUE COMMENT '配置键名',
  `value` TEXT NOT NULL COMMENT '配置值',
  `description` VARCHAR(255) DEFAULT '' COMMENT '配置说明',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- 验证码临时存储表
CREATE TABLE IF NOT EXISTS `verification_codes` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `email` VARCHAR(100) NOT NULL,
  `code` VARCHAR(10) NOT NULL,
  `username` VARCHAR(50) NOT NULL,
  `password` VARCHAR(255) NOT NULL COMMENT '已加密密码',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_vc_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='注册验证码临时存储';

-- AI 角色扮演智能体表
CREATE TABLE IF NOT EXISTS `ai_agents` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT 'Agent ID',
  `user_id` INT NOT NULL COMMENT '所属用户 ID',
  `name` VARCHAR(100) NOT NULL COMMENT '角色名',
  `avatar` VARCHAR(500) DEFAULT NULL COMMENT '头像URL',
  `system_prompt` TEXT NOT NULL COMMENT '人设+背景故事',
  `greeting` TEXT DEFAULT NULL COMMENT '初始场景',
  `model_config` JSON DEFAULT NULL COMMENT '可选模型覆盖配置',
  `is_default` BOOLEAN DEFAULT FALSE COMMENT '是否为默认角色',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_agent_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI角色扮演智能体表';

-- 聊天室表
CREATE TABLE IF NOT EXISTS `chat_rooms` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '房间ID',
  `owner_id` INT NOT NULL COMMENT '房间创建者ID',
  `name` VARCHAR(200) NOT NULL COMMENT '房间名称',
  `topic` TEXT DEFAULT NULL COMMENT '房间话题/描述',
  `is_active` TINYINT(1) DEFAULT 1 COMMENT '是否活跃',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_room_owner` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天室表';

-- 房间与AI角色关联表
CREATE TABLE IF NOT EXISTS `chat_room_agents` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '关联ID',
  `room_id` INT NOT NULL COMMENT '房间ID',
  `agent_id` INT NOT NULL COMMENT 'AI角色ID',
  `joined_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
  UNIQUE KEY `uq_room_agent` (`room_id`, `agent_id`),
  FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`agent_id`) REFERENCES `ai_agents`(`id`) ON DELETE CASCADE,
  INDEX `idx_cra_room` (`room_id`),
  INDEX `idx_cra_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='房间与AI角色关联表';

-- 聊天室成员表
CREATE TABLE IF NOT EXISTS `chat_room_members` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '关联ID',
  `room_id` INT NOT NULL COMMENT '房间ID',
  `user_id` INT NOT NULL COMMENT '用户ID',
  `joined_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
  UNIQUE KEY `uq_room_user` (`room_id`, `user_id`),
  FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_crm_room` (`room_id`),
  INDEX `idx_crm_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天室成员表';

-- 微信用户关联表
CREATE TABLE IF NOT EXISTS `wechat_users` (
  `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '关联ID',
  `openid` VARCHAR(100) NOT NULL COMMENT '微信 openid',
  `unionid` VARCHAR(100) NULL COMMENT '微信 unionid',
  `user_id` INT NOT NULL COMMENT '用户ID',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY `uq_wu_openid` (`openid`),
  INDEX `idx_wu_user_id` (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='微信用户关联表';

-- 聊天反馈表
CREATE TABLE IF NOT EXISTS `chat_feedback` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(64) NOT NULL COMMENT '会话ID',
  `message_index` INT NOT NULL COMMENT '消息在会话中的序号',
  `user_id` INT NULL COMMENT '用户ID',
  `rating` ENUM('up','down') NOT NULL COMMENT '评价',
  `comment` TEXT NULL COMMENT '反馈备注',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `idx_fb_session_id` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天反馈表';

-- 注：chat_history.room_id → chat_rooms FK 由应用层管理
-- 如需外键约束，请在数据库已包含 chat_rooms 表后手动执行：
-- ALTER TABLE chat_history ADD FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE;
