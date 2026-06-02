import { Request, Response, NextFunction } from 'express'
import { getRedis } from '../services/cache.js'

const IDEMPOTENCY_TTL = 24 * 60 * 60 // 24 小时

function resolveUserId(req: Request): string {
  return (req as any).userId?.toString() || req.ip || req.headers['x-forwarded-for']?.toString() || 'anonymous'
}

export function idempotencyGuard(): (req: Request, res: Response, next: NextFunction) => void {
  return async (req, res, next) => {
    const idempotencyKey = req.headers['x-request-id'] as string || req.headers['idempotency-key'] as string

    if (!idempotencyKey) {
      return next()
    }

    const userId = resolveUserId(req)
    const key = `idempotent:${userId}:${req.method}:${req.path}:${idempotencyKey}`

    try {
      const cached = await getRedis().get(key)
      if (cached) {
        const { status, body } = JSON.parse(cached)
        res.set('X-Idempotency-Replayed', 'true')
        return res.status(status).json(body)
      }
    } catch {
      // Redis 不可用时降级放行
    }

    const originalJson = res.json.bind(res)
    res.json = function (body: any) {
      const statusCode = res.statusCode

      if (statusCode >= 200 && statusCode < 300) {
        try {
          getRedis().setex(key, IDEMPOTENCY_TTL, JSON.stringify({ status: statusCode, body })).catch(() => {})
        } catch {}
      }

      return originalJson(body)
    }

    next()
  }
}

export function idempotencyGuardFor(paths: string[]): (req: Request, res: Response, next: NextFunction) => void {
  const guard = idempotencyGuard()
  return (req, res, next) => {
    if (paths.some(p => req.path.startsWith(p))) {
      return guard(req, res, next)
    }
    next()
  }
}