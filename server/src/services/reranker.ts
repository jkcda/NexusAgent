/**
 * 本地 Cross-Encoder Reranker
 * 使用 @xenova/transformers 加载 bge-reranker-base，
 * 对 (query, chunk) 对做相关性打分。失败时降级为 null，
 * 由调用方（ragChain）回退到 LLM 重排序。
 */
import os from 'os'
import { getSetting } from '../config/index.js'

let _reranker: any = null
let _rerankerLoading = false
let _disabled = false

const MODEL = 'Xenova/bge-reranker-base'

function hasEnoughMemory(): boolean {
  try {
    const raw = getSetting('CAPABILITY_RERANK')
    if (raw) {
      const cfg = JSON.parse(raw)
      if (cfg.forceAPI) {
        console.log('[Reranker] forceAPI=true，跳过本地模型')
        return false
      }
    }
  } catch {}

  const freeMem = Math.round(os.freemem() / (1024 * 1024))
  const cpuCount = os.cpus().length
  const minFreeMem = cpuCount <= 2 ? 1200 : 800
  return freeMem >= minFreeMem
}

async function getReranker() {
  if (_reranker) return _reranker
  if (_disabled) return null

  if (!hasEnoughMemory()) {
    console.warn('[Reranker] 服务器资源不足，禁用本地 Reranker，使用 LLM 兜底')
    _disabled = true
    return null
  }

  if (_rerankerLoading) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      if (_reranker) return _reranker
      if (_disabled) return null
    }
    return null
  }

  _rerankerLoading = true
  try {
    const { pipeline, env } = await import('@xenova/transformers')
    env.remoteHost = 'https://hf-mirror.com/'
    env.allowLocalModels = false
    // Cross-encoder reranker: 输入 (query, passage) 对，输出相关性分数
    _reranker = await pipeline('text-classification', MODEL)
    return _reranker
  } catch (e: any) {
    _disabled = true
    console.warn('[Reranker] 模型加载失败，降级为 LLM 重排序:', e.message)
    return null
  } finally {
    _rerankerLoading = false
  }
}

/** 预加载（启动时调用） */
export async function preloadReranker(): Promise<void> {
  try {
    await getReranker()
  } catch {}
}

export interface RerankCandidate {
  content: string
  source: string
  score: number
  index: number
}

/**
 * 本地 rerank：对每个候选，计算与 query 的相关性分，降序取 topK
 * 返回 null 表示不可用，调用方应回退到 LLM rerank
 */
export async function rerankLocally(
  query: string,
  candidates: RerankCandidate[],
  topK: number,
  timeoutMs: number = 8000
): Promise<RerankCandidate[] | null> {
  const pipe = await getReranker()
  if (!pipe) return null

  try {
    // 超时保护：超过 8 秒降级到 LLM
    const result = await Promise.race([
      doRerank(pipe, query, candidates, topK),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
      ),
    ])
    return result
  } catch (e: any) {
    if (e.message === 'TIMEOUT') {
      console.warn(`[Reranker] 本地重排序超时(${timeoutMs}ms)，降级为 LLM`)
    } else {
      console.warn('[Reranker] 推理失败，降级为 LLM 重排序:', e.message)
    }
    return null
  }
}

async function doRerank(
  pipe: any,
  query: string,
  candidates: RerankCandidate[],
  topK: number
): Promise<RerankCandidate[]> {
  // 批量推理：一次传入所有 (query, passage) 对
  const inputs = candidates.map(c =>
    `${query} [SEP] ${c.content.slice(0, 500)}`
  )
  const results = await pipe(inputs)

  const scored = candidates.map((c, i) => {
    const item = Array.isArray(results[i]) ? results[i][0] : results[i]
    const rawScore: number = item?.score ?? 0
    return { candidate: c, relevance: 1 / (1 + Math.exp(-rawScore)) }
  })

  scored.sort((a, b) => b.relevance - a.relevance)
  const top = scored.slice(0, topK)

  if (top.length > 0) {
    console.log(`[Reranker] 本地重排序: ${candidates.length}条 → ${top.length}条, 最高分=${top[0].relevance.toFixed(4)}, 最低分=${top[top.length - 1].relevance.toFixed(4)}`)
  }

  return top.map(s => ({
    ...s.candidate,
    score: s.relevance
  }))
}
