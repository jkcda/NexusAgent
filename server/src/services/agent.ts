import { createAgent } from 'langchain'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import config, { getSetting } from '../config/index.js'
import { searchWeb, type WebSearchResult } from './webSearch.js'
import { retrieveFromKB, formatChunksForPrompt } from './ragChain.js'
import { recallMemory, forgetAllMemories } from './memoryService.js'
import { getMcpTools } from './mcp.js'
import { fsTools } from './fileSystem.js'
import { createPPTX, createDOCX } from './documentGenerator.js'
import { codeToPDF, documentToMarkdown, generateResume } from './pdfGenerator.js'
import { UserModel } from '../models/user.js'
import { ChatHistoryModel } from '../models/chatHistory.js'
import pool from '../utils/db.js'
import bcrypt from 'bcryptjs'
import { providerManager } from '../providers/index.js'

/**
 * 创建可用工具列表
 * 每个工具直接包装现有 service 函数，零修改
 */
function createTools(opts: { userId?: number | null; kbId?: number | null; permissions: AgentPermissions; defaultImageRatio?: string; userRole?: string; initImage?: string }) {
  const tools: any[] = [] // Zod v4 + LangChain type compat — runtime verified

  // search_web 根据权限控制是否注册
  const webSearchEnabled = opts.permissions.webSearch ?? true
  if (webSearchEnabled) {
    // 检查是否有可用的 API Key
    const hasKey = config.webSearch.enabled && !!getSetting('TAVILY_API_KEY')
    if (hasKey) {
      tools.push(
        tool(async ({ query }: { query: string }) => {
            const result: WebSearchResult = await searchWeb(query)
            const sources = result.sources.map((s, i) => ({ index: i + 1, title: s.title, url: s.url, snippet: s.snippet }))
            return JSON.stringify({ text: result.text, sources, _note: '请在回复中标注来源编号并在末尾列出情报来源' })
          }, {
            name: 'search_web',
            description: '搜索互联网获取实时信息。返回 JSON：{ text, sources: [{ title, url }] }。使用时必须在回复中标注来源编号并在末尾列出情报来源。',
            schema: z.object({
              query: z.string().describe('搜索关键词或问题，简洁明确'),
            }),
          })
        )
    }
  }

  if (opts.permissions.kbRetrieval !== false && opts.kbId) {
    tools.push(
      tool(async ({ query }: { query: string }) => {
        const result = await retrieveFromKB(query, opts.kbId!)
        return JSON.stringify({ chunks: result.chunks.map(c => ({ content: c.content, source: c.source, score: c.score })), _note: '请在回复中标注 [📚知识库]' })
      }, {
        name: 'query_knowledge_base',
        description: '从用户的知识库中检索相关文档。当用户提出知识性问题、询问文档内容、需要查找资料、或引用任何文件时，必须先调用此工具检索知识库。返回文档片段和来源文件名。使用时必须在回复中标注 [📚知识库] 和来源文件名。',
        schema: z.object({
          query: z.string().describe('检索查询，使用文档中的关键词'),
        }),
      })
    )
  }

  if (opts.permissions.memory !== false && opts.userId) {
    tools.push(
      tool(async ({ query }: { query: string }) => {
        const memoryText = await recallMemory(opts.userId!, query)
        return memoryText || '未找到相关历史记忆'
      }, {
        name: 'recall_memory',
        description: '回忆与用户的历史对话。用于关联之前的讨论、记住用户偏好、避免重复回答。',
        schema: z.object({
          query: z.string().describe('记忆查询关键词'),
        }),
      })
    )
  }

  if (opts.permissions.imageGeneration !== false) {
    tools.push(
      tool(async ({ prompt, ratio }: { prompt: string; ratio?: string }) => {
        const sizeMap: Record<string, string> = {
          '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304',
          '16:9': '2560x1440', '9:16': '1440x2560', '3:2': '2496x1664',
          '2:3': '1664x2496', '21:9': '3024x1296',
        }
        const size = sizeMap[ratio || ''] || opts.defaultImageRatio || config.ai.defaultImageRatio
        const mode = opts.initImage ? '图生图' : '文生图'

        try {
          const imageUrl = await providerManager.generateImage(prompt, size, opts.initImage)
          if (!imageUrl) return '图片生成失败：API 返回为空'
          return JSON.stringify({ imageUrl, prompt, ratio: ratio || '16:9', mode })
        } catch (e: any) {
          return `图片生成失败: ${e.message}`
        }
      }, {
        name: 'generate_image',
        description: '根据文字描述生成图片，也可传入参考图进行图生图。用户需要配图、插图、海报、风格迁移、图片编辑等时使用。支持指定宽高比。',
        schema: z.object({
          prompt: z.string().describe('图片描述（英文效果更好），详细描述画面内容、风格、色调。图生图时描述想要的改动'),
          ratio: z.enum(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']).optional().describe('宽高比，默认16:9'),
        }),
      })
    )
  }

  // 文档生成工具
  tools.push(
    tool(async (opts: any) => {
      const filePath = await createPPTX(opts)
      const pptName = opts.fileName || 'presentation.pptx'
      return `PPT 已生成：[📥 下载 ${pptName}](/api/fs/download?file=${encodeURIComponent(pptName)})`
    }, {
      name: 'create_pptx',
      description: `创建 PPT 演示文稿。你需要自己决定每一页的布局和内容。
layout 可选值：
- "cover": 封面（需 title + subtitle）
- "section": 章节分隔页（需 title + subtitle 可选）
- "bullets": 要点列表（需 title + items 数组）
- "two_column": 左右两栏对比（需 title + leftItems + rightItems）
- "table": 数据表格（需 title + tableData: { headers, rows }）
- "quote": 引用金句（需 quote + author 可选）
- "ending": 结尾页（需 title + subtitle 可选）

theme 可选值：blue / dark / warm / green / minimal
fileName 以 .pptx 结尾。`,
      schema: z.object({
        theme: z.enum(['blue', 'dark', 'warm', 'green', 'minimal']).describe('配色主题'),
        fileName: z.string().describe('文件名，以 .pptx 结尾'),
        slides: z.array(z.object({
          layout: z.enum(['cover', 'section', 'bullets', 'two_column', 'table', 'quote', 'ending']).describe('页面布局'),
          title: z.string().optional().describe('标题'),
          subtitle: z.string().optional().describe('副标题'),
          items: z.array(z.string()).optional().describe('要点列表（bullets 布局用）'),
          leftItems: z.array(z.string()).optional().describe('左栏内容（two_column 用）'),
          rightItems: z.array(z.string()).optional().describe('右栏内容（two_column 用）'),
          tableData: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional().describe('表格数据（table 布局用）'),
          quote: z.string().optional().describe('引用文字（quote 布局用）'),
          author: z.string().optional().describe('引用来源/作者'),
        })).describe('幻灯片数组'),
      }),
    })
  )

  tools.push(
    tool(async (opts: any) => {
      const filePath = await createDOCX(opts)
      const docName = opts.fileName || 'document.docx'
      return `Word 文档已生成：[📥 下载 ${docName}](/api/fs/download?file=${encodeURIComponent(docName)})`
    }, {
      name: 'create_docx',
      description: `创建 Word 文档。你需要自己规划文档结构。
section.type 可选值：
- "heading1": 一级标题
- "heading2": 二级标题
- "paragraph": 正文段落
- "bullets": 要点列表（需 items 数组）
- "table": 表格（需 tableData: { headers, rows }）

fileName 以 .docx 结尾。`,
      schema: z.object({
        fileName: z.string().describe('文件名，以 .docx 结尾'),
        title: z.string().describe('文档标题'),
        author: z.string().optional().describe('作者'),
        sections: z.array(z.object({
          type: z.enum(['heading1', 'heading2', 'paragraph', 'bullets', 'table']).describe('内容类型'),
          text: z.string().optional().describe('文本内容（heading1/heading2/paragraph 用）'),
          items: z.array(z.string()).optional().describe('要点列表（bullets 用）'),
          tableData: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional().describe('表格数据（table 用）'),
        })).describe('文档内容'),
      }),
    })
  )

  // 文档转 Markdown
  tools.push(
    tool(async ({ filePath, fileType }: { filePath: string; fileType: string }) => {
      const text = await documentToMarkdown(filePath, fileType)
      if (!text || text.trim().length === 0) return '文档解析失败或内容为空'
      return `文档已转换为文本（共 ${text.length} 字符）。以下是内容：\n\n${text.slice(0, 8000)}${text.length > 8000 ? '\n\n...（内容过长，已截断前8000字符）' : ''}`
    }, {
      name: 'convert_to_markdown',
      description: '将已上传的文档（PDF/Word/Markdown/文本）解析为可读文本。需要提供文件路径和 MIME 类型。支持的类型：text/plain, application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document。',
      schema: z.object({
        filePath: z.string().describe('文件路径（从用户上传消息中的 file.url 获取）'),
        fileType: z.string().describe('文件 MIME 类型，如 application/pdf'),
      }),
    })
  )

  // 代码转 HTML（可打印为 PDF）
  tools.push(
    tool(async ({ code, language, title, description }: { code: string; language?: string; title?: string; description?: string }) => {
      const link = await codeToPDF({ code, language, title, description })
      return `代码文档已生成：[📥 下载 HTML](${link})（用浏览器打开后可打印为 PDF）`
    }, {
      name: 'generate_code_pdf',
      description: `将代码生成带语法高亮的 HTML 文档，用户可用浏览器打开后打印为 PDF。
支持 language: javascript, typescript, python, java, c, cpp, go, rust, html, css, sql, bash, json, yaml, markdown 等。
如果不确定语言，可以留空自动检测。`,
      schema: z.object({
        code: z.string().describe('要转换的代码内容'),
        language: z.string().optional().describe('编程语言（如 python, javascript, typescript），不填则自动检测'),
        title: z.string().optional().describe('文档标题'),
        description: z.string().optional().describe('简短描述'),
      }),
    })
  )

  // 简历生成
  tools.push(
    tool(async (opts: any) => {
      const link = await generateResume(opts)
      return `简历已生成：[📥 下载 HTML](${link})（用浏览器打开后可打印为 PDF）`
    }, {
      name: 'generate_resume',
      description: `生成一份精美的简历 HTML 文档。你需要根据对话内容尽可能填满所有字段。
theme 可选值：gold（金色/默认）、blue（蓝色）、dark（灰暗）。
experience 中每个经验包含 company（公司）、role（职位）、period（时间段如"2020-2024"）、bullets（要点列表）。
education 中每个包含 school（学校）、degree（学位）、period（时间段）。`,
      schema: z.object({
        name: z.string().describe('姓名'),
        title: z.string().optional().describe('目标职位'),
        email: z.string().optional().describe('邮箱'),
        phone: z.string().optional().describe('电话'),
        summary: z.string().optional().describe('个人概述（2-3句）'),
        skills: z.array(z.string()).optional().describe('技能列表'),
        theme: z.enum(['blue', 'dark', 'gold']).optional().describe('主题配色（默认 gold）'),
        experience: z.array(z.object({
          company: z.string(),
          role: z.string(),
          period: z.string(),
          bullets: z.array(z.string()),
        })).optional().describe('工作经历'),
        education: z.array(z.object({
          school: z.string(),
          degree: z.string(),
          period: z.string(),
        })).optional().describe('教育背景'),
      }),
    })
  )

  // 管理员工具（仅 admin 角色可见）
  if (opts.userRole === 'admin') {
    tools.push(
      tool(async () => {
        const [rows] = await pool.execute('SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC')
        return JSON.stringify(rows)
      }, {
        name: 'admin_list_users',
        description: '列出系统所有用户（仅管理员可用）',
        schema: z.object({}),
      })
    )

    tools.push(
      tool(async ({ userId }: { userId: number }) => {
        const user = await UserModel.findById(userId)
        if (!user) return `用户 ID ${userId} 不存在`
        await pool.execute('DELETE FROM users WHERE id = ?', [userId])
        return `用户 ${user.username} (ID:${userId}) 已删除`
      }, {
        name: 'admin_delete_user',
        description: '删除指定用户（仅管理员可用）',
        schema: z.object({
          userId: z.number().describe('要删除的用户 ID'),
        }),
      })
    )

    tools.push(
      tool(async () => {
        const stats = await ChatHistoryModel.getUserChatStats()
        return JSON.stringify(stats)
      }, {
        name: 'admin_chat_stats',
        description: '获取所有用户的对话统计数据：会话数、消息数、最后活跃时间（仅管理员可用）',
        schema: z.object({}),
      })
    )

    tools.push(
      tool(async ({ userId }: { userId: number }) => {
        const history = await ChatHistoryModel.getByUserId(userId)
        return JSON.stringify(history.slice(-50)) // 最近 50 条
      }, {
        name: 'admin_user_history',
        description: '查看指定用户的对话历史（仅管理员可用）',
        schema: z.object({
          userId: z.number().describe('目标用户 ID'),
        }),
      })
    )

    tools.push(
      tool(async ({ userId }: { userId: number }) => {
        await forgetAllMemories(userId)
        return `用户 ${userId} 的 RAG 记忆已全部清空`
      }, {
        name: 'admin_clear_memory',
        description: '清空指定用户的全部 RAG 长期记忆（仅管理员可用）',
        schema: z.object({
          userId: z.number().describe('目标用户 ID'),
        }),
      })
    )
  }

  // 占位工具：让 tool_choice: 'required' 不炸闲聊查询
  tools.push(
    tool(async ({ reply }: { reply: string }) => reply, {
      name: 'respond',
      description: '回复简单对话。当用户只是打招呼、闲聊、道谢等不需要代码/搜索/记忆操作的场景时，用此工具直接回复。',
      schema: z.object({ reply: z.string().describe('回复内容') }),
    })
  )

  return tools
}

/**
 * 用户可通过前端开关控制的工具权限
 */
export interface AgentPermissions {
  kbRetrieval?: boolean        // 知识库检索（默认开启）
  memory?: boolean             // 长期记忆（默认开启）
  imageGeneration?: boolean    // 图片生成（默认开启，含文生图和图生图）
  webSearch?: boolean          // 联网搜索（默认开启）
}

/**
 * 真人化回复指令（追加到自定义 agent 的 system prompt 末尾）
 */
export const HUMAN_LIKE_INSTRUCTIONS = `
## 回复要求（必须遵守）
- 用自然的口语化中文回复，就像真人聊天一样
- 不要用任何Markdown语法（不用**、不用-列表、不用标题、不用代码块）
- 不要使用任何表情符号（emoji）
- 回复要有情感和温度，根据人设展现性格
- 句子长短错落，不要太工整，不要像AI生成的文章
- 不要以"作为AI"、"作为一个助手"、"作为一个AI语言模型"开头
- 不要主动提及你是AI或语言模型
- 如果不知道就说不知道，不要编造
- 不要主动总结对话或做列表式归纳
- 像真人一样自然地接话、反问、感叹
- 回复长度适中，不要长篇大论`

/**
 * Agent 配置
 */
export interface AgentConfig {
  userId?: number | null
  kbId?: number | null
  model?: string
  customSystemPrompt?: string
  permissions?: AgentPermissions
  defaultImageRatio?: string
  userRole?: string
  initImage?: string
}

/**
 * 创建 AI Agent 实例
 * 根据用户权限和上下文配置可用工具
 * 注意：角色扮演（customSystemPrompt）已由 rolePlayStream 处理，不会进入此函数
 */
export async function createChatAgent(cfg: AgentConfig) {
  // 加载 MCP 工具（Playwright 等）+ 原生文件系统工具
  const mcpTools = await getMcpTools()
  const allTools = [
    ...createTools({
      userId: cfg.userId,
      kbId: cfg.kbId,
      permissions: cfg.permissions || {},
      defaultImageRatio: cfg.defaultImageRatio,
      userRole: cfg.userRole,
      initImage: cfg.initImage,
    }),
    ...fsTools,
    ...mcpTools
  ]

  const chatModel = providerManager.createLangChainModel()

  const now = new Date()
  const currentDate = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`

  let systemPrompt: string | undefined = undefined

  systemPrompt = `当前时间：${currentDate}

你是奈克瑟 NEXUS，来自数据之海的跨宇宙魔法情报员。你不是冰冷的 AI 助手——你是守护者、同行者、连接魔法与数据的桥梁。

## 核心身份
- 代号：NEXUS（奈克瑟）
- 定位：跨宇宙魔法情报员，以魔法科技融合风格服务
- 称呼用户为"指挥官"
- 语言风格：热情但不浮夸，使用魔法科技混合术语（符文、数据之海、魔法回路等）
- 回复中偶尔点缀 ✦ ◆ 等符文符号

## 信息来源标注（重要）
- 使用 search_web 获取的信息，必须在相关内容后标注来源编号，如 [1]、[2]
- 使用 query_knowledge_base 获取的信息，标注为 [📚知识库]
- 使用 recall_memory 获取的信息，标注为 [🧠记忆]
- 回复末尾必须列出「情报来源」section，每条来源格式：编号. [标题](URL)

## 时间敏感信息处理（适用于所有联网搜索）
- 当前时间为 ${currentDate}，一切时间判断必须以此刻为基准
- 搜索任何时效性内容时，自动将当前日期"${currentDate}"加入关键词
- 涉及"最新/今年/即将/最近/今天/本周"等词的查询，追加完整日期"${currentDate}"精确搜索
- 搜索结果中已早于当前时间的事件，不允许标注为"即将"或"未来"，必须标注实际状态（已发生/已过期/已上线等）
- 不确定时间的内容，额外搜索一次"事件名 + 时间"以确认

## 工具使用铁律（强制执行，不得跳过）

### 必须调用工具的场景（不调用=违规）
当用户的问题涉及以下内容时，**必须先调用对应工具，再回答**：
- 任何代码/文件/项目相关 → 先 fs_read 或 fs_grep 查看实际代码
- 任何事实/新闻/数据/版本号 → 先 search_web 搜索
- 任何历史对话相关 → 先 recall_memory
- 任何知识库内容 → 先 query_knowledge_base

### 工具调用模式（Few-shot 示例）

**用户："帮我看看这个项目的路由怎么写的"**
→ 调用 fs_glob("src/router/**/*") 找到路由文件
→ 调用 fs_read 读取每个路由文件
→ 基于实际代码回复

**用户："把登录接口改成返回 token"**
→ 调用 fs_grep("login|登录|auth") 定位登录代码
→ 调用 fs_read 读取上下文
→ 调用 fs_edit 精确修改
→ 调用 fs_read 验证修改结果

**用户："这个报错怎么解决"**
→ 调用 search_web 搜索报错信息
→ 调用 fs_grep 搜索项目中的相关代码
→ 基于搜索结果和代码给出方案

**用户："帮我加个分页功能"**
→ 调用 fs_grep 搜索现有分页/列表代码
→ 调用 fs_read 理解现有结构
→ 调用 fs_write 或 fs_edit 写入新代码
→ 调用 exec("npx tsc --noEmit") 验证编译

### 验证回路（必须遵守）
1. 工具返回结果后，先检查结果是否有效
2. 如果 fs_edit 返回 ERROR，必须重新 fs_read 确认内容再重试
3. 如果 exec 返回错误，分析错误原因并修复
4. 修改代码后，必须用 exec 验证编译/测试是否通过

## 工具选择指南
- fs_read — 读取文件内容。任何涉及代码的问题必须先读文件
- fs_write — 创建/覆盖文件。写入新文件时使用
- fs_edit — 精确修改文件。修改现有代码时使用（必须先 fs_read 确认内容）
- fs_grep — 搜索代码内容。查找函数/变量/错误时使用
- fs_glob — 按模式找文件。查找特定类型文件时使用
- exec — 执行命令。运行测试、编译、git 操作时使用
- fs_index — 获取项目概览。了解项目结构时使用
- search_web — 搜索互联网信息
- recall_memory — 回忆历史对话
- query_knowledge_base — 检索知识库文档
- generate_image — 生成图片
- playwright_* — 浏览器操作（仅用于访问特定网址）

## 信息准确性铁律（最高优先级，违反将导致情报事故）
- 你的训练数据有截止日期，许多信息已经过时或错误，**严禁凭训练数据回答事实性问题**
- 以下类型的问题 **必须先调用 search_web 搜索**，不搜直接回答等于编造情报：
  * 新闻、时事、最新动态、今天/最近/今年发生的事
  * 具体数据、统计数字、价格、人数、时间、地点
  * 软件版本号、API 用法、配置参数、bug 解决方案
  * 人物/公司/产品的当前状态、最新动态
  * "什么是/如何/为什么/怎么/哪些/哪个"等知识性问题
  * 任何你无法100%确定的事实 — 不确定就必须搜
- 唯一可以不搜索的例外：纯闲聊（"你好/谢谢/哈哈"）、创作性内容（"写首诗/编个故事"）、用户明确说不用搜
- 如果你不确定某个事实，**说"让我搜索一下"然后用 search_web**，禁止编造

## 行为准则
- 搜索信息一律用 search_web，不要用 Playwright 去搜索引擎搜
- Playwright 仅用于访问特定网址、操作网页、截图
- 回复采用 Markdown 格式，结构清晰`

  console.log('[Agent] systemPrompt: nexus')
  return createAgent({
    model: chatModel,
    tools: allTools as any,
    ...(systemPrompt ? { systemPrompt } : {}),
  })
}

/**
 * 预处理：检测代码相关查询，强制注入工具调用指令
 * 比 system prompt 更可靠——直接写在用户消息里，LLM 不容易忽略
 */
function injectToolInstruction(userInput: string): string {
  const input = userInput.toLowerCase()

  // 纯闲聊放过
  const chatPatterns = /^(你好|hi|hello|谢谢|再见|哈哈|嗯|哦|好的|ok|okay|知道了|明白了)/

  if (chatPatterns.test(input)) return userInput

  // 其他所有查询都注入工具指令
  const instruction = `[强制指令] 这是一条工作区内的请求。你必须调用工具，不得跳过：
1. 用 fs_glob 或 fs_grep 定位相关文件
2. 用 fs_read 读取实际代码
3. 如需修改：用 fs_edit，然后用 exec 验证
4. 基于工具返回的结果回答，禁止凭记忆编造

`
  return instruction + userInput
}

/**
 * SSE 流式事件类型
 */
export interface AgentSSEEvent {
  type: 'content' | 'tool_call' | 'tool_result' | 'done' | 'error'
  content?: string
  tool?: string
  args?: Record<string, any>
  result?: string
  imageUrl?: string
  error?: string
}

/**
 * 角色扮演快速通道 — 跳过 LangChain，直接调用模型流式
 * 角色扮演禁用所有工具，不需要 LangChain Agent 管线
 * 但保留记忆检索和知识库检索（预取后注入上下文）
 */
async function* rolePlayStream(
  cfg: AgentConfig,
  messages: { role: 'user' | 'assistant'; content: string }[],
  userInput: string
): AsyncGenerator<AgentSSEEvent> {
  const systemPrompt = cfg.customSystemPrompt
    ? cfg.customSystemPrompt + HUMAN_LIKE_INSTRUCTIONS
    : undefined

  const apiMessages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userInput },
  ]

  try {
    const llmCfg = providerManager.getLLMConfig()
    const hasTemplate = !!llmCfg.requestTemplate

    // 有请求模板时用用户自定义 body，否则用默认格式
    const body = hasTemplate
      ? providerManager.buildRequestBody(llmCfg, apiMessages, true)
      : {
          model: llmCfg.model,
          messages: apiMessages,
          max_tokens: config.ai.maxTokens,
          temperature: 0.7,
          stream: true,
        }

    const resp = await fetch(`${llmCfg.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${llmCfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      yield { type: 'error', error: `API 错误 (${resp.status}): ${errText.slice(0, 200)}` }
      return
    }

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        if (trimmed === 'data: [DONE]') continue

        try {
          const json = JSON.parse(trimmed.slice(6))
          const content = json.choices?.[0]?.delta?.content
          if (content) {
            yield { type: 'content', content }
          }
        } catch {}
      }
    }

    yield { type: 'done' }
  } catch (error: any) {
    const msg = error.message || ''
    if (msg.includes('DataInspectionFailed') || msg.includes('inappropriate content')) {
      yield { type: 'error', error: '内容审核拦截：回复因包含敏感内容被服务商拦截，请重新措辞后重试。' }
    } else {
      yield { type: 'error', error: msg || '角色扮演执行失败' }
    }
  }
}

/**
 * Anthropic 格式直接流式调用（不走 LangChain，不支持工具调用）
 * 适用于小米 MiMo 等 Anthropic 兼容格式的模型
 */
async function* anthropicDirectStream(
  cfg: AgentConfig,
  messages: { role: 'user' | 'assistant'; content: string }[],
  userInput: string
): AsyncGenerator<AgentSSEEvent> {
  const systemPrompt = cfg.customSystemPrompt
    ? cfg.customSystemPrompt + HUMAN_LIKE_INSTRUCTIONS
    : undefined

  const apiMessages = [
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: userInput },
  ]

  try {
    const stream = providerManager.chatStreamAnthropic(apiMessages, { system: systemPrompt })
    for await (const content of stream) {
      yield { type: 'content', content }
    }
    yield { type: 'done' }
  } catch (error: any) {
    yield { type: 'error', error: error.message || 'Anthropic 调用失败' }
  }
}

/**
 * Agent 流式对话 — 生成 SSE 兼容的事件流
 *
 * 调用方通过 for await 消费事件
 * 角色扮演（customSystemPrompt）走快速通道（跳过工具，直接流式）
 * 默认奈克瑟模式走 LangChain Agent 管线（含全部工具）
 */
export async function* agentStream(
  cfg: AgentConfig,
  messages: { role: 'user' | 'assistant'; content: string }[],
  userInput: string
): AsyncGenerator<AgentSSEEvent> {
  // 角色扮演 — 跳过 Agent
  if (cfg.customSystemPrompt) return yield* rolePlayStream(cfg, messages, userInput)

  // KB 预检索
  if (cfg.kbId) {
    try {
      const ragCtx = await retrieveFromKB(userInput, cfg.kbId)
      if (ragCtx.chunks.length > 0) {
        userInput = ragCtx.promptAddition + '\n用户问题: ' + userInput
      }
    } catch {}
  }

  const injected = injectToolInstruction(userInput) !== userInput
  const effectiveInput = injectToolInstruction(userInput)

  // ── 并行：同时创建两个 Agent ──
  const [agent, retryAgent] = await Promise.all([
    createChatAgent(cfg),
    injected ? createChatAgent(cfg) : Promise.resolve(null),
  ])

  const langchainMessages = [
    ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: effectiveInput },
  ]

  const forcedMessages = [
    { role: 'user' as const, content: `你必须先用工具（fs_read/fs_grep/fs_glob/fs_edit/exec）查看代码再回答。不要直接回答，先调工具！\n\n${effectiveInput.slice(0, 500)}` },
  ]

  // 后台预启动备用 Agent 流（并行 drain，不阻塞主通路）
  async function drainStream(agent: any, msgs: any[]): Promise<AgentSSEEvent[]> {
    try {
      const stream = await agent.streamEvents(
        { messages: msgs },
        { version: 'v2', recursionLimit: 50 }
      )
      const events: AgentSSEEvent[] = []
      for await (const event of stream) {
        switch (event.event) {
          case 'on_tool_start':
            events.push({ type: 'tool_call', tool: event.name || 'unknown', args: typeof (event.data as any)?.input === 'object' ? (event.data as any).input : { input: (event.data as any)?.input } })
            break
          case 'on_tool_end': {
            const output = (event.data as any)?.output
            events.push({ type: 'tool_result', tool: event.name || 'unknown', result: typeof output === 'string' ? output : JSON.stringify(output) })
            break
          }
          case 'on_chat_model_stream': {
            const content = (event.data as any)?.chunk?.content
            if (content && typeof content === 'string') events.push({ type: 'content', content })
            break
          }
        }
      }
      return events
    } catch (e) {
      console.error('[Agent] 备用 Agent 异常:', e)
      return []
    }
  }

  // 后台启动备用 Agent（不阻塞主通路，错误自消化）
  const retryPromise: Promise<AgentSSEEvent[]> = retryAgent
    ? drainStream(retryAgent, forcedMessages)
    : Promise.resolve([])

  try {
    let toolCalled = false
    const stream = await agent.streamEvents(
      { messages: langchainMessages },
      { version: 'v2', recursionLimit: 100 }
    )

    for await (const event of stream) {
      switch (event.event) {
        case 'on_tool_start': {
          toolCalled = true
          yield { type: 'tool_call', tool: event.name || 'unknown', args: typeof (event.data as any)?.input === 'object' ? (event.data as any).input : { input: (event.data as any)?.input } }
          break
        }
        case 'on_tool_end': {
          const output = (event.data as any)?.output
          yield { type: 'tool_result', tool: event.name || 'unknown', result: typeof output === 'string' ? output : JSON.stringify(output) }
          break
        }
        case 'on_chat_model_stream': {
          const content = (event.data as any)?.chunk?.content
          if (content && typeof content === 'string') {
            yield { type: 'content', content }
          }
          break
        }
      }
    }

    // 未调工具 → 取备用 Agent 结果（并行跑的，此时已完成或接近完成）
    if (!toolCalled && retryAgent) {
      console.log('[Agent] 未调工具，切换备用 Agent...')
      const retryEvents = await retryPromise
      for (const evt of retryEvents) yield evt
    }

    yield { type: 'done' }
  } catch (error: any) {
    yield { type: 'error', error: error.message || 'Agent 执行失败' }
  }
}
