import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import config from '../config/index.js'
import { getTextFilesForGrep, globFromIndex, rebuildIndex, indexSummary, getIndexRoot } from './projectIndex.js'
import { getWorkspaceRoot, initFromConfig } from './workspaceState.js'

// Initialize workspace from config on module load
initFromConfig(config.workspace.root)

const uploadsRoot = path.resolve(process.cwd(), 'uploads')

/** 校验路径在沙箱内，越界抛错 */
function resolveSafe(targetPath: string): string {
  const wsRoot = getWorkspaceRoot()
  const resolved = path.resolve(targetPath.startsWith(uploadsRoot) ? targetPath : path.join(wsRoot, targetPath))
  const allowed = [wsRoot, uploadsRoot].some(root => resolved === root || resolved.startsWith(root + path.sep))
  if (!allowed) {
    throw new Error(`路径越界：${targetPath} 不在工作区范围内`)
  }
  return resolved
}

// 确保 workspace 目录存在
const wsRoot = getWorkspaceRoot()
if (!fs.existsSync(wsRoot)) {
  fs.mkdirSync(wsRoot, { recursive: true })
}

/** Build a concise diff summary showing changed lines with context */
function buildDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const maxLines = 20

  if (oldLines.length <= maxLines && newLines.length <= maxLines) {
    // Short text: show full line-by-line diff
    return oldLines.map((l, i) => `- ${l}\n+ ${newLines[i] || ''}`).join('\n')
  }

  // Long text: show first 5 + last 3 changed lines
  const head = oldLines.slice(0, 5).map((l, i) => `- ${l}\n+ ${newLines[i] || ''}`).join('\n')
  const tail = oldLines.slice(-3).map((l, i) => {
    const ni = newLines.length - 3 + i
    return `- ${l}\n+ ${newLines[ni] || ''}`
  }).join('\n')
  const skipped = oldLines.length - 8
  return `${head}\n... (省略 ${skipped} 行) ...\n${tail}`
}

// ── fs_read 文件读取缓存 ──
const readCache = new Map<string, string>()
const READ_CACHE_MAX = 200

function cacheKey(absPath: string, mtime: number): string {
  return `${absPath}@${mtime}`
}

function getCached(absPath: string, mtime: number): string | undefined {
  return readCache.get(cacheKey(absPath, mtime))
}

function setCached(absPath: string, mtime: number, content: string): void {
  if (readCache.size >= READ_CACHE_MAX) {
    const keys = [...readCache.keys()]
    for (let i = 0; i < 50 && i < keys.length; i++) readCache.delete(keys[i])
  }
  readCache.set(cacheKey(absPath, mtime), content)
}export const fsTools = [
  tool(async ({ filePath, offset, limit }: { filePath: string; offset?: number; limit?: number }) => {
    const wsRoot = getWorkspaceRoot()
    const abs = resolveSafe(filePath)
    if (!fs.existsSync(abs)) return `文件不存在：${filePath}（工作区：${wsRoot}）`
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(abs)
      return JSON.stringify({ type: 'directory', path: filePath, entries, count: entries.length, workspace: wsRoot })
    }

    // 检查缓存（基于 mtime）
    const mtime = stat.mtimeMs
    const cached = getCached(abs, mtime)
    let content = cached || ''
    if (!cached) {
      content = fs.readFileSync(abs, 'utf-8')
      setCached(abs, mtime, content)
    }

    const lines = content.split('\n')
    const totalLines = lines.length

    if (offset !== undefined || limit !== undefined) {
      const start = Math.max(0, (offset || 1) - 1) // 1-indexed
      const end = limit ? Math.min(start + limit, totalLines) : totalLines
      const slice = lines.slice(start, end).join('\n')
      return JSON.stringify({ type: 'file', path: filePath, content: slice, lineRange: `${start + 1}-${end}`, totalLines, size: stat.size, workspace: wsRoot })
    }

    const maxChars = 50000
    if (content.length > maxChars) {
      const truncated = content.slice(0, maxChars)
      return JSON.stringify({ type: 'file', path: filePath, content: truncated + '\n...(内容过长，已截断)', truncated: true, totalLines, size: stat.size, workspace: wsRoot })
    }
    return JSON.stringify({ type: 'file', path: filePath, content, totalLines, size: stat.size, modifiedAt: stat.mtime.toISOString(), workspace: wsRoot })
  }, {
    name: 'fs_read',
    description: '读取文件内容或列出目录。支持 offset/limit 分段读取大文件（行号从1开始）。返回文件内容、行数、大小等。',
    schema: z.object({
      filePath: z.string().describe('相对于工作区的文件或目录路径'),
      offset: z.number().optional().describe('起始行号（从1开始），用于分段读取大文件'),
      limit: z.number().optional().describe('读取行数，配合 offset 使用'),
    }),
  }),

  tool(async ({ filePath, content }: { filePath: string; content: string }) => {
    const abs = resolveSafe(filePath)
    const dir = path.dirname(abs)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(abs, content, 'utf-8')
    return `文件已写入：${filePath}（${content.length} 字符）`
  }, {
    name: 'fs_write',
    description: '创建或覆盖文件。会自动创建不存在的父目录。',
    schema: z.object({
      filePath: z.string().describe('相对于工作区的文件路径'),
      content: z.string().describe('要写入的内容'),
    }),
  }),

  tool(async ({ filePath }: { filePath: string }) => {
    const abs = resolveSafe(filePath)
    if (!fs.existsSync(abs)) return `文件不存在：${filePath}`
    fs.rmSync(abs, { recursive: true, force: true })
    return `已删除：${filePath}`
  }, {
    name: 'fs_delete',
    description: '删除文件或目录（递归删除目录内所有内容）。不可恢复。',
    schema: z.object({
      filePath: z.string().describe('要删除的文件或目录路径'),
    }),
  }),

  tool(async ({ filePath, recursive }: { filePath: string; recursive?: boolean }) => {
    const wsRoot = getWorkspaceRoot()
    const abs = resolveSafe(filePath)
    if (!fs.existsSync(abs)) return `路径不存在：${filePath}`
    if (!fs.statSync(abs).isDirectory()) return `不是目录：${filePath}`
    const walk = (dir: string, depth: number): any[] => {
      if (depth > 5) return []
      const entries = fs.readdirSync(dir)
      return entries.map(entry => {
        const full = path.join(dir, entry)
        const rel = path.relative(wsRoot, full).replace(/\\/g, '/')
        const stat = fs.statSync(full)
        if (stat.isDirectory()) {
          return { name: entry, type: 'directory', children: recursive ? walk(full, depth + 1) : undefined }
        }
        return { name: entry, type: 'file', size: stat.size, modifiedAt: stat.mtime.toISOString() }
      })
    }
    const tree = walk(abs, 0)
    return JSON.stringify({ path: filePath, total: tree.length, entries: tree })
  }, {
    name: 'fs_list',
    description: '列出目录下的所有文件和子目录，支持递归展开。',
    schema: z.object({
      filePath: z.string().describe('目录路径'),
      recursive: z.boolean().optional().describe('是否递归展开子目录（默认 false）'),
    }),
  }),

  tool(async ({ pattern, dirPath }: { pattern: string; dirPath?: string }) => {
    const wsRoot = getWorkspaceRoot()
    const searchDir = dirPath ? resolveSafe(dirPath) : wsRoot

    // Build regex once, fallback to literal substring search on invalid pattern
    let regex: RegExp | null = null
    try { regex = new RegExp(pattern, 'i') } catch { /* invalid regex, use literal */ }

    const candidates = getTextFilesForGrep(null, dirPath)
    const results: { file: string; line: number; content: string }[] = []

    for (const relPath of candidates) {
      if (results.length >= 200) break
      const full = path.join(wsRoot, relPath)
      try {
        const content = fs.readFileSync(full, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length && results.length < 200; i++) {
          const hit = regex
            ? regex.test(lines[i])
            : lines[i].toLowerCase().includes(pattern.toLowerCase())
          if (hit) {
            results.push({ file: relPath, line: i + 1, content: lines[i].trim().slice(0, 200) })
          }
        }
      } catch { /* permission denied, skip */ }
    }

    if (results.length >= 200) {
      return JSON.stringify({ matches: results, total: results.length, truncated: true, _note: '匹配过多，仅显示前200条，请缩小搜索范围' })
    }
    return JSON.stringify({ matches: results, total: results.length })
  }, {
    name: 'fs_grep',
    description: '在工作区文件中搜索文本（类似 grep）。使用预建索引快速定位文件，支持正则表达式(如 "export.*function")，无效正则自动降级为字面量搜索。跳过 node_modules/.git 等目录。返回文件路径、行号和匹配内容。',
    schema: z.object({
      pattern: z.string().describe('搜索模式，支持正则表达式，如 "export.*function" 或 "useState"'),
      dirPath: z.string().optional().describe('搜索目录，默认整个工作区'),
    }),
  }),

  tool(async ({ glob, dirPath }: { glob: string; dirPath?: string }) => {
    const wsRoot = getWorkspaceRoot()
    const files = globFromIndex(glob, dirPath)
    if (files.length > 500) {
      return JSON.stringify({ files: files.slice(0, 500), total: files.length, truncated: true })
    }
    return JSON.stringify({ files, total: files.length })
  }, {
    name: 'fs_glob',
    description: '按文件名模式查找文件（类似 glob）。使用预建索引，毫秒级返回。** 匹配任意路径，* 匹配任意文件名。示例: "**/*.ts" 查找所有 TypeScript 文件， "src/**/*.vue" 查找 src 下所有 Vue 文件。',
    schema: z.object({
      glob: z.string().describe('Glob 模式，如 "**/*.ts", "src/components/**/*.vue", "*.json"'),
      dirPath: z.string().optional().describe('搜索目录，默认整个工作区'),
    }),
  }),

  tool(async ({ filePath, oldText, newText }: { filePath: string; oldText: string; newText: string }) => {
    const abs = resolveSafe(filePath)
    if (!fs.existsSync(abs)) return `ERROR: 文件不存在：${filePath}`

    const content = fs.readFileSync(abs, 'utf-8')

    // Count occurrences
    let count = 0
    let pos = 0
    while ((pos = content.indexOf(oldText, pos)) !== -1) { count++; pos++ }

    if (count === 0) {
      // Try fuzzy match: trim whitespace and compare
      const normalizedContent = content.replace(/\r\n/g, '\n')
      const normalizedOld = oldText.replace(/\r\n/g, '\n')
      let fuzzyCount = 0
      let fuzzyPos = 0
      while ((fuzzyPos = normalizedContent.indexOf(normalizedOld, fuzzyPos)) !== -1) { fuzzyCount++; fuzzyPos++ }
      if (fuzzyCount === 0) {
        // Find closest match location for debugging
        const firstLine = oldText.split('\n')[0].trim()
        const lineIdx = content.split('\n').findIndex(l => l.includes(firstLine))
        const hint = lineIdx >= 0 ? `\n提示：第 ${lineIdx + 1} 行附近找到类似内容，请用 fs_read 确认准确文本。` : ''
        return `ERROR: 文件中未找到要替换的内容。请先用 fs_read 读取文件确认准确文本后重试。${hint}`
      }
      // Fuzzy match found — use normalized version
      const newContent = normalizedContent.replace(normalizedOld, newText.replace(/\r\n/g, '\n'))
      fs.writeFileSync(abs, newContent, 'utf-8')
      const diff = buildDiff(normalizedOld, newText.replace(/\r\n/g, '\n'))
      return `已修改 ${filePath}（已自动修正换行符）:\n${diff}`
    }

    if (count > 1) {
      return `ERROR: 找到 ${count} 处匹配，请提供更多上下文使匹配唯一（包含前后各 2-3 行代码）。`
    }

    const newContent = content.replace(oldText, newText)
    fs.writeFileSync(abs, newContent, 'utf-8')

    // Verify the write actually happened
    const verifyContent = fs.readFileSync(abs, 'utf-8')
    if (verifyContent === content) {
      return `ERROR: 文件写入后内容未变化，可能写入失败。`
    }

    const diff = buildDiff(oldText, newText)
    const lineDelta = newText.split('\n').length - oldText.split('\n').length
    const lineInfo = lineDelta > 0 ? ` (+${lineDelta} 行)` : lineDelta < 0 ? ` (${lineDelta} 行)` : ''
    return `已修改 ${filePath}${lineInfo}:\n${diff}`
  }, {
    name: 'fs_edit',
    description: `精确替换文件中的文本。必须先用 fs_read 确认要替换的准确文本（包括缩进、换行、引号），oldText 必须与文件中内容完全一致。如果返回 ERROR，说明匹配失败，必须重新 fs_read 确认内容后再试。`,
    schema: z.object({
      filePath: z.string().describe('要编辑的文件路径'),
      oldText: z.string().describe('要替换的原文（必须与文件中内容完全一致，包括缩进和换行）'),
      newText: z.string().describe('替换后的新文本'),
    }),
  }),

  tool(async () => {
    const summary = indexSummary()
    const root = getWorkspaceRoot()
    // Rebuild if stale
    if (getIndexRoot() !== root) {
      rebuildIndex(root)
    }
    return `工作区: ${root}\n${indexSummary()}`
  }, {
    name: 'fs_index',
    description: '获取项目文件索引概览：文件数量、大小、按扩展名分布统计（.ts, .vue, .json 等）。用于了解项目结构。',
    schema: z.object({}),
  }),

  tool(async ({ command }: { command: string }) => {
    const wsRoot = getWorkspaceRoot()
    const blocked = [/\brm\s+-rf\s+\//i, /\bdd\s+if=/i, /\b:(){ :|:& };:/, /\b>\/dev\/sda/i, /\bmkfs\./i, /\bformat\s+[A-Z]:/i]
    for (const p of blocked) {
      if (p.test(command)) return `命令被阻止（安全策略）: ${command}`
    }

    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
      const child = spawn(command, {
        cwd: wsRoot,
        shell,
        env: process.env,  // 不覆盖 HOME/USERPROFILE
        timeout: 60000,    // 60s，npm install 等需要更长时间
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

      child.on('close', (code) => {
        const out = (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).slice(0, 8000)
        if (code === 0) {
          resolve(out.trim() || '(命令执行完成，无输出)')
        } else {
          const msg = stderr || stdout || `退出码: ${code}`
          resolve(`命令执行失败 (退出码 ${code}): ${msg}`.slice(0, 3000))
        }
      })

      child.on('error', (err) => {
        resolve(`命令启动失败: ${err.message}`.slice(0, 3000))
      })
    })
  }, {
    name: 'exec',
    description: `在工作区目录执行命令并返回输出。支持编译、运行测试、安装依赖、git 操作等。命令在 ${process.platform === 'win32' ? 'PowerShell' : 'bash'} 中执行，超时 30 秒，输出截断至 8000 字符。危险命令(rm -rf /, dd, fork bomb等)会被拦截。`,
    schema: z.object({
      command: z.string().describe('要执行的 shell 命令，如 "npm test"、"npx tsx src/index.ts"、"git status"'),
    }),
  }),
]
