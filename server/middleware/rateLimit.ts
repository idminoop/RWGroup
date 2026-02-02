import type { NextFunction, Request, Response } from 'express'

const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(opts: { keyPrefix: string; max: number; windowMs: number }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
    const key = `${opts.keyPrefix}:${ip}`
    const now = Date.now()
    const existing = buckets.get(key)
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs })
      next()
      return
    }
    if (existing.count >= opts.max) {
      res.status(429).json({ success: false, error: 'Too many requests' })
      return
    }
    existing.count += 1
    next()
  }
}

