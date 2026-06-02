import config, { getSetting } from '../config/index.js'
import { cacheGet, cacheSet, hashKey } from './cache.js'
import os from 'os'

// ── 本地 embedding 模型（Xenova Transformers.js，无需 API Key）──

let _extractor: any = null
let _extractorLoading = false
let _useApiFallback = false

/** 检查服务器资源是否足够跑本地模型 */
function hasEnoughMemory(): boolean {
  try {
    const raw = getSetting('CAPABILITY_EMBEDDING')
    if (raw) {
      const cfg = JSON.parse(raw)
      if (cfg.forceAPI) {
        console.log('[Embedding] forceAPI=true，跳过本地模型')
        return false
      }
    }
  } catch {}

  const freeMem = Math.round(os.freemem() / (1024 * 1024))
  const cpuCount = os.cpus().length
  const minFreeMem = cpuCount <= 2 ? 800 : 500
  if (freeMem < minFreeMem) {
    console.warn(`[Embedding] 资源不足（CPU:${cpuCount}核, 空闲:${freeMem}MB），降级 API`)
    return false
  }
  return true
}

/** 加载本地 feature-extraction pipeline（bge-small-zh-v1.5，约 100MB） */
async function getExtractor() {
  if (_extractor) return _extractor
  if (_useApiFallback) throw new Error('API_FALLBACK')

  if (!hasEnoughMemory()) {
    _useApiFallback = true
    throw new Error('API_FALLBACK')
  }

  if (_extractorLoading) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      if (_extractor) return _extractor
      if (_useApiFallback) throw new Error('API_FALLBACK')
    }
    throw new Error('Embedding 模型加载超时（60秒）')
  }

  _extractorLoading = true
  try {
    const { pipeline, env } = await import('@xenova/transformers')
    env.remoteHost = 'https://hf-mirror.com/'
    env.allowLocalModels = false
    _extractor = await pipeline(
      'feature-extraction',
      config.embeddings.modelName as any
    )
    return _extractor
  } catch (e: any) {
    _useApiFallback = true
    console.warn('[Embedding] 本地模型加载失败，降级为 API 向量化:', e.message)
    throw new Error('API_FALLBACK')
  } finally {
    _extractorLoading = false
  }
}

// LanceDB 兼容的 embeddings 实例
export function getEmbeddings() {
  return { embedQuery, embedDocuments }
}

/** 本地模型向量化 */
async function callEmbeddingLocal(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor()
  const vectors: number[][] = []
  for (const text of texts) {
    const result = await extractor(text, { pooling: 'mean', normalize: true })
    vectors.push(Array.from(result.data) as number[])
  }
  return vectors
}

/** API 向量化（降级方案，复用 LLM 配置的 key） */
async function callEmbeddingApi(texts: string[]): Promise<number[][]> {
  const { providerManager } = await import('../providers/index.js')
  return providerManager.createEmbedding(texts)
}

async function callEmbedding(texts: string[]): Promise<number[][]> {
  try {
    return await callEmbeddingLocal(texts)
  } catch (e: any) {
    if (e.message === 'API_FALLBACK' || _useApiFallback) {
      return callEmbeddingApi(texts)
    }
    throw e
  }
}

export async function embedQuery(text: string): Promise<number[]> {
  const key = `emb:query:${hashKey(text)}`
  const cached = await cacheGet<number[]>(key)
  if (cached) return cached

  const vectors = await callEmbedding([text])
  const vector = vectors[0]
  await cacheSet(key, vector, config.redis.ttl.embeddingQuery)
  return vector
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const results: (number[] | null)[] = new Array(texts.length).fill(null)
  const uncached: { index: number; text: string }[] = []

  for (let i = 0; i < texts.length; i++) {
    const key = `emb:doc:${hashKey(texts[i])}`
    const cached = await cacheGet<number[]>(key)
    if (cached) {
      results[i] = cached
    } else {
      uncached.push({ index: i, text: texts[i] })
    }
  }

  if (uncached.length > 0) {
    const batchSize = config.embeddings.batchSize
    for (let i = 0; i < uncached.length; i += batchSize) {
      const batch = uncached.slice(i, i + batchSize)
      const vectors = await callEmbedding(batch.map(t => t.text))
      for (let j = 0; j < vectors.length; j++) {
        const { index, text } = batch[j]
        results[index] = vectors[j]
        await cacheSet(`emb:doc:${hashKey(text)}`, vectors[j], config.redis.ttl.embeddingDoc)
      }
    }
  }

  return results as number[][]
}

/** 检查本地模型是否已就绪（用于启动预加载） */
export async function preloadEmbeddingModel(): Promise<void> {
  try {
    await getExtractor()
  } catch {
    // 静默失败，首次使用时再报或降级
  }
}
