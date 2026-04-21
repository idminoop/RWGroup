import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  MapPin,
  X,
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
import JsonLd from '@/components/seo/JsonLd'
import { setPageMeta } from '@/lib/meta'
import type {
  Complex,
  ComplexLandingConfig,
  ComplexLandingInfoCard,
  ComplexLandingPlanItem,
  ComplexNearbyPlace,
  Property,
} from '../../shared/types'
import { useUiStore } from '@/store/useUiStore'

const ComplexMap = lazy(() => import('@/components/complex/ComplexMap'))
const NearbyPlaces = lazy(() => import('@/components/complex/NearbyPlaces'))

const UI = {
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

function normalizeFactCardColSpan(value: unknown): 1 | 2 | 3 {
  const parsed = toFiniteNumber(value)
  if (parsed === 2 || parsed === 3) return parsed
  return 1
}

function normalizeFactCardRowSpan(value: unknown): 1 | 2 {
  const parsed = toFiniteNumber(value)
  if (parsed === 2) return 2
  return 1
}

function normalizeInfoCardColSpan(value: unknown): 1 | 2 | 3 {
  return normalizeFactCardColSpan(value)
}

function normalizeInfoCardRowSpan(value: unknown): 1 | 2 {
  return normalizeFactCardRowSpan(value)
}

function dedupeImageUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const url = raw.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

function buildHiResModalImageUrl(url: string): string {
  const source = url.trim()
  if (!source) return source

  if (/images\.unsplash\.com/i.test(source)) {
    try {
      const parsed = new URL(source)
      const width = Number(parsed.searchParams.get('w') || '0')
      if (!Number.isFinite(width) || width < 2400) parsed.searchParams.set('w', '2400')
      const quality = Number(parsed.searchParams.get('q') || '0')
      if (!Number.isFinite(quality) || quality < 90) parsed.searchParams.set('q', '95')
      if (!parsed.searchParams.get('fit')) parsed.searchParams.set('fit', 'max')
      return parsed.toString()
    } catch {
      return source
    }
  }

  if (/wikimedia\.org/i.test(source)) {
    return source.replace(/\/\d+px-/i, '/2400px-')
  }

  return source
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

type InfoCardViewModel = {
  id: string
  title: string
  description?: string
  cover_image?: string
  modal_title: string
  modal_text: string
  gallery_images: string[]
  card_col_span: 1 | 2 | 3
  card_row_span: 1 | 2
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
  const [planGalleryOpen, setPlanGalleryOpen] = useState(false)
  const [planGalleryIndex, setPlanGalleryIndex] = useState(0)
  const [isAccordionExpanded, setIsAccordionExpanded] = useState(false)
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false)
  const [activeInfoCardId, setActiveInfoCardId] = useState('')
  const [activeInfoImageIndex, setActiveInfoImageIndex] = useState(0)
  const [isTickerDragging, setIsTickerDragging] = useState(false)
  const isTickerDraggingRef = useRef(false)
  const tickerAutoPosRef = useRef(0)
  const tickerManualPauseUntilRef = useRef(0)
  const tickerViewportRef = useRef<HTMLDivElement | null>(null)
  const tickerDragRef = useRef<{ active: boolean; startX: number; startScrollLeft: number }>({
    active: false,
    startX: 0,
    startScrollLeft: 0,
  })

  const pauseTickerAutoScroll = (durationMs = 1400) => {
    tickerManualPauseUntilRef.current = performance.now() + durationMs
  }

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

  useEffect(() => {
    if (!c) return
    const priceLabel = typeof c.price_from === 'number' ? ` — от ${formatPriceRub(c.price_from)}` : ''
    setPageMeta({
      title: `ЖК ${c.title}${priceLabel}`,
      description: c.description?.slice(0, 160) || `Жилой комплекс ${c.title}, ${c.district}`,
      ogImage: heroCover,
      ogType: 'product',
    })
  }, [c, heroCover])

  const complexLd = c ? {
    '@context': 'https://schema.org',
    '@type': 'ApartmentComplex',
    name: c.title,
    description: c.description || '',
    url: typeof window !== 'undefined' ? window.location.href : '',
    image: heroCover || '',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Москва',
      addressRegion: c.district,
    },
    ...(c.geo_lat && c.geo_lon ? {
      geo: {
        '@type': 'GeoCoordinates',
        latitude: c.geo_lat,
        longitude: c.geo_lon,
      },
    } : {}),
    ...(typeof c.price_from === 'number' ? {
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: c.price_from,
        priceCurrency: 'RUB',
      },
    } : {}),
  } : null

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
    const raw = Array.isArray(activePlan.preview_images) && activePlan.preview_images.length
      ? activePlan.preview_images
      : activePlan.preview_image
        ? [activePlan.preview_image]
        : []
    return dedupeImageUrls(raw)
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

  const photoFacts = useMemo(() => landing?.facts.slice(6) || [], [landing?.facts])
  const accordionSection = useMemo(() => {
    const section = landing?.accordion
    const rawItems = Array.isArray(section?.items) ? section.items : []
    const rawItem = rawItems.find((item) => (item?.text || '').trim() || (item?.image || '').trim() || (item?.title || '').trim()) || rawItems[0]
    const item = rawItem
      ? {
          text: decodeEscapedUnicode(rawItem.text || '').trim(),
          image: (rawItem.image || '').trim() || undefined,
          legacy_title: decodeEscapedUnicode(rawItem.title || '').trim(),
        }
      : null

    return {
      enabled: section?.enabled !== false,
      title: decodeEscapedUnicode(section?.title || item?.legacy_title || 'Подробнее о проекте'),
      item,
    }
  }, [landing?.accordion])
  const accordionCanExpand = useMemo(() => {
    const text = accordionSection.item?.text || ''
    return text.length > 520 || text.includes('\n')
  }, [accordionSection.item?.text])
  const infoCardsSection = useMemo(() => {
    const section = landing?.info_cards
    const rawItems = Array.isArray(section?.items) ? section.items : []
    const items: InfoCardViewModel[] = rawItems
      .map((item: ComplexLandingInfoCard) => {
        const title = decodeEscapedUnicode(item.title || '').trim()
        const description = decodeEscapedUnicode(item.description || '').trim()
        const modal_title = decodeEscapedUnicode(item.modal_title || title || '').trim()
        const modal_text = decodeEscapedUnicode(item.modal_text || description || '').trim()
        const cover_image = (item.cover_image || '').trim() || undefined
        const gallery_images = dedupeImageUrls([
          cover_image || '',
          ...((Array.isArray(item.gallery_images) ? item.gallery_images : []).map((src) => String(src || '').trim())),
        ])

        return {
          id: item.id,
          title: title || 'Карточка',
          description: description || undefined,
          cover_image,
          modal_title: modal_title || title || 'Подробная информация',
          modal_text,
          gallery_images,
          card_col_span: normalizeInfoCardColSpan(item.card_col_span),
          card_row_span: normalizeInfoCardRowSpan(item.card_row_span),
        }
      })
      .filter((item) => item.title || item.modal_text || item.cover_image)

    return {
      enabled: section?.enabled !== false,
      title: decodeEscapedUnicode(section?.title || 'Информация о ЖК').trim(),
      subtitle: decodeEscapedUnicode(section?.subtitle || '').trim(),
      items,
    }
  }, [landing?.info_cards])
  const activeInfoCard = useMemo(
    () => infoCardsSection.items.find((item) => item.id === activeInfoCardId) || infoCardsSection.items[0] || null,
    [activeInfoCardId, infoCardsSection.items]
  )
  const nearbySection = useMemo(() => {
    const nearby = landing?.nearby
    if (!nearby || nearby.enabled === false) {
      return {
        title: 'Места поблизости',
        subtitle: 'Пешком и на машине от жилого комплекса',
        collections: [],
        items: [] as ComplexNearbyPlace[],
      }
    }

    const candidates = Array.isArray(nearby.candidates) ? nearby.candidates : []
    const selectedSet = new Set((nearby.selected_ids || []).map((id) => String(id)))
    const selected = selectedSet.size ? candidates.filter((item) => selectedSet.has(item.id)) : candidates

    return {
      title: nearby.title || 'Места поблизости',
      subtitle: nearby.subtitle || 'Пешком и на машине от жилого комплекса',
      collections: Array.isArray(nearby.collections) ? nearby.collections : [],
      items: selected.slice(0, 20),
    }
  }, [landing?.nearby])

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
    setPlanGalleryOpen(false)
    setPlanGalleryIndex(0)
  }, [activePlan?.id])

  useEffect(() => {
    setIsAccordionExpanded(false)
  }, [accordionSection.item?.text, accordionSection.item?.image, c?.id])

  useEffect(() => {
    if (!infoCardsSection.items.length) {
      setActiveInfoCardId('')
      setIsInfoModalOpen(false)
      return
    }
    if (!infoCardsSection.items.some((item) => item.id === activeInfoCardId)) {
      setActiveInfoCardId(infoCardsSection.items[0].id)
    }
  }, [activeInfoCardId, infoCardsSection.items])

  useEffect(() => {
    setActiveInfoImageIndex(0)
  }, [activeInfoCard?.id])

  useEffect(() => {
    if (!activeInfoCard) return
    if (!activeInfoCard.gallery_images.length) {
      setActiveInfoImageIndex(0)
      return
    }
    if (activeInfoImageIndex >= activeInfoCard.gallery_images.length) {
      setActiveInfoImageIndex(0)
    }
  }, [activeInfoCard, activeInfoImageIndex])

  useEffect(() => {
    if (!isInfoModalOpen || !activeInfoCard) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsInfoModalOpen(false)
        return
      }
      if (event.key === 'ArrowRight' && activeInfoCard.gallery_images.length > 1) {
        setActiveInfoImageIndex((prev) => (prev + 1) % activeInfoCard.gallery_images.length)
      }
      if (event.key === 'ArrowLeft' && activeInfoCard.gallery_images.length > 1) {
        setActiveInfoImageIndex((prev) => (prev - 1 + activeInfoCard.gallery_images.length) % activeInfoCard.gallery_images.length)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeInfoCard, isInfoModalOpen])

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
      const isPausedByUser = now < tickerManualPauseUntilRef.current
      if (!isTickerDraggingRef.current && !isPausedByUser && hasOverflow) {
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
    pauseTickerAutoScroll(2200)
    tickerAutoPosRef.current = viewport.scrollLeft
    isTickerDraggingRef.current = true
    setIsTickerDragging(true)
    if (event.currentTarget.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Some browsers may reject pointer capture in edge cases.
      }
    }
  }

  const onTickerPointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const viewport = tickerViewportRef.current
    if (!viewport || !tickerDragRef.current.active) return
    event.preventDefault()
    pauseTickerAutoScroll(2200)
    const dx = event.clientX - tickerDragRef.current.startX
    viewport.scrollLeft = tickerDragRef.current.startScrollLeft - dx
    tickerAutoPosRef.current = viewport.scrollLeft
  }

  const onTickerPointerEnd: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const viewport = tickerViewportRef.current
    if (viewport) tickerAutoPosRef.current = viewport.scrollLeft
    pauseTickerAutoScroll(1200)
    tickerDragRef.current.active = false
    isTickerDraggingRef.current = false
    setIsTickerDragging(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onTickerTouchStart: React.TouchEventHandler<HTMLDivElement> = (event) => {
    const viewport = tickerViewportRef.current
    if (!viewport) return
    const touch = event.touches[0]
    if (!touch) return
    tickerDragRef.current = {
      active: true,
      startX: touch.clientX,
      startScrollLeft: viewport.scrollLeft,
    }
    pauseTickerAutoScroll(2200)
    tickerAutoPosRef.current = viewport.scrollLeft
    isTickerDraggingRef.current = true
    setIsTickerDragging(true)
  }

  const onTickerTouchMove: React.TouchEventHandler<HTMLDivElement> = (event) => {
    const viewport = tickerViewportRef.current
    if (!viewport || !tickerDragRef.current.active) return
    const touch = event.touches[0]
    if (!touch) return
    event.preventDefault()
    pauseTickerAutoScroll(2200)
    const dx = touch.clientX - tickerDragRef.current.startX
    viewport.scrollLeft = tickerDragRef.current.startScrollLeft - dx
    tickerAutoPosRef.current = viewport.scrollLeft
  }

  const onTickerTouchEnd: React.TouchEventHandler<HTMLDivElement> = () => {
    const viewport = tickerViewportRef.current
    if (viewport) tickerAutoPosRef.current = viewport.scrollLeft
    pauseTickerAutoScroll(1200)
    tickerDragRef.current.active = false
    isTickerDraggingRef.current = false
    setIsTickerDragging(false)
  }

  const openGallery = (index = 0) => {
    setGalleryIndex(index)
    setGalleryOpen(true)
  }

  const openPlanGallery = (index = 0) => {
    if (!activePlanImages.length) return
    const safeIndex = Math.min(Math.max(index, 0), activePlanImages.length - 1)
    setPlanGalleryIndex(safeIndex)
    setPlanGalleryOpen(true)
  }

  const openInfoModal = (cardId: string) => {
    setActiveInfoCardId(cardId)
    setActiveInfoImageIndex(0)
    setIsInfoModalOpen(true)
  }

  const closeInfoModal = () => {
    setIsInfoModalOpen(false)
  }

  const switchInfoCard = (cardId: string) => {
    setActiveInfoCardId(cardId)
    setActiveInfoImageIndex(0)
  }

  const stepInfoCard = (direction: 'prev' | 'next') => {
    if (!infoCardsSection.items.length || !activeInfoCard) return
    const currentIndex = infoCardsSection.items.findIndex((item) => item.id === activeInfoCard.id)
    if (currentIndex < 0) return
    const delta = direction === 'next' ? 1 : -1
    const nextIndex = (currentIndex + delta + infoCardsSection.items.length) % infoCardsSection.items.length
    switchInfoCard(infoCardsSection.items[nextIndex].id)
  }

  const stepInfoImage = (direction: 'prev' | 'next') => {
    if (!activeInfoCard || activeInfoCard.gallery_images.length <= 1) return
    const delta = direction === 'next' ? 1 : -1
    setActiveInfoImageIndex((prev) => (prev + delta + activeInfoCard.gallery_images.length) % activeInfoCard.gallery_images.length)
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

  const hasComplexPurchaseInfo =
    Boolean(c?.address || c?.building_type || typeof c?.queue_min === 'number') ||
    typeof c?.mortgage_available === 'boolean' ||
    typeof c?.installment_available === 'boolean' ||
    typeof c?.subsidy_available === 'boolean' ||
    typeof c?.military_mortgage_available === 'boolean'

  return (
    <SiteLayout>
      {complexLd && <JsonLd data={complexLd} />}
      <div className="overflow-x-hidden bg-[radial-gradient(circle_at_20%_0%,#0a2231_0%,#06141f_40%,#041019_100%)] text-white">
        {error && (
          <div className="mx-auto max-w-6xl px-4 pt-10">
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>
          </div>
        )}

        {!data || !landing ? (
          <div className="mx-auto max-w-6xl space-y-4 px-4 py-10">
            <div className="h-[300px] animate-pulse rounded-2xl bg-white/5 sm:h-[420px]" />
            <div className="h-40 animate-pulse rounded-2xl bg-white/5" />
          </div>
        ) : (
          <>
          <section className="relative h-[72svh] min-h-[460px] w-full overflow-hidden md:h-[78vh] md:min-h-[520px]">
            {heroImage ? (
              <img src={heroImage} alt={c.title} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-white/5" />
            )}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.15),transparent_35%),linear-gradient(to_top,rgba(2,8,16,0.95),rgba(2,8,16,0.35),rgba(2,8,16,0.1))]" />

            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-6xl px-4 pb-8 md:pb-12">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                {previewDraftMode && <Badge variant="warning">{UI.preview}</Badge>}
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {landing.tags.map((tag) => (
                  <span key={tag.id} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur-sm">
                    {decodeEscapedUnicode(tag.label)}
                  </span>
                ))}
              </div>

              <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-white sm:text-4xl md:text-6xl">
                {decodeEscapedUnicode(c.title)}
              </h1>

              <div className="mt-3 flex items-center gap-2 text-sm text-white/70">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>
                  {c.district}
                  {c.metro?.[0] ? ` • м. ${c.metro[0]}` : ''}
                </span>
              </div>

              {(c.mortgage_available || c.installment_available || c.subsidy_available || c.military_mortgage_available) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.mortgage_available && <Badge variant="secondary" className="bg-white/15 text-white">Ипотека</Badge>}
                  {c.installment_available && <Badge variant="secondary" className="bg-white/15 text-white">Рассрочка</Badge>}
                  {c.subsidy_available && <Badge variant="secondary" className="bg-white/15 text-white">Субсидия</Badge>}
                  {c.military_mortgage_available && <Badge variant="secondary" className="bg-white/15 text-white">Военная ипотека</Badge>}
                </div>
              )}

              <div className="mt-6 flex flex-col items-start gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                <div className="rounded-xl border border-white/20 bg-black/35 px-5 py-3 backdrop-blur">
                  <div className="text-xs uppercase tracking-[0.1em] text-white/45">Цена от</div>
                  <div className="mt-1 text-2xl font-semibold text-white">
                    {typeof complexPriceFrom === 'number' ? formatPriceRub(complexPriceFrom) : 'Цена по запросу'}
                  </div>
                </div>
                <Button
                  className="h-11 w-full rounded-xl px-5 text-sm font-semibold sm:h-12 sm:w-auto sm:px-6"
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
                className="absolute right-3 top-3 flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-3 py-1.5 text-xs text-white backdrop-blur-sm transition hover:bg-black/60 sm:right-5 sm:top-5 sm:px-4 sm:py-2 sm:text-sm"
              >
                <Camera className="h-4 w-4" />
                {presentableImages.length} {UI.photos}
              </button>
            )}
          </section>

          <div className="mx-auto w-full max-w-6xl px-4 pb-14">
            {hasComplexPurchaseInfo && (
              <section className="mt-8 rounded-3xl border border-white/10 p-4 md:p-6" style={{ backgroundColor: surface }}>
                <Heading size="h3" className="text-white">Условия покупки и параметры дома</Heading>
                <div className="mt-4 grid gap-3 text-sm text-white/85 md:grid-cols-2">
                  {typeof c.mortgage_available === 'boolean' && (
                    <div><span className="text-white/55">Ипотека:</span> {c.mortgage_available ? 'Доступна' : 'Нет'}</div>
                  )}
                  {typeof c.installment_available === 'boolean' && (
                    <div><span className="text-white/55">Рассрочка:</span> {c.installment_available ? 'Доступна' : 'Нет'}</div>
                  )}
                  {typeof c.subsidy_available === 'boolean' && (
                    <div><span className="text-white/55">Субсидия:</span> {c.subsidy_available ? 'Доступна' : 'Нет'}</div>
                  )}
                  {typeof c.military_mortgage_available === 'boolean' && (
                    <div><span className="text-white/55">Военная ипотека:</span> {c.military_mortgage_available ? 'Доступна' : 'Нет'}</div>
                  )}
                  {c.address && (
                    <div><span className="text-white/55">Адрес:</span> {c.address}</div>
                  )}
                  {c.building_type && (
                    <div><span className="text-white/55">Тип дома:</span> {c.building_type}</div>
                  )}
                  {typeof c.queue_min === 'number' && (
                    <div><span className="text-white/55">Минимальная очередь:</span> {c.queue_min}</div>
                  )}
                </div>
              </section>
            )}
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

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 xl:auto-rows-[200px] xl:grid-flow-dense">
                  {photoFacts.map((fact) => {
                    const colSpan = normalizeFactCardColSpan(fact.card_col_span)
                    const rowSpan = normalizeFactCardRowSpan(fact.card_row_span)
                    const colSpanClass =
                      colSpan === 3
                        ? 'sm:col-span-2 xl:col-span-3'
                        : colSpan === 2
                          ? 'xl:col-span-2'
                          : ''
                    const rowSpanClass = rowSpan === 2 ? 'xl:row-span-2' : ''
                    const heightClass = rowSpan === 2 ? 'h-[260px] sm:h-[320px] xl:h-auto' : 'h-[200px] sm:h-[220px] xl:h-auto'

                    return (
                    <article
                      key={fact.id}
                      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1e2a] ${heightClass} ${colSpanClass} ${rowSpanClass}`}
                    >
                      {fact.image ? (
                        <img src={fact.image} alt={fact.title} className="absolute inset-0 h-full w-full object-cover opacity-70" />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#021019] via-[#021019]/70 to-transparent" />
                      <div className="relative z-10 p-4">
                        <div className="text-xs uppercase tracking-[0.08em] text-white/55">{decodeEscapedUnicode(fact.title)}</div>
                        <div className="mt-1 text-2xl font-semibold text-white sm:text-3xl">{decodeEscapedUnicode(fact.value)}</div>
                        {fact.subtitle ? <div className="mt-1 text-xs text-white/65">{decodeEscapedUnicode(fact.subtitle)}</div> : null}
                      </div>
                    </article>
                    )
                  })}
                </div>
              </div>

              <div
                ref={tickerViewportRef}
                className={`rw-feature-ticker-viewport mt-6 pb-1 ${isTickerDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onPointerDown={onTickerPointerDown}
                onPointerMove={onTickerPointerMove}
                onPointerUp={onTickerPointerEnd}
                onPointerCancel={onTickerPointerEnd}
                onTouchStart={onTickerTouchStart}
                onTouchMove={onTickerTouchMove}
                onTouchEnd={onTickerTouchEnd}
                onTouchCancel={onTickerTouchEnd}
                onContextMenu={(event) => event.preventDefault()}
              >
                <div className="rw-feature-ticker">
                  {[...tickerCycleItems, ...tickerCycleItems].map((feature, index) => (
                    <article key={`${feature.id}_${index}`} className="w-[102px] shrink-0 text-center select-none sm:w-[118px]" draggable={false}>
                      <div className="relative mx-auto h-[92px] w-[92px] overflow-hidden rounded-full border border-white/20 bg-black/25 sm:h-[108px] sm:w-[108px]">
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
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0">
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
                        className="flex w-full flex-col items-stretch gap-3 border-b border-white/10 px-3 py-3 text-left transition last:border-b-0 hover:bg-white/[0.04] md:flex-row md:items-center md:px-4 md:py-4"
                        style={{ backgroundColor: activePlan?.id === item.id ? 'rgba(255,255,255,0.06)' : 'transparent' }}
                      >
                        <button
                          type="button"
                          onClick={() => setActivePlanId(item.id)}
                          className="flex min-w-0 flex-1 flex-col gap-2 text-left md:flex-row md:items-center md:gap-3"
                        >
                          <div className="text-sm font-semibold text-white md:min-w-[100px] lg:min-w-[120px]">{decodeEscapedUnicode(item.name)}</div>
                          <div className="min-w-0 flex-1 text-sm text-white/75">{decodeEscapedUnicode(item.price || 'Цена по запросу')}</div>
                          <div className="flex flex-wrap items-center gap-3 md:ml-auto md:flex-nowrap md:gap-4">
                            <div className="text-sm text-white/65 md:w-24">{decodeEscapedUnicode(item.area || 'от -')}</div>
                            <div className="text-xs text-white/55 md:w-28 md:text-right lg:w-32">{planVariantsLabel(item.variants)}</div>
                            <ChevronRight className="hidden h-4 w-4 text-white/50 md:block" />
                          </div>
                        </button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openCatalogForPlan(item)}
                          className="w-full shrink-0 md:w-auto"
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

                <aside className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.1em] text-white/45">Формат</div>
                  <div className="mt-1 text-lg font-semibold text-white">{decodeEscapedUnicode(activePlan?.name || 'Планировка')}</div>
                  <div className="mt-3 text-sm text-white/65">{defaultPlanNote(activePlan)}</div>
                  <div className="group mt-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
                    {activePlanImages.length ? (
                      <img
                        src={activePlanImages[activePlanImageIndex] || activePlanImages[0]}
                        alt={activePlan?.name}
                        className="h-[220px] w-full cursor-zoom-in object-contain p-2 transition-transform duration-300 ease-out group-hover:scale-110 sm:h-[260px]"
                        onClick={() => openPlanGallery(activePlanImageIndex)}
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    ) : (
                      <div className="flex h-[220px] items-center justify-center text-sm text-white/35 sm:h-[260px]">
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
                          className={`h-16 w-20 shrink-0 overflow-hidden rounded border bg-white/[0.04] ${
                            index === activePlanImageIndex ? 'border-white/80' : 'border-white/20'
                          }`}
                        >
                          <img
                            src={src}
                            alt=""
                            className="h-full w-full object-contain p-0.5"
                            onError={(e) => { e.currentTarget.style.display = 'none' }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
            </section>

            {accordionSection.enabled && accordionSection.item && (accordionSection.item.text || accordionSection.item.image) && (
              <section className="mt-12 rounded-3xl border border-white/10 p-4 md:p-6" style={{ backgroundColor: surface }}>
                <Heading size="h3" className="text-white">
                  {accordionSection.title}
                </Heading>

                {accordionSection.item.image ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                    <img src={accordionSection.item.image} alt={accordionSection.title} className="h-[220px] w-full object-cover sm:h-[320px]" />
                  </div>
                ) : null}

                <div className="relative mt-4">
                  <div className={!isAccordionExpanded && accordionCanExpand ? 'max-h-[180px] overflow-hidden' : ''}>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-white/80">
                      {accordionSection.item.text}
                    </p>
                  </div>
                  {!isAccordionExpanded && accordionCanExpand ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#05131c] to-transparent" />
                  ) : null}
                </div>

                {accordionCanExpand && (
                  <button
                    type="button"
                    className="mt-3 text-sm text-white/85 underline decoration-white/40 underline-offset-4 transition hover:text-white"
                    onClick={() => setIsAccordionExpanded((prev) => !prev)}
                  >
                    {isAccordionExpanded ? 'Свернуть' : 'Читать полностью'}
                  </button>
                )}
              </section>
            )}

            {infoCardsSection.enabled && infoCardsSection.items.length > 0 && (
              <section className="mt-12 rounded-3xl border border-white/10 p-4 md:p-6" style={{ backgroundColor: surface }}>
                {(infoCardsSection.title || infoCardsSection.subtitle) && (
                  <div className="mb-4 md:mb-5">
                    {infoCardsSection.title ? (
                      <Heading size="h3" className="text-white">
                        {infoCardsSection.title}
                      </Heading>
                    ) : null}
                    {infoCardsSection.subtitle ? (
                      <p className="mt-2 max-w-3xl text-sm text-white/65">{infoCardsSection.subtitle}</p>
                    ) : null}
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2 xl:auto-rows-[220px] xl:grid-cols-3 xl:grid-flow-dense">
                  {infoCardsSection.items.map((card) => {
                    const colSpanClass =
                      card.card_col_span === 3
                        ? 'md:col-span-2 xl:col-span-3'
                        : card.card_col_span === 2
                          ? 'xl:col-span-2'
                          : ''
                    const rowSpanClass = card.card_row_span === 2 ? 'xl:row-span-2' : ''
                    const heightClass = card.card_row_span === 2 ? 'h-[300px] xl:h-auto' : 'h-[220px] xl:h-auto'
                    const image = card.cover_image || card.gallery_images[0]
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => openInfoModal(card.id)}
                        className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1e2a] text-left ${heightClass} ${colSpanClass} ${rowSpanClass}`}
                      >
                        {image ? (
                          <img
                            src={image}
                            alt={card.title}
                            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          />
                        ) : null}
                        <div className="absolute inset-0 bg-gradient-to-t from-[#020b12]/95 via-[#020b12]/45 to-transparent" />
                        <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
                          <div className="text-base font-semibold text-white md:text-lg">{card.title}</div>
                          {card.description ? <div className="mt-1 line-clamp-2 text-xs text-white/75">{card.description}</div> : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            <section className="mt-12">
              <Suspense
                fallback={(
                  <div className="h-[300px] animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] sm:h-[420px]" />
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

            {nearbySection.items.length > 0 && (
              <section className="mt-12">
                <Suspense
                  fallback={(
                    <div className="h-[360px] animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] sm:h-[460px]" />
                  )}
                >
                  <NearbyPlaces
                    title={decodeEscapedUnicode(nearbySection.title)}
                    subtitle={decodeEscapedUnicode(nearbySection.subtitle)}
                    collections={nearbySection.collections}
                    items={nearbySection.items}
                    surfaceColor={surface}
                  />
                </Suspense>
              </section>
            )}

          </div>

          {isInfoModalOpen && activeInfoCard && (
            <div className="fixed inset-0 z-[2500] bg-[#020b12]/95 backdrop-blur-sm">
              <div className="h-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
                <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                      {infoCardsSection.items.map((card) => (
                        <button
                          key={`modal_tab_${card.id}`}
                          type="button"
                          onClick={() => switchInfoCard(card.id)}
                          className={`h-10 shrink-0 rounded-sm border px-4 text-sm font-semibold transition ${
                            card.id === activeInfoCard.id
                              ? 'border-amber-300/80 bg-amber-300 text-[#081015]'
                              : 'border-white/10 bg-[#071923] text-white/85 hover:bg-[#0b2433]'
                          }`}
                        >
                          {card.title}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={closeInfoModal}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
                      aria-label="Закрыть"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
                    <div className="rounded-2xl border border-white/10 bg-[#041520] p-5 xl:h-[640px]">
                      <div className="flex h-full flex-col justify-start">
                        <h3 className="text-3xl font-semibold text-white sm:text-4xl">
                          {activeInfoCard.modal_title || activeInfoCard.title}
                        </h3>
                        {activeInfoCard.modal_text ? (
                          <p className="mt-5 whitespace-pre-line text-base leading-relaxed text-white/85">
                            {activeInfoCard.modal_text}
                          </p>
                        ) : (
                          <p className="mt-5 text-sm text-white/60">Добавьте расширенный текст в админке для этой карточки.</p>
                        )}

                        <div className="mt-6 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => stepInfoCard('prev')}
                            className="inline-flex h-9 items-center gap-1 rounded-md border border-white/20 bg-white/5 px-3 text-xs text-white/85 transition hover:bg-white/10"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                            Пред.
                          </button>
                          <button
                            type="button"
                            onClick={() => stepInfoCard('next')}
                            className="inline-flex h-9 items-center gap-1 rounded-md border border-white/20 bg-white/5 px-3 text-xs text-white/85 transition hover:bg-white/10"
                          >
                            След.
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/25">
                      {activeInfoCard.gallery_images.length ? (
                        <img
                          src={buildHiResModalImageUrl(activeInfoCard.gallery_images[activeInfoImageIndex] || activeInfoCard.gallery_images[0])}
                          alt={activeInfoCard.title}
                          className="h-[320px] w-full object-contain bg-[#021019] sm:h-[420px] xl:h-[640px]"
                        />
                      ) : activeInfoCard.cover_image ? (
                        <img
                          src={buildHiResModalImageUrl(activeInfoCard.cover_image)}
                          alt={activeInfoCard.title}
                          className="h-[320px] w-full object-contain bg-[#021019] sm:h-[420px] xl:h-[640px]"
                        />
                      ) : (
                        <div className="flex h-[320px] items-center justify-center text-sm text-white/45 sm:h-[420px] xl:h-[640px]">Изображение не выбрано</div>
                      )}

                      {activeInfoCard.gallery_images.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() => stepInfoImage('prev')}
                            className="absolute bottom-5 left-5 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#021019] text-white/90 transition hover:bg-[#04324a]"
                            aria-label="Предыдущее фото"
                          >
                            <ChevronLeft className="h-5 w-5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => stepInfoImage('next')}
                            className="absolute bottom-5 right-5 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#021019] text-white/90 transition hover:bg-[#04324a]"
                            aria-label="Следующее фото"
                          >
                            <ChevronRight className="h-5 w-5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {activeInfoCard.gallery_images.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {activeInfoCard.gallery_images.map((src, index) => (
                        <button
                          key={`modal_thumb_${activeInfoCard.id}_${index}`}
                          type="button"
                          onClick={() => setActiveInfoImageIndex(index)}
                          className={`h-20 w-28 shrink-0 overflow-hidden rounded border ${
                            index === activeInfoImageIndex ? 'border-amber-300' : 'border-white/20'
                          }`}
                        >
                          <img src={src} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <ImageGallery
            images={presentableImages}
            initialIndex={galleryIndex}
            open={galleryOpen}
            onClose={() => setGalleryOpen(false)}
            title={c.title}
          />
          <ImageGallery
            images={activePlanImages}
            initialIndex={planGalleryIndex}
            open={planGalleryOpen}
            onClose={() => setPlanGalleryOpen(false)}
            title={`${c.title} — ${decodeEscapedUnicode(activePlan?.name || UI.plansFallback)}`}
          />
          </>
        )}
      </div>
    </SiteLayout>
  )
}
