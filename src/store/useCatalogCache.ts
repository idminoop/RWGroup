import { create } from 'zustand'
import type { Complex, Property } from '../../shared/types'

type CatalogData = { complexes: Complex[]; properties: Property[]; total: number; page: number; limit: number }

type CatalogCacheState = {
  byQuery: Record<string, CatalogData>
  setCache: (query: string, data: CatalogData) => void
}

export const useCatalogCache = create<CatalogCacheState>((set) => ({
  byQuery: {},
  setCache: (query, data) =>
    set((state) => ({
      byQuery: { ...state.byQuery, [query]: data },
    })),
}))
