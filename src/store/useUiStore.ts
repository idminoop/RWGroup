import { create } from 'zustand'

export type LeadModalType = 'consultation' | 'buy_sell' | 'view_details' | 'partner'

export type LeadSource = {
  page: string
  block?: string
  object_id?: string
  object_type?: 'property' | 'complex' | 'collection'
}

type UiState = {
  leadModal: { open: boolean; type: LeadModalType; source: LeadSource; initialTab?: 'buy' | 'sell' }
  openLeadModal: (type: LeadModalType, source: LeadSource, opts?: { initialTab?: 'buy' | 'sell' }) => void
  closeLeadModal: () => void
  adminToken: string | null
  setAdminToken: (token: string | null) => void
  isMenuOpen: boolean
  toggleMenu: (open?: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  leadModal: { open: false, type: 'consultation', source: { page: 'unknown' } },
  openLeadModal: (type, source, opts) => set({ leadModal: { open: true, type, source, initialTab: opts?.initialTab } }),
  closeLeadModal: () => set((s) => ({ leadModal: { ...s.leadModal, open: false } })),
  adminToken: localStorage.getItem('rw_admin_token'),
  setAdminToken: (token) => {
    if (token) localStorage.setItem('rw_admin_token', token)
    else localStorage.removeItem('rw_admin_token')
    set({ adminToken: token })
  },
  isMenuOpen: false,
  toggleMenu: (open) => set((s) => ({ isMenuOpen: open !== undefined ? open : !s.isMenuOpen })),
}))
