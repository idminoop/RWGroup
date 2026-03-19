import { Car, Footprints, Navigation, Star } from 'lucide-react'
import { Heading } from '@/components/ui/Typography'
import type { ComplexNearbyPlace, NearbyGroup } from '../../../shared/types'

type NearbyPlacesProps = {
  title?: string
  subtitle?: string
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

function buildBuckets(items: ComplexNearbyPlace[]): GroupBucket[] {
  const groupMap = new Map<GroupBucket['key'], { label?: string; categories: Map<string, CategoryBucket> }>()

  for (const item of items.slice(0, 20)) {
    const groupKey: GroupBucket['key'] = item.group || 'ungrouped'
    const groupLabel = item.group ? groupLabelByKey(item.group) : undefined
    const categoryLabel = normalizeCategoryLabel(item)
    const categoryKey = normalizeCategoryKey(item, categoryLabel)

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { label: groupLabel, categories: new Map() })
    }
    const group = groupMap.get(groupKey)!
    const scopedCategoryKey = `${groupKey}:${categoryKey}`
    if (!group.categories.has(scopedCategoryKey)) {
      group.categories.set(scopedCategoryKey, {
        key: scopedCategoryKey,
        label: categoryLabel,
        items: [],
      })
    }
    group.categories.get(scopedCategoryKey)!.items.push(item)
  }

  const orderedKeys: GroupBucket['key'][] = [
    ...GROUP_CONFIGS.map((item) => item.key).filter((key) => groupMap.has(key)),
    ...(groupMap.has('ungrouped') ? ['ungrouped' as const] : []),
  ]

  return orderedKeys.map((key) => {
    const group = groupMap.get(key)!
    return {
      key,
      label: group.label,
      categories: Array.from(group.categories.values()),
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
    <article className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0a1a26] aspect-[4/5]">
      {item.image_url ? (
        <img
          src={item.image_url}
          alt={item.name}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5">
          <span className="text-5xl opacity-40">{item.emoji || '📍'}</span>
        </div>
      )}

      {/* Gradient overlay */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

      {/* Content bottom */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-3">
        <div className="line-clamp-2 text-sm font-semibold leading-tight text-white sm:text-base">
          {item.name}
        </div>
        {item.description ? (
          <div className="mt-1 line-clamp-2 text-[11px] text-white/75 sm:text-xs">
            {item.description}
          </div>
        ) : null}

        {item.rating !== undefined && (
          <div className="mt-1.5">
            <RatingBadge rating={item.rating} count={item.reviews_count} />
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-white/85 sm:text-xs">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/40 px-2 py-0.5">
            <Footprints className="h-3 w-3" />
            {formatMinutes(item.walk_minutes)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/40 px-2 py-0.5">
            <Car className="h-3 w-3" />
            {formatMinutes(item.drive_minutes)}
          </span>
          <a
            href={routeUrl(originLat, originLon, item.lat, item.lon)}
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-sky-300 transition hover:bg-sky-500/25"
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

export default function NearbyPlaces({
  title = 'Места поблизости',
  subtitle = 'Почему здесь хочется жить',
  items,
  originLat,
  originLon,
  surfaceColor = '#071520',
}: NearbyPlacesProps) {
  if (!items.length) return null

  const buckets = buildBuckets(items)
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

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {bucket.categories.map((category) => (
                <div key={category.key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 md:p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.14em] text-white/75">
                      {category.label}
                    </h4>
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/55">
                      {category.items.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {category.items.map((item) => (
                      <PlaceCard
                        key={item.id}
                        item={item}
                        originLat={originLat}
                        originLon={originLon}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
