-- ============================================
-- RAG → NEXUS 数据库迁移脚本
-- 在现有 NEXUS 数据库上执行，增加 RAG 新增的表和字段
-- ============================================
-- 使用方法：mysql -u root -p your_database_name < migration.sql
-- ============================================

-- 1. users 表增加 avatar 字段（如果不存在）
SET @dbname = DATABASE();
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar');
SET @sql = IF(@exists = 0, 'ALTER TABLE users ADD COLUMN `avatar` VARCHAR(500) DEFAULT NULL COMMENT ''用户头像 URL'' AFTER `role`', 'SELECT ''avatar already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. kb_documents 表增加版本管理字段
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'kb_documents' AND COLUMN_NAME = 'user_id');
SET @sql = IF(@exists = 0, 'ALTER TABLE kb_documents ADD COLUMN `user_id` INT DEFAULT NULL COMMENT ''上传用户 ID'' AFTER `error_message`', 'SELECT ''user_id already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'kb_documents' AND COLUMN_NAME = 'file_hash');
SET @sql = IF(@exists = 0, 'ALTER TABLE kb_documents ADD COLUMN `file_hash` VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''文件内容 hash'' AFTER `user_id`', 'SELECT ''file_hash already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'kb_documents' AND COLUMN_NAME = 'version');
SET @sql = IF(@exists = 0, 'ALTER TABLE kb_documents ADD COLUMN `version` INT DEFAULT 1 COMMENT ''版本号，从 1 开始递增'' AFTER `file_hash`', 'SELECT ''version already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'kb_documents' AND COLUMN_NAME = 'is_latest');
SET @sql = IF(@exists = 0, 'ALTER TABLE kb_documents ADD COLUMN `is_latest` TINYINT(1) DEFAULT 1 COMMENT ''1=最新版本，0=历史版本'' AFTER `version`', 'SELECT ''is_latest already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 修改 file_size 为 BIGINT
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'kb_documents' AND COLUMN_NAME = 'file_size' AND DATA_TYPE = 'bigint');
SET @sql = IF(@exists = 0, 'ALTER TABLE kb_documents MODIFY COLUMN `file_size` BIGINT NOT NULL COMMENT ''文件大小（字节）''', 'SELECT ''file_size already bigint''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- kb_documents 新增索引
SET @exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'kb_documents' AND INDEX_NAME = 'idx_file_hash');
SET @sql = IF(@exists = 0, 'CREATE INDEX idx_file_hash ON kb_documents (file_hash)', 'SELECT ''idx_file_hash already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'kb_documents' AND INDEX_NAME = 'idx_file_hash_latest');
SET @sql = IF(@exists = 0, 'CREATE INDEX idx_file_hash_latest ON kb_documents (file_hash, is_latest)', 'SELECT ''idx_file_hash_latest already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'kb_documents' AND INDEX_NAME = 'idx_kb_latest');
SET @sql = IF(@exists = 0, 'CREATE INDEX idx_kb_latest ON kb_documents (kb_id, is_latest)', 'SELECT ''idx_kb_latest already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- kb_documents 外键（user_id → users.id）
-- 跳过外键检查避免冲突
-- ALTER TABLE kb_documents ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 3. 创建聊天反馈表
CREATE TABLE IF NOT EXISTS `chat_feedback` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(64) NOT NULL COMMENT '会话ID',
  `message_index` INT NOT NULL COMMENT '消息在会话中的序号',
  `user_id` INT NULL COMMENT '用户ID',
  `rating` ENUM('up','down') NOT NULL COMMENT '评价：up 好评，down 差评',
  `comment` TEXT NULL COMMENT '反馈备注',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `idx_fb_session_id` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天反馈表';

-- 4. 知识库名称唯一索引
SET @exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'knowledge_bases' AND INDEX_NAME = 'uk_kb_name');
SET @sql = IF(@exists = 0, 'ALTER TABLE knowledge_bases ADD UNIQUE INDEX `uk_kb_name` (`name`)', 'SELECT ''uk_kb_name already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. users 表增加 department 字段
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'department');
SET @sql = IF(@exists = 0, 'ALTER TABLE users ADD COLUMN `department` VARCHAR(100) DEFAULT NULL COMMENT ''部门'' AFTER `role`', 'SELECT ''department already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. chat_history 增加内容哈希列（用于追踪，不做唯一约束）
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'chat_history' AND COLUMN_NAME = 'content_hash');
SET @sql = IF(@exists = 0, 'ALTER TABLE chat_history ADD COLUMN `content_hash` VARCHAR(64) NULL COMMENT ''内容哈希'' AFTER `content`', 'SELECT ''content_hash already exists''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
