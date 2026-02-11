import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { withDb } from '../lib/storage.js'
import { newId } from '../lib/ids.js'
import { isValidRuPhoneDigits, normalizePhone } from '../lib/phone.js'
import { rateLimit } from '../middleware/rateLimit.js'

const router = Router()

router.post(
  '/',
  rateLimit({ keyPrefix: 'lead', max: 15, windowMs: 60_000 }),
  (req: Request, res: Response) => {
    const schema = z.object({
      form_type: z.enum(['consultation', 'buy_sell', 'view_details', 'partner']),
      tab: z.enum(['buy', 'sell']).optional(),
      name: z.string().min(1).max(80),
      phone: z.string().min(6).max(40),
      comment: z.string().max(2000).optional(),
      consent: z.boolean(),
      company: z.string().optional(),
      source: z
        .object({
          page: z.string().min(1).max(80),
          block: z.string().max(120).optional(),
          object_id: z.string().max(80).optional(),
          object_type: z.enum(['property', 'complex', 'collection']).optional(),
        })
        .default({ page: 'unknown' }),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid payload' })
      return
    }

    if ((parsed.data.company || '').trim() !== '') {
      res.status(200).json({ success: true })
      return
    }

    if (!parsed.data.consent) {
      res.status(400).json({ success: false, error: 'Consent required' })
      return
    }

    const { digits, pretty } = normalizePhone(parsed.data.phone)
    if (!isValidRuPhoneDigits(digits)) {
      res.status(400).json({ success: false, error: 'Invalid phone' })
      return
    }

    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.socket.remoteAddress
    const ua = req.headers['user-agent']
    const createdAt = new Date().toISOString()

    const source = (parsed.data.source && parsed.data.source.page ? parsed.data.source : { page: 'unknown' }) as {
      page: string
      block?: string
      object_id?: string
      object_type?: 'property' | 'complex' | 'collection'
    }

    const lead = {
      id: newId(),
      form_type: parsed.data.form_type,
      tab: parsed.data.tab,
      name: parsed.data.name,
      phone: pretty,
      comment: parsed.data.comment,
      source,
      lead_status: 'new' as const,
      assignee: '',
      admin_note: '',
      created_at: createdAt,
      updated_at: createdAt,
      ip: ip || undefined,
      user_agent: typeof ua === 'string' ? ua : undefined,
    }

    withDb((db) => {
      db.leads.unshift(lead)
    })

    res.json({ success: true, data: { id: lead.id } })
  },
)

export default router
