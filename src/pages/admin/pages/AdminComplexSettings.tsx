import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import { useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { geocodeAddress } from '@/lib/overpass'
import { useUiStore } from '@/store/useUiStore'
import {
  buildAutoLandingConfig,
  createLandingFact,
  createLandingFeature,
  createLandingNearby,
  createLandingNearbyPlace,
  createLandingTag,
  FACT_IMAGE_PRESETS,
  inferFeaturePresetKey,
  LANDING_FEATURE_PRESETS,
  MAX_LANDING_FACTS,
  normalizeLandingConfig,
} from '@/lib/complexLanding'
import type {
  Complex,
  ComplexLandingConfig,
  ComplexLandingFact,
  ComplexLandingNearby,
  LandingFeaturePreset,
  ComplexNearbyPlace,
  ComplexLandingTag,
  Property,
} from '../../../../shared/types'
import 'leaflet/dist/leaflet.css'

type ComplexListItem = Pick<Complex, 'id' | 'title' | 'status' | 'district' | 'price_from' | 'images'>

type ComplexDetailsResponse = {
  complex: Complex
  properties: Property[]
}

type NearbyGenerateResponse = {
  origin: { lat: number; lon: number }
  refreshed_at: string
  candidates: ComplexNearbyPlace[]
}

type NearbyPhotoVariantsResponse = {
  urls: string[]
}

type GeoPoint = {
  lat: number
  lon: number
}

const DEFAULT_MAP_CENTER: LatLngExpression = [55.751244, 37.618423]
const MAP_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const MAP_TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
const MAX_NEARBY_IMAGE_VARIANTS = 24

function normalizeGeoPoint(lat?: number, lon?: number): GeoPoint | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }
  if (Math.abs(lat) <= 180 && Math.abs(lon) <= 90) return { lat: lon, lon: lat }
  return null
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

function MapCenterSync({ point }: { point: GeoPoint | null }) {
  const map = useMap()

  useEffect(() => {
    if (!point) return
    map.setView([point.lat, point.lon], Math.max(map.getZoom(), 14), { animate: true })
  }, [map, point?.lat, point?.lon])

  return null
}

function MapClickCapture({ onSelect }: { onSelect: (point: GeoPoint) => void }) {
  useMapEvents({
    click(event) {
      onSelect({
        lat: Number(event.latlng.lat.toFixed(6)),
        lon: Number(event.latlng.lng.toFixed(6)),
      })
    },
  })
  return null
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
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyError, setNearbyError] = useState<string | null>(null)
  const [nearbyPhotoLoadingById, setNearbyPhotoLoadingById] = useState<Record<string, boolean>>({})
  const [autoNearbyGeneratedFor, setAutoNearbyGeneratedFor] = useState('')
  const [mapSearchQuery, setMapSearchQuery] = useState('')
  const [mapLookupLoading, setMapLookupLoading] = useState(false)
  const [mapLookupError, setMapLookupError] = useState<string | null>(null)

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
    if (Array.isArray(activePlan.preview_images) && activePlan.preview_images.length) return activePlan.preview_images
    if (activePlan.preview_image) return [activePlan.preview_image]
    return []
  }, [activePlan])
  const nearbyConfig = useMemo<ComplexLandingNearby | null>(() => {
    if (!draftLanding) return null
    return createLandingNearby(draftLanding.nearby)
  }, [draftLanding])
  const nearbySelectedIds = useMemo(() => new Set(nearbyConfig?.selected_ids || []), [nearbyConfig?.selected_ids])
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

  const selectedFeaturePresetKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const feature of draftLanding?.feature_ticker || []) {
      const key = inferFeaturePresetKey(feature) || feature.preset_key
      if (key) keys.add(key)
    }
    return keys
  }, [draftLanding])

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
    if (!selectedId) return
    setDetailsLoading(true)
    setDetailsError(null)
    setNearbyError(null)
    setMapSearchQuery('')
    setMapLookupError(null)
    setNearbyPhotoLoadingById({})
    setAutoNearbyGeneratedFor('')
    apiGet<ComplexDetailsResponse>(`/api/admin/catalog/complex/${selectedId}`, headers)
      .then((res) => {
        const minPrice = getMinPositive(res.properties.map((item) => item.status === 'active' ? item.price : undefined))
        const minArea = getMinPositive(res.properties.map((item) => item.status === 'active' ? item.area_total : undefined))
        const normalizedComplex: Complex = {
          ...res.complex,
          price_from: typeof res.complex.price_from === 'number' ? res.complex.price_from : minPrice,
          area_from: typeof res.complex.area_from === 'number' ? res.complex.area_from : minArea,
        }
        setDraftComplex(normalizedComplex)
        setMapSearchQuery(buildMapSearchQuery(normalizedComplex))
        setLinkedProperties(res.properties)
        setDraftLanding(normalizeLandingConfig(res.complex.landing, normalizedComplex, res.properties))
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

  const patchNearby = (updater: (value: ComplexLandingNearby) => ComplexLandingNearby) => {
    patchLanding((cfg) => ({
      ...cfg,
      nearby: updater(createLandingNearby(cfg.nearby)),
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

  const toggleNearbySelection = (id: string) => {
    patchNearby((nearby) => {
      const selected = new Set(nearby.selected_ids)
      if (selected.has(id)) selected.delete(id)
      else selected.add(id)
      return {
        ...nearby,
        selected_ids: nearby.candidates.map((item) => item.id).filter((itemId) => selected.has(itemId)).slice(0, 20),
      }
    })
  }

  const selectAllNearbyCandidates = () => {
    patchNearby((nearby) => ({
      ...nearby,
      selected_ids: nearby.candidates.map((item) => item.id).slice(0, 20),
    }))
  }

  const clearNearbySelection = () => {
    patchNearby((nearby) => ({ ...nearby, selected_ids: [] }))
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
    const typedQuery = mapSearchQuery.trim()
    const query = typedQuery || buildMapSearchQuery(draftComplex)
    if (!query) {
      setMapLookupError('Введите название и адрес ЖК, чтобы найти точку на карте.')
      return
    }

    setMapLookupLoading(true)
    setMapLookupError(null)
    try {
      const useComplexNameBias = !looksLikeAddressQuery(query)
      const result = await geocodeAddress(query, {
        city: 'Moscow',
        complexName: useComplexNameBias ? (draftComplex.title || undefined) : undefined,
      })
      if (!result) {
        setMapLookupError('Не удалось определить координаты автоматически. Укажите точку вручную на карте.')
        return
      }
      setMapSearchQuery(query)
      setComplexMapPoint({
        lat: Number(result.lat.toFixed(6)),
        lon: Number(result.lon.toFixed(6)),
      })
    } catch (error) {
      setMapLookupError(error instanceof Error ? error.message : 'Ошибка определения координат.')
    } finally {
      setMapLookupLoading(false)
    }
  }, [draftComplex, mapSearchQuery])

  const generateNearbyCandidates = useCallback(async () => {
    if (!draftComplex) return
    setNearbyLoading(true)
    setNearbyError(null)
    try {
      const payload = mapPoint ? { origin_lat: mapPoint.lat, origin_lon: mapPoint.lon } : {}
      const generated = await apiPost<NearbyGenerateResponse>(
        `/api/admin/catalog/complex/${draftComplex.id}/nearby/generate`,
        payload,
        headers
      )

      const previous = createLandingNearby(draftLanding?.nearby)
      const previousById = new Map(previous.candidates.map((item) => [item.id, item]))

      const merged = generated.candidates.slice(0, 20).map((raw) => {
        const next = createLandingNearbyPlace(raw)
        const prev = previousById.get(next.id)
        if (!prev?.image_custom || !prev.image_url) return next

        const variants = dedupeUrls([prev.image_url, ...(prev.image_variants || []), ...(next.image_variants || [])]).slice(0, MAX_NEARBY_IMAGE_VARIANTS)
        return createLandingNearbyPlace({
          ...next,
          image_url: prev.image_url,
          image_custom: true,
          image_fallback: false,
          image_variants: variants,
        })
      })

      const mergedIdSet = new Set(merged.map((item) => item.id))
      const preservedSelected = previous.selected_ids.filter((id) => mergedIdSet.has(id))
      const nextSelected = preservedSelected.length ? preservedSelected : merged.map((item) => item.id)

      patchNearby((nearby) => ({
        ...nearby,
        refreshed_at: generated.refreshed_at,
        candidates: merged,
        selected_ids: nextSelected.slice(0, 20),
      }))
      if (!mapPoint && Number.isFinite(generated.origin.lat) && Number.isFinite(generated.origin.lon)) {
        setComplexMapPoint({
          lat: Number(generated.origin.lat.toFixed(6)),
          lon: Number(generated.origin.lon.toFixed(6)),
        })
      }
    } catch (e) {
      setNearbyError(e instanceof Error ? e.message : 'Ошибка генерации мест поблизости')
    } finally {
      setNearbyLoading(false)
    }
  }, [draftComplex, draftLanding?.nearby, headers, mapPoint])

  const loadMoreNearbyPhotos = useCallback(async (candidate: ComplexNearbyPlace) => {
    if (!draftComplex) return
    setNearbyPhotoLoadingById((prev) => ({ ...prev, [candidate.id]: true }))
    setNearbyError(null)
    try {
      const data = await apiPost<NearbyPhotoVariantsResponse>(
        `/api/admin/catalog/complex/${draftComplex.id}/nearby/photo-variants`,
        { name: candidate.name, district: draftComplex.district, category: candidate.category, lat: candidate.lat, lon: candidate.lon },
        headers
      )
      const variants = dedupeUrls([...(candidate.image_variants || []), ...data.urls]).slice(0, MAX_NEARBY_IMAGE_VARIANTS)
      updateNearbyCandidate(candidate.id, {
        image_variants: variants,
        image_url: candidate.image_custom ? candidate.image_url : (candidate.image_url || variants[0]),
        image_fallback: candidate.image_custom ? candidate.image_fallback : false,
      })
    } catch (e) {
      setNearbyError(e instanceof Error ? e.message : 'Ошибка загрузки дополнительных фото')
    } finally {
      setNearbyPhotoLoadingById((prev) => {
        const next = { ...prev }
        delete next[candidate.id]
        return next
      })
    }
  }, [draftComplex, headers])

  useEffect(() => {
    if (!selectedId || !draftComplex || !nearbyConfig) return
    if (autoNearbyGeneratedFor === selectedId) return

    if (nearbyConfig.candidates.length > 0) {
      setAutoNearbyGeneratedFor(selectedId)
      return
    }

    setAutoNearbyGeneratedFor(selectedId)
    generateNearbyCandidates().catch(() => {})
  }, [autoNearbyGeneratedFor, draftComplex, generateNearbyCandidates, nearbyConfig, selectedId])

  const toggleFeaturePreset = (presetKey: string) => {
    patchLanding((cfg) => {
      const preset = featurePresetOptions.find((item) => item.key === presetKey)
      if (!preset) return cfg

      const resolveKey = (item: { preset_key?: string; title: string; image?: string }) => inferFeaturePresetKey(item) || item.preset_key
      const exists = cfg.feature_ticker.some((item) => resolveKey(item) === presetKey)
      if (exists) {
        return {
          ...cfg,
          feature_ticker: cfg.feature_ticker.filter((item) => resolveKey(item) !== presetKey),
        }
      }

      const next = [
        ...cfg.feature_ticker,
        createLandingFeature({
          id: `feature_${preset.key}_${Date.now()}`,
          title: preset.title,
          image: preset.image,
          preset_key: preset.key,
        }),
      ]
      const orderedKeys = featurePresetOptions.map((item) => item.key)
      next.sort((a, b) => {
        const aKey = resolveKey(a)
        const bKey = resolveKey(b)
        const aIndex = aKey ? orderedKeys.indexOf(aKey) : -1
        const bIndex = bKey ? orderedKeys.indexOf(bKey) : -1
        const aRank = aIndex >= 0 ? aIndex : Number.MAX_SAFE_INTEGER
        const bRank = bIndex >= 0 ? bIndex : Number.MAX_SAFE_INTEGER
        if (aRank === bRank) return a.title.localeCompare(b.title, 'ru')
        return aRank - bRank
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
        feature_ticker: cfg.feature_ticker.filter((item) => (inferFeaturePresetKey(item) || item.preset_key) !== key),
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
    setSaving(true)
    try {
      await apiPut(`/api/admin/catalog/items/complex/${draftComplex.id}`, {
        title: draftComplex.title,
        district: draftComplex.district,
        metro: draftComplex.metro,
        description: draftComplex.description,
        status: draftComplex.status,
        images: draftComplex.images,
        price_from: draftComplex.price_from,
        area_from: draftComplex.area_from,
        developer: draftComplex.developer,
        handover_date: draftComplex.handover_date,
        class: draftComplex.class,
        finish_type: draftComplex.finish_type,
        geo_lat: point?.lat,
        geo_lon: point?.lon,
        landing: draftLanding,
      }, headers)
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
    <div className="space-y-4">
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

          <article className="space-y-6 rounded-2xl border border-slate-900/30 bg-[#05131c] p-4 text-white md:p-6">
            <section className="space-y-3 rounded-2xl border border-white/10 bg-[#081b27] p-3 md:p-4">
              <div className="grid gap-3 md:grid-cols-3">
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

              <div className="grid gap-3 md:grid-cols-3">
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

              <div className="absolute left-4 right-4 top-4 grid gap-2 rounded-xl border border-white/15 bg-black/35 p-3 backdrop-blur md:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <label className="text-xs text-white/60">Фото первого экрана (URL)</label>
                  <Input
                    value={draftLanding.hero_image || ''}
                    className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
                    onChange={(e) => patchLanding((cfg) => ({ ...cfg, hero_image: e.target.value }))}
                  />
                </div>
                <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-3 text-xs hover:bg-white/15">
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

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Факты и карточки ({draftLanding.facts.length}/{MAX_LANDING_FACTS})</h3>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={addFactCard}
                  disabled={draftLanding.facts.length >= MAX_LANDING_FACTS}
                >
                  + Карточка
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {draftLanding.facts.map((fact, index) => (
                  <article key={fact.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs text-white/60">Блок факта</div>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={() => patchLanding((cfg) => ({ ...cfg, facts: cfg.facts.filter((item) => item.id !== fact.id) }))}
                      >
                        Удалить
                      </button>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
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
                        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
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
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Бегущая лента фишек</h3>
                <div className="text-xs text-white/55">
                  Можно создать свою фишку и использовать её для всех ЖК
                </div>
              </div>

              <div className="grid gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 md:grid-cols-[1fr_1fr_auto_auto]">
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

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                        <div className="flex items-center justify-between px-3 py-2">
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

            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Карта ЖК</h3>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setComplexMapPoint(null)} disabled={!mapPoint}>
                    Сбросить метку
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Поиск точки (название + адрес)</label>
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
                    {mapLookupLoading ? 'Ищем...' : 'Найти на карте'}
                  </Button>
                </div>
              </div>

              <div className="text-xs text-white/60">
                Введите адрес и нажмите «Найти на карте», затем при необходимости поправьте метку кликом по карте.
              </div>

              {mapPoint ? (
                <div className="text-xs text-white/65">
                  Текущая метка: {mapPoint.lat.toFixed(6)}, {mapPoint.lon.toFixed(6)}
                </div>
              ) : null}

              <div className="overflow-hidden rounded-xl border border-white/10">
                <MapContainer
                  center={mapPoint ? [mapPoint.lat, mapPoint.lon] : DEFAULT_MAP_CENTER}
                  zoom={mapPoint ? 14 : 11}
                  scrollWheelZoom
                  className="h-[300px] w-full md:h-[360px]"
                >
                  <TileLayer attribution={MAP_TILE_ATTR} url={MAP_TILE_URL} />
                  <MapCenterSync point={mapPoint} />
                  <MapClickCapture
                    onSelect={(point) => {
                      setMapLookupError(null)
                      setComplexMapPoint(point)
                    }}
                  />
                  {mapPoint ? (
                    <CircleMarker
                      center={[mapPoint.lat, mapPoint.lon]}
                      radius={11}
                      pathOptions={{ color: '#F8D77D', fillColor: '#F8D77D', fillOpacity: 0.92, weight: 2 }}
                    />
                  ) : null}
                </MapContainer>
              </div>

              {mapLookupError ? <div className="text-xs text-rose-300">{mapLookupError}</div> : null}
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Места поблизости {nearbyConfig ? `(${nearbyConfig.selected_ids.length}/${nearbyConfig.candidates.length})` : ''}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={selectAllNearbyCandidates} disabled={!nearbyConfig?.candidates.length}>
                    Выбрать все
                  </Button>
                  <Button size="sm" variant="secondary" onClick={clearNearbySelection} disabled={!nearbyConfig?.selected_ids.length}>
                    Очистить выбор
                  </Button>
                  <Button size="sm" onClick={generateNearbyCandidates} disabled={nearbyLoading}>
                    {nearbyLoading ? 'Загрузка...' : 'Обновить из карты'}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
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

              <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
                <span>Показываем до 20 карточек</span>
                {nearbyConfig?.refreshed_at ? <span>Обновлено: {new Date(nearbyConfig.refreshed_at).toLocaleString('ru-RU')}</span> : null}
              </div>

              {nearbyError ? <div className="text-xs text-rose-300">{nearbyError}</div> : null}

              {!nearbyConfig?.candidates.length ? (
                <div className="rounded-xl border border-dashed border-white/20 bg-white/[0.03] p-4 text-sm text-white/55">
                  Нажмите «Обновить из карты», чтобы получить список мест поблизости с предрасчетом времени пешком и на машине.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {nearbyConfig.candidates.map((candidate) => {
                      const selected = nearbySelectedIds.has(candidate.id)
                      const imageVariants = dedupeUrls([candidate.image_url || '', ...(candidate.image_variants || [])]).slice(0, MAX_NEARBY_IMAGE_VARIANTS)
                      const photoLoading = Boolean(nearbyPhotoLoadingById[candidate.id])
                      return (
                        <article
                          key={candidate.id}
                          className={`rounded-xl border p-3 ${
                            selected ? 'border-amber-300/70 bg-amber-200/10' : 'border-white/10 bg-white/[0.03]'
                          }`}
                        >
                          <div className="relative h-40 overflow-hidden rounded-lg border border-white/10">
                            {candidate.image_url ? (
                              <img src={candidate.image_url} alt={candidate.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-white/5 text-xs text-white/55">
                                Нет фото
                              </div>
                            )}
                            {candidate.image_fallback ? (
                              <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/75">
                                Иллюстративное
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-white">{candidate.name}</div>
                              <div className="mt-1 text-xs text-white/65">
                                Пешком: {Math.round(candidate.walk_minutes)} мин · На машине: {Math.round(candidate.drive_minutes)} мин
                              </div>
                            </div>
                            <Button size="sm" variant={selected ? 'secondary' : 'default'} onClick={() => toggleNearbySelection(candidate.id)}>
                              {selected ? 'Убрать' : 'Добавить'}
                            </Button>
                          </div>

                          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
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

                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => loadMoreNearbyPhotos(candidate)} disabled={photoLoading}>
                              {photoLoading ? 'Ищем...' : 'Загрузить еще фото'}
                            </Button>
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
                    })}
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 p-3 md:p-4">
              <div className="grid gap-3 md:grid-cols-3">
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

              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="w-full text-sm">
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
            </section>
          </article>
        </>
      )}
    </div>
  )
}

