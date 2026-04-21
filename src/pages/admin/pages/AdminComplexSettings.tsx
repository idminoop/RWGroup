import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { geocodeAddress } from '@/lib/overpass'
import { useUiStore } from '@/store/useUiStore'
import {
  buildAutoLandingConfig,
  createLandingAccordion,
  createLandingAccordionItem,
  createLandingFact,
  createLandingFeature,
  createLandingInfoCard,
  createLandingInfoSection,
  createLandingNearby,
  createLandingNearbyPlace,
  createLandingTag,
  FACT_IMAGE_PRESETS,
  inferFeaturePresetKey,
  LANDING_FEATURE_PRESETS,
  MAX_LANDING_ACCORDION_ITEMS,
  MAX_LANDING_FACTS,
  MAX_LANDING_INFO_CARDS,
  normalizeLandingConfig,
} from '@/lib/complexLanding'
import { promoteImageToFront, isLayoutImage } from '@/lib/images'
import type {
  Complex,
  ComplexLandingAccordion,
  ComplexLandingAccordionItem,
  ComplexLandingConfig,
  ComplexLandingFact,
  ComplexLandingInfoCard,
  ComplexLandingInfoSection,
  ComplexLandingNearby,
  ComplexNearbyCollection,
  LandingFeaturePreset,
  ComplexNearbyPlace,
  ComplexLandingTag,
  Property,
} from '../../../../shared/types'

type ComplexListItem = Pick<Complex, 'id' | 'title' | 'status' | 'district' | 'price_from' | 'images'>

type ComplexDetailsResponse = {
  complex: Complex
  properties: Property[]
}

type GeoPoint = {
  lat: number
  lon: number
}

type AdminSectionKey =
  | 'info_cards'
  | 'facts'
  | 'features'
  | 'coords'
  | 'nearby'
  | 'plans'
  | 'accordion'

const MAX_NEARBY_IMAGE_VARIANTS = 24
const MAP_LOOKUP_TIMEOUT_MS = 50000
const ADMIN_TRACE_STORAGE_KEY = 'rw_debug_admin_nearby'
const ADMIN_TRACE_QUERY_PARAM = 'debugNearby'
const ADMIN_COMPLEX_SECTIONS_STORAGE_KEY = 'rw_admin_complex_sections_v1'
const DEFAULT_SECTION_COLLAPSE_STATE: Record<AdminSectionKey, boolean> = {
  info_cards: false,
  facts: false,
  features: false,
  coords: false,
  nearby: false,
  plans: false,
  accordion: false,
}
let adminTraceSeq = 0
const MOSCOW_COORD_BOUNDS = {
  minLat: 54.9,
  maxLat: 56.3,
  minLon: 36.2,
  maxLon: 38.8,
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

function isAdminTraceEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const qs = new URLSearchParams(window.location.search || '')
  if (qs.get(ADMIN_TRACE_QUERY_PARAM) === '1') return true
  if (qs.get(ADMIN_TRACE_QUERY_PARAM) === '0') return false
  if (window.localStorage.getItem(ADMIN_TRACE_STORAGE_KEY) === '1') return true
  return window.location.pathname.startsWith('/admin')
}

function nextAdminTraceId(scope: 'map' | 'nearby' | 'photo'): string {
  adminTraceSeq = (adminTraceSeq + 1) % 100000
  return `${scope}-${String(adminTraceSeq).padStart(5, '0')}`
}

function adminTrace(id: string, stage: string, details?: Record<string, unknown>): void {
  if (!isAdminTraceEnabled()) return
  if (details) {
    console.info(`[admin:${id}] ${stage}`, details)
    return
  }
  console.info(`[admin:${id}] ${stage}`)
}

function adminTraceError(id: string, stage: string, error: unknown, details?: Record<string, unknown>): void {
  if (!isAdminTraceEnabled()) return
  const errorInfo = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) }
  console.error(`[admin:${id}] ${stage}`, { ...(details || {}), error: errorInfo })
}

function isWithinMoscowCoords(point: GeoPoint): boolean {
  return point.lat >= MOSCOW_COORD_BOUNDS.minLat
    && point.lat <= MOSCOW_COORD_BOUNDS.maxLat
    && point.lon >= MOSCOW_COORD_BOUNDS.minLon
    && point.lon <= MOSCOW_COORD_BOUNDS.maxLon
}

function normalizeGeoPoint(lat?: number, lon?: number): GeoPoint | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const direct = Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
  const swapped = Math.abs(lat) <= 180 && Math.abs(lon) <= 90 ? { lat: lon, lon: lat } : null

  if (direct && swapped) {
    const directInMoscow = isWithinMoscowCoords(direct)
    const swappedInMoscow = isWithinMoscowCoords(swapped)
    if (directInMoscow && !swappedInMoscow) return direct
    if (swappedInMoscow && !directInMoscow) return swapped
    return direct
  }
  if (direct) return direct
  if (swapped) return swapped
  return null
}

function parseCoordinateQuery(raw: string): GeoPoint | null {
  const source = raw
    .trim()
    .replace(/[()]/g, ' ')
    .replace(/[;|]/g, ',')
  if (!source) return null
  if (/[A-Za-z\u0400-\u04FF]/.test(source)) return null

  const matches = source.match(/-?\d+(?:[.,]\d+)?/g)
  if (!matches || matches.length < 2) return null

  const first = Number(matches[0].replace(',', '.'))
  const second = Number(matches[1].replace(',', '.'))
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  return normalizeGeoPoint(first, second)
}

function buildMapSearchQuery(complex?: Pick<Complex, 'title' | 'district'> | null): string {
  if (!complex) return ''
  return [complex.title, complex.district]
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ')
}

function looksLikeAddressQuery(value: string): boolean {
  if (!value.trim()) return false
  const hasHouse = /\b\d+[a-zа-я]?\b/iu.test(value)
  const hasStreet = /\b(?:ул(?:\.|ица)?|пр(?:-|\.)?|просп(?:\.|ект)?|пер(?:\.|еулок)?|наб(?:\.|ережная)?|шоссе|бул(?:\.|ьвар)?|street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?)\b/iu.test(value)
  return hasHouse || hasStreet
}

async function uploadImage(token: string, file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const resp = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'x-admin-token': token || '' },
    body: formData,
  })
  const json = await resp.json()
  if (!json.success) throw new Error(json.error || 'Upload failed')
  return json.data.url as string
}

function toMetroString(value: string[]): string {
  return value.join(', ')
}

function fromMetroString(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getMinPositive(values: Array<number | undefined>): number | undefined {
  let min: number | undefined
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    if (typeof min !== 'number' || value < min) min = value
  }
  return min
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of urls) {
    const url = raw.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    result.push(url)
  }
  return result
}

function parseMultilineUrls(raw: string): string[] {
  return dedupeUrls(
    raw
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

function nearbyCategoryKey(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9а-яё_]/gi, '')
  return normalized || 'manual'
}

function nearbyCollectionKey(candidate: Pick<ComplexNearbyPlace, 'category_key'>): string {
  return (candidate.category_key || '__none__').trim() || '__none__'
}

function makeUniqueNearbyCollectionKey(baseLabel: string, takenKeys: Set<string>): string {
  const base = nearbyCategoryKey(baseLabel) || 'manual'
  let key = base
  let suffix = 2
  while (takenKeys.has(key)) {
    key = `${base}_${suffix}`
    suffix += 1
  }
  return key
}

export default function AdminComplexSettingsPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('complexId') || ''

  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [complexes, setComplexes] = useState<ComplexListItem[]>([])
  const [pickerFilter, setPickerFilter] = useState('')

  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [draftComplex, setDraftComplex] = useState<Complex | null>(null)
  const [draftLanding, setDraftLanding] = useState<ComplexLandingConfig | null>(null)
  const [loadedHeroImage, setLoadedHeroImage] = useState('')
  const [linkedProperties, setLinkedProperties] = useState<Property[]>([])
  const [saving, setSaving] = useState(false)
  const [activePlanId, setActivePlanId] = useState('')
  const [customFeaturePresets, setCustomFeaturePresets] = useState<LandingFeaturePreset[]>([])
  const [hiddenBuiltinKeys, setHiddenBuiltinKeys] = useState<Set<string>>(new Set())
  const [presetError, setPresetError] = useState<string | null>(null)
  const [creatingPreset, setCreatingPreset] = useState(false)
  const [deletingPresetKey, setDeletingPresetKey] = useState<string | null>(null)
  const [newPresetTitle, setNewPresetTitle] = useState('')
  const [newPresetImage, setNewPresetImage] = useState('')
  const [newNearbyCollectionName, setNewNearbyCollectionName] = useState('')
  const [mapSearchQuery, setMapSearchQuery] = useState('')
  const [mapLookupLoading, setMapLookupLoading] = useState(false)
  const [mapLookupError, setMapLookupError] = useState<string | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Record<AdminSectionKey, boolean>>(DEFAULT_SECTION_COLLAPSE_STATE)

  const filteredComplexes = useMemo(() => {
    const q = pickerFilter.trim().toLowerCase()
    if (!q) return complexes
    return complexes.filter((item) => item.title.toLowerCase().includes(q) || item.district.toLowerCase().includes(q))
  }, [complexes, pickerFilter])

  const activePlan = useMemo(() => {
    if (!draftLanding) return null
    return draftLanding.plans.items.find((item) => item.id === activePlanId) || draftLanding.plans.items[0] || null
  }, [activePlanId, draftLanding])

  const activePlanImages = useMemo(() => {
    if (!activePlan) return []
    const raw = Array.isArray(activePlan.preview_images) && activePlan.preview_images.length
      ? activePlan.preview_images
      : activePlan.preview_image
        ? [activePlan.preview_image]
        : []
    return dedupeUrls(raw)
  }, [activePlan])
  const accordionConfig = useMemo<ComplexLandingAccordion>(() => {
    const normalized = createLandingAccordion(draftLanding?.accordion)
    const firstItem = normalized.items[0] || createLandingAccordionItem({ open_by_default: true })
    return {
      ...normalized,
      items: [firstItem],
    }
  }, [draftLanding?.accordion])
  const infoCardsConfig = useMemo<ComplexLandingInfoSection>(() => createLandingInfoSection(draftLanding?.info_cards), [draftLanding?.info_cards])
  const feedImageOptions = useMemo(
    () => dedupeUrls((draftComplex?.images || []).filter((url) => !isLayoutImage(url))),
    [draftComplex?.images]
  )
  const accordionItem = accordionConfig.items[0] || createLandingAccordionItem({ open_by_default: true })
  const nearbyConfig = useMemo<ComplexLandingNearby | null>(() => {
    if (!draftLanding) return null
    return createLandingNearby(draftLanding.nearby)
  }, [draftLanding])
  const nearbyCollections = useMemo<ComplexNearbyCollection[]>(() => {
    if (!nearbyConfig) return []
    return Array.isArray(nearbyConfig.collections) ? nearbyConfig.collections : []
  }, [nearbyConfig])
  const mapPoint = useMemo(() => normalizeGeoPoint(draftComplex?.geo_lat, draftComplex?.geo_lon), [draftComplex?.geo_lat, draftComplex?.geo_lon])

  const featurePresetOptions = useMemo(() => {
    const map = new Map<string, LandingFeaturePreset>()
    LANDING_FEATURE_PRESETS.forEach((preset) => {
      if (!hiddenBuiltinKeys.has(preset.key)) map.set(preset.key, preset)
    })
    customFeaturePresets.forEach((preset) => {
      if (!map.has(preset.key)) map.set(preset.key, preset)
    })
    return Array.from(map.values())
  }, [customFeaturePresets, hiddenBuiltinKeys])

  const featurePresetKeySet = useMemo(() => new Set(featurePresetOptions.map((preset) => preset.key)), [featurePresetOptions])

  const normalizeFeatureTicker = useCallback((items: ComplexLandingConfig['feature_ticker']) => {
    const byKey = new Map(featurePresetOptions.map((preset) => [preset.key, preset]))
    const existingByKey = new Map<string, ComplexLandingConfig['feature_ticker'][number]>()
    for (const item of items || []) {
      const key = item.preset_key || inferFeaturePresetKey(item)
      if (!key || !byKey.has(key) || existingByKey.has(key)) continue
      existingByKey.set(key, item)
    }

    return featurePresetOptions
      .filter((preset) => existingByKey.has(preset.key))
      .map((preset) => {
        const existing = existingByKey.get(preset.key)
        return createLandingFeature({
          id: existing?.id,
          title: preset.title,
          image: preset.image,
          preset_key: preset.key,
        })
      })
  }, [featurePresetOptions])

  const selectedFeaturePresetKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const feature of draftLanding?.feature_ticker || []) {
      const key = feature.preset_key || inferFeaturePresetKey(feature)
      if (key && featurePresetKeySet.has(key)) keys.add(key)
    }
    return keys
  }, [draftLanding, featurePresetKeySet])

  useEffect(() => {
    if (!draftLanding?.plans.items.length) {
      setActivePlanId('')
      return
    }
    if (!draftLanding.plans.items.some((item) => item.id === activePlanId)) {
      setActivePlanId(draftLanding.plans.items[0].id)
    }
  }, [activePlanId, draftLanding])

  const loadComplexes = useCallback(() => {
    setListLoading(true)
    setListError(null)
    apiGet<{ items: ComplexListItem[]; total: number; page: number; limit: number }>(
      '/api/admin/catalog/items?type=complex&page=1&limit=500',
      headers
    )
      .then((res) => setComplexes(res.items))
      .catch((e) => setListError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setListLoading(false))
  }, [headers])

  const loadCustomFeaturePresets = useCallback(() => {
    setPresetError(null)
    apiGet<{ presets: LandingFeaturePreset[]; hidden_builtin_keys: string[] }>('/api/admin/landing-feature-presets', headers)
      .then((res) => {
        setCustomFeaturePresets(res.presets)
        setHiddenBuiltinKeys(new Set(res.hidden_builtin_keys))
      })
      .catch((e) => setPresetError(e instanceof Error ? e.message : 'Ошибка загрузки пресетов'))
  }, [headers])

  useEffect(() => {
    loadComplexes()
  }, [loadComplexes])

  useEffect(() => {
    loadCustomFeaturePresets()
  }, [loadCustomFeaturePresets])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(ADMIN_COMPLEX_SECTIONS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<Record<AdminSectionKey, boolean>>
      if (!parsed || typeof parsed !== 'object') return
      setCollapsedSections((prev) => ({
        ...prev,
        ...(Object.fromEntries(
          Object.entries(parsed).filter((entry): entry is [AdminSectionKey, boolean] => (
            typeof entry[0] === 'string' && typeof entry[1] === 'boolean'
          ))
        ) as Partial<Record<AdminSectionKey, boolean>>),
      }))
    } catch {
      // Ignore malformed persisted collapse state.
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ADMIN_COMPLEX_SECTIONS_STORAGE_KEY, JSON.stringify(collapsedSections))
  }, [collapsedSections])

  useEffect(() => {
    if (!selectedId) {
      setLoadedHeroImage('')
      return
    }
    setDetailsLoading(true)
    setDetailsError(null)
    setMapSearchQuery('')
    setMapLookupError(null)
    apiGet<ComplexDetailsResponse>(`/api/admin/catalog/complex/${selectedId}`, headers)
      .then((res) => {
        const minPrice = getMinPositive(res.properties.map((item) => item.status === 'active' ? item.price : undefined))
        const minArea = getMinPositive(res.properties.map((item) => item.status === 'active' ? item.area_total : undefined))
        const normalizedComplex: Complex = {
          ...res.complex,
          price_from: typeof res.complex.price_from === 'number' ? res.complex.price_from : minPrice,
          area_from: typeof res.complex.area_from === 'number' ? res.complex.area_from : minArea,
        }
        const normalizedLanding = normalizeLandingConfig(res.complex.landing, normalizedComplex, res.properties)
        setDraftComplex(normalizedComplex)
        setMapSearchQuery(buildMapSearchQuery(normalizedComplex))
        setLinkedProperties(res.properties)
        setDraftLanding(normalizedLanding)
        setLoadedHeroImage((normalizedLanding.hero_image || '').trim())
      })
      .catch((e) => setDetailsError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setDetailsLoading(false))
  }, [headers, selectedId])

  const setSelectedComplex = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id) next.set('complexId', id)
    else next.delete('complexId')
    setSearchParams(next)
  }

  const isSectionCollapsed = (key: AdminSectionKey): boolean => collapsedSections[key]

  const toggleSectionCollapse = (key: AdminSectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const patchLanding = (updater: (value: ComplexLandingConfig) => ComplexLandingConfig) => {
    setDraftLanding((prev) => {
      if (!prev) return prev
      const next = updater(prev)
      return {
        ...next,
        facts: next.facts.slice(0, MAX_LANDING_FACTS),
      }
    })
  }

  const patchTag = (id: string, patch: Partial<ComplexLandingTag>) => {
    patchLanding((cfg) => ({
      ...cfg,
      tags: cfg.tags.map((tag) => (tag.id === id ? { ...tag, ...patch } : tag)),
    }))
  }

  const patchFact = (id: string, patch: Partial<ComplexLandingFact>) => {
    patchLanding((cfg) => ({
      ...cfg,
      facts: cfg.facts.map((fact) => (fact.id === id ? { ...fact, ...patch } : fact)),
    }))
  }

  const patchInfoCards = (updater: (value: ComplexLandingInfoSection) => ComplexLandingInfoSection) => {
    patchLanding((cfg) => ({
      ...cfg,
      info_cards: updater(createLandingInfoSection(cfg.info_cards)),
    }))
  }

  const patchInfoCard = (id: string, patch: Partial<ComplexLandingInfoCard>) => {
    patchInfoCards((section) => ({
      ...section,
      items: section.items.map((item) => (
        item.id === id
          ? createLandingInfoCard({ ...item, ...patch })
          : item
      )),
    }))
  }

  const addInfoCard = () => {
    patchInfoCards((section) => {
      if (section.items.length >= MAX_LANDING_INFO_CARDS) return section
      return {
        ...section,
        items: [...section.items, createLandingInfoCard({ title: `Карточка ${section.items.length + 1}` })],
      }
    })
  }

  const deleteInfoCard = (id: string) => {
    patchInfoCards((section) => ({
      ...section,
      items: section.items.filter((item) => item.id !== id),
    }))
  }

  const moveInfoCard = (id: string, direction: 'up' | 'down') => {
    patchInfoCards((section) => {
      const items = [...section.items]
      const currentIndex = items.findIndex((item) => item.id === id)
      if (currentIndex < 0) return section
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= items.length) return section
      const [moved] = items.splice(currentIndex, 1)
      items.splice(targetIndex, 0, moved)
      return { ...section, items }
    })
  }

  const appendInfoCardGalleryImage = (id: string, url: string) => {
    const normalized = url.trim()
    if (!normalized) return
    patchInfoCards((section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.id !== id) return item
        return createLandingInfoCard({
          ...item,
          cover_image: item.cover_image || normalized,
          gallery_images: dedupeUrls([normalized, item.cover_image || '', ...(item.gallery_images || [])]),
        })
      }),
    }))
  }

  const patchAccordion = (updater: (value: ComplexLandingAccordion) => ComplexLandingAccordion) => {
    patchLanding((cfg) => ({
      ...cfg,
      accordion: updater(createLandingAccordion(cfg.accordion)),
    }))
  }

  const patchAccordionItem = (id: string, patch: Partial<ComplexLandingAccordionItem>) => {
    patchAccordion((accordion) => {
      const base =
        accordion.items.find((item) => item.id === id)
        || accordion.items[0]
        || createLandingAccordionItem({ id, open_by_default: true })
      return {
        ...accordion,
        items: [createLandingAccordionItem({ ...base, ...patch, open_by_default: true })],
      }
    })
  }

  const addAccordionItem = () => {
    patchAccordion((accordion) => {
      if (accordion.items.length >= MAX_LANDING_ACCORDION_ITEMS) return accordion
      const hasDefaultOpen = accordion.items.some((item) => item.open_by_default)
      return {
        ...accordion,
        items: [
          ...accordion.items,
          createLandingAccordionItem({
            title: `Блок ${accordion.items.length + 1}`,
            open_by_default: !hasDefaultOpen,
          }),
        ],
      }
    })
  }

  const deleteAccordionItem = (id: string) => {
    patchAccordion((accordion) => {
      const nextItems = accordion.items.filter((item) => item.id !== id)
      if (nextItems.length && !nextItems.some((item) => item.open_by_default)) {
        nextItems[0] = { ...nextItems[0], open_by_default: true }
      }
      return { ...accordion, items: nextItems }
    })
  }

  const moveAccordionItem = (id: string, direction: 'up' | 'down') => {
    patchAccordion((accordion) => {
      const items = [...accordion.items]
      const currentIndex = items.findIndex((item) => item.id === id)
      if (currentIndex < 0) return accordion
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= items.length) return accordion
      const [moved] = items.splice(currentIndex, 1)
      items.splice(targetIndex, 0, moved)
      return { ...accordion, items }
    })
  }

  const setAccordionDefaultOpen = (id: string, nextOpen: boolean) => {
    patchAccordion((accordion) => ({
      ...accordion,
      items: accordion.items.map((item) => {
        if (item.id === id) {
          return { ...item, open_by_default: nextOpen || undefined }
        }
        if (nextOpen && item.open_by_default) return { ...item, open_by_default: false }
        return item
      }),
    }))
  }

  const patchNearby = (updater: (value: ComplexLandingNearby) => ComplexLandingNearby) => {
    patchLanding((cfg) => ({
      ...cfg,
      nearby: (() => {
        const nextNearby = updater(createLandingNearby(cfg.nearby))
        return {
          ...nextNearby,
          selected_ids: nextNearby.candidates.map((item) => item.id).slice(0, 20),
        }
      })(),
    }))
  }

  const updateNearbyCandidate = (id: string, patch: Partial<ComplexNearbyPlace>) => {
    patchNearby((nearby) => ({
      ...nearby,
      candidates: nearby.candidates.map((candidate) =>
        candidate.id === id ? createLandingNearbyPlace({ ...candidate, ...patch }) : candidate
      ),
    }))
  }

  const addNearbyCollection = () => {
    const label = newNearbyCollectionName.trim()
    if (!label) return
    patchNearby((nearby) => {
      const takenKeys = new Set<string>([
        ...(nearby.collections || []).map((item) => item.key),
        ...nearby.candidates.map((item) => nearbyCollectionKey(item)).filter((key) => key !== '__none__'),
      ])
      const key = makeUniqueNearbyCollectionKey(label, takenKeys)
      const collections: ComplexNearbyCollection[] = [...(nearby.collections || []), { key, label }]
      return {
        ...nearby,
        refreshed_at: new Date().toISOString(),
        collections,
      }
    })
    setNewNearbyCollectionName('')
  }

  const addNearbyCandidate = (collection: Pick<ComplexNearbyCollection, 'key' | 'label'>) => {
    const point = mapPoint || { lat: 55.751244, lon: 37.618423 }
    patchNearby((nearby) => {
      const next = createLandingNearbyPlace({
        id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: 'Новое место',
        description: '',
        category: collection.label,
        category_key: collection.key,
        lat: point.lat,
        lon: point.lon,
        walk_minutes: 10,
        drive_minutes: 5,
      })

      const candidates = [...nearby.candidates]
      let insertAt = -1
      for (let i = candidates.length - 1; i >= 0; i -= 1) {
        if (nearbyCollectionKey(candidates[i]) === collection.key) {
          insertAt = i
          break
        }
      }
      if (insertAt >= 0) candidates.splice(insertAt + 1, 0, next)
      else candidates.push(next)

      const collections = nearby.collections || []
      const hasCollection = collections.some((item) => item.key === collection.key)
      return {
        ...nearby,
        refreshed_at: new Date().toISOString(),
        collections: hasCollection ? collections : [...collections, { key: collection.key, label: collection.label }],
        candidates: candidates.slice(0, 20),
      }
    })
  }

  const deleteNearbyCandidate = (id: string) => {
    patchNearby((nearby) => {
      const candidates = nearby.candidates.filter((item) => item.id !== id)
      return {
        ...nearby,
        refreshed_at: new Date().toISOString(),
        candidates,
      }
    })
  }

  const renameNearbyCollection = (categoryKey: string, nextCategoryLabel: string) => {
    const nextCategory = nextCategoryLabel.trim()
    if (!nextCategory) return
    patchNearby((nearby) => ({
      ...nearby,
      collections: (nearby.collections || []).map((item) => (
        item.key === categoryKey
          ? { ...item, label: nextCategory }
          : item
      )),
      candidates: nearby.candidates.map((item) => (
        nearbyCollectionKey(item) === categoryKey
          ? createLandingNearbyPlace({ ...item, category: nextCategory, category_key: categoryKey })
          : item
      )),
    }))
  }

  const deleteNearbyCollection = (categoryKey: string) => {
    patchNearby((nearby) => {
      const candidates = nearby.candidates.filter((item) => nearbyCollectionKey(item) !== categoryKey)
      return {
        ...nearby,
        refreshed_at: new Date().toISOString(),
        collections: (nearby.collections || []).filter((item) => item.key !== categoryKey),
        candidates,
      }
    })
  }

  const moveNearbyCollection = (categoryKey: string, direction: 'up' | 'down') => {
    patchNearby((nearby) => {
      const collections = [...(nearby.collections || [])]
      const currentIndex = collections.findIndex((collection) => collection.key === categoryKey)
      if (currentIndex < 0) return nearby

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= collections.length) return nearby

      const [moved] = collections.splice(currentIndex, 1)
      collections.splice(targetIndex, 0, moved)

      return {
        ...nearby,
        refreshed_at: new Date().toISOString(),
        collections,
      }
    })
  }

  const setComplexMapPoint = (point: GeoPoint | null) => {
    setDraftComplex((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        geo_lat: point?.lat,
        geo_lon: point?.lon,
      }
    })
  }

  const resolveMapPoint = useCallback(async () => {
    if (!draftComplex) return
    const traceId = nextAdminTraceId('map')
    const startedAt = nowMs()
    const typedQuery = mapSearchQuery.trim()
    const query = typedQuery || buildMapSearchQuery(draftComplex)
    adminTrace(traceId, 'resolve:start', {
      complexId: draftComplex.id,
      typedQuery,
      fallbackQuery: typedQuery ? undefined : query,
      hasExistingMapPoint: Boolean(mapPoint),
    })
    if (!query) {
      adminTrace(traceId, 'resolve:empty_query')
      setMapLookupError('Введите название и адрес ЖК, чтобы найти точку на карте.')
      return
    }

    const directPoint = parseCoordinateQuery(query)
    if (directPoint) {
      adminTrace(traceId, 'resolve:direct_coordinates', { directPoint })
      setMapLookupError(null)
      setMapSearchQuery(`${directPoint.lat.toFixed(6)}, ${directPoint.lon.toFixed(6)}`)
      setComplexMapPoint({
        lat: Number(directPoint.lat.toFixed(6)),
        lon: Number(directPoint.lon.toFixed(6)),
      })
      return
    }

    setMapLookupLoading(true)
    setMapLookupError(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), MAP_LOOKUP_TIMEOUT_MS)
    try {
      const useComplexNameBias = !looksLikeAddressQuery(query)
      adminTrace(traceId, 'resolve:geocode_request', {
        query,
        city: 'Москва',
        useComplexNameBias,
        complexName: useComplexNameBias ? (draftComplex.title || undefined) : undefined,
        timeoutMs: MAP_LOOKUP_TIMEOUT_MS,
        maxQueries: 3,
      })
      const result = await geocodeAddress(query, {
        city: 'Москва',
        complexName: useComplexNameBias ? (draftComplex.title || undefined) : undefined,
        signal: controller.signal,
        maxQueries: 3,
      })
      if (!result) {
        adminTrace(traceId, 'resolve:no_result', { durationMs: Number((nowMs() - startedAt).toFixed(1)) })
        setMapLookupError('Не удалось определить координаты автоматически. Укажите точку вручную на карте.')
        return
      }
      adminTrace(traceId, 'resolve:success', { result, durationMs: Number((nowMs() - startedAt).toFixed(1)) })
      setMapSearchQuery(query)
      setComplexMapPoint({
        lat: Number(result.lat.toFixed(6)),
        lon: Number(result.lon.toFixed(6)),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        adminTraceError(traceId, 'resolve:timeout', error, {
          timeoutMs: MAP_LOOKUP_TIMEOUT_MS,
          durationMs: Number((nowMs() - startedAt).toFixed(1)),
          query,
        })
        setMapLookupError('Map lookup timed out. Try a more specific address or set marker manually.')
      } else {
        adminTraceError(traceId, 'resolve:error', error, {
          durationMs: Number((nowMs() - startedAt).toFixed(1)),
          query,
        })
        setMapLookupError(error instanceof Error ? error.message : 'Ошибка определения координат.')
      }
    } finally {
      window.clearTimeout(timeout)
      setMapLookupLoading(false)
      adminTrace(traceId, 'resolve:finish', { durationMs: Number((nowMs() - startedAt).toFixed(1)) })
    }
  }, [draftComplex, mapPoint, mapSearchQuery])

  const toggleFeaturePreset = (presetKey: string) => {
    patchLanding((cfg) => {
      if (!featurePresetKeySet.has(presetKey)) return cfg
      const normalized = normalizeFeatureTicker(cfg.feature_ticker)
      const selectedKeys = new Set<string>()
      const existingByKey = new Map<string, ComplexLandingConfig['feature_ticker'][number]>()
      for (const item of normalized) {
        const key = item.preset_key || inferFeaturePresetKey(item)
        if (!key) continue
        selectedKeys.add(key)
        existingByKey.set(key, item)
      }

      if (selectedKeys.has(presetKey)) selectedKeys.delete(presetKey)
      else selectedKeys.add(presetKey)

      const next = featurePresetOptions
        .filter((preset) => selectedKeys.has(preset.key))
        .map((preset) => {
          const existing = existingByKey.get(preset.key)
          return createLandingFeature({
            id: existing?.id,
            title: preset.title,
            image: preset.image,
            preset_key: preset.key,
          })
        })
      return { ...cfg, feature_ticker: next }
    })
  }

  const addFactCard = () => {
    patchLanding((cfg) => {
      if (cfg.facts.length >= MAX_LANDING_FACTS) return cfg
      return { ...cfg, facts: [...cfg.facts, createLandingFact()] }
    })
  }

  const createCustomPreset = async () => {
    const title = newPresetTitle.trim()
    const image = newPresetImage.trim()
    if (!title || !image) {
      alert('Укажите название и изображение фишки')
      return
    }
    setCreatingPreset(true)
    setPresetError(null)
    try {
      const created = await apiPost<LandingFeaturePreset>(
        '/api/admin/landing-feature-presets',
        { title, image },
        headers
      )
      setCustomFeaturePresets((prev) => [...prev, created].sort((a, b) => a.title.localeCompare(b.title, 'ru')))
      setNewPresetTitle('')
      setNewPresetImage('')
      toggleFeaturePreset(created.key)
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Ошибка сохранения пресета')
    } finally {
      setCreatingPreset(false)
    }
  }

  const deletePreset = async (key: string) => {
    if (!confirm('Удалить фишку из системы?')) return
    setDeletingPresetKey(key)
    setPresetError(null)
    try {
      await apiDelete(`/api/admin/landing-feature-presets/${encodeURIComponent(key)}`, headers)
      if (key.startsWith('custom_')) {
        setCustomFeaturePresets((prev) => prev.filter((preset) => preset.key !== key))
      } else {
        setHiddenBuiltinKeys((prev) => new Set([...prev, key]))
      }
      patchLanding((cfg) => ({
        ...cfg,
        feature_ticker: cfg.feature_ticker.filter((item) => (item.preset_key || inferFeaturePresetKey(item)) !== key),
      }))
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Ошибка удаления пресета')
    } finally {
      setDeletingPresetKey(null)
    }
  }

  const save = async () => {
    if (!draftComplex || !draftLanding) return
    const point = normalizeGeoPoint(draftComplex.geo_lat, draftComplex.geo_lon)
    const nextHeroImage = (draftLanding.hero_image || '').trim()
    const heroChanged = nextHeroImage !== loadedHeroImage
    const normalizedFeatureTicker = normalizeFeatureTicker(draftLanding.feature_ticker)
    const normalizedInfoCards = createLandingInfoSection(draftLanding.info_cards)
    const landingForSave: ComplexLandingConfig = {
      ...draftLanding,
      feature_ticker: normalizedFeatureTicker,
      info_cards: normalizedInfoCards,
    }
    const imagesForSave =
      heroChanged && nextHeroImage
        ? promoteImageToFront(draftComplex.images, nextHeroImage)
        : draftComplex.images
    setSaving(true)
    try {
      await apiPut(`/api/admin/catalog/items/complex/${draftComplex.id}`, {
        title: draftComplex.title,
        district: draftComplex.district,
        metro: draftComplex.metro,
        description: draftComplex.description,
        status: draftComplex.status,
        images: imagesForSave,
        price_from: draftComplex.price_from,
        area_from: draftComplex.area_from,
        developer: draftComplex.developer,
        handover_date: draftComplex.handover_date,
        class: draftComplex.class,
        finish_type: draftComplex.finish_type,
        geo_lat: point?.lat,
        geo_lon: point?.lon,
        landing: landingForSave,
      }, headers)
      setDraftComplex((prev) => (prev ? { ...prev, images: imagesForSave } : prev))
      setDraftLanding((prev) => (prev ? { ...prev, feature_ticker: normalizedFeatureTicker, info_cards: normalizedInfoCards } : prev))
      setLoadedHeroImage(nextHeroImage)
      alert('Настройки ЖК сохранены')
      loadComplexes()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const resetAuto = () => {
    if (!draftComplex) return
    setDraftLanding(buildAutoLandingConfig(draftComplex, linkedProperties))
  }

  const openPreview = () => {
    if (!draftComplex || !draftLanding) return
    const key = `rw_complex_landing_draft_v2_${draftComplex.id}`
    window.localStorage.setItem(key, JSON.stringify(draftLanding))
    window.open(`/complex/${draftComplex.id}?previewDraft=1`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-900">Настройка ЖК</div>
            <div className="mt-1 text-sm text-slate-600">
              Визуальный редактор страницы ЖК: первый экран, теги, факты, фишки и планировки.
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Input
              value={pickerFilter}
              onChange={(e) => setPickerFilter(e.target.value)}
              placeholder="Фильтр по названию/району..."
              className="min-w-0 flex-1"
            />
            <Select value={selectedId} onChange={(e) => setSelectedComplex(e.target.value)} className="min-w-0 flex-1">
              <option value="">Выберите ЖК...</option>
              {filteredComplexes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} — {item.district}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {listLoading && <div className="mt-2 text-sm text-slate-500">Загрузка списка ЖК...</div>}
        {listError && <div className="mt-2 text-sm text-rose-600">{listError}</div>}
      </div>

      {!selectedId ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          Выберите ЖК в выпадающем списке, чтобы начать настройку.
        </div>
      ) : detailsLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Загрузка ЖК...</div>
      ) : detailsError || !draftComplex || !draftLanding ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{detailsError || 'Не удалось открыть ЖК'}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-sm font-semibold text-slate-900">{draftComplex.title}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={resetAuto}>Автосборка из фида</Button>
              <Button size="sm" variant="secondary" onClick={openPreview}>Предпросмотр</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить'}</Button>
            </div>
          </div>

          <article className="min-w-0 flex flex-col gap-6 rounded-2xl border border-slate-900/30 bg-[#05131c] p-4 text-white md:p-6">
            <section className="space-y-3 rounded-2xl border border-white/10 bg-[#081b27] p-3 md:p-4">
              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Название ЖК</label>
                  <Input
                    value={draftComplex.title}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => setDraftComplex((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Цена от</label>
                  <Input
                    type="number"
                    value={String(draftComplex.price_from || '')}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => setDraftComplex((prev) => (prev ? { ...prev, price_from: e.target.value ? Number(e.target.value) : undefined } : prev))}
                  />
                </div>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Район</label>
                  <Input
                    value={draftComplex.district}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => setDraftComplex((prev) => (prev ? { ...prev, district: e.target.value } : prev))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Метро</label>
                  <Input
                    value={toMetroString(draftComplex.metro)}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => setDraftComplex((prev) => (prev ? { ...prev, metro: fromMetroString(e.target.value) } : prev))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">CTA кнопка</label>
                  <Input
                    value={draftLanding.cta_label || ''}
                    className="border-white/20 bg-white/5 text-white placeholder:text-white/35"
                    onChange={(e) => patchLanding((cfg) => ({ ...cfg, cta_label: e.target.value }))}
                  />
                </div>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-3xl border border-white/10">
              {draftLanding.hero_image ? (
                <img src={draftLanding.hero_image} alt="" className="h-[420px] w-full object-cover" />
              ) : (
                <div className="flex h-[420px] w-full items-center justify-center bg-white/5 text-sm text-white/50">
                  Добавьте фото первого экрана
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#05131c] via-[#05131c]/70 to-transparent" />

              <div className="absolute left-4 right-4 top-4 min-w-0 space-y-2 rounded-xl border border-white/15 bg-black/35 p-3 backdrop-blur">
                {/* URL input + upload button */}
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="space-y-1.5">
                    <label className="text-xs text-white/60">Фото первого экрана (URL)</label>
                    <Input
                      value={draftLanding.hero_image || ''}
                      className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
                      onChange={(e) => patchLanding((cfg) => ({ ...cfg, hero_image: e.target.value }))}
                    />
                  </div>
                  <label className="inline-flex h-10 cursor-pointer items-center justify-center self-end rounded-md border border-white/25 bg-white/10 px-3 text-xs hover:bg-white/15">
                    Загрузить
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={async (e) => {
                        if (!e.target.files?.[0]) return
                        try {
                          const url = await uploadImage(token || '', e.target.files[0])
                          patchLanding((cfg) => ({ ...cfg, hero_image: url }))
                        } catch (err) {
                          alert(err instanceof Error ? err.message : 'Upload error')
                        } finally {
                          e.target.value = ''
                        }
                      }}
                    />
                  </label>
                </div>

                {/* Feed photo picker — non-layout images only */}
                {feedImageOptions.length > 0 && (
                  <div>
                    <label className="text-xs text-white/60">Выбрать из фото фида</label>
                    <div
                      className="mt-1.5 flex gap-2 overflow-x-auto pb-1"
                      style={{ scrollbarWidth: 'none' }}
                    >
                      {feedImageOptions.map((url) => {
                        const active = draftLanding.hero_image === url
                        return (
                          <button
                            key={url}
                            type="button"
                            onClick={() => patchLanding((cfg) => ({ ...cfg, hero_image: url }))}
                            className={`relative h-16 w-24 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                              active
                                ? 'border-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]'
                                : 'border-white/20 opacity-60 hover:opacity-100 hover:border-white/50'
                            }`}
                          >
                            <img src={url} alt="" className="h-full w-full object-cover" />
                            {active && (
                              <div className="absolute inset-0 flex items-center justify-center bg-sky-400/20">
                                <div className="rounded-full bg-sky-400 p-0.5">
                                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 md:p-6">
                <div className="mb-3 flex flex-wrap gap-2">
                  {draftLanding.tags.map((tag) => (
                    <div key={tag.id} className="flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-1">
                      <Input
                        value={tag.label}
                        className="h-6 min-w-[90px] border-0 bg-transparent px-1 text-xs text-white"
                        onChange={(e) => patchTag(tag.id, { label: e.target.value })}
                      />
                      <button
                        type="button"
                        className="rounded px-1 text-xs text-white/70 hover:bg-white/15 hover:text-white"
                        onClick={() => patchLanding((cfg) => ({ ...cfg, tags: cfg.tags.filter((item) => item.id !== tag.id) }))}
                      >
                        x
                      </button>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" onClick={() => patchLanding((cfg) => ({ ...cfg, tags: [...cfg.tags, createLandingTag()] }))}>
                    + Тег
                  </Button>
                </div>
              </div>
            </section>

            <section className="order-[90] space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Информация о ЖК: карточки + fullscreen ({infoCardsConfig.items.length}/{MAX_LANDING_INFO_CARDS})
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => toggleSectionCollapse('info_cards')}>
                    {isSectionCollapsed('info_cards') ? 'Развернуть' : 'Свернуть'}
                  </Button>
                  <label className="inline-flex items-center gap-2 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={infoCardsConfig.enabled !== false}
                      onChange={(e) => patchInfoCards((section) => ({ ...section, enabled: e.target.checked }))}
                    />
                    Показывать секцию на витрине
                  </label>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={addInfoCard}
                    disabled={infoCardsConfig.items.length >= MAX_LANDING_INFO_CARDS}
                  >
                    + Карточка
                  </Button>
                </div>
              </div>

              {!isSectionCollapsed('info_cards') && (
                <>
                  <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                    <Input
                      value={infoCardsConfig.title || ''}
                      className="border-white/20 bg-white/5 text-white"
                      placeholder="Заголовок секции (опционально)"
                      onChange={(e) => patchInfoCards((section) => ({ ...section, title: e.target.value }))}
                    />
                    <Input
                      value={infoCardsConfig.subtitle || ''}
                      className="border-white/20 bg-white/5 text-white"
                      placeholder="Подзаголовок секции (опционально)"
                      onChange={(e) => patchInfoCards((section) => ({ ...section, subtitle: e.target.value }))}
                    />
                  </div>

                  {!infoCardsConfig.items.length ? (
                    <div className="rounded-lg border border-dashed border-white/20 bg-white/[0.02] px-3 py-4 text-xs text-white/55">
                      Пока нет карточек. Добавьте хотя бы одну, чтобы на витрине появился интерактивный блок с модальным окном.
                    </div>
                  ) : (
                    <div className="space-y-3">
                  {infoCardsConfig.items.map((card, index) => {
                    const canMoveUp = index > 0
                    const canMoveDown = index < infoCardsConfig.items.length - 1
                    const galleryImages = dedupeUrls([card.cover_image || '', ...(card.gallery_images || [])])
                    return (
                      <article key={card.id} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs text-white/60">Карточка #{index + 1}</div>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="secondary" onClick={() => moveInfoCard(card.id, 'up')} disabled={!canMoveUp}>
                              ↑
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => moveInfoCard(card.id, 'down')} disabled={!canMoveDown}>
                              ↓
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => deleteInfoCard(card.id)}>
                              Удалить
                            </Button>
                          </div>
                        </div>

                        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
                          <div className="space-y-2">
                            <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
                              {card.cover_image ? (
                                <img src={card.cover_image} alt="" className="h-[170px] w-full object-cover" />
                              ) : (
                                <div className="flex h-[170px] items-center justify-center text-xs text-white/45">Обложка не выбрана</div>
                              )}
                            </div>
                            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                              <Input
                                value={card.cover_image || ''}
                                className="border-white/20 bg-white/5 text-white"
                                placeholder="URL обложки карточки"
                                onChange={(e) => {
                                  const nextCover = e.target.value.trim()
                                  patchInfoCard(card.id, {
                                    cover_image: nextCover || undefined,
                                    gallery_images: dedupeUrls([nextCover, ...(card.gallery_images || [])]),
                                  })
                                }}
                              />
                              <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-3 text-xs hover:bg-white/15">
                                Файл
                                <input
                                  type="file"
                                  className="hidden"
                                  accept="image/*"
                                  onChange={async (e) => {
                                    if (!e.target.files?.[0]) return
                                    try {
                                      const url = await uploadImage(token || '', e.target.files[0])
                                      patchInfoCard(card.id, {
                                        cover_image: url,
                                        gallery_images: dedupeUrls([url, ...(card.gallery_images || [])]),
                                      })
                                    } catch (err) {
                                      alert(err instanceof Error ? err.message : 'Upload error')
                                    } finally {
                                      e.target.value = ''
                                    }
                                  }}
                                />
                              </label>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                              <Input
                                value={card.title || ''}
                                className="border-white/20 bg-white/5 text-white"
                                placeholder="Название карточки"
                                onChange={(e) => patchInfoCard(card.id, { title: e.target.value })}
                              />
                              <Input
                                value={card.modal_title || ''}
                                className="border-white/20 bg-white/5 text-white"
                                placeholder="Заголовок в модальном окне"
                                onChange={(e) => patchInfoCard(card.id, { modal_title: e.target.value })}
                              />
                            </div>

                            <Input
                              value={card.description || ''}
                              className="border-white/20 bg-white/5 text-white"
                              placeholder="Короткое описание карточки (опционально)"
                              onChange={(e) => patchInfoCard(card.id, { description: e.target.value })}
                            />

                            <textarea
                              value={card.modal_text || ''}
                              rows={5}
                              className="w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40"
                              placeholder="Расширенный текст в fullscreen-модалке"
                              onChange={(e) => patchInfoCard(card.id, { modal_text: e.target.value })}
                            />

                            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                              <div>
                                <label className="mb-1 block text-xs text-white/60">Растяжение по ширине</label>
                                <Select
                                  value={String(card.card_col_span || 1)}
                                  className="h-9 border-white/20 bg-white/5 text-white"
                                  onChange={(e) => patchInfoCard(card.id, { card_col_span: Number(e.target.value) as 1 | 2 | 3 })}
                                >
                                  <option value="1">1/3 (обычная)</option>
                                  <option value="2">2/3 (широкая)</option>
                                  <option value="3">Вся строка</option>
                                </Select>
                              </div>
                              <div>
                                <label className="mb-1 block text-xs text-white/60">Растяжение по высоте</label>
                                <Select
                                  value={String(card.card_row_span || 1)}
                                  className="h-9 border-white/20 bg-white/5 text-white"
                                  onChange={(e) => patchInfoCard(card.id, { card_row_span: Number(e.target.value) as 1 | 2 })}
                                >
                                  <option value="1">Обычная высота</option>
                                  <option value="2">Высокая (x2)</option>
                                </Select>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
                          <div className="text-xs text-white/55">Галерея модального окна (каждый URL с новой строки)</div>
                          <textarea
                            value={(card.gallery_images || []).join('\n')}
                            rows={3}
                            className="w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40"
                            placeholder={'https://.../1.jpg\nhttps://.../2.jpg'}
                            onChange={(e) => {
                              const gallery = parseMultilineUrls(e.target.value)
                              patchInfoCard(card.id, {
                                gallery_images: gallery,
                                cover_image: card.cover_image || gallery[0] || undefined,
                              })
                            }}
                          />

                          {galleryImages.length > 0 && (
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {galleryImages.map((src, imageIndex) => (
                                <button
                                  key={`${card.id}_gallery_${imageIndex}`}
                                  type="button"
                                  onClick={() => patchInfoCard(card.id, { cover_image: src })}
                                  className={`h-14 w-20 shrink-0 overflow-hidden rounded border ${
                                    card.cover_image === src ? 'border-amber-300' : 'border-white/20'
                                  }`}
                                  title="Сделать обложкой"
                                >
                                  <img src={src} alt="" className="h-full w-full object-cover" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {feedImageOptions.length > 0 && (
                          <div>
                            <div className="mb-1 text-xs text-white/55">Добавить фото из фида в карточку/галерею</div>
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {feedImageOptions.map((url) => (
                                <button
                                  key={`${card.id}_feed_${url}`}
                                  type="button"
                                  onClick={() => appendInfoCardGalleryImage(card.id, url)}
                                  className={`h-14 w-20 shrink-0 overflow-hidden rounded border ${
                                    card.cover_image === url ? 'border-amber-300' : 'border-white/20'
                                  }`}
                                >
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </article>
                    )
                  })}
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Факты и карточки ({draftLanding.facts.length}/{MAX_LANDING_FACTS})</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => toggleSectionCollapse('facts')}>
                    {isSectionCollapsed('facts') ? 'Развернуть' : 'Свернуть'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={addFactCard}
                    disabled={draftLanding.facts.length >= MAX_LANDING_FACTS}
                  >
                    + Карточка
                  </Button>
                </div>
              </div>
              {!isSectionCollapsed('facts') && (
              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {draftLanding.facts.map((fact, index) => (
                  <article key={fact.id} className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-white/60">Блок факта</div>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={() => patchLanding((cfg) => ({ ...cfg, facts: cfg.facts.filter((item) => item.id !== fact.id) }))}
                      >
                        Удалить
                      </button>
                    </div>

                    <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                      <Input
                        value={fact.title}
                        className="border-white/20 bg-white/5 text-white"
                        onChange={(e) => patchFact(fact.id, { title: e.target.value })}
                        placeholder="Заголовок"
                      />
                      <Input
                        value={fact.value}
                        className="border-white/20 bg-white/5 text-white"
                        onChange={(e) => patchFact(fact.id, { value: e.target.value })}
                        placeholder="Значение"
                      />
                    </div>
                    <Input
                      value={fact.subtitle || ''}
                      className="mt-2 border-white/20 bg-white/5 text-white"
                      onChange={(e) => patchFact(fact.id, { subtitle: e.target.value })}
                      placeholder="Подпись (опционально)"
                    />
                    {index >= 6 ? (
                      <>
                        <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                          <Input
                            value={fact.image || ''}
                            className="border-white/20 bg-white/5 text-white"
                            onChange={(e) => patchFact(fact.id, { image: e.target.value })}
                            placeholder="Фон карточки (URL)"
                          />
                          <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-3 text-xs hover:bg-white/15">
                            Файл
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*"
                              onChange={async (e) => {
                                if (!e.target.files?.[0]) return
                                try {
                                  const url = await uploadImage(token || '', e.target.files[0])
                                  patchFact(fact.id, { image: url })
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : 'Upload error')
                                } finally {
                                  e.target.value = ''
                                }
                              }}
                            />
                          </label>
                        </div>
                        <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-white/60">Растяжение по ширине</label>
                            <Select
                              value={String(fact.card_col_span || 1)}
                              className="h-9 border-white/20 bg-white/5 text-white"
                              onChange={(e) => patchFact(fact.id, { card_col_span: Number(e.target.value) as 1 | 2 | 3 })}
                            >
                              <option value="1">1/3 (обычная)</option>
                              <option value="2">2/3 (широкая)</option>
                              <option value="3">Вся строка</option>
                            </Select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-white/60">Растяжение по высоте</label>
                            <Select
                              value={String(fact.card_row_span || 1)}
                              className="h-9 border-white/20 bg-white/5 text-white"
                              onChange={(e) => patchFact(fact.id, { card_row_span: Number(e.target.value) as 1 | 2 })}
                            >
                              <option value="1">Обычная высота</option>
                              <option value="2">Высокая (x2)</option>
                            </Select>
                          </div>
                        </div>
                        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                          {FACT_IMAGE_PRESETS.map((preset, idx) => (
                            <button
                              key={`${fact.id}_preset_${idx}`}
                              type="button"
                              onClick={() => patchFact(fact.id, { image: preset })}
                              className={`h-12 w-16 shrink-0 overflow-hidden rounded border ${
                                fact.image === preset ? 'border-amber-300' : 'border-white/20'
                              }`}
                              title={`Пресет ${idx + 1}`}
                            >
                              <img src={preset} alt="" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="mt-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/50">
                        Для боковых фактов фото не используется.
                      </div>
                    )}
                  </article>
                ))}
              </div>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Бегущая лента фишек</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs text-white/55">
                    Можно создать свою фишку и использовать её для всех ЖК
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => toggleSectionCollapse('features')}>
                    {isSectionCollapsed('features') ? 'Развернуть' : 'Свернуть'}
                  </Button>
                </div>
              </div>

              {!isSectionCollapsed('features') && (
              <>
              <div className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
                <Input
                  value={newPresetTitle}
                  onChange={(e) => setNewPresetTitle(e.target.value)}
                  className="border-white/20 bg-white/5 text-white"
                  placeholder="Название фишки"
                />
                <Input
                  value={newPresetImage}
                  onChange={(e) => setNewPresetImage(e.target.value)}
                  className="border-white/20 bg-white/5 text-white"
                  placeholder="URL изображения"
                />
                <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-3 text-xs hover:bg-white/15">
                  Файл
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={async (e) => {
                      if (!e.target.files?.[0]) return
                      try {
                        const url = await uploadImage(token || '', e.target.files[0])
                        setNewPresetImage(url)
                      } catch (err) {
                        alert(err instanceof Error ? err.message : 'Upload error')
                      } finally {
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
                <Button
                  size="sm"
                  onClick={createCustomPreset}
                  disabled={creatingPreset || !newPresetTitle.trim() || !newPresetImage.trim()}
                >
                  {creatingPreset ? 'Создание...' : 'Создать'}
                </Button>
              </div>

              {presetError ? <div className="text-xs text-rose-300">{presetError}</div> : null}

              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {featurePresetOptions.map((preset) => {
                  const enabled = selectedFeaturePresetKeys.has(preset.key)
                  return (
                    <article
                      key={preset.key}
                      className={`overflow-hidden rounded-xl border ${
                        enabled ? 'border-amber-300/70 bg-amber-100/10' : 'border-white/10 bg-white/[0.03]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleFeaturePreset(preset.key)}
                        className="group block w-full text-left"
                      >
                        <div className="relative h-28 w-full overflow-hidden">
                          <img src={preset.image} alt={preset.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                          <div className="absolute inset-0 bg-gradient-to-t from-[#05131c] via-transparent to-transparent" />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <div className="text-sm text-white">{preset.title}</div>
                          <div className={`rounded-full px-2 py-0.5 text-xs ${enabled ? 'bg-amber-300/30 text-amber-100' : 'bg-white/10 text-white/65'}`}>
                            {enabled ? 'Вкл' : 'Выкл'}
                          </div>
                        </div>
                      </button>
                      <div className="border-t border-white/10 px-3 py-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full"
                          disabled={deletingPresetKey === preset.key}
                          onClick={() => deletePreset(preset.key)}
                        >
                          {deletingPresetKey === preset.key ? 'Удаление...' : 'Удалить'}
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>
              </>
              )}

            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Координаты ЖК</h3>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => toggleSectionCollapse('coords')}>
                    {isSectionCollapsed('coords') ? 'Развернуть' : 'Свернуть'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setComplexMapPoint(null)} disabled={!mapPoint}>
                    Сбросить координаты
                  </Button>
                </div>
              </div>

              {!isSectionCollapsed('coords') && (
              <>
              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Поиск координат (название + адрес)</label>
                  <Input
                    value={mapSearchQuery}
                    className="border-white/20 bg-white/5 text-white"
                    placeholder="Например: ЖК Republic, Москва, Пресненский Вал 27"
                    onChange={(e) => {
                      setMapLookupError(null)
                      setMapSearchQuery(e.target.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      resolveMapPoint().catch(() => {})
                    }}
                  />
                </div>
                <div className="flex items-end">
                  <Button size="sm" onClick={resolveMapPoint} disabled={mapLookupLoading}>
                    {mapLookupLoading ? 'Ищем...' : 'Найти координаты'}
                  </Button>
                </div>
              </div>

              <div className="text-xs text-white/60">
                Карта в админке отключена. Используйте поиск адреса или введите координаты вручную.
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Широта (lat)</label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={draftComplex?.geo_lat ?? ''}
                    className="border-white/20 bg-white/5 text-white"
                    onChange={(e) => {
                      const raw = e.target.value.trim()
                      setMapLookupError(null)
                      setDraftComplex((prev) => {
                        if (!prev) return prev
                        if (!raw) return { ...prev, geo_lat: undefined }
                        const parsed = Number(raw.replace(',', '.'))
                        if (!Number.isFinite(parsed)) return prev
                        return { ...prev, geo_lat: parsed }
                      })
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Долгота (lon)</label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={draftComplex?.geo_lon ?? ''}
                    className="border-white/20 bg-white/5 text-white"
                    onChange={(e) => {
                      const raw = e.target.value.trim()
                      setMapLookupError(null)
                      setDraftComplex((prev) => {
                        if (!prev) return prev
                        if (!raw) return { ...prev, geo_lon: undefined }
                        const parsed = Number(raw.replace(',', '.'))
                        if (!Number.isFinite(parsed)) return prev
                        return { ...prev, geo_lon: parsed }
                      })
                    }}
                  />
                </div>
              </div>

              {mapPoint ? (
                <div className="text-xs text-white/65">
                  Текущие координаты: {mapPoint.lat.toFixed(6)}, {mapPoint.lon.toFixed(6)}
                </div>
              ) : null}

              {mapLookupError ? <div className="text-xs text-rose-300">{mapLookupError}</div> : null}
              </>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Места поблизости {nearbyConfig ? `(${nearbyCollections.length} подборок, ${nearbyConfig.candidates.length} мест)` : ''}
                </h3>
                <Button size="sm" variant="secondary" onClick={() => toggleSectionCollapse('nearby')}>
                  {isSectionCollapsed('nearby') ? 'Развернуть' : 'Свернуть'}
                </Button>
              </div>

              {!isSectionCollapsed('nearby') && (
              <>
              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Заголовок блока</label>
                  <Input
                    value={nearbyConfig?.title || ''}
                    className="border-white/20 bg-white/5 text-white"
                    onChange={(e) => patchNearby((nearby) => ({ ...nearby, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Подзаголовок блока</label>
                  <Input
                    value={nearbyConfig?.subtitle || ''}
                    className="border-white/20 bg-white/5 text-white"
                    onChange={(e) => patchNearby((nearby) => ({ ...nearby, subtitle: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  value={newNearbyCollectionName}
                  className="border-white/20 bg-white/5 text-white"
                  placeholder="Название новой подборки"
                  onChange={(e) => setNewNearbyCollectionName(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={addNearbyCollection}
                  disabled={!newNearbyCollectionName.trim()}
                >
                  + Создать подборку
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
                <span>Показываем до 20 карточек</span>
                <span>Стрелки ↑ ↓ управляют только порядком подборок</span>
                {nearbyConfig?.refreshed_at ? <span>Обновлено: {new Date(nearbyConfig.refreshed_at).toLocaleString('ru-RU')}</span> : null}
              </div>

              {!nearbyCollections.length && !nearbyConfig?.candidates.length ? (
                <div className="rounded-xl border border-dashed border-white/20 bg-white/[0.03] p-4 text-sm text-white/55">
                  Сначала создайте подборку, затем добавьте в нее места.
                </div>
              ) : (
                <div className="space-y-5">
                  {(() => {
                    const candidatesByCollection = new Map<string, ComplexNearbyPlace[]>()
                    const unassigned: ComplexNearbyPlace[] = []
                    for (const candidate of nearbyConfig.candidates) {
                      const collectionKey = nearbyCollectionKey(candidate)
                      if (collectionKey === '__none__') {
                        unassigned.push(candidate)
                        continue
                      }
                      const arr = candidatesByCollection.get(collectionKey) || []
                      arr.push(candidate)
                      candidatesByCollection.set(collectionKey, arr)
                    }

                    const renderCandidate = (candidate: ComplexNearbyPlace) => {
                      const imageVariants = dedupeUrls([candidate.image_url || '', ...(candidate.image_variants || [])]).slice(0, MAX_NEARBY_IMAGE_VARIANTS)
                      return (
                        <article
                          key={candidate.id}
                          className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3"
                        >
                          <div className="relative h-36 overflow-hidden rounded-lg border border-white/10">
                            {candidate.image_url ? (
                              <img src={candidate.image_url} alt={candidate.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-white/5 text-3xl opacity-40">
                                {candidate.emoji || '📍'}
                              </div>
                            )}
                            {candidate.image_fallback ? (
                              <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/75">
                                Иллюстративное
                              </span>
                            ) : null}
                            {candidate.emoji && (
                              <span className="absolute right-2 top-2 rounded-lg bg-black/55 px-1.5 py-0.5 text-base">
                                {candidate.emoji}
                              </span>
                            )}
                          </div>

                          <div className="mt-2 flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="break-words text-sm font-semibold text-white">{candidate.name}</div>
                              {candidate.description ? (
                                <div className="mt-1 text-xs text-white/70">{candidate.description}</div>
                              ) : null}
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-white/55">
                                <span>{Math.round(candidate.walk_minutes)} мин пешком · {Math.round(candidate.drive_minutes)} мин на машине</span>
                                {candidate.rating !== undefined && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/20 border border-amber-500/25 px-1.5 py-0.5 text-[10px] text-amber-300 font-semibold">
                                    ★ {candidate.rating.toFixed(1)}
                                    {candidate.reviews_count ? <span className="text-amber-400/60"> · {candidate.reviews_count}</span> : null}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Button size="sm" variant="secondary" onClick={() => deleteNearbyCandidate(candidate.id)}>
                              Удалить
                            </Button>
                          </div>

                          <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                            <Input
                              value={candidate.name}
                              className="border-white/20 bg-white/5 text-white"
                              placeholder="Название места"
                              onChange={(e) => updateNearbyCandidate(candidate.id, { name: e.target.value })}
                            />
                            <Input
                              value={candidate.description || ''}
                              className="border-white/20 bg-white/5 text-white"
                              placeholder="Описание"
                              onChange={(e) => updateNearbyCandidate(candidate.id, { description: e.target.value })}
                            />
                            <Input
                              type="number"
                              min={1}
                              value={candidate.walk_minutes}
                              className="border-white/20 bg-white/5 text-white"
                              placeholder="Пешком (мин)"
                              onChange={(e) => updateNearbyCandidate(candidate.id, { walk_minutes: Number(e.target.value) || 1 })}
                            />
                            <Input
                              type="number"
                              min={1}
                              value={candidate.drive_minutes}
                              className="border-white/20 bg-white/5 text-white"
                              placeholder="На машине (мин)"
                              onChange={(e) => updateNearbyCandidate(candidate.id, { drive_minutes: Number(e.target.value) || 1 })}
                            />
                          </div>

                          <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                            <Input
                              value={candidate.image_url || ''}
                              className="border-white/20 bg-white/5 text-white"
                              placeholder="URL фото"
                              onChange={(e) =>
                                updateNearbyCandidate(candidate.id, {
                                  image_url: e.target.value,
                                  image_custom: true,
                                  image_fallback: false,
                                  image_variants: dedupeUrls([e.target.value, ...(candidate.image_variants || [])]).slice(0, MAX_NEARBY_IMAGE_VARIANTS),
                                })
                              }
                            />
                            <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-3 text-xs hover:bg-white/15">
                              Файл
                              <input
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={async (e) => {
                                  if (!e.target.files?.[0]) return
                                  try {
                                    const url = await uploadImage(token || '', e.target.files[0])
                                    updateNearbyCandidate(candidate.id, {
                                      image_url: url,
                                      image_custom: true,
                                      image_fallback: false,
                                      image_variants: dedupeUrls([url, ...(candidate.image_variants || [])]).slice(0, MAX_NEARBY_IMAGE_VARIANTS),
                                    })
                                  } catch (err) {
                                    alert(err instanceof Error ? err.message : 'Upload error')
                                  } finally {
                                    e.target.value = ''
                                  }
                                }}
                              />
                            </label>
                          </div>

                          {imageVariants.length > 0 && (
                            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                              {imageVariants.map((src, index) => (
                                <button
                                  key={`${candidate.id}_img_${index}`}
                                  type="button"
                                  onClick={() =>
                                    updateNearbyCandidate(candidate.id, {
                                      image_url: src,
                                      image_custom: true,
                                      image_fallback: false,
                                      image_variants: imageVariants,
                                    })
                                  }
                                  className={`h-14 w-20 shrink-0 overflow-hidden rounded border ${
                                    candidate.image_url === src ? 'border-amber-300' : 'border-white/20'
                                  }`}
                                >
                                  <img src={src} alt="" className="h-full w-full object-cover" />
                                </button>
                              ))}
                            </div>
                          )}
                        </article>
                      )
                    }

                    const renderCollectionBlock = (collection: ComplexNearbyCollection, collectionIndex: number, collectionCount: number) => {
                      const categoryCandidates = candidatesByCollection.get(collection.key) || []
                      const canMoveUp = collectionIndex > 0
                      const canMoveDown = collectionIndex < collectionCount - 1
                      return (
                        <div key={collection.key} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
                            <Input
                              value={collection.label}
                              className="border-white/20 bg-white/5 text-white"
                              placeholder="Подборка"
                              onChange={(e) => renameNearbyCollection(collection.key, e.target.value)}
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => moveNearbyCollection(collection.key, 'up')}
                              disabled={!canMoveUp}
                              title="Поднять подборку выше"
                            >
                              ↑
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => moveNearbyCollection(collection.key, 'down')}
                              disabled={!canMoveDown}
                              title="Опустить подборку ниже"
                            >
                              ↓
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => addNearbyCandidate(collection)}>
                              + Место
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => deleteNearbyCollection(collection.key)}>
                              Удалить
                            </Button>
                          </div>
                          {!categoryCandidates.length ? (
                            <div className="rounded-lg border border-dashed border-white/20 bg-white/[0.02] px-3 py-4 text-xs text-white/55">
                              Подборка пустая. Нажмите «+ Место», чтобы добавить первую карточку.
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {categoryCandidates.map((candidate) => renderCandidate(candidate))}
                            </div>
                          )}
                        </div>
                      )
                    }

                    return (
                      <>
                        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                          {nearbyCollections.map((collection, index) => renderCollectionBlock(collection, index, nearbyCollections.length))}
                        </div>
                        {unassigned.length > 0 && (
                          <div>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/45">Места без подборки</div>
                            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {unassigned.map(renderCandidate)}
                            </div>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              )}
              </>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Планировки</h3>
                <Button size="sm" variant="secondary" onClick={() => toggleSectionCollapse('plans')}>
                  {isSectionCollapsed('plans') ? 'Развернуть' : 'Свернуть'}
                </Button>
              </div>

              {!isSectionCollapsed('plans') && (
              <>
              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Заголовок блока планировок</label>
                  <Input
                    value={draftLanding.plans.title || ''}
                    className="border-white/20 bg-white/5 text-white"
                    onChange={(e) => patchLanding((cfg) => ({ ...cfg, plans: { ...cfg.plans, title: e.target.value } }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">CTA кнопка</label>
                  <Input
                    value={draftLanding.plans.cta_label || ''}
                    className="border-white/20 bg-white/5 text-white"
                    onChange={(e) => patchLanding((cfg) => ({ ...cfg, plans: { ...cfg.plans, cta_label: e.target.value } }))}
                  />
                </div>
              </div>
              <Input
                value={draftLanding.plans.description || ''}
                className="border-white/20 bg-white/5 text-white"
                onChange={(e) => patchLanding((cfg) => ({ ...cfg, plans: { ...cfg.plans, description: e.target.value } }))}
                placeholder="Описание блока"
              />
              <div className="text-xs text-white/55">
                Данные по планировкам собираются автоматически из фида: тип, цена от, площадь от, число вариантов и превью-планы.
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-[640px] w-full text-sm">
                  <thead className="bg-white/[0.04] text-white/70">
                    <tr>
                      <th className="px-2 py-2 text-left">Тип</th>
                      <th className="px-2 py-2 text-left">Цена от</th>
                      <th className="px-2 py-2 text-left">Площадь от</th>
                      <th className="px-2 py-2 text-left">Варианты</th>
                      <th className="px-2 py-2 text-left">Превью</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftLanding.plans.items.map((item) => (
                      <tr key={item.id} className="border-t border-white/10">
                        <td className="px-2 py-2 text-white">{item.name}</td>
                        <td className="px-2 py-2 text-white/85">{item.price || 'Цена по запросу'}</td>
                        <td className="px-2 py-2 text-white/70">{item.area || 'от -'}</td>
                        <td className="px-2 py-2 text-white/70">{item.variants || 0}</td>
                        <td className="px-2 py-2">
                          <Button size="sm" variant="secondary" onClick={() => setActivePlanId(item.id)}>
                            Смотреть
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 text-sm font-semibold text-white">{activePlan?.name || 'Выберите формат'}</div>
                {!activePlanImages.length ? (
                  <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-white/20 text-sm text-white/45">
                    Для выбранного формата нет превью-планов
                  </div>
                ) : (
                  <div className="space-y-2">
                    <img src={activePlanImages[0]} alt={activePlan?.name} className="h-[220px] w-full rounded-lg object-cover" />
                    {activePlanImages.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {activePlanImages.map((src, index) => (
                          <img key={`${activePlan?.id}_image_${index}`} src={src} alt="" className="h-16 w-24 shrink-0 rounded border border-white/15 object-cover" />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              </>
              )}
            </section>

            <section className="order-[80] space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Текстовый блок после планировок</h3>
                <Button size="sm" variant="secondary" onClick={() => toggleSectionCollapse('accordion')}>
                  {isSectionCollapsed('accordion') ? 'Развернуть' : 'Свернуть'}
                </Button>
              </div>

              {!isSectionCollapsed('accordion') && (
              <>
              <label className="inline-flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={accordionConfig.enabled !== false}
                  onChange={(e) => patchAccordion((accordion) => ({ ...accordion, enabled: e.target.checked }))}
                />
                Показывать секцию сразу после планировок
              </label>

              <div>
                <label className="mb-1 block text-xs text-white/60">Заголовок секции</label>
                <Input
                  value={accordionConfig.title || ''}
                  className="border-white/20 bg-white/5 text-white"
                  onChange={(e) => patchAccordion((accordion) => ({ ...accordion, title: e.target.value }))}
                />
              </div>

              <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
                {accordionItem.image ? (
                  <img src={accordionItem.image} alt="" className="h-[180px] w-full object-cover sm:h-[220px]" />
                ) : (
                  <div className="flex h-[180px] w-full items-center justify-center text-xs text-white/45 sm:h-[220px]">
                    Фото не выбрано
                  </div>
                )}
              </div>

              <textarea
                value={accordionItem.text || ''}
                rows={8}
                className="w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40"
                placeholder="Основной текст блока"
                onChange={(e) => patchAccordionItem(accordionItem.id, { text: e.target.value })}
              />

              <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  value={accordionItem.image || ''}
                  className="border-white/20 bg-white/5 text-white"
                  placeholder="URL фото"
                  onChange={(e) => patchAccordionItem(accordionItem.id, { image: e.target.value })}
                />
                <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-3 text-xs hover:bg-white/15">
                  Файл
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={async (e) => {
                      if (!e.target.files?.[0]) return
                      try {
                        const url = await uploadImage(token || '', e.target.files[0])
                        patchAccordionItem(accordionItem.id, { image: url })
                      } catch (err) {
                        alert(err instanceof Error ? err.message : 'Upload error')
                      } finally {
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
              </div>

              {feedImageOptions.length > 0 && (
                <div>
                  <div className="mb-1 text-xs text-white/55">Выбрать фото из фида</div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {feedImageOptions.map((url) => (
                      <button
                        key={`accordion_${url}`}
                        type="button"
                        onClick={() => patchAccordionItem(accordionItem.id, { image: url })}
                        className={`h-14 w-20 shrink-0 overflow-hidden rounded border ${
                          accordionItem.image === url ? 'border-amber-300' : 'border-white/20'
                        }`}
                      >
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-white/55">
                На витрине показываем превью текста с кнопкой «Читать полностью».
              </div>
              </>
              )}
            </section>
          </article>
        </>
      )}
    </div>
  )
}
