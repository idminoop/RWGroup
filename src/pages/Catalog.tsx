import { useEffect, useMemo, useState } from 'react'
import SiteLayout from '@/components/layout/SiteLayout'
import CatalogTabs from '@/components/catalog/CatalogTabs'
import CatalogFilters, { type FiltersState } from '@/components/catalog/CatalogFilters'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import { Heading, Text } from '@/components/ui/Typography'
import { apiGet } from '@/lib/api'
import { trackEvent } from '@/lib/analytics'
import type { Complex, Property } from '../../shared/types'

type Facets = { districts: string[]; metros: string[] }

export default function CatalogPage() {
  const [tab, setTab] = useState<'newbuild' | 'secondary' | 'rent'>('newbuild')
  const [filters, setFilters] = useState<FiltersState>({ bedrooms: '', priceMin: '', priceMax: '', areaMin: '', areaMax: '', district: '', metro: '', q: '' })
  const [facets, setFacets] = useState<Facets | null>(null)
  const [data, setData] = useState<{ complexes: Complex[]; properties: Property[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<Facets>('/api/facets').then(setFacets).catch(() => setFacets(null))
  }, [])

  const query = useMemo(() => {
    const sp = new URLSearchParams({ tab })
    Object.entries(filters).forEach(([k, v]) => {
      if (v) sp.set(k, v)
    })
    return sp.toString()
  }, [tab, filters])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    const sp = new URLSearchParams(query)
    trackEvent('filter_apply', {
      page: 'catalog',
      tab: sp.get('tab') || '',
      bedrooms: sp.get('bedrooms') || '',
      priceMin: sp.get('priceMin') || '',
      priceMax: sp.get('priceMax') || '',
      areaMin: sp.get('areaMin') || '',
      areaMax: sp.get('areaMax') || '',
      district: sp.get('district') || '',
      metro: sp.get('metro') || '',
      q: sp.get('q') || '',
    })
    apiGet<{ complexes: Complex[]; properties: Property[] }>(`/api/catalog?${query}`)
      .then((d) => {
        if (!alive) return
        setData(d)
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Ошибка')
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [query])

  return (
    <SiteLayout>
      <div className="min-h-screen bg-[#F5F5F5]">
        <div className="mx-auto w-full max-w-6xl px-4 py-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <Heading size="h2">Каталог недвижимости</Heading>
              <Text size="sm" muted className="mt-1">Фильтруйте по спальням, цене, району и метро.</Text>
            </div>
            <CatalogTabs value={tab} onChange={(t) => setTab(t)} />
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
            <CatalogFilters tab={tab} value={filters} onChange={setFilters} facets={facets} />
          </div>

          <div className="mt-6">
            {loading ? (
              <div className="grid gap-4 md:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-72 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
                ))}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
            ) : (
              <div className="space-y-8">
                {tab === 'newbuild' && data?.complexes?.length ? (
                  <section>
                    <Heading size="h4" className="mb-3">Жилые комплексы</Heading>
                    <div className="grid gap-4 md:grid-cols-3">
                      {data.complexes.map((c) => (
                        <ComplexCard key={c.id} item={c} />
                      ))}
                    </div>
                  </section>
                ) : null}

                <section>
                  <Heading size="h4" className="mb-3">Объекты</Heading>
                  {data?.properties?.length ? (
                    <div className="grid gap-4 md:grid-cols-3">
                      {data.properties.map((p) => (
                        <PropertyCard key={p.id} item={p} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Нет результатов</div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </SiteLayout>
  )
}
