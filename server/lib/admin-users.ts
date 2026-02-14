import crypto from 'crypto'
import type { AdminIdentity, AdminPermission, AdminRole, AdminUser, AdminUserPublic, DbShape } from '../../shared/types.js'
import { newId } from './ids.js'

const DEFAULT_OWNER_LOGIN_RAW = (process.env.ADMIN_DEFAULT_LOGIN || 'admin').trim()
const DEFAULT_OWNER_PASSWORD = (process.env.ADMIN_DEFAULT_PASSWORD || 'admin').trim() || 'admin'

const HASH_PREFIX = 'scrypt'
const KEYLEN = 64
const SALT_BYTES = 16
const ADMIN_ROLE_ORDER: AdminRole[] = ['owner', 'content', 'import', 'sales']

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  owner: [
    'admin.access',
    'publish.read',
    'publish.apply',
    'admin_users.read',
    'admin_users.write',
    'upload.write',
    'home.read',
    'home.write',
    'leads.read',
    'leads.write',
    'feeds.read',
    'feeds.write',
    'import.read',
    'import.write',
    'catalog.read',
    'catalog.write',
    'collections.read',
    'collections.write',
    'landing_presets.read',
    'landing_presets.write',
    'logs.read',
  ],
  content: [
    'admin.access',
    'publish.read',
    'upload.write',
    'home.read',
    'home.write',
    'catalog.read',
    'catalog.write',
    'collections.read',
    'collections.write',
    'landing_presets.read',
    'landing_presets.write',
  ],
  import: [
    'admin.access',
    'publish.read',
    'feeds.read',
    'feeds.write',
    'import.read',
    'import.write',
    'catalog.read',
  ],
  sales: [
    'admin.access',
    'publish.read',
    'leads.read',
    'leads.write',
  ],
}

export function isAdminRole(value: string): value is AdminRole {
  return value === 'owner' || value === 'content' || value === 'import' || value === 'sales'
}

function nowIso(): string {
  return new Date().toISOString()
}

function safeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf-8')
  const right = Buffer.from(b, 'utf-8')
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

export function normalizeAdminLogin(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeAdminRoles(input: unknown): AdminRole[] {
  const raw: string[] = Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string')
    : typeof input === 'string'
      ? [input]
      : []

  const set = new Set<AdminRole>()
  for (const value of raw) {
    if (isAdminRole(value)) set.add(value)
  }

  return ADMIN_ROLE_ORDER.filter((role) => set.has(role))
}

export function hasAdminRole(userOrRoles: Pick<AdminUser, 'roles'> | AdminRole[], role: AdminRole): boolean {
  const roles = Array.isArray(userOrRoles) ? userOrRoles : userOrRoles.roles
  return roles.includes(role)
}

export function permissionsForRoles(rolesInput: AdminRole[]): AdminPermission[] {
  const roles = normalizeAdminRoles(rolesInput)
  const permissions = new Set<AdminPermission>()
  for (const role of roles) {
    for (const permission of ADMIN_ROLE_PERMISSIONS[role]) {
      permissions.add(permission)
    }
  }
  return Array.from(permissions)
}

export function hashAdminPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex')
  const derived = crypto.scryptSync(password, salt, KEYLEN).toString('hex')
  return `${HASH_PREFIX}$${salt}$${derived}`
}

export function verifyAdminPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false
  if (!storedHash.startsWith(`${HASH_PREFIX}$`)) {
    return safeEqualStrings(password, storedHash)
  }

  const parts = storedHash.split('$')
  if (parts.length !== 3) return false
  const [, salt, expectedHex] = parts
  if (!salt || !expectedHex) return false

  const actualHex = crypto.scryptSync(password, salt, KEYLEN).toString('hex')
  return safeEqualStrings(actualHex, expectedHex)
}

function buildOwnerUser(existingUsers: AdminUser[]): AdminUser {
  const loginBase = normalizeAdminLogin(DEFAULT_OWNER_LOGIN_RAW || 'admin') || 'admin'
  let login = loginBase
  let suffix = 2
  const hasTaken = (candidate: string) =>
    existingUsers.some((user) => normalizeAdminLogin(user.login) === candidate)

  while (hasTaken(login)) {
    login = `${loginBase}${suffix}`
    suffix += 1
  }

  const createdAt = nowIso()
  return {
    id: newId(),
    login,
    password_hash: hashAdminPassword(DEFAULT_OWNER_PASSWORD),
    roles: ['owner'],
    is_active: true,
    created_at: createdAt,
    updated_at: createdAt,
  }
}

function normalizeExistingUsers(rawUsers: unknown[]): AdminUser[] {
  const result: AdminUser[] = []
  const usedLogins = new Set<string>()

  for (const raw of rawUsers) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const login = normalizeAdminLogin(typeof item.login === 'string' ? item.login : '')
    if (!login || usedLogins.has(login)) continue

    const roles = normalizeAdminRoles(item.roles ?? item.role)
    if (!roles.length) continue

    const createdAt = typeof item.created_at === 'string' && item.created_at ? item.created_at : nowIso()
    const updatedAt = typeof item.updated_at === 'string' && item.updated_at ? item.updated_at : createdAt
    const passwordHash =
      typeof item.password_hash === 'string' && item.password_hash.trim()
        ? item.password_hash
        : hashAdminPassword(DEFAULT_OWNER_PASSWORD)

    result.push({
      id: typeof item.id === 'string' && item.id ? item.id : newId(),
      login,
      password_hash: passwordHash,
      roles,
      is_active: item.is_active !== false,
      created_at: createdAt,
      updated_at: updatedAt,
    })
    usedLogins.add(login)
  }

  return result
}

export function ensureAdminUsers(db: DbShape): AdminUser[] {
  const rawUsers = Array.isArray(db.admin_users) ? db.admin_users : []
  const users = normalizeExistingUsers(rawUsers)

  if (!users.length) {
    users.push(buildOwnerUser(users))
  }

  if (!users.some((user) => user.is_active && hasAdminRole(user, 'owner'))) {
    users.push(buildOwnerUser(users))
  }

  db.admin_users = users
  return users
}

export function findAdminUserByLogin(users: AdminUser[], login: string): AdminUser | undefined {
  const normalized = normalizeAdminLogin(login)
  return users.find((user) => normalizeAdminLogin(user.login) === normalized)
}

export function findAdminUserById(users: AdminUser[], id: string): AdminUser | undefined {
  return users.find((user) => user.id === id)
}

export function toAdminIdentity(user: AdminUser): AdminIdentity {
  return {
    id: user.id,
    login: normalizeAdminLogin(user.login),
    roles: normalizeAdminRoles(user.roles),
    permissions: permissionsForRoles(user.roles),
  }
}

export function toAdminUserPublic(user: AdminUser): AdminUserPublic {
  return {
    id: user.id,
    login: normalizeAdminLogin(user.login),
    roles: normalizeAdminRoles(user.roles),
    is_active: user.is_active,
    created_at: user.created_at,
    updated_at: user.updated_at,
  }
}

export function countActiveOwners(users: AdminUser[]): number {
  return users.filter((user) => user.is_active && hasAdminRole(user, 'owner')).length
}
