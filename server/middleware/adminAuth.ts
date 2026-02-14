import crypto from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import type { AdminIdentity, AdminPermission, AdminRole } from '../../shared/types.js'
import { findAdminUserById, normalizeAdminRoles, permissionsForRoles, toAdminIdentity } from '../lib/admin-users.js'
import { readDb } from '../lib/storage.js'

const LEGACY_TOKEN = process.env.ADMIN_TOKEN || 'dev-token'
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || LEGACY_TOKEN
const SESSION_TTL_HOURS = Number(process.env.ADMIN_SESSION_TTL_HOURS || 24)

type AdminTokenPayloadV3 = {
  u: string
  l: string
  rs: AdminRole[]
  iat: number
  exp: number
  v: 3
}

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminIdentity
  }
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4)) % 4
  return Buffer.from(normalized + '='.repeat(padLength), 'base64').toString('utf-8')
}

function signValue(value: string): string {
  return toBase64Url(crypto.createHmac('sha256', SESSION_SECRET).update(value).digest())
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function buildIdentity(payload: { id: string; login: string; roles: AdminRole[] }): AdminIdentity {
  const roles = normalizeAdminRoles(payload.roles)
  return {
    id: payload.id,
    login: payload.login,
    roles,
    permissions: permissionsForRoles(roles),
  }
}

function parseTokenPayload(raw: string): AdminIdentity | null {
  const payload = JSON.parse(raw) as Record<string, unknown>
  const now = Math.floor(Date.now() / 1000)
  const rolesFromPayload = normalizeAdminRoles(payload.rs)
  const roleCandidate = typeof payload.r === 'string' ? payload.r : ''
  const expCandidate =
    typeof payload.exp === 'number'
      ? payload.exp
      : typeof payload.exp === 'string'
        ? Number(payload.exp)
        : NaN
  const version =
    typeof payload.v === 'number'
      ? payload.v
      : typeof payload.v === 'string'
        ? Number(payload.v)
        : NaN

  if (!Number.isFinite(expCandidate) || expCandidate <= now) return null

  if (version === 3) {
    if (!rolesFromPayload.length) return null
    if (typeof payload.u !== 'string' || !payload.u) return null
    if (typeof payload.l !== 'string' || !payload.l) return null
    return buildIdentity({ id: payload.u, login: payload.l, roles: rolesFromPayload })
  }

  // Backward compatibility for previous token format (v2 with one role).
  if (version === 2) {
    const roles = normalizeAdminRoles(roleCandidate)
    if (!roles.length) return null
    if (typeof payload.u !== 'string' || !payload.u) return null
    if (typeof payload.l !== 'string' || !payload.l) return null
    return buildIdentity({ id: payload.u, login: payload.l, roles })
  }

  // Legacy support for v1 payload shape.
  if (version === 1) {
    const roles = normalizeAdminRoles(roleCandidate)
    if (!roles.length) return null
    return buildIdentity({
      id: `legacy-${roles[0]}`,
      login: roles[0],
      roles,
    })
  }

  return null
}

function verifyToken(token: string): AdminIdentity | null {
  if (!token) return null

  // Backward compatibility: legacy static token means owner session.
  if (token === LEGACY_TOKEN) {
    return buildIdentity({ id: 'legacy-owner', login: 'owner', roles: ['owner'] })
  }

  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'rwadmin') return null

  const payloadB64 = parts[1]
  const signature = parts[2]
  const expectedSignature = signValue(payloadB64)
  if (!safeEqual(signature, expectedSignature)) return null

  try {
    return parseTokenPayload(fromBase64Url(payloadB64))
  } catch {
    return null
  }
}

function resolveIdentity(candidate: AdminIdentity): AdminIdentity | null {
  if (candidate.id.startsWith('legacy-')) return candidate
  try {
    const db = readDb()
    const users = Array.isArray(db.admin_users) ? db.admin_users : []
    const user = findAdminUserById(users, candidate.id)
    if (!user || !user.is_active) return null
    return toAdminIdentity(user)
  } catch {
    return null
  }
}

export function issueAdminToken(identity: Pick<AdminIdentity, 'id' | 'login' | 'roles'>): string {
  const roles = normalizeAdminRoles(identity.roles)
  if (!roles.length) {
    throw new Error('Cannot issue admin token without roles')
  }
  const now = Math.floor(Date.now() / 1000)
  const ttlSeconds = Math.max(1, SESSION_TTL_HOURS) * 3600
  const payload: AdminTokenPayloadV3 = {
    u: identity.id,
    l: identity.login,
    rs: roles,
    iat: now,
    exp: now + ttlSeconds,
    v: 3,
  }
  const payloadB64 = toBase64Url(JSON.stringify(payload))
  const signature = signValue(payloadB64)
  return `rwadmin.${payloadB64}.${signature}`
}

function forbidden(res: Response): void {
  res.status(403).json({ success: false, error: 'Forbidden' })
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const got = (req.header('x-admin-token') || '').trim()
  const parsed = verifyToken(got)
  const identity = parsed ? resolveIdentity(parsed) : null
  if (!identity) {
    res.status(401).json({ success: false, error: 'Unauthorized' })
    return
  }
  req.admin = identity
  next()
}

export function requireAdminPermission(permission: AdminPermission): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const permissions = req.admin?.permissions || []
    if (!permissions.includes(permission)) {
      forbidden(res)
      return
    }
    next()
  }
}

export function requireAdminAnyPermission(
  ...permissionsToCheck: AdminPermission[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const permissions = req.admin?.permissions || []
    const ok = permissionsToCheck.some((permission) => permissions.includes(permission))
    if (!ok) {
      forbidden(res)
      return
    }
    next()
  }
}
