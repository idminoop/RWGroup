import type {
  Complex,
  ComplexLandingConfig,
  ComplexLandingFact,
  ComplexLandingFeature,
  ComplexLandingNearby,
  ComplexLandingPlanItem,
  ComplexLandingTag,
  ComplexNearbyCollection,
  ComplexNearbyPlace,
  Property,
} from '../../shared/types'

const DEFAULT_ACCENT = '#C2A87A'
const DEFAULT_SURFACE = '#071520'
const KREMLIN_COORDS = { lat: 55.752023, lon: 37.617499 }
const PLAN_IMAGE_RX = /(plan|layout|preset|floor)/i
export const MAX_LANDING_FACTS = 12
const MAX_NEARBY_CANDIDATES = 63 // up to 3 per category × 21 categories
const MAX_NEARBY_SELECTED = 20
const MAX_NEARBY_IMAGE_VARIANTS = 24

export const FACT_IMAGE_PRESETS = [
  'https://images.unsplash.com/photo-1515263487990-61b07816b324?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1616046229478-9901c5536a45?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1565182999561-18d7dc61c393?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1616486029423-aaa4789e8c9a?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80',
]

export type LandingFeaturePreset = {
  key: string
  title: string
  image: string
}

export const LANDING_FEATURE_PRESETS: LandingFeaturePreset[] = []

const DEFAULT_FEATURES: string[] = []

const FEATURE_KEYWORDS: Array<{ title: string; rx: RegExp }> = []

function makeId(prefix = 'cfg'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function toText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16))
    } catch {
      return _match
    }
  })
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const normalized = value.replace(/\s/g, '').replace(',', '.')
    const parsed = Number(normalized)
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

function isLikelyPlanImage(url?: string): boolean {
  return Boolean(url && PLAN_IMAGE_RX.test(url))
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function uniq(strings: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of strings.map((v) => v.trim()).filter(Boolean)) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function formatMoney(value?: number): string {
  const num = toFiniteNumber(value)
  if (typeof num !== 'number' || num <= 0) return 'Цена по запросу'
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(num))} ₽`
}

function formatArea(value?: number): string {
  const num = toFiniteNumber(value)
  if (typeof num !== 'number' || num <= 0) return 'По запросу'
  return `от ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(num)} м²`
}

function bedroomsLabel(value: number): string {
  if (value <= 0) return 'Студия'
  if (value === 1) return '1 спальня'
  if (value >= 2 && value <= 4) return `${value} спальни`
  return `${value} спален`
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const earthRadius = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

function inferFeatureTitles(description?: string): string[] {
  const text = (description || '').trim()
  if (!text) return DEFAULT_FEATURES
  const matched = FEATURE_KEYWORDS.filter((item) => item.rx.test(text)).map((item) => item.title)
  return uniq([...matched, ...DEFAULT_FEATURES]).slice(0, 12)
}

function collectPlanPreviewImages(images?: string[]): string[] {
  if (!Array.isArray(images) || !images.length) return []
  const matched = images.filter((url) => PLAN_IMAGE_RX.test(url))
  return uniq(matched.length ? matched : images).slice(0, 12)
}

function normalizeNearbyCollectionKey(value?: string): string {
  return toText(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9а-яё_]/gi, '')
    .replace(/^_+|_+$/g, '') || '__none__'
}

function normalizeNearbyCollectionLabel(value?: string, fallbackKey?: string): string {
  const label = toText(value).trim()
  if (label) return label
  const key = normalizeNearbyCollectionKey(fallbackKey)
  if (key === '__none__') return 'Подборка'
  return key
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

function inferPlanItems(complex: Complex, properties: Property[]): ComplexLandingPlanItem[] {
  const grouped = new Map<number, {
    minPrice?: number
    minArea?: number
    variants: number
    preview?: string
    previews: Set<string>
  }>()

  for (const property of properties) {
    if (property.status !== 'active') continue
    if (!Number.isFinite(property.bedrooms)) continue

    const bedrooms = property.bedrooms
    const current = grouped.get(bedrooms) || { variants: 0, previews: new Set<string>() }
    current.variants += 1

    const priceValue = toFiniteNumber(property.price)
    if (typeof priceValue === 'number' && (!current.minPrice || priceValue < current.minPrice)) {
      current.minPrice = priceValue
    }

    const areaValue = toFiniteNumber(property.area_total)
    if (typeof areaValue === 'number' && (!current.minArea || areaValue < current.minArea)) {
      current.minArea = areaValue
    }

    const previews = collectPlanPreviewImages(property.images)
    previews.forEach((url) => current.previews.add(url))

    if (!current.preview) {
      current.preview = previews[0] || property.images?.[0]
    }

    grouped.set(bedrooms, current)
  }

  const complexMinPrice = toFiniteNumber(complex.price_from)
  const complexMinArea = toFiniteNumber(complex.area_from)

  const items = Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bedrooms, data]) => createLandingPlanItem({
      name: bedroomsLabel(bedrooms),
      price: formatMoney(data.minPrice ?? complexMinPrice),
      area: formatArea(data.minArea ?? complexMinArea),
      variants: data.variants,
      bedrooms,
      preview_image: data.preview,
      preview_images: Array.from(data.previews).slice(0, 12),
      note: `Доступно ${data.variants} вариантов`,
    }))

  if (items.length > 0) return items

  return [
    createLandingPlanItem({ name: 'Студия', price: formatMoney(complexMinPrice), area: formatArea(complexMinArea), variants: 0, bedrooms: 0 }),
    createLandingPlanItem({ name: '1 спальня', price: formatMoney(complexMinPrice), area: formatArea(complexMinArea), variants: 0, bedrooms: 1 }),
    createLandingPlanItem({ name: '2 спальни', price: formatMoney(complexMinPrice), area: formatArea(complexMinArea), variants: 0, bedrooms: 2 }),
    createLandingPlanItem({ name: '3 спальни', price: formatMoney(complexMinPrice), area: formatArea(complexMinArea), variants: 0, bedrooms: 3 }),
  ]
}

export function getFeaturePresetByKey(key?: string): LandingFeaturePreset | undefined {
  if (!key) return undefined
  return LANDING_FEATURE_PRESETS.find((item) => item.key === key)
}

function getFeaturePresetByTitle(title?: string): LandingFeaturePreset | undefined {
  const name = (title || '').trim().toLowerCase()
  if (!name) return undefined
  return LANDING_FEATURE_PRESETS.find((item) => item.title.toLowerCase() === name)
}

export function inferFeaturePresetKey(feature: Pick<ComplexLandingFeature, 'title' | 'image' | 'preset_key'>): string | undefined {
  const rawKey = toText(feature.preset_key)
  if (rawKey) return rawKey

  const byTitle = getFeaturePresetByTitle(feature.title)
  if (byTitle) return byTitle.key

  if (feature.image) {
    const byImage = LANDING_FEATURE_PRESETS.find((item) => item.image === feature.image)
    if (byImage) return byImage.key
  }

  return undefined
}

export function createLandingTag(partial?: Partial<ComplexLandingTag>): ComplexLandingTag {
  return {
    id: partial?.id || makeId('tag'),
    label: toText(partial?.label) || 'Новостройка',
  }
}

export function createLandingFact(partial?: Partial<ComplexLandingFact>): ComplexLandingFact {
  return {
    id: partial?.id || makeId('fact'),
    title: toText(partial?.title) || 'Факт',
    value: toText(partial?.value) || 'По запросу',
    subtitle: toText(partial?.subtitle) || undefined,
    image: toText(partial?.image) || undefined,
    card_col_span: normalizeFactCardColSpan(partial?.card_col_span),
    card_row_span: normalizeFactCardRowSpan(partial?.card_row_span),
  }
}

export function createLandingFeature(partial?: Partial<ComplexLandingFeature>): ComplexLandingFeature {
  const preset = getFeaturePresetByKey(partial?.preset_key) || getFeaturePresetByTitle(partial?.title)
  const rawImage = toText(partial?.image)
  const image = isLikelyPlanImage(rawImage) ? (preset?.image || undefined) : (rawImage || preset?.image || undefined)
  return {
    id: partial?.id || makeId('feature'),
    title: toText(partial?.title) || preset?.title || 'Фишка',
    image,
    preset_key: toText(partial?.preset_key) || preset?.key || undefined,
  }
}

export function createLandingPlanItem(partial?: Partial<ComplexLandingPlanItem>): ComplexLandingPlanItem {
  return {
    id: partial?.id || makeId('plan'),
    name: toText(partial?.name) || 'Планировка',
    price: toText(partial?.price) || 'Цена по запросу',
    area: toText(partial?.area) || 'от 0 м²',
    variants: typeof partial?.variants === 'number' ? partial.variants : 0,
    bedrooms: typeof partial?.bedrooms === 'number' ? partial.bedrooms : undefined,
    note: toText(partial?.note) || undefined,
    preview_image: toText(partial?.preview_image) || undefined,
    preview_images: safeArray<string>(partial?.preview_images).map((item) => toText(item)).filter(Boolean),
  }
}

export function createLandingNearbyPlace(partial?: Partial<ComplexNearbyPlace>): ComplexNearbyPlace {
  const imageVariants = safeArray<string>(partial?.image_variants)
    .map((item) => toText(item))
    .filter(Boolean)
    .slice(0, MAX_NEARBY_IMAGE_VARIANTS)

  return {
    id: partial?.id || makeId('nearby'),
    name: toText(partial?.name) || 'Место поблизости',
    description: toText(partial?.description) || undefined,
    category: toText(partial?.category) || undefined,
    category_key: toText(partial?.category_key) || undefined,
    group: partial?.group || undefined,
    emoji: toText(partial?.emoji) || undefined,
    lat: toFiniteNumber(partial?.lat) ?? 0,
    lon: toFiniteNumber(partial?.lon) ?? 0,
    walk_minutes: Math.max(1, Math.round(toFiniteNumber(partial?.walk_minutes) ?? 0)),
    drive_minutes: Math.max(1, Math.round(toFiniteNumber(partial?.drive_minutes) ?? 0)),
    rating: typeof partial?.rating === 'number' && Number.isFinite(partial.rating) ? partial.rating : undefined,
    reviews_count: typeof partial?.reviews_count === 'number' && Number.isFinite(partial.reviews_count) ? partial.reviews_count : undefined,
    image_url: toText(partial?.image_url) || undefined,
    image_variants: imageVariants.length ? imageVariants : undefined,
    image_fallback: typeof partial?.image_fallback === 'boolean' ? partial.image_fallback : undefined,
    image_custom: typeof partial?.image_custom === 'boolean' ? partial.image_custom : undefined,
  }
}

export function createLandingNearby(partial?: Partial<ComplexLandingNearby>): ComplexLandingNearby {
  const candidates = safeArray<Partial<ComplexNearbyPlace>>(partial?.candidates)
    .map((item) => createLandingNearbyPlace(item))
    .filter((item) =>
      Number.isFinite(item.lat)
      && Number.isFinite(item.lon)
      && (Math.abs(item.lat) > 0.0001 || Math.abs(item.lon) > 0.0001)
      && item.name.trim().length > 1
    )
    .slice(0, MAX_NEARBY_CANDIDATES)

  const candidateIds = new Set(candidates.map((item) => item.id))
  const selectedRaw = safeArray<string>(partial?.selected_ids)
    .map((item) => toText(item))
    .filter((item) => item.length > 0 && candidateIds.has(item))

  const seenSelected = new Set<string>()
  const selected_ids = selectedRaw
    .filter((item) => {
      if (seenSelected.has(item)) return false
      seenSelected.add(item)
      return true
    })
    .slice(0, MAX_NEARBY_SELECTED)

  const declaredCollections = safeArray<Partial<ComplexNearbyCollection>>(partial?.collections)
    .map((item) => {
      const key = normalizeNearbyCollectionKey(item?.key || item?.label)
      if (key === '__none__') return null
      return {
        key,
        label: normalizeNearbyCollectionLabel(item?.label, key),
        group: item?.group,
      } as ComplexNearbyCollection
    })
    .filter((item): item is ComplexNearbyCollection => Boolean(item))

  const autoCollectionsMap = new Map<string, ComplexNearbyCollection>()
  for (const candidate of candidates) {
    const key = normalizeNearbyCollectionKey(candidate.category_key || candidate.category)
    if (key === '__none__' || autoCollectionsMap.has(key)) continue
    autoCollectionsMap.set(key, {
      key,
      label: normalizeNearbyCollectionLabel(candidate.category, key),
      group: candidate.group,
    })
  }

  const collections: ComplexNearbyCollection[] = []
  const seenCollectionKeys = new Set<string>()
  for (const collection of [...declaredCollections, ...autoCollectionsMap.values()]) {
    if (seenCollectionKeys.has(collection.key)) continue
    seenCollectionKeys.add(collection.key)
    collections.push(collection)
  }

  return {
    enabled: typeof partial?.enabled === 'boolean' ? partial.enabled : true,
    title: toText(partial?.title) || 'Места поблизости',
    subtitle: toText(partial?.subtitle) || 'Пешком и на машине от жилого комплекса',
    refreshed_at: toText(partial?.refreshed_at) || undefined,
    collections: collections.length ? collections : undefined,
    candidates,
    selected_ids: selected_ids.length ? selected_ids : candidates.map((item) => item.id),
  }
}

function buildAutoFacts(complex: Complex, properties: Property[]): ComplexLandingFact[] {
  const activeLots = properties.filter((item) => item.status === 'active')
  const maxFloor = activeLots.reduce((max, item) => Math.max(max, item.floors_total || 0), 0)
  const totalLots = properties.length
  const inSaleLots = activeLots.length
  const hasParking = /паркинг|parking/i.test(complex.description || '')

  const minPriceFromLots = activeLots.reduce<number | undefined>((min, item) => {
    const current = toFiniteNumber(item.price)
    if (typeof current !== 'number' || current <= 0) return min
    if (typeof min !== 'number' || current < min) return current
    return min
  }, undefined)
  const priceFrom = toFiniteNumber(complex.price_from) ?? minPriceFromLots

  const cards: Array<Partial<ComplexLandingFact>> = [
    { title: 'Класс', value: complex.class || 'Премиум' },
    { title: 'Цена от', value: formatMoney(priceFrom) },
    { title: 'Площадь от', value: formatArea(complex.area_from) },
    { title: 'Этажность', value: maxFloor > 0 ? `${maxFloor}` : 'По запросу' },
    { title: 'Квартир всего / в продаже', value: `${totalLots} / ${inSaleLots}` },
    { title: 'Срок сдачи', value: complex.handover_date || 'Уточняется' },
  ]

  if (typeof complex.geo_lat === 'number' && typeof complex.geo_lon === 'number') {
    const distance = haversineKm(complex.geo_lat, complex.geo_lon, KREMLIN_COORDS.lat, KREMLIN_COORDS.lon)
    cards.push({ title: 'До Кремля', value: `${distance.toFixed(1).replace('.', ',')} км` })
  }
  if (complex.metro?.[0]) {
    cards.push({ title: 'Ближайшее метро', value: complex.metro[0] })
  }
  if (hasParking) {
    cards.push({ title: 'Подземный паркинг', value: 'Да' })
  }
  if (complex.finish_type) {
    cards.push({ title: 'Отделка', value: complex.finish_type })
  }

  return cards
    .slice(0, MAX_LANDING_FACTS)
    .map((fact, idx) => createLandingFact({ ...fact, image: FACT_IMAGE_PRESETS[idx % FACT_IMAGE_PRESETS.length] }))
}

function buildAutoFeatures(complex: Complex): ComplexLandingFeature[] {
  const titles = inferFeatureTitles(complex.description)
  return titles
    .map((title) => {
      const preset = getFeaturePresetByTitle(title)
      return createLandingFeature({
        preset_key: preset?.key,
        title: preset?.title || title,
        image: preset?.image,
      })
    })
    .slice(0, 12)
}

export function buildAutoLandingConfig(complex: Complex, properties: Property[]): ComplexLandingConfig {
  const planItems = inferPlanItems(complex, properties)
  return {
    enabled: true,
    accent_color: DEFAULT_ACCENT,
    surface_color: DEFAULT_SURFACE,
    hero_image: complex.images?.[0],
    cta_label: 'Старт продаж',
    tags: [],
    facts: buildAutoFacts(complex, properties),
    feature_ticker: [],
    plans: {
      title: `Планировки в ${complex.title}`,
      description: 'Выберите формат квартиры и откройте все доступные предложения в каталоге.',
      cta_label: 'Все планировки',
      items: planItems,
    },
    nearby: createLandingNearby(),
  }
}

function fromLegacyLanding(
  legacyValue: Record<string, unknown>,
  complex: Complex,
  properties: Property[],
  fallback: ComplexLandingConfig
): ComplexLandingConfig {
  const blocks = safeArray<Record<string, unknown>>(legacyValue.blocks)
  const overview = blocks.find((block) => toText(block.type) === 'overview')
  const gallery = blocks.find((block) => toText(block.type) === 'gallery')
  const cta = blocks.find((block) => toText(block.type) === 'cta')

  const rawBullets = safeArray<string>(overview?.bullets)
  const tags = rawBullets.slice(0, 4).map((line) => createLandingTag({ label: line }))
  const facts = rawBullets
    .slice(0, MAX_LANDING_FACTS)
    .map((line, idx) => createLandingFact({
      title: idx < 6 ? fallback.facts[idx]?.title || 'Факт' : 'Детали',
      value: line,
      image: FACT_IMAGE_PRESETS[idx % FACT_IMAGE_PRESETS.length],
    }))

  const galleryImages = safeArray<string>(gallery?.images)
  const features = galleryImages.length
    ? galleryImages.slice(0, 12).map((image, idx) => createLandingFeature({
        preset_key: LANDING_FEATURE_PRESETS[idx]?.key,
        title: LANDING_FEATURE_PRESETS[idx]?.title || DEFAULT_FEATURES[idx] || 'Фишка',
        image,
      }))
    : fallback.feature_ticker

  return {
    ...fallback,
    enabled: typeof legacyValue.enabled === 'boolean' ? Boolean(legacyValue.enabled) : fallback.enabled,
    accent_color: toText(legacyValue.accent_color) || fallback.accent_color,
    surface_color: toText(legacyValue.surface_color) || fallback.surface_color,
    hero_image: toText(legacyValue.hero_image) || toText(gallery?.image) || toText(complex.images?.[0]) || fallback.hero_image,
    cta_label: toText(cta?.title) || fallback.cta_label,
    tags,
    facts: facts.length ? facts : fallback.facts,
    feature_ticker: features.length ? features : fallback.feature_ticker,
    plans: {
      ...fallback.plans,
      items: inferPlanItems(complex, properties),
    },
  }
}

export function normalizeLandingConfig(
  value: ComplexLandingConfig | undefined,
  complex: Complex,
  properties: Property[]
): ComplexLandingConfig {
  const auto = buildAutoLandingConfig(complex, properties)
  if (!value) return auto

  const candidate = value as unknown as Record<string, unknown>
  if (Array.isArray(candidate.blocks)) {
    return fromLegacyLanding(candidate, complex, properties, auto)
  }

  const hasExplicitTags = Array.isArray(candidate.tags)
  const tags = safeArray<Partial<ComplexLandingTag>>(candidate.tags)
    .map((item) => {
      const label = toText(item?.label)
      if (!label) return null
      return {
        id: toText(item?.id) || makeId('tag'),
        label,
      } as ComplexLandingTag
    })
    .filter((item): item is ComplexLandingTag => Boolean(item))
    .slice(0, 12)

  const facts = safeArray<Partial<ComplexLandingFact>>(candidate.facts)
    .map((item, idx) => createLandingFact({
      ...item,
      image: toText(item.image) || FACT_IMAGE_PRESETS[idx % FACT_IMAGE_PRESETS.length],
    }))
    .slice(0, MAX_LANDING_FACTS)

  const features = safeArray<Partial<ComplexLandingFeature>>(candidate.feature_ticker)
    .map((item) => {
      const rawPresetKey = toText(item.preset_key) || undefined
      const presetKey = inferFeaturePresetKey({
        title: toText(item.title),
        image: toText(item.image) || undefined,
        preset_key: rawPresetKey,
      })
      return createLandingFeature({ ...item, preset_key: presetKey || rawPresetKey })
    })
    .slice(0, 20)

  const plansData = (candidate.plans && typeof candidate.plans === 'object' ? (candidate.plans as Record<string, unknown>) : {}) || {}
  const planItems = inferPlanItems(complex, properties)
  const nearbyData =
    candidate.nearby && typeof candidate.nearby === 'object'
      ? createLandingNearby(candidate.nearby as Partial<ComplexLandingNearby>)
      : auto.nearby

  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : auto.enabled,
    accent_color: toText(candidate.accent_color) || auto.accent_color,
    surface_color: toText(candidate.surface_color) || auto.surface_color,
    hero_image: toText(candidate.hero_image) || auto.hero_image,
    preview_photo_label: toText(candidate.preview_photo_label) || auto.preview_photo_label,
    cta_label: toText(candidate.cta_label) || auto.cta_label,
    tags: hasExplicitTags ? tags : auto.tags,
    facts: facts.length ? facts : auto.facts,
    feature_ticker: features.length ? features : auto.feature_ticker,
    plans: {
      title: toText(plansData.title) || auto.plans.title,
      description: toText(plansData.description) || auto.plans.description,
      cta_label: toText(plansData.cta_label) || auto.plans.cta_label,
      items: planItems,
    },
    nearby: nearbyData,
  }
}

export function parseMultilineList(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function stringifyList(items?: string[]): string {
  return (items || []).join('\n')
}
