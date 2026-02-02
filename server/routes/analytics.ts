import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { rateLimit } from '../middleware/rateLimit.js'

const router = Router()

router.post(
  '/event',
  rateLimit({ keyPrefix: 'analytics', max: 60, windowMs: 60_000 }),
  (req: Request, res: Response) => {
    const schema = z.object({
      name: z.string().min(1).max(80),
      params: z.record(z.any()).optional(),
      ts: z.number().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid payload' })
      return
    }
    res.json({ success: true })
  },
)

export default router

