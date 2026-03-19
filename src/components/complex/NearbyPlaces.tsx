import { useEffect, useRef, useState, type MouseEventHandler, type PointerEventHandler } from 'react'
import { Car, Footprints, Navigation, Star } from 'lucide-react'
import { Heading } from '@/components/ui/Typography'
import type { ComplexNearbyCollection, ComplexNearbyPlace, NearbyGroup } from '../../../shared/types'

type NearbyPlacesProps = {
  title?: string
  subtitle?: string
  collections?: ComplexNearbyCollection[]
  items: ComplexNearbyPlace[]
  originLat?: number
  originLon?: number
  surfaceColor?: string
}

type GroupConfig = {
  key: NearbyGroup
  label: string
}

type CategoryBucket = {
  key: string
  label: string
  order: number
  appearance: number
  items: ComplexNearbyPlace[]
}

type GroupBucket = {
  key: NearbyGroup | 'ungrouped'
  label?: string
  categories: CategoryBucket[]
}

const GROUP_CONFIGS: GroupConfig[] = [
  { key: 'life', label: 'Жизнь рядом' },
  { key: 'leisure', label: 'Досуг' },
  { key: 'family', label: 'Для семьи и спорта' },
]
const CAROUSEL_SPEED_PX_PER_SEC = 20
const CAROUSEL_INTERACTION_PAUSE_MS = 1400

function formatMinutes(minutes: number): string {
  const value = Math.max(1, Math.round(minutes || 0))
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return `${value} мин`
  return `${value} мин`
}

function routeUrl(originLat: number | undefined, originLon: number | undefined, lat: number, lon: number): string {
  if (typeof originLat === 'number' && typeof originLon === 'number') {
    return `https://yandex.ru/maps/?rtext=${originLat},${originLon}~${lat},${lon}&rtt=auto`
  }
  return `https://yandex.ru/maps/?pt=${lon},${lat}&z=15`
}

function normalizeCategoryLabel(item: ComplexNearbyPlace): string {
  const category = (item.category || '').trim()
  if (category) return category
  const categoryKey = (item.category_key || '').trim()
  if (!categoryKey) return 'Подборка'
  return categoryKey
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

function normalizeCategoryKey(item: ComplexNearbyPlace, fallbackLabel: string): string {
  const key = (item.category_key || '').trim()
  if (key) return key
  return fallbackLabel
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9а-яё_]/gi, '')
    .replace(/^_+|_+$/g, '') || 'manual'
}

function groupLabelByKey(key: NearbyGroup): string {
  return GROUP_CONFIGS.find((item) => item.key === key)?.label || key
}

function buildBuckets(items: ComplexNearbyPlace[], collections?: ComplexNearbyCollection[]): GroupBucket[] {
  const collectionMetaByKey = new Map<string, { label: string; group?: NearbyGroup; order: number }>()
  ;(collections || []).forEach((collection, order) => {
    const key = (collection.key || '').trim()
    if (!key || collectionMetaByKey.has(key)) return
    collectionMetaByKey.set(key, {
      label: (collection.label || '').trim() || 'Подборка',
      group: collection.group,
      order,
    })
  })

  const groupMap = new Map<GroupBucket['key'], { label?: string; categories: Map<string, CategoryBucket> }>()
  let appearance = 0

  for (const item of items.slice(0, 20)) {
    const categoryKey = normalizeCategoryKey(item, normalizeCategoryLabel(item))
    const meta = collectionMetaByKey.get(categoryKey)
    const groupKey: GroupBucket['key'] = item.group || meta?.group || 'ungrouped'
    const groupLabel = item.group ? groupLabelByKey(item.group) : (meta?.group ? groupLabelByKey(meta.group) : undefined)
    const categoryLabel = meta?.label || normalizeCategoryLabel(item)

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { label: groupLabel, categories: new Map() })
    }
    const group = groupMap.get(groupKey)!
    const scopedCategoryKey = `${groupKey}:${categoryKey}`
    if (!group.categories.has(scopedCategoryKey)) {
      group.categories.set(scopedCategoryKey, {
        key: scopedCategoryKey,
        label: categoryLabel,
        order: meta?.order ?? Number.MAX_SAFE_INTEGER,
        appearance: appearance++,
        items: [],
      })
    }
    const bucket = group.categories.get(scopedCategoryKey)!
    if (meta?.label && !bucket.items.length) bucket.label = meta.label
    group.categories.get(scopedCategoryKey)!.items.push(item)
  }

  const orderedKeys: GroupBucket['key'][] = [
    ...GROUP_CONFIGS.map((item) => item.key).filter((key) => groupMap.has(key)),
    ...(groupMap.has('ungrouped') ? ['ungrouped' as const] : []),
  ]

  return orderedKeys.map((key) => {
    const group = groupMap.get(key)!
    const categories = Array.from(group.categories.values())
      .sort((a, b) => (a.order - b.order) || (a.appearance - b.appearance))
    return {
      key,
      label: group.label,
      categories,
    }
  })
}

function RatingBadge({ rating, count }: { rating: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
      <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
      {rating.toFixed(1)}
      {count !== undefined && count > 0 && (
        <span className="text-amber-400/70">· {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}</span>
      )}
    </span>
  )
}

function PlaceCard({
  item,
  originLat,
  originLon,
}: {
  item: ComplexNearbyPlace
  originLat?: number
  originLon?: number
}) {
  return (
    <article className="group relative aspect-[4/5] overflow-hidden rounded-2xl bg-[#0a1a26] shadow-[0_18px_45px_rgba(0,0,0,0.45)]">
      {item.image_url ? (
        <img
          src={item.image_url}
          alt={item.name}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.06]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5">
          <span className="text-5xl opacity-40">{item.emoji || '📍'}</span>
        </div>
      )}

      {/* Gradient overlay */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#02050b]/95 via-[#02050b]/35 to-transparent" />

      {/* Content bottom */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-3 sm:p-3.5">
        <div className="line-clamp-2 text-sm font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)] sm:text-base">
          {item.name}
        </div>
        {item.description ? (
          <div className="mt-1 line-clamp-2 text-[11px] text-white/80 drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)] sm:text-xs">
            {item.description}
          </div>
        ) : null}

        {item.rating !== undefined && (
          <div className="mt-1.5">
            <RatingBadge rating={item.rating} count={item.reviews_count} />
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-white/85 sm:text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/35 px-2 py-0.5 backdrop-blur-sm">
            <Footprints className="h-3 w-3" />
            {formatMinutes(item.walk_minutes)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-black/35 px-2 py-0.5 backdrop-blur-sm">
            <Car className="h-3 w-3" />
            {formatMinutes(item.drive_minutes)}
          </span>
          <a
            href={routeUrl(originLat, originLon, item.lat, item.lon)}
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-0.5 text-sky-200 backdrop-blur-sm transition hover:bg-sky-500/30"
            aria-label={`Маршрут до ${item.name}`}
          >
            <Navigation className="h-3 w-3" />
            Маршрут
          </a>
        </div>
      </div>
    </article>
  )
}

function CollectionCarousel({
  items,
  originLat,
  originLon,
}: {
  items: ComplexNearbyPlace[]
  originLat?: number
  originLon?: number
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const autoPosRef = useRef(0)
  const pauseUntilRef = useRef(0)
  const dragStateRef = useRef({
    active: false,
    startX: 0,
    startScrollLeft: 0,
    pointerId: null as number | null,
  })
  const movedDuringDragRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  const hasLoop = items.length > 1
  const loopItems = hasLoop ? [...items, ...items] : items

  const pauseAutoScroll = (ms: number = CAROUSEL_INTERACTION_PAUSE_MS) => {
    pauseUntilRef.current = Math.max(pauseUntilRef.current, performance.now() + ms)
  }

  const normalizeLoopPosition = () => {
    const viewport = viewportRef.current
    if (!viewport || !hasLoop) return
    const cycleWidth = viewport.scrollWidth / 2
    if (cycleWidth <= 1) return
    let next = viewport.scrollLeft
    while (next >= cycleWidth) next -= cycleWidth
    while (next < 0) next += cycleWidth
    if (next !== viewport.scrollLeft) viewport.scrollLeft = next
    autoPosRef.current = viewport.scrollLeft
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollLeft = 0
    autoPosRef.current = 0
  }, [items.length, hasLoop])

  useEffect(() => {
    if (!hasLoop) return

    let rafId = 0
    let lastTime = performance.now()

    const tick = (now: number) => {
      const viewport = viewportRef.current
      if (!viewport) {
        rafId = window.requestAnimationFrame(tick)
        return
      }

      const dt = now - lastTime
      lastTime = now

      const hasOverflow = viewport.scrollWidth > viewport.clientWidth + 1
      const isPaused = now < pauseUntilRef.current || dragStateRef.current.active
      if (hasOverflow && !isPaused) {
        autoPosRef.current += (CAROUSEL_SPEED_PX_PER_SEC * dt) / 1000
        viewport.scrollLeft = autoPosRef.current
        normalizeLoopPosition()
      } else {
        autoPosRef.current = viewport.scrollLeft
        normalizeLoopPosition()
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [hasLoop, loopItems.length])

  const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    const viewport = viewportRef.current
    if (!viewport) return
    movedDuringDragRef.current = false
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
      pointerId: event.pointerId,
    }
    setIsDragging(true)
    pauseAutoScroll(2200)
    autoPosRef.current = viewport.scrollLeft
    if (event.currentTarget.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Ignore pointer capture edge cases.
      }
    }
  }

  const onPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const viewport = viewportRef.current
    if (!viewport || !dragStateRef.current.active) return
    event.preventDefault()
    const dx = event.clientX - dragStateRef.current.startX
    if (Math.abs(dx) > 4) movedDuringDragRef.current = true
    viewport.scrollLeft = dragStateRef.current.startScrollLeft - dx
    normalizeLoopPosition()
    autoPosRef.current = viewport.scrollLeft
    pauseAutoScroll(2200)
  }

  const endPointerInteraction = (event?: { currentTarget: HTMLDivElement; pointerId: number }) => {
    const viewport = viewportRef.current
    if (viewport) {
      normalizeLoopPosition()
      autoPosRef.current = viewport.scrollLeft
    }
    dragStateRef.current.active = false
    dragStateRef.current.pointerId = null
    setIsDragging(false)
    pauseAutoScroll(1200)
    if (movedDuringDragRef.current) {
      window.setTimeout(() => {
        movedDuringDragRef.current = false
      }, 0)
    }
    if (event && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onPointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
    endPointerInteraction(event)
  }

  const onPointerCancel: PointerEventHandler<HTMLDivElement> = (event) => {
    endPointerInteraction(event)
  }

  const onClickCapture: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!movedDuringDragRef.current) return
    movedDuringDragRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={viewportRef}
      className={`-mx-1 overflow-x-auto pb-2 pt-0.5 select-none [&::-webkit-scrollbar]:hidden ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ touchAction: 'pan-y', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={onClickCapture}
      onMouseEnter={() => pauseAutoScroll(2600)}
    >
      <div className="flex min-w-max gap-4 px-1">
        {loopItems.map((item, index) => (
          <div key={`${item.id}_${index}`} className="w-[230px] shrink-0 sm:w-[260px] lg:w-[290px]">
            <PlaceCard item={item} originLat={originLat} originLon={originLon} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function NearbyPlaces({
  title = 'Места поблизости',
  subtitle = 'Почему здесь хочется жить',
  collections,
  items,
  originLat,
  originLon,
  surfaceColor = '#071520',
}: NearbyPlacesProps) {
  if (!items.length) return null

  const buckets = buildBuckets(items, collections)
  const hasNamedGroups = buckets.some((bucket) => bucket.key !== 'ungrouped')

  return (
    <section className="rounded-3xl border border-white/10 p-4 md:p-8" style={{ backgroundColor: surfaceColor }}>
      {/* Section header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading size="h3" className="text-white uppercase tracking-[0.08em]">
            {title}
          </Heading>
          <p className="mt-1 text-sm text-white/55">{subtitle}</p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/50">
          {items.length} {items.length === 1 ? 'место' : items.length >= 2 && items.length <= 4 ? 'места' : 'мест'}
        </span>
      </div>

      <div className="space-y-8">
        {buckets.map((bucket) => (
          <div key={bucket.key} className="space-y-3">
            {(bucket.key !== 'ungrouped' || hasNamedGroups) && bucket.label ? (
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-semibold uppercase tracking-widest text-white/70">
                  {bucket.label}
                </span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
            ) : null}

            <div className="space-y-6">
              {bucket.categories.map((category) => (
                <div key={category.key} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.16em] text-white/80">
                      {category.label}
                    </h4>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/65">
                      {category.items.length}
                    </span>
                  </div>
                  <CollectionCarousel items={category.items} originLat={originLat} originLon={originLon} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
