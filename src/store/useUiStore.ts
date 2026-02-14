import { create } from 'zustand'
import type { AdminPermission, AdminRole } from '../../shared/types'

export type LeadModalType = 'consultation' | 'buy_sell' | 'view_details' | 'partner'

export type LeadSource = {
  page: string
  block?: string
  object_id?: string
  object_type?: 'property' | 'complex' | 'collection'
}

type AdminSession = {
  token: string
  id: string
  login: string
  roles: AdminRole[]
  permissions: AdminPermission[]
}

type UiState = {
  leadModal: { open: boolean; type: LeadModalType; source: LeadSource; initialTab?: 'buy' | 'sell' }
  openLeadModal: (type: LeadModalType, source: LeadSource, opts?: { initialTab?: 'buy' | 'sell' }) => void
  closeLeadModal: () => void
  adminToken: string | null
  adminId: string | null
  adminLogin: string | null
  adminRoles: AdminRole[]
  adminPermissions: AdminPermission[]
  setAdminSession: (session: AdminSession | null) => void
  setAdminToken: (token: string | null) => void
  isMenuOpen: boolean
  toggleMenu: (open?: boolean) => void
}

function isAdminRole(value: unknown): value is AdminRole {
  return value === 'owner' || value === 'content' || value === 'import' || value === 'sales'
}

function normalizeAdminRoles(input: unknown): AdminRole[] {
  if (!Array.isArray(input)) return []
  const set = new Set<AdminRole>()
  for (const item of input) {
    if (isAdminRole(item)) set.add(item)
  }
  return Array.from(set)
}

function loadStoredRoles(): AdminRole[] {
  const raw = localStorage.getItem('rw_admin_roles')
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      const roles = normalizeAdminRoles(parsed)
      if (roles.length) return roles
    } catch {
      // ignore invalid stored payload
    }
  }

  const legacyRoleRaw = localStorage.getItem('rw_admin_role')
  return isAdminRole(legacyRoleRaw) ? [legacyRoleRaw] : []
}

function loadStoredPermissions(): AdminPermission[] {
  const raw = localStorage.getItem('rw_admin_permissions')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AdminPermission => typeof item === 'string')
  } catch {
    return []
  }
}

const storedRoles = loadStoredRoles()
const storedAdminId = (localStorage.getItem('rw_admin_id') || '').trim() || null
const storedAdminLogin = (localStorage.getItem('rw_admin_login') || '').trim() || null

export const useUiStore = create<UiState>((set) => ({
  leadModal: { open: false, type: 'consultation', source: { page: 'unknown' } },
  openLeadModal: (type, source, opts) => set({ leadModal: { open: true, type, source, initialTab: opts?.initialTab } }),
  closeLeadModal: () => set((s) => ({ leadModal: { ...s.leadModal, open: false } })),
  adminToken: localStorage.getItem('rw_admin_token'),
  adminId: storedAdminId,
  adminLogin: storedAdminLogin,
  adminRoles: storedRoles,
  adminPermissions: loadStoredPermissions(),
  setAdminSession: (session) => {
    if (session) {
      localStorage.setItem('rw_admin_token', session.token)
      localStorage.setItem('rw_admin_id', session.id)
      localStorage.setItem('rw_admin_login', session.login)
      localStorage.setItem('rw_admin_roles', JSON.stringify(session.roles))
      localStorage.removeItem('rw_admin_role')
      localStorage.setItem('rw_admin_permissions', JSON.stringify(session.permissions))
      set({
        adminToken: session.token,
        adminId: session.id,
        adminLogin: session.login,
        adminRoles: session.roles,
        adminPermissions: session.permissions,
      })
      return
    }

    localStorage.removeItem('rw_admin_token')
    localStorage.removeItem('rw_admin_id')
    localStorage.removeItem('rw_admin_login')
    localStorage.removeItem('rw_admin_roles')
    localStorage.removeItem('rw_admin_role')
    localStorage.removeItem('rw_admin_permissions')
    set({ adminToken: null, adminId: null, adminLogin: null, adminRoles: [], adminPermissions: [] })
  },
  setAdminToken: (token) => {
    if (token) {
      localStorage.setItem('rw_admin_token', token)
      localStorage.removeItem('rw_admin_id')
      localStorage.removeItem('rw_admin_login')
      localStorage.removeItem('rw_admin_roles')
      localStorage.removeItem('rw_admin_role')
      localStorage.removeItem('rw_admin_permissions')
      set({ adminToken: token, adminId: null, adminLogin: null, adminRoles: [], adminPermissions: [] })
      return
    }
    localStorage.removeItem('rw_admin_token')
    localStorage.removeItem('rw_admin_id')
    localStorage.removeItem('rw_admin_login')
    localStorage.removeItem('rw_admin_roles')
    localStorage.removeItem('rw_admin_role')
    localStorage.removeItem('rw_admin_permissions')
    set({ adminToken: null, adminId: null, adminLogin: null, adminRoles: [], adminPermissions: [] })
  },
  isMenuOpen: false,
  toggleMenu: (open) => set((s) => ({ isMenuOpen: open !== undefined ? open : !s.isMenuOpen })),
}))
