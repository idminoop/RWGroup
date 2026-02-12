import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SiteLayout from '@/components/layout/SiteLayout'
import CatalogTabs from '@/components/catalog/CatalogTabs'
import CatalogFilters, { type FiltersState } from '@/components/catalog/CatalogFilters'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import { Heading, Text } from '@/components/ui/Typography'
import Button from '@/components/ui/Button'
import { apiGet } from '@/lib/api'
import { trackEvent } from '@/lib/analytics'
import { useUiStore } from '@/store/useUiStore'
import { useCatalogCache } from '@/store/useCatalogCache'
import type { Complex, Property } from '../../shared/types'

const UI = {
  title: '\u041a\u0430\u0442\u0430\u043b\u043e\u0433 \u043d\u0435\u0434\u0432\u0438\u0436\u0438\u043c\u043e\u0441\u0442\u0438',
  subtitle: '\u0424\u0438\u043b\u044c\u0442\u0440\u0443\u0439\u0442\u0435 \u043f\u043e \u0441\u043f\u0430\u043b\u044c\u043d\u044f\u043c, \u0446\u0435\u043d\u0435, \u0440\u0430\u0439\u043e\u043d\u0443 \u0438 \u043c\u0435\u0442\u0440\u043e.',
  error: '\u041e\u0448\u0438\u0431\u043a\u0430',
  complexes: '\u0416\u0438\u043b\u044b\u0435 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u044b',
  objects: '\u041e\u0431\u044a\u0435\u043a\u0442\u044b',
  total: '\u0422\u043e\u0432\u0430\u0440\u043e\u0432',
  prev: '\u041d\u0430\u0437\u0430\u0434',
  next: '\u0412\u043f\u0435\u0440\u0451\u0434',
  page: '\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430',
  of: '\u0438\u0437',
  empty: '\u041d\u0435\u0442 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u043e\u0432',
  buy: '\u041a\u0443\u043f\u0438\u0442\u044c \u043d\u0435\u0434\u0432\u0438\u0436\u0438\u043c\u043e\u0441\u0442\u044c',
  sell: '\u041f\u0440\u043e\u0434\u0430\u0442\u044c \u043d\u0435\u0434\u0432\u0438\u0436\u0438\u043c\u043e\u0441\u0442\u044c',
  rentOut: '\u0421\u0434\u0430\u0442\u044c \u043d\u0435\u0434\u0432\u0438\u0436\u0438\u043c\u043e\u0441\u0442\u044c',
}

export default function CatalogPage() {
  const { openLeadModal } = useUiStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as 'newbuild' | 'secondary' | 'rent' | null) || 'newbuild'
  const [tab, setTab] = useState<'newbuild' | 'secondary' | 'rent'>(() => (
    initialTab === 'secondary' || initialTab === 'rent' ? initialTab : 'newbuild'
  ))
  const [filters, setFilters] = useState<FiltersState>(() => ({
    complexId: searchParams.get('complexId') || '',
    bedrooms: searchParams.get('bedrooms') || '',
    priceMin: searchParams.get('priceMin') || '',
    priceMax: searchParams.get('priceMax') || '',
    areaMin: searchParams.get('areaMin') || '',
    areaMax: searchParams.get('areaMax') || '',
    district: searchParams.get('district') || '',
    metro: searchParams.get('metro') || '',
    q: searchParams.get('q') || '',
  }))
  const catalogCache = useCatalogCache()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [limit] = useState(12)

  const query = useMemo(() => {
    const sp = new URLSearchParams({ tab, page: String(page), limit: String(limit) })
    Object.entries(filters).forEach(([k, v]) => {
      if (v) sp.set(k, v)
    })
    return sp.toString()
  }, [tab, filters, page, limit])

  const cachedData = catalogCache.byQuery[query]
  const [data, setData] = useState<{ complexes: Complex[]; properties: Property[]; total: number; page: number; limit: number } | null>(
    cachedData || null,
  )

  useEffect(() => {
    setPage(1)
  }, [tab, filters])

  useEffect(() => {
    setSearchParams(new URLSearchParams(query), { replace: true })
  }, [query, setSearchParams])

  useEffect(() => {
    let alive = true
    if (cachedData) setData(cachedData)
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
      q: sp.get('q') || '',
    })
    apiGet<{ complexes: Complex[]; properties: Property[]; total: number; page: number; limit: number }>(`/api/catalog?${query}`)
      .then((d) => {
        if (!alive) return
        setData(d)
        catalogCache.setCache(query, d)
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : UI.error)
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [query])

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / limit))

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  return (
    <SiteLayout>
      <div className="min-h-screen bg-[radial-gradient(120%_120%_at_50%_0%,#102738_0%,#081924_45%,#06131d_100%)]">
        <div className="mx-auto w-full max-w-6xl px-4 py-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <Heading size="h2" className="font-serif text-white">
                {UI.title}
              </Heading>
              <Text size="sm" className="mt-1 text-[#9BB0BB]">
                {UI.subtitle}
              </Text>
            </div>
            <CatalogTabs value={tab} onChange={(t) => setTab(t)} />
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-[#0b1d2b]/90 p-3 backdrop-blur-sm sm:p-4">
            <CatalogFilters tab={tab} value={filters} onChange={setFilters} />
          </div>

          <div className="mt-6">
            {loading && !data ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-72 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
                ))}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-500/40 bg-rose-900/20 p-4 text-sm text-rose-200">{error}</div>
            ) : (
              <div className="space-y-8">
                {tab === 'newbuild' && data?.complexes?.length ? (
                  <section>
                    <Heading size="h4" className="mb-3 text-white">
                      {UI.complexes}
                    </Heading>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {data.complexes.map((c) => (
                        <ComplexCard key={c.id} item={c} />
                      ))}
                    </div>
                  </section>
                ) : null}

                <section>
                  <Heading size="h4" className="mb-3 text-white">
                    {UI.objects}
                  </Heading>
                  {data?.properties?.length ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {data.properties.map((p) => (
                          <PropertyCard key={p.id} item={p} />
                        ))}
                      </div>
                      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <div>
                          {UI.total}:{' '}
                          <span className="font-semibold text-slate-900">{data?.total || 0}</span>
                        </div>
                        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
                          <Button size="sm" variant="secondary" onClick={() => setPage(Math.max(page - 1, 1))} disabled={page <= 1}>
                            {UI.prev}
                          </Button>
                          <span>
                            {UI.page} {page} {UI.of} {totalPages}
                          </span>
                          <Button size="sm" variant="secondary" onClick={() => setPage(Math.min(page + 1, totalPages))} disabled={page >= totalPages}>
                            {UI.next}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">{UI.empty}</div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="bg-background py-12 md:py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-4 md:grid-cols-3 md:gap-6">
            <div
              onClick={() => {
                trackEvent('click_buy_sell', { page: 'catalog', block: 'buy_cta', tab: 'buy' })
                openLeadModal('buy_sell', { page: 'catalog', block: 'buy_cta' }, { initialTab: 'buy' })
              }}
              className="group relative flex min-h-[180px] cursor-pointer items-stretch overflow-hidden rounded-sm border border-white/10 transition-colors hover:border-white/25 sm:min-h-[220px]"
            >
              <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-10">
                <Heading size="h3" className="font-serif text-2xl font-normal leading-tight text-white lg:text-3xl">
                  {UI.buy.split(' ').slice(0, 1).join(' ')}
                  <br />
                  {UI.buy.split(' ').slice(1).join(' ')}
                </Heading>
              </div>
              <div className="relative hidden w-1/2 overflow-hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80"
                  alt={UI.buy}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />
              </div>
            </div>

            <div
              onClick={() => {
                trackEvent('click_buy_sell', { page: 'catalog', block: 'sell_cta', tab: 'sell' })
                openLeadModal('buy_sell', { page: 'catalog', block: 'sell_cta' }, { initialTab: 'sell' })
              }}
              className="group relative flex min-h-[180px] cursor-pointer items-stretch overflow-hidden rounded-sm border border-white/10 transition-colors hover:border-white/25 sm:min-h-[220px]"
            >
              <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-10">
                <Heading size="h3" className="font-serif text-2xl font-normal leading-tight text-white lg:text-3xl">
                  {UI.sell.split(' ').slice(0, 1).join(' ')}
                  <br />
                  {UI.sell.split(' ').slice(1).join(' ')}
                </Heading>
              </div>
              <div className="relative hidden w-1/2 overflow-hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80"
                  alt={UI.sell}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />
              </div>
            </div>

            <div
              onClick={() => {
                trackEvent('click_buy_sell', { page: 'catalog', block: 'rent_cta', tab: 'sell' })
                openLeadModal('consultation', { page: 'catalog', block: 'rent_cta' })
              }}
              className="group relative flex min-h-[180px] cursor-pointer items-stretch overflow-hidden rounded-sm border border-white/10 transition-colors hover:border-white/25 sm:min-h-[220px]"
            >
              <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-10">
                <Heading size="h3" className="font-serif text-2xl font-normal leading-tight text-white lg:text-3xl">
                  {UI.rentOut.split(' ').slice(0, 1).join(' ')}
                  <br />
                  {UI.rentOut.split(' ').slice(1).join(' ')}
                </Heading>
              </div>
              <div className="relative hidden w-1/2 overflow-hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80"
                  alt={UI.rentOut}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </SiteLayout>
  )
}
