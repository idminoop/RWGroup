import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Camera,
  ChevronRight,
  MapPin,
} from 'lucide-react'
import SiteLayout from '@/components/layout/SiteLayout'
import Button from '@/components/ui/Button'
import { Heading } from '@/components/ui/Typography'
import { Badge } from '@/components/ui/Badge'
import ImageGallery from '@/components/ui/ImageGallery'
import { apiGet } from '@/lib/api'
import { formatPriceRub } from '@/lib/format'
import { getPresentableImages, selectCoverImage } from '@/lib/images'
import { normalizeLandingConfig } from '@/lib/complexLanding'
import type { Complex, ComplexLandingConfig, ComplexLandingPlanItem, Property } from '../../shared/types'
import { useUiStore } from '@/store/useUiStore'

const ComplexMap = lazy(() => import('@/components/complex/ComplexMap'))

const UI = {
  complex: 'Жилой комплекс',
  preview: 'Черновик',
  photos: 'фото',
  ctaFallback: 'Старт продаж',
  plansFallback: 'Планировки',
  allPlans: 'Все планировки',
  error: 'Ошибка',
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function decodeEscapedUnicode(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16))
    } catch {
      return _match
    }
  })
}

function getDraftStorageKey(id: string): string {
  return `rw_complex_landing_draft_v2_${id}`
}

function getLegacyDraftStorageKey(id: string): string {
  return `rw_complex_landing_draft_${id}`
}

function planVariantsLabel(value?: number): string {
  const count = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (count <= 0) return 'нет вариантов'
  if (count === 1) return '1 вариант'
  if (count >= 2 && count <= 4) return `${count} варианта`
  return `${count} вариантов`
}

function defaultPlanNote(plan?: ComplexLandingPlanItem): string {
  if (!plan) return 'Выберите формат квартиры слева.'
  if (plan.note) return decodeEscapedUnicode(plan.note)
  return `Доступно ${planVariantsLabel(plan.variants)}`
}

function inferBedroomsFromPlan(plan?: ComplexLandingPlanItem): number | undefined {
  if (!plan) return undefined
  if (typeof plan.bedrooms === 'number' && Number.isFinite(plan.bedrooms) && plan.bedrooms >= 0) return plan.bedrooms
  const lowered = (plan.name || '').toLowerCase()
  if (lowered.includes('студ')) return 0
  const match = lowered.match(/(\d+)/)
  if (!match) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

export default function ComplexPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const previewDraftMode = searchParams.get('previewDraft') === '1'
  const openLeadModal = useUiStore((s) => s.openLeadModal)

  const [data, setData] = useState<{ complex: Complex; properties: Property[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [draftLanding, setDraftLanding] = useState<ComplexLandingConfig | null>(null)
  const [activePlanId, setActivePlanId] = useState<string>('')
  const [activePlanImageIndex, setActivePlanImageIndex] = useState(0)
  const [isTickerDragging, setIsTickerDragging] = useState(false)
  const isTickerDraggingRef = useRef(false)
  const tickerAutoPosRef = useRef(0)
  const tickerViewportRef = useRef<HTMLDivElement | null>(null)
  const tickerDragRef = useRef<{ active: boolean; startX: number; startScrollLeft: number }>({
    active: false,
    startX: 0,
    startScrollLeft: 0,
  })

  useEffect(() => {
    if (!id) return
    apiGet<{ complex: Complex; properties: Property[] }>(`/api/complex/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : UI.error))
  }, [id])

  useEffect(() => {
    if (!previewDraftMode || !id) {
      setDraftLanding(null)
      return
    }

    try {
      const raw =
        window.localStorage.getItem(getDraftStorageKey(id))
        || window.localStorage.getItem(getLegacyDraftStorageKey(id))
      if (!raw) {
        setDraftLanding(null)
        return
      }
      setDraftLanding(JSON.parse(raw) as ComplexLandingConfig)
    } catch {
      setDraftLanding(null)
    }
  }, [id, previewDraftMode])

  const c = data?.complex
  const properties = data?.properties || []
  const presentableImages = c ? getPresentableImages(c.images) : []
  const coverImage = c ? selectCoverImage(c.images) : undefined
  const heroCover = presentableImages[0] || coverImage

  const landing = useMemo(() => {
    if (!c) return null
    return normalizeLandingConfig(draftLanding || c.landing, c, properties)
  }, [c, draftLanding, properties])

  const accent = landing?.accent_color || '#C2A87A'
  const surface = landing?.surface_color || '#071520'
  const heroImage = landing?.hero_image || heroCover

  const planItems = landing?.plans.items || []
  const activePlan = planItems.find((item) => item.id === activePlanId) || planItems[0]
  const activePlanImages = useMemo(() => {
    if (!activePlan) return []
    if (Array.isArray(activePlan.preview_images) && activePlan.preview_images.length) return activePlan.preview_images
    if (activePlan.preview_image) return [activePlan.preview_image]
    return []
  }, [activePlan])
  const tickerCycleItems = useMemo(() => {
    const source = landing?.feature_ticker || []
    if (!source.length) return []
    const estimatedCardWidth = 138
    const minCycleWidth = 2200
    const minItems = Math.max(source.length, Math.ceil(minCycleWidth / estimatedCardWidth))
    const repeats = Math.max(1, Math.ceil(minItems / source.length))
    const out: typeof source = []
    for (let i = 0; i < repeats; i += 1) out.push(...source)
    return out
  }, [landing?.feature_ticker])

  const minPropertyPrice = useMemo(() => {
    const withPrice = properties
      .filter((item) => item.status === 'active')
      .map((item) => toFiniteNumber(item.price))
      .filter((item): item is number => typeof item === 'number' && item > 0)
    if (!withPrice.length) return undefined
    return Math.min(...withPrice)
  }, [properties])
  const complexPriceFrom = toFiniteNumber(c?.price_from) ?? minPropertyPrice

  useEffect(() => {
    if (!planItems.length) {
      setActivePlanId('')
      return
    }
    if (!planItems.some((item) => item.id === activePlanId)) {
      setActivePlanId(planItems[0].id)
    }
  }, [planItems, activePlanId])

  useEffect(() => {
    setActivePlanImageIndex(0)
  }, [activePlan?.id])

  useEffect(() => {
    const viewport = tickerViewportRef.current
    if (!viewport) return
    viewport.scrollLeft = 0
    tickerAutoPosRef.current = 0
  }, [tickerCycleItems.length])

  useEffect(() => {
    if (!tickerCycleItems.length) return

    let rafId = 0
    let lastTime = performance.now()
    const speedPxPerSec = 24

    const tick = (now: number) => {
      const el = tickerViewportRef.current
      if (!el) {
        rafId = window.requestAnimationFrame(tick)
        return
      }

      const dt = now - lastTime
      lastTime = now

      const hasOverflow = el.scrollWidth > el.clientWidth + 1
      if (!isTickerDraggingRef.current && hasOverflow) {
        const cycleWidth = el.scrollWidth / 2
        if (cycleWidth > 1) {
          const delta = (speedPxPerSec * dt) / 1000
          let next = tickerAutoPosRef.current + delta
          if (next >= cycleWidth) next -= cycleWidth
          if (next < 0) next += cycleWidth
          tickerAutoPosRef.current = next
          el.scrollLeft = next
        } else {
          tickerAutoPosRef.current = el.scrollLeft
        }
      } else {
        tickerAutoPosRef.current = el.scrollLeft
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [tickerCycleItems.length])

  const onTickerPointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const viewport = tickerViewportRef.current
    if (!viewport) return
    event.preventDefault()
    tickerDragRef.current = {
      active: true,
      startX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
    }
    tickerAutoPosRef.current = viewport.scrollLeft
    isTickerDraggingRef.current = true
    setIsTickerDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onTickerPointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const viewport = tickerViewportRef.current
    if (!viewport || !tickerDragRef.current.active) return
    event.preventDefault()
    const dx = event.clientX - tickerDragRef.current.startX
    viewport.scrollLeft = tickerDragRef.current.startScrollLeft - dx
    tickerAutoPosRef.current = viewport.scrollLeft
  }

  const onTickerPointerEnd: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const viewport = tickerViewportRef.current
    if (viewport) tickerAutoPosRef.current = viewport.scrollLeft
    tickerDragRef.current.active = false
    isTickerDraggingRef.current = false
    setIsTickerDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const openGallery = (index = 0) => {
    setGalleryIndex(index)
    setGalleryOpen(true)
  }

  const openCatalogForPlan = (plan?: ComplexLandingPlanItem) => {
    if (!c) return
    const params = new URLSearchParams()
    params.set('tab', 'newbuild')
    params.set('complexId', c.id)
    const bedrooms = inferBedroomsFromPlan(plan)
    if (typeof bedrooms === 'number') params.set('bedrooms', String(bedrooms))
    navigate(`/catalog?${params.toString()}`)
  }

  return (
    <SiteLayout>
      <div className="bg-[radial-gradient(circle_at_20%_0%,#0a2231_0%,#06141f_40%,#041019_100%)] text-white">
        {error && (
          <div className="mx-auto max-w-6xl px-4 pt-10">
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>
          </div>
        )}

        {!data || !landing ? (
          <div className="mx-auto max-w-6xl space-y-4 px-4 py-10">
            <div className="h-[420px] animate-pulse rounded-2xl bg-white/5" />
            <div className="h-40 animate-pulse rounded-2xl bg-white/5" />
          </div>
        ) : (
          <>
          <section className="relative h-[78vh] min-h-[520px] w-full overflow-hidden">
            {heroImage ? (
              <img src={heroImage} alt={c.title} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-white/5" />
            )}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.15),transparent_35%),linear-gradient(to_top,rgba(2,8,16,0.95),rgba(2,8,16,0.35),rgba(2,8,16,0.1))]" />

            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-6xl px-4 pb-12">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{UI.complex}</Badge>
                {previewDraftMode && <Badge variant="warning">{UI.preview}</Badge>}
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {landing.tags.map((tag) => (
                  <span key={tag.id} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur-sm">
                    {decodeEscapedUnicode(tag.label)}
                  </span>
                ))}
              </div>

              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                {decodeEscapedUnicode(c.title)}
              </h1>

              <div className="mt-3 flex items-center gap-2 text-sm text-white/70">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>
                  {c.district}
                  {c.metro?.[0] ? ` • м. ${c.metro[0]}` : ''}
                </span>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <div className="rounded-xl border border-white/20 bg-black/35 px-5 py-3 backdrop-blur">
                  <div className="text-xs uppercase tracking-[0.1em] text-white/45">Цена от</div>
                  <div className="mt-1 text-2xl font-semibold text-white">
                    {typeof complexPriceFrom === 'number' ? formatPriceRub(complexPriceFrom) : 'Цена по запросу'}
                  </div>
                </div>
                <Button
                  className="h-12 rounded-xl px-6 text-sm font-semibold"
                  style={{ backgroundColor: accent, color: '#081015' }}
                  onClick={() =>
                    openLeadModal('view_details', {
                      page: 'complex',
                      block: 'hero_cta',
                      object_id: c.id,
                      object_type: 'complex',
                    })
                  }
                >
                  {landing.cta_label || UI.ctaFallback}
                </Button>
              </div>
            </div>

            {presentableImages.length > 1 && (
              <button
                onClick={() => openGallery(0)}
                className="absolute right-5 top-5 flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-2 text-sm text-white backdrop-blur-sm transition hover:bg-black/60"
              >
                <Camera className="h-4 w-4" />
                {presentableImages.length} {UI.photos}
              </button>
            )}
          </section>

          <div className="mx-auto w-full max-w-6xl px-4 pb-14">
            <section className="mt-8 rounded-3xl border border-white/10 p-4 md:p-6" style={{ backgroundColor: surface }}>
              <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <div className="space-y-5">
                    {landing.facts.slice(0, 6).map((fact) => (
                      <article key={fact.id}>
                        <div className="text-[11px] uppercase tracking-[0.1em] text-white/40">{decodeEscapedUnicode(fact.title)}</div>
                        <div className="mt-1 text-2xl font-semibold text-white">{decodeEscapedUnicode(fact.value)}</div>
                        {fact.subtitle ? <div className="mt-0.5 text-xs text-white/45">{decodeEscapedUnicode(fact.subtitle)}</div> : null}
                      </article>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {landing.facts.slice(6).map((fact) => (
                    <article key={fact.id} className="relative min-h-[170px] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1e2a]">
                      {fact.image ? (
                        <img src={fact.image} alt={fact.title} className="absolute inset-0 h-full w-full object-cover opacity-70" />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#021019] via-[#021019]/70 to-transparent" />
                      <div className="relative z-10 p-4">
                        <div className="text-xs uppercase tracking-[0.08em] text-white/55">{decodeEscapedUnicode(fact.title)}</div>
                        <div className="mt-1 text-3xl font-semibold text-white">{decodeEscapedUnicode(fact.value)}</div>
                        {fact.subtitle ? <div className="mt-1 text-xs text-white/65">{decodeEscapedUnicode(fact.subtitle)}</div> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div
                ref={tickerViewportRef}
                className={`rw-feature-ticker-viewport mt-6 pb-1 ${isTickerDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onPointerDown={onTickerPointerDown}
                onPointerMove={onTickerPointerMove}
                onPointerUp={onTickerPointerEnd}
                onPointerCancel={onTickerPointerEnd}
                onContextMenu={(event) => event.preventDefault()}
              >
                <div className="rw-feature-ticker">
                  {[...tickerCycleItems, ...tickerCycleItems].map((feature, index) => (
                    <article key={`${feature.id}_${index}`} className="w-[118px] shrink-0 text-center select-none" draggable={false}>
                      <div className="relative mx-auto h-[108px] w-[108px] overflow-hidden rounded-full border border-white/20 bg-black/25">
                        {feature.image ? (
                          <img src={feature.image} alt={decodeEscapedUnicode(feature.title)} className="h-full w-full object-cover" draggable={false} />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_35%_25%,rgba(194,168,122,0.45),rgba(7,21,32,0.9))] text-xs uppercase tracking-[0.12em] text-white/80">
                            ЖК
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-white/80">{decodeEscapedUnicode(feature.title)}</div>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <section className="mt-12 rounded-3xl border border-white/10 p-4 md:p-6" style={{ backgroundColor: surface }}>
              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                <div>
                  <Heading size="h3" className="text-white">
                    {decodeEscapedUnicode(landing.plans.title || UI.plansFallback)}
                  </Heading>
                  {landing.plans.description && (
                    <p className="mt-2 max-w-3xl text-sm text-white/65">{decodeEscapedUnicode(landing.plans.description)}</p>
                  )}

                  <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
                    {planItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex w-full items-center gap-3 border-b border-white/10 px-4 py-4 text-left transition last:border-b-0 hover:bg-white/[0.04]"
                        style={{ backgroundColor: activePlan?.id === item.id ? 'rgba(255,255,255,0.06)' : 'transparent' }}
                      >
                        <button
                          type="button"
                          onClick={() => setActivePlanId(item.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <div className="min-w-[130px] text-sm font-semibold text-white">{decodeEscapedUnicode(item.name)}</div>
                          <div className="flex-1 text-sm text-white/75">{decodeEscapedUnicode(item.price || 'Цена по запросу')}</div>
                          <div className="w-24 text-sm text-white/65">{decodeEscapedUnicode(item.area || 'от -')}</div>
                          <div className="w-32 text-right text-xs text-white/55">{planVariantsLabel(item.variants)}</div>
                          <ChevronRight className="h-4 w-4 text-white/50" />
                        </button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openCatalogForPlan(item)}
                          className="shrink-0"
                        >
                          Смотреть
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button
                    className="mt-5"
                    variant="secondary"
                    onClick={() => openCatalogForPlan()}
                  >
                    {landing.plans.cta_label || UI.allPlans}
                  </Button>
                </div>

                <aside className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.1em] text-white/45">Формат</div>
                  <div className="mt-1 text-lg font-semibold text-white">{decodeEscapedUnicode(activePlan?.name || 'Планировка')}</div>
                  <div className="mt-3 text-sm text-white/65">{defaultPlanNote(activePlan)}</div>
                  <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
                    {activePlanImages.length ? (
                      <img
                        src={activePlanImages[activePlanImageIndex] || activePlanImages[0]}
                        alt={activePlan?.name}
                        className="h-[200px] w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-[200px] items-center justify-center bg-white/[0.04] text-sm text-white/35">
                        Планы из фида появятся после импорта
                      </div>
                    )}
                  </div>
                  {activePlanImages.length > 1 && (
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                      {activePlanImages.map((src, index) => (
                        <button
                          key={`${activePlan?.id}_preview_${index}`}
                          type="button"
                          onClick={() => setActivePlanImageIndex(index)}
                          className={`h-14 w-20 shrink-0 overflow-hidden rounded border ${
                            index === activePlanImageIndex ? 'border-white/80' : 'border-white/20'
                          }`}
                        >
                          <img src={src} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
            </section>

            <section className="mt-12">
              <Suspense
                fallback={(
                  <div className="h-[420px] animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]" />
                )}
              >
                <ComplexMap
                  title={c.title}
                  district={c.district}
                  metro={c.metro}
                  geo_lat={c.geo_lat}
                  geo_lon={c.geo_lon}
                  ctaLabel="Записаться на экскурсию"
                  onCtaClick={() =>
                    openLeadModal('view_details', {
                      page: 'complex',
                      block: 'map_cta',
                      object_id: c.id,
                      object_type: 'complex',
                    })
                  }
                />
              </Suspense>
            </section>

          </div>

          <ImageGallery
            images={presentableImages}
            initialIndex={galleryIndex}
            open={galleryOpen}
            onClose={() => setGalleryOpen(false)}
            title={c.title}
          />
          </>
        )}
      </div>
    </SiteLayout>
  )
}

