import type { NextFunction, Request, Response } from 'express'

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_TOKEN || 'dev-token'
  const got = (req.header('x-admin-token') || '').trim()
  if (!got || got !== expected) {
    res.status(401).json({ success: false, error: 'Unauthorized' })
    return
  }
  next()
}

