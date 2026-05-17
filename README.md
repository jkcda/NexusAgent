# 奈克瑟 NEXUS

全栈 AI 对话平台，支持多模态对话、知识库 RAG、AI 角色扮演、实时聊天室、语音交互。

> 本项目采用 **Vibe Coding** 方式开发，核心逻辑由 Claude Code 辅助实现，从 0 到上线部署全流程 AI 辅助。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express 5 + TypeScript |
| 前端 | Vue 3 + Vite + Pinia + Element Plus |
| 小程序 | uni-app |
| 数据库 | MySQL + Redis（可选） |
| 向量存储 | LanceDB（本地嵌入式） |
| 实时通信 | Socket.IO（Web）/ WebSocket（小程序） |
| AI 能力 | 多供应商可配置（OpenAI 兼容 / Anthropic 格式） |
| 向量化 | 本地模型 bge-small-zh-v1.5（低配服务器自动降级 API） |

## 项目结构

```
aiconnent/
├── server/                    # 后端 Express + TypeScript
│   ├── src/
│   │   ├── app.ts             # 入口（Express + Socket.IO + WebSocket）
│   │   ├── config/            # 动态配置（DB + 环境变量双回退）
│   │   ├── providers/         # AI 能力调度中心（核心）
│   │   ├── services/          # 业务服务层
│   │   │   ├── ai.ts          # 对话编排入口
│   │   │   ├── agent.ts       # Agent 系统（Tool Calling）
│   │   │   ├── ragChain.ts    # RAG 检索管线
│   │   │   ├── embedding.ts   # 向量嵌入
│   │   │   ├── memoryService.ts # 长期记忆
│   │   │   └── ...
│   │   ├── routes/            # API 路由
│   │   ├── models/            # 数据模型
│   │   ├── middleware/        # JWT 认证/权限
│   │   └── utils/             # 工具函数
│   └── data/lancedb/          # 向量数据
├── client/                    # Web 前端 Vue 3 + Vite
│   └── src/
│       ├── views/             # 页面（Chat、Agent、Room、Admin...）
│       ├── stores/            # Pinia 状态管理
│       ├── apis/              # API 调用封装
│       └── utils/             # SSE、Socket.IO、语音工具
├── client-miniapp/            # 小程序/App uni-app
└── docs/                      # 开发文档
```

---

## 架构设计

### 核心架构图

```
┌─────────────────────────────────────────────────────────┐
│                      前端 (Vue 3)                        │
│    Chat · Agent · Room · KnowledgeBase · Admin          │
│    SSE 流式接收 · Socket.IO 实时通信 · Axios HTTP       │
└──────────────┬──────────────────────────────┬────────────┘
               │ HTTP/SSE          Socket.IO  │
               ▼                              ▼
┌─────────────────────────────────────────────────────────┐
│                  后端 (Express 5)                        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ 路由层    │  │ 中间件   │  │ WebSocket 服务        │  │
│  │ ai/user/  │  │ JWT/     │  │ Socket.IO + ws 桥接  │  │
│  │ admin/kb  │  │ 限流/   │  │ (小程序原生ws)        │  │
│  └─────┬────┘  │ 文件     │  └──────────────────────┘  │
│        │       └──────────┘                            │
│        ▼                                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │               service 层                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │   │
│  │  │ Agent    │  │ RAG      │  │ ProviderManager │  │   │
│  │  │ 系统     │  │ 检索管线  │  │ 能力调度中心     │  │   │
│  │  │ tool     │  │ 重写→混合 │  │ LLM/图片/语音   │  │   │
│  │  │ calling  │  │ →重排    │  │ Embedding       │  │   │
│  │  └──────────┘  └──────────┘  └────────┬─────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│                                          │              │
│         ┌────────────────────────────────┘              │
│         ▼                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ MySQL    │  │ Redis    │  │ LanceDB (向量库)      │  │
│  │ 持久化   │  │ 缓存     │  │ 本地嵌入存储          │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 对话完整链路

```
用户输入 → chatWithAIStream(services/ai.ts)
  ├─ 保存消息到 MySQL + 长期记忆(LanceDB)
  ├─ 检查 agentId → 加载角色扮演 / 默认模式
  ├─ 检查附件类型 → 多模态(图片/视频) / 纯文本+文档
  ├─ 事实性问题检测 → 注入搜索指令
  │
  ▼
agentStream(services/agent.ts)
  ├─ rolePlayStream(角色扮演)
  │  直调 LLM 流式 API，无工具，低延迟
  │
  └─ createChatAgent(默认奈克瑟模式)
      LangChain Agent + 8 种工具
      search_web / query_knowledge_base / recall_memory
      generate_image / create_pptx / create_docx
      convert_to_markdown / generate_code_pdf
      + MCP 工具(Playwright) + 文件工具 + 管理员工具
      │
      ▼
  Tool Calling 循环:
  LLM 返回 tool_call → 执行函数 → 结果回传 LLM → 生成回复
      │
      ▼
  SSE 事件流推给前端:
  tool_call → tool_result → content(逐字) → done
```

### RAG 检索管线

```
用户问题 → 追问检测 → 查询重写(LLM展开代词)
  → 向量检索(LanceDB, bge-small-zh-v1.5)
  → BM25 关键词混合(RRF 融合)
  → Small-to-Big 上下文扩展(避免分块割裂)
  → LLM 重排序(选出最相关 topK)
  → 注入 system prompt 作为参考资料
```

### AI 能力调度中心 (ProviderManager)

```
DB system_settings 表
  ↓ 读取 JSON 配置
ProviderManager.getLLMConfig() / getImageConfig()
  ↓
createLangChainModel()   → Agent 用
createAnthropicClient()  → 多模态对话用
createOpenAIClient()     → Embedding 用
chatStreamRaw()          → 流式对话(角色扮演)
chatCompletion()         → 单次补全(RAG 重写/重排)
generateImage()          → 图片生成
createEmbedding()        → 向量嵌入
transcribeAudio()        → 语音转写
```

**多供应商切换：** 配置存在 DB，用户可在管理页面动态切换供应商（修改 baseURL 即可），无需重启服务。支持 OpenAI 兼容格式和 Anthropic 格式双路线。

---

## 关键 Prompt 设计

### 默认 Agent System Prompt

奈克瑟 NEXUS 角色设定为"跨宇宙魔法情报员"，system prompt 包括：

- **身份定位**：数据之海的守护者，称呼用户为"指挥官"
- **信息来源标注规则**：搜索来源标 `[1][2]`、知识库标 `[📚知识库]`、记忆标 `[🧠记忆]`
- **信息准确性铁律**：事实性问题必须先调用 search_web，禁止凭训练数据编造
- **工具选择指南**：根据用户意图关键词匹配合适工具
- **时间敏感处理**：自动将当前日期加入时效性查询

### 角色扮演 System Prompt

用户自定义角色时，自动追加真人化回复指令：

- 自然口语化中文，禁止 Markdown 和 emoji
- 句子长短错落，不要像 AI 生成
- 禁止以"作为AI"、"作为一个助手"开头
- 不主动提及自己是 AI

### RAG 查询重写 Prompt

```
将以下用户问题改写为更具体、完整的检索查询。
去除指代词（如"它"、"这个"），补充隐含的上下文信息。
只输出改写后的句子，不要解释。
```

### RAG 重排序 Prompt

```
从以下检索结果中选出与问题最相关的N条。
只输出编号，用英文逗号分隔。
```

---

## Vibe Coding 思路

本项目采用 **Vibe Coding**（AI 辅助编程）方式开发，核心工具为 **Claude Code**：

### 开发流程

```
需求描述 → Claude Code 生成代码 → 人工审查 → 调试优化 → 迭代
   ↑                                                     │
   └─────────────────────────────────────────────────────┘
```

### 各模块实现方式

| 模块 | 实现方式 |
|------|----------|
| **后端骨架** | Claude Code 生成 Express + TypeScript 基础框架、路由结构、数据库模型 |
| **AI 对话管线** | 描述 OpenAI/Anthropic API 接入需求 → Claude 生成流式调用、SSE 处理、多模态支持 |
| **Agent 系统** | 描述 Tool Calling 需求 → Claude 搭建 LangChain Agent 框架、工具注册、事件流 |
| **RAG 管线** | 描述检索流程 → Claude 实现查询重写、向量检索、混合搜索、重排序 |
| **前端页面** | 描述 UI 需求 → Claude 生成 Vue 组件、Pinia Store、路由守卫 |
| **小程序端** | 描述跨端需求 → Claude 搭建 uni-app 页面、WebSocket 桥接 |
| **部署配置** | 描述部署环境 → Claude 生成 Nginx 配置、环境变量、启动脚本 |

### 核心原则

1. **架构先行**：先定好 ProviderManager 统一调度、Agent 双路径、RAG 5 阶段等核心设计，再逐块实现
2. **迭代验证**：每实现一个功能立即启动服务验证，发现问题即时反馈给 AI 修复
3. **人工把关**：AI 生成代码后人工 review 核心逻辑，特别是 API Key 安全、错误处理、边界情况
4. **渐进增强**：先跑通核心链路（文本对话），再逐步叠加图片、视频、RAG、聊天室等能力

---

## AI 调用逻辑

### 核心调用流程

```
┌─────────────────────────────────────────────────────────────┐
│                     ProviderManager                         │
│                                                             │
│  getLLMConfig()                                             │
│    ├─ 读 DB system_settings → 有? → 解析 JSON 配置           │
│    └─ 没有 → 读环境变量 .env 作为 fallback                    │
│                                                             │
│  createLangChainModel() → ChatOpenAI(baseURL + apiKey)      │
│  createAnthropicClient() → Anthropic(baseURL + apiKey)      │
│                                                             │
│  chatCompletion(messages, maxTokens)                        │
│    ├─ format === 'openai' → fetch /v1/chat/completions      │
│    └─ format === 'anthropic' → Anthropic SDK messages.create │
│                                                             │
│  chatStreamRaw(messages)                                    │
│    └─ fetch /v1/chat/completions { stream: true }           │
│       → 逐行解析 SSE data: {...} → yield content            │
└─────────────────────────────────────────────────────────────┘
```

### 配置优先级

```
数据库 system_settings 表
    ↑ 优先级高（管理页面写入）
环境变量 .env
    ↑ 首次部署 fallback
硬编码默认值 (config/index.ts)
    ↑ 兜底
```

### 流式输出格式 (SSE)

后端通过 Server-Sent Events 向前端推送 AI 回复：

```
event: message
data: {"type":"tool_call","tool":"search_web","args":{"query":"今日新闻"}}

data: {"type":"tool_result","tool":"search_web","result":"..."}

data: {"type":"content","content":"根据搜索结果显示，"}

data: {"type":"content","content":"今天的主要新闻有……"}

data: {"type":"done"}
```

前端通过 EventSource 或 fetch + ReadableStream 逐行解析渲染。

---

## 部署

### 本地开发部署

```bash
# 1. 克隆项目
git clone <repo-url>
cd aiconnent

# 2. 后端
cd server
cp .env.example .env          # 编辑 .env 配置数据库连接
npm install
npm run dev                   # http://localhost:3000 (API)
                              # ws://localhost:3001 (小程序 WebSocket)

# 3. 前端（Vite 代理模式）
cd client
npm install
npm run dev                   # http://localhost:5173
```

**Vite 代理配置** (`client/vite.config.ts`)：
- 前端开发服务器 `localhost:5173`
- `/api` 请求自动代理到 `localhost:3000`
- `/socket.io` WebSocket 自动代理到 `localhost:3000`
- 零跨域问题，本地开发无需配置 Nginx

### 服务器部署

#### 环境要求

- Linux Server（本文以 CentOS / Ubuntu 为例）
- Node.js >= 20
- MySQL >= 8.0
- Nginx
- 可选：Redis

#### 部署步骤

```bash
# 1. 项目上传到服务器
# 方式：git clone / scp / CI 部署

# 2. 后端构建与启动
cd server
cp .env.example .env
# 编辑 .env 修改为生产配置
npm install
npm run build                 # 编译 TypeScript → JavaScript

# 使用 PM2 进程管理
npm install -g pm2
pm2 start dist/app.js --name nexus-server
pm2 save
pm2 startup                   # 设置开机自启

# 3. 前端构建
cd client
npm install
npm run build                 # 输出到 dist/ 目录

# 4. 配置 Nginx 反向代理
```

#### Nginx 配置

```nginx
# /etc/nginx/conf.d/nexus.conf

server {
    listen 80;
    server_name your-domain.com;   # 替换为你的域名

    # 301 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书（阿里云 DNS 配置见下文）
    ssl_certificate /etc/nginx/ssl/your-domain.com.pem;
    ssl_certificate_key /etc/nginx/ssl/your-domain.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 前端静态文件
    root /path/to/client/dist;
    index index.html;

    # 前端路由（SPA 历史模式）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO WebSocket 代理
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 小程序 WebSocket（独立端口）
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 上传文件访问
    location /uploads/ {
        alias /path/to/server/uploads/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

验证配置并重启：

```bash
nginx -t
systemctl restart nginx
```

### DNS 解析与 SSL 证书（阿里云）

#### 1. DNS 解析

在阿里云 DNS（云解析 DNS）控制台添加记录：

| 记录类型 | 主机记录 | 记录值 |
|---------|---------|--------|
| A | @ | 服务器公网 IP |
| A | www | 服务器公网 IP |
| CNAME | api | your-domain.com（可选，API 子域名） |

#### 2. SSL 证书

**方式一：阿里云免费证书（推荐）**

```bash
# 1. 在阿里云控制台 → SSL证书 → 免费证书 → 申请
#    填写域名 your-domain.com

# 2. 下载 Nginx 类型的证书
#    得到 your-domain.com.pem 和 your-domain.com.key

# 3. 上传到服务器
scp your-domain.com.pem root@your-server:/etc/nginx/ssl/
scp your-domain.com.key root@your-server:/etc/nginx/ssl/

# 4. 配置 Nginx（见上方配置）
```

**方式二：acme.sh 自动申请（Let's Encrypt）**

```bash
# 安装 acme.sh
curl https://get.acme.sh | sh

# 申请证书（DNS 手动模式）
acme.sh --issue -d your-domain.com --dns dns_ali

# 安装到 Nginx
acme.sh --install-cert -d your-domain.com \
  --key-file /etc/nginx/ssl/your-domain.com.key \
  --fullchain-file /etc/nginx/ssl/your-domain.com.pem \
  --reloadcmd "systemctl reload nginx"
```

> **注意：** acme.sh 使用 DNS API 模式需要配置阿里云 RAM 子账号的 AccessKey，赋予 `AliyunDNSFullAccess` 权限。

### 服务器端口规划

| 端口 | 用途 | Nginx 代理 |
|------|------|-----------|
| 80 | HTTP | 301 跳转 HTTPS |
| 443 | HTTPS → 前端静态文件 + API | 是 |
| 3000 | 后端 API + Socket.IO | 是 |
| 3001 | 小程序 WebSocket | 是 |

### 数据库初始化

```sql
-- 使用 Navicat / DBeaver 或命令行
CREATE DATABASE ai_chat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 表结构自动创建：首次启动后端服务时
-- 项目使用 Model 层的 sync 机制自动建表
```

### 环境变量配置（生产环境）

```env
# server/.env 生产配置示例
DB_HOST=127.0.0.1
DB_USER=nexus
DB_PASSWORD=安全的数据库密码
DB_NAME=ai_chat

JWT_SECRET=替换为随机字符串

# AI 能力（管理页面可覆盖）
DASHSCOPE_API_KEY=sk-xxx
ARK_API_KEY=xxx

# 可选
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
TAVILY_API_KEY=xxx

# 生产环境
CLIENT_URL=https://your-domain.com
CORS_ORIGINS=https://your-domain.com
```

---

## 核心功能

- **多模态 AI 对话** — 文本、图片、视频输入，SSE 流式输出，Agent 工具调用
- **AI 文生图** — 多供应商配置，多种宽高比
- **知识库 RAG** — 文档上传 → 本地向量化 → 混合检索（向量 + BM25）→ LLM 重排
- **AI 角色扮演** — 自定义角色名称、头像、系统提示词、开场白
- **聊天室** — 多角色实时对话，LLM 调度 + @ 提及
- **语音交互** — 语音转写（Whisper 降级 API）+ TTS 合成（Edge-TTS）
- **MCP 协议** — Playwright 浏览器自动化
- **游客模式** — 未登录可体验 10 次对话，IP 限流
- **管理后台** — 用户管理、对话统计、能力配置、API Key 管理

## 环境变量

```env
# 数据库
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=ai_chat

# JWT
JWT_SECRET=your-secret-key

# LLM 默认配置（首次未保存能力配置时 fallback）
DASHSCOPE_API_KEY=sk-xxx
ARK_API_KEY=xxx

# 邮箱（注册验证码）
EMAIL_USER=xxx@qq.com
EMAIL_PASS=xxx

# 可选
TAVILY_API_KEY=xxx
REDIS_HOST=localhost
REDIS_PORT=6379
CLIENT_URL=http://localhost:5173
WS_PORT=3001
```

## API 概览

| 模块 | 前缀 | 关键端点 |
|------|------|----------|
| AI 对话 | `/api/ai` | `POST /chat`（SSE 流式）、`GET /sessions`、`GET /history` |
| AI 生图 | `/api/ai` | `POST /image` |
| 用户 | `/api/user` | `POST /register`、`POST /login`、`GET /info` |
| 知识库 | `/api/kb` | CRUD + `POST /:id/documents` + `POST /:id/search` |
| 角色 | `/api/agents` | CRUD |
| 聊天室 | `/api/rooms` | CRUD + 加入/发现 |
| 语音 | `/api/voice` | `/transcribe`、`/tts` |
| 管理后台 | `/api/admin` | 用户管理、对话统计、能力配置 |
| 上传 | `/api` | `/upload`、`/upload/avatar` |
