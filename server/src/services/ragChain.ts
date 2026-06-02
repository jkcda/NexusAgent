import config from '../config/index.js'
import { searchInKB } from './knowledgeBase.js'
import { hybridFuse } from './hybridSearch.js'
import { getAdjacentChunks } from './vectorStore.js'
import { cacheGet, cacheSet, hashKey } from './cache.js'
import type { Document } from '@langchain/core/documents'
import type { HybridCandidate } from './hybridSearch.js'
import type { SearchResult } from './knowledgeBase.js'
import { providerManager } from '../providers/index.js'
import { rerankLocally } from './reranker.js'
import type { RerankCandidate } from './reranker.js'

export interface RetrievedChunk {
  content: string
  source: string
  score: number
}

export interface RAGContext {
  chunks: RetrievedChunk[]
  promptAddition: string
}

// ============================================================
// 阶段 1：查询重写
// ============================================================

const PRONOUN_PATTERN = /它|这个|那个|这些|那些|他|她|他们|她们|这|那|其|该/
const SHORT_QUERY_THRESHOLD = 6 // 极短查询尝试补全

function needsRewrite(query: string): boolean {
  if (!config.rag.enableQueryRewrite) return false
  if (query.length > config.rag.queryRewriteMinLen && !PRONOUN_PATTERN.test(query)) return false
  return true
}

async function rewriteQuery(query: string, context?: string): Promise<string> {
  if (!needsRewrite(query)) return query

  // LLM 改写被关闭时，规则处理即可
  if (!config.rag.enableLLMQueryRewrite) {
    const trimmed = query.replace(PRONOUN_PATTERN, '').trim()
    return trimmed.length >= SHORT_QUERY_THRESHOLD ? trimmed : query
  }

  try {
    const contextBlock = context
      ? `对话上下文:\n${context.slice(-2000)}\n\n`
      : ''
    const rewritten = (await providerManager.chatCompletion([{
      role: 'user',
      content: `${contextBlock}将以下用户问题改写为更具体、完整的检索查询。去除指代词（如"它"、"这个"），补充隐含的上下文信息。只输出改写后的句子，不要解释。

用户问题: ${query}
改写后的查询:`
    }], 200)).trim()
    if (rewritten && rewritten !== query) {
      console.log(`[RAG] 查询重写: "${query}" → "${rewritten}"`)
      return rewritten
    }
  } catch (err: any) {
    console.warn(`[RAG] 查询重写失败: ${err.message}`)
  }
  return query
}

// ============================================================
// 阶段 2.5：小窗口 → 大窗口上下文扩展（Small-to-Big）
// ============================================================

interface ChunkWindow {
  content: string
  source: string
  score: number       // 原始匹配块的最佳分数
  mergedFrom: number  // 合并了多少原始匹配块
}

async function expandToContextWindow(
  results: SearchResult[],
  kbTableName: string
): Promise<ChunkWindow[]> {
  if (!config.rag.enableSmallToBig || results.length === 0) {
    return results.map(r => ({
      content: r.content,
      source: r.source,
      score: r.score,
      mergedFrom: 1
    }))
  }

  const { windowBefore, windowAfter, maxExpandedChars } = config.rag

  // 按 (docId, chunkIndex) 分组去重，记录每个匹配块
  const matches = new Map<string, { docId: number; chunkIndex: number; source: string; score: number }>()
  for (const r of results) {
    const key = `${r.docId}_${r.chunkIndex}`
    const existing = matches.get(key)
    if (!existing || r.score > existing.score) {
      matches.set(key, { docId: r.docId, chunkIndex: r.chunkIndex, source: r.source, score: r.score })
    }
  }

  // 对每个匹配块，获取周围块的文本
  const expansions = await Promise.all(
    Array.from(matches.values()).map(async (m) => {
      try {
        const adjacent = await getAdjacentChunks(
          kbTableName, m.docId, m.chunkIndex, windowBefore, windowAfter
        )
        return { match: m, adjacent }
      } catch {
        return { match: m, adjacent: [] }
      }
    })
  )

  // 合并重叠窗口：同文档且窗口有交集的合并
  const docGroups = new Map<number, { anchor: number; range: [number, number]; sources: string[]; bestScore: number; count: number }[]>()
  for (const { match, adjacent } of expansions) {
    const range: [number, number] = [
      Math.min(match.chunkIndex - windowBefore, adjacent.length > 0 ? adjacent[0].chunkIndex : match.chunkIndex),
      Math.max(match.chunkIndex + windowAfter, adjacent.length > 0 ? adjacent[adjacent.length - 1].chunkIndex : match.chunkIndex)
    ]
    const group = docGroups.get(match.docId) || []
    // 检查是否与已有窗口重叠
    let merged = false
    for (const g of group) {
      if (range[0] <= g.range[1] && range[1] >= g.range[0]) {
        g.range[0] = Math.min(g.range[0], range[0])
        g.range[1] = Math.max(g.range[1], range[1])
        g.sources.push(match.source)
        g.bestScore = Math.max(g.bestScore, match.score)
        g.count++
        merged = true
        break
      }
    }
    if (!merged) {
      group.push({
        anchor: match.chunkIndex,
        range,
        sources: [match.source],
        bestScore: match.score,
        count: 1
      })
    }
    docGroups.set(match.docId, group)
  }

  // 对每个窗口，收集分块文本并拼接
  const windows: ChunkWindow[] = []
  for (const [docId, groups] of docGroups) {
    for (const g of groups) {
      try {
        const allChunks = await getAdjacentChunks(
          kbTableName, docId, g.anchor, g.anchor - g.range[0], g.range[1] - g.anchor
        )
        let mergedText = allChunks.map(c => c.text).join('\n')
        if (mergedText.length > maxExpandedChars) {
          mergedText = mergedText.slice(0, maxExpandedChars) + '…'
        }
        windows.push({
          content: mergedText,
          source: g.sources[0],
          score: g.bestScore,
          mergedFrom: g.count
        })
      } catch {
        // fallback: 用原始匹配内容
        const orig = results.find(r => r.docId === docId)
        if (orig) {
          windows.push({ content: orig.content, source: orig.source, score: orig.score, mergedFrom: 1 })
        }
      }
    }
  }

  if (windows.length > 0) {
    console.log(`[RAG] Small-to-Big: ${results.length}个匹配块 → ${windows.length}个上下文窗口`)
  }
  return windows
}

// ============================================================
// 阶段 3：重排序（本地 Reranker 优先，LLM 兜底）
// ============================================================

async function rerankWithLLM(
  query: string,
  candidates: RerankCandidate[],
  topK: number
): Promise<RerankCandidate[]> {
  if (candidates.length <= topK) return candidates
  if (!config.rag.enableRerank) return candidates.slice(0, topK)

  try {
    const items = candidates.map((c, i) =>
      `[${i}] 来源:${c.source} 分:${c.score.toFixed(3)}\n${c.content.slice(0, 400)}`
    ).join('\n\n')

    const text = (await providerManager.chatCompletion([{
      role: 'user',
      content: `从以下检索结果中选出与问题最相关的${topK}条。只输出编号，用英文逗号分隔，如: 3,7,1,5

问题: ${query}

检索结果:
${items}

最相关${topK}条编号:`
    }], 80)).trim()
    const indices = text
      .split(/[,，\s]+/)
      .map((s: string) => parseInt(s, 10))
      .filter((n: number) => !isNaN(n) && n >= 0 && n < candidates.length)
      .slice(0, topK)

    const selected = indices.map((i: number) => candidates[i]).filter(Boolean)
    if (selected.length > 0) {
      console.log(`[RAG] LLM重排序: ${candidates.length}条 → ${selected.length}条`)
      return selected
    }
  } catch (err: any) {
    console.warn(`[RAG] 重排序失败: ${err.message}`)
  }

  return candidates.slice(0, topK)
}

async function rerankCandidates(
  query: string,
  candidates: RerankCandidate[],
  topK: number
): Promise<RerankCandidate[]> {
  if (candidates.length === 0) return []

  if (config.rag.enableRerank && candidates.length > topK) {
    const localResult = await rerankLocally(query, candidates, topK)
    if (localResult) return localResult
    return rerankWithLLM(query, candidates, topK)
  }

  return candidates.slice(0, topK)
}

// ============================================================
// 追问检测
// ============================================================

// 纯追问：不需要检索，直接让 LLM 继续
const PURE_CONTINUATION = /^(还有呢|继续说|然后呢|接着呢|继续|还有吗|然后|接下来|然后呢？|之后呢|再然后|and then|what else|go on)[\s。.。]?$/i

// 引用型追问：引用之前的结果，可复用缓存
const REFERENCE_FOLLOWUP = /^(那)?第[一二三四五六七八九\d]+[个条]|上面|前面|刚才|之前|那个|这个|它|这些|那些|你说|你提到/

// 新问题信号：长句子或明显转话题
const NEW_TOPIC = /^(新建|创建|帮我|怎么|如何|什么|解释|介绍一下|分析|什么是|为什么|区别|对比)/

interface FollowUpDecision {
  isFollowUp: boolean
  action: 'skip' | 'reuse_cache' | 'full_retrieval'
}

function detectFollowUp(query: string): FollowUpDecision {
  const trimmed = query.trim()

  // 纯追问：跳过检索，让模型直接继续
  if (PURE_CONTINUATION.test(trimmed) && trimmed.length <= 10) {
    return { isFollowUp: true, action: 'skip' }
  }

  // 引用型追问 + 短查询：复用缓存
  if (REFERENCE_FOLLOWUP.test(trimmed) && trimmed.length <= 25) {
    return { isFollowUp: true, action: 'reuse_cache' }
  }

  // 长查询或明确新话题：完整检索
  if (trimmed.length > 30 || NEW_TOPIC.test(trimmed)) {
    return { isFollowUp: false, action: 'full_retrieval' }
  }

  // 默认：完整检索
  return { isFollowUp: false, action: 'full_retrieval' }
}

// ============================================================
// 元数据过滤
// ============================================================

export interface SearchFilters {
  fileType?: string[]      // 如 ['pdf', 'docx']
  dateFrom?: string         // ISO 日期字符串
  dateTo?: string
  docIds?: number[]         // 限定文档 ID 范围
}

// ============================================================
// 会话级检索缓存（用于追问复用）
// ============================================================

const sessionRetrievalCache = new Map<string, RAGContext>()

export function clearSessionCache(sessionId: string) {
  sessionRetrievalCache.delete(sessionId)
}

// ============================================================
// 主检索管线
//   rewriteQuery → vectorSearch → hybridFuse → smallToBig → rerank → topK
// ============================================================

export async function retrieveFromKB(
  query: string,
  kbId: number,
  context?: string,
  topK: number = config.rag.topK,
  filters?: SearchFilters,
  sessionId?: string
): Promise<RAGContext> {
  // 追问检测
  if (sessionId) {
    const followUp = detectFollowUp(query)
    if (followUp.action === 'skip') {
      return { chunks: [], promptAddition: '' }
    }
    if (followUp.action === 'reuse_cache') {
      const cached = sessionRetrievalCache.get(sessionId)
      if (cached) {
        console.log('[RAG] 追问检测 → 复用缓存检索结果')
        return cached
      }
    }
  }

  // 阶段 1：查询重写
  const rewrittenQuery = await rewriteQuery(query, context)

  // 缓存检查
  const filterHash = filters ? hashKey(JSON.stringify(filters)) : ''
  const cacheKey = `rag:${kbId}:${hashKey(rewrittenQuery)}:${filterHash}`
  const cached = await cacheGet<RAGContext>(cacheKey)
  if (cached) {
    if (sessionId) sessionRetrievalCache.set(sessionId, cached)
    return cached
  }

  // 阶段 2a：向量检索
  const useAdvanced = config.rag.enableHybridSearch || config.rag.enableRerank
  const retrievalK = useAdvanced ? config.rag.retrievalTopK : topK
  let rawResults = await searchInKB(kbId, rewrittenQuery, retrievalK)

  // 元数据过滤：日期范围转换为 doc_id 列表
  if (filters && (filters.dateFrom || filters.dateTo)) {
    try {
      const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null
      const dateTo = filters.dateTo ? new Date(filters.dateTo) : null
      const { KbDocumentModel } = await import('../models/kbDocument.js')
      const allDocs = await KbDocumentModel.findByKbId(kbId)
      const matchingIds = allDocs
        .filter(d => {
          if (dateFrom && new Date(d.created_at) < dateFrom) return false
          if (dateTo && new Date(d.created_at) > dateTo) return false
          return true
        })
        .map(d => d.id)
      if (filters.docIds) {
        const existing = new Set(filters.docIds)
        filters = { ...filters, docIds: matchingIds.filter(id => existing.has(id)) }
      } else {
        filters = { ...filters, docIds: matchingIds }
      }
    } catch (err: any) {
      console.warn(`[RAG] 日期过滤失败: ${err.message}`)
    }
  }
  if (filters) {
    if (filters.fileType && filters.fileType.length > 0) {
      rawResults = rawResults.filter(r => {
        const ext = r.source.split('.').pop()?.toLowerCase()
        return ext && filters.fileType!.includes(ext)
      })
    }
    if (filters.docIds && filters.docIds.length > 0) {
      const idSet = new Set(filters.docIds)
      rawResults = rawResults.filter(r => idSet.has(r.docId))
    }
  }

  if (rawResults.length === 0) {
    return { chunks: [], promptAddition: '' }
  }

  // 获取知识库表名（用于 Small-to-Big）
  let kbTableName = ''
  if (config.rag.enableSmallToBig) {
    const { getKnowledgeBase } = await import('./knowledgeBase.js')
    const kb = await getKnowledgeBase(kbId)
    if (kb) kbTableName = (kb as any).lancedb_table_name || ''
  }

  // 阶段 2b：混合检索
  let fusedResults: (HybridCandidate & { fusedScore: number; docId: number; chunkIndex: number })[]

  if (config.rag.enableHybridSearch && rawResults.length > 1) {
    const fuseOutput = hybridFuse(rewrittenQuery, rawResults, config.rag.rerankTopK)
    fusedResults = fuseOutput.map(f => ({
      content: f.content,
      source: f.source,
      score: f.vectorScore,
      fusedScore: f.fusedScore,
      docId: 0,
      chunkIndex: 0
    }))
    // 恢复 docId/chunkIndex（hybridFuse 不保留这些）
    for (const fr of fusedResults) {
      const orig = rawResults.find(r => r.content === fr.content)
      if (orig) {
        fr.docId = orig.docId
        fr.chunkIndex = orig.chunkIndex
      }
    }
  } else {
    fusedResults = rawResults
      .filter(r => r.score >= config.rag.similarityThreshold)
      .map(r => ({
        content: r.content,
        source: r.source,
        score: r.score,
        fusedScore: r.score,
        docId: r.docId,
        chunkIndex: r.chunkIndex
      }))
  }

  // 阶段 2.5：Small-to-Big 上下文窗口扩展
  let expandedResults: (HybridCandidate & { fusedScore: number })[]
  if (config.rag.enableSmallToBig && kbTableName) {
    const toExpand: SearchResult[] = fusedResults.map(f => ({
      content: f.content,
      source: f.source,
      score: f.fusedScore,
      docId: f.docId,
      chunkIndex: f.chunkIndex
    }))
    const windows = await expandToContextWindow(toExpand, kbTableName)
    expandedResults = windows.map(w => ({
      content: w.content,
      source: w.source,
      score: w.score,
      fusedScore: w.score
    }))
  } else {
    expandedResults = fusedResults
  }

  // 阶段 3：重排序（本地 Reranker 优先，LLM 兜底）
  const rankCandidates: RerankCandidate[] = expandedResults.map((r, i) => ({
    content: r.content,
    source: r.source,
    score: r.fusedScore,
    index: i
  }))
  const reranked = await rerankCandidates(rewrittenQuery, rankCandidates, topK)

  const chunks: RetrievedChunk[] = reranked.map(r => ({
    content: r.content,
    source: r.source,
    score: r.score
  }))

  const promptAddition = formatChunksForPrompt(chunks)
  const result: RAGContext = { chunks, promptAddition }

  // 缓存结果
  await cacheSet(cacheKey, result, config.redis.ttl.ragResult)
  if (sessionId) sessionRetrievalCache.set(sessionId, result)

  return result
}

// ============================================================
// 多知识库联合检索
// ============================================================

export async function searchAcrossKBs(
  query: string,
  kbIds: number[],
  topK: number = config.rag.topK
): Promise<RAGContext> {
  if (kbIds.length === 0) return { chunks: [], promptAddition: '' }

  // 并行检索所有知识库
  const allResults = await Promise.all(
    kbIds.map(async (kbId) => {
      try {
        const results = await searchInKB(kbId, query, config.rag.retrievalTopK)
        return results.map(r => ({ ...r, kbId }))
      } catch {
        return []
      }
    })
  )

  const flat = allResults.flat()
  if (flat.length === 0) return { chunks: [], promptAddition: '' }

  console.log(`[RAG] 多库联合检索: ${kbIds.length}个KB → ${flat.length}条原始结果`)

  // 混合检索 + 重排序（与单库管线一致，但少了 Small-to-Big）
  let fused: (HybridCandidate & { fusedScore: number })[]

  if (config.rag.enableHybridSearch && flat.length > 1) {
    const fuseOutput = hybridFuse(query, flat, config.rag.rerankTopK)
    fused = fuseOutput.map(f => ({
      content: f.content,
      source: f.source,
      score: f.vectorScore,
      fusedScore: f.fusedScore
    }))
  } else {
    fused = flat.map(r => ({
      content: r.content,
      source: r.source,
      score: r.score,
      fusedScore: r.score
    }))
  }

  const candidates: RerankCandidate[] = fused.map((r, i) => ({
    content: r.content,
    source: r.source,
    score: r.fusedScore,
    index: i
  }))

  const reranked = await rerankCandidates(query, candidates, topK)
  const chunks: RetrievedChunk[] = reranked.map(r => ({
    content: r.content,
    source: r.source,
    score: r.score
  }))

  return { chunks, promptAddition: formatChunksForPrompt(chunks) }
}

export async function retrieveFromFileChunks(
  query: string,
  fileChunks: Document[],
  topK: number = config.rag.topK
): Promise<RAGContext> {
  if (fileChunks.length === 0) {
    return { chunks: [], promptAddition: '' }
  }

  const queryLower = query.toLowerCase()
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 0)

  const candidates: HybridCandidate[] = fileChunks.map(doc => {
    const contentLower = doc.pageContent.toLowerCase()
    let hits = 0
    for (const term of queryTerms) {
      if (contentLower.includes(term)) hits++
    }
    const score = hits / Math.max(queryTerms.length, 1)
    return {
      content: doc.pageContent,
      source: (doc.metadata.source as string) || (doc.metadata.filename as string) || 'unknown',
      score
    }
  })

  let chunks: RetrievedChunk[]

  if (config.rag.enableHybridSearch && fileChunks.length > topK) {
    const fused = hybridFuse(query, candidates, topK)
    chunks = fused.map(f => ({
      content: f.content,
      source: f.source,
      score: f.fusedScore
    }))
  } else {
    candidates.sort((a, b) => b.score - a.score)
    const top = candidates.slice(0, topK).filter(c => c.score > 0)
    chunks = top.map(c => ({
      content: c.content,
      source: c.source,
      score: c.score
    }))
  }

  return { chunks, promptAddition: formatChunksForPrompt(chunks) }
}

export function formatChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return ''

  return '\n\n--- 以下是与当前问题相关的参考资料 ---\n' +
    chunks.map((c, i) =>
      `[参考资料 ${i + 1} 来源: ${c.source}]\n${c.content}`
    ).join('\n\n') +
    '\n--- 参考资料结束 ---\n' +
    '请根据以上参考资料回答用户问题。如果参考资料不足以回答问题，请如实说明。\n'
}
