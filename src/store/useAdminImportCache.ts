import { create } from 'zustand'
import type { FeedSource, ImportRun } from '../../shared/types'

type Diagnostics = Record<string, { reason?: string; items?: { properties: number; complexes: number; total: number } }>

type AdminImportCacheState = {
  feeds: FeedSource[]
  runs: ImportRun[]
  diagnostics: Diagnostics
  setCache: (next: { feeds?: FeedSource[]; runs?: ImportRun[]; diagnostics?: Diagnostics }) => void
}

export const useAdminImportCache = create<AdminImportCacheState>((set) => ({
  feeds: [],
  runs: [],
  diagnostics: {},
  setCache: (next) =>
    set((state) => ({
      feeds: next.feeds ?? state.feeds,
      runs: next.runs ?? state.runs,
      diagnostics: next.diagnostics ?? state.diagnostics,
    })),
}))
