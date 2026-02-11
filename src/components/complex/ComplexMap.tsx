import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import { Heading, Text } from '@/components/ui/Typography'
import { fetchPOIs, geocodeAddress, type PoiResult } from '@/lib/overpass'
import 'leaflet/dist/leaflet.css'

type PoiCategory = {
  key: string
  label: string
  color: string
}

const DEFAULT_CENTER: LatLngExpression = [55.751244, 37.618423]
const KREMLIN_COORDS = { lat: 55.752023, lon: 37.617499 }

const POI_CATEGORIES: PoiCategory[] = [
  { key: 'cafe', label: 'Кафе и рестораны', color: '#FB7185' },
  { key: 'church', label: 'Церкви и храмы', color: '#EAB308' },
  { key: 'theatre', label: 'Театры', color: '#F97316' },
  { key: 'school', label: 'Школы', color: '#D9F99D' },
  { key: 'university', label: 'Университеты', color: '#FACC15' },
  { key: 'sport', label: 'Спорт и фитнес', color: '#14B8A6' },
  { key: 'kids', label: 'Детские сады', color: '#C084FC' },
  { key: 'metro', label: 'Метро', color: '#EF4444' },
  { key: 'parks', label: 'Парки и скверы', color: '#34D399' },
  { key: 'mall', label: 'Торговые центры', color: '#60A5FA' },
  { key: 'business', label: 'Бизнес-центры', color: '#A78BFA' },
  { key: 'market', label: 'Супермаркеты', color: '#F97316' },
  { key: 'fun', label: 'Развлечения', color: '#4ADE80' },
]

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

export type ComplexMapProps = {
  title: string
  district: string
  metro?: string[]
  geo_lat?: number
  geo_lon?: number
  ctaLabel?: string
  onCtaClick?: () => void
}

export default function ComplexMap({
  title,
  district,
  metro,
  geo_lat,
  geo_lon,
  ctaLabel = 'Записаться на экскурсию',
  onCtaClick,
}: ComplexMapProps) {
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(['metro', 'cafe']))
  const [poiData, setPoiData] = useState<Record<string, PoiResult[]>>({})
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [nearestMetro, setNearestMetro] = useState<{ name: string; walkMinutes: number } | null>(null)

  const [geocoded, setGeocoded] = useState<{ lat: number; lon: number } | null>(null)
  const [geocoding, setGeocoding] = useState(false)

  const hasDirectCoords = typeof geo_lat === 'number' && typeof geo_lon === 'number'

  useEffect(() => {
    if (hasDirectCoords || geocoded) return
    setGeocoding(true)
    geocodeAddress(district)
      .then((result) => { if (result) setGeocoded(result) })
      .finally(() => setGeocoding(false))
  }, [district, hasDirectCoords, geocoded])

  const resolvedLat = hasDirectCoords ? geo_lat : geocoded?.lat
  const resolvedLon = hasDirectCoords ? geo_lon : geocoded?.lon
  const hasCoords = typeof resolvedLat === 'number' && typeof resolvedLon === 'number'

  const center = useMemo<LatLngExpression>(() => {
    if (hasCoords) return [resolvedLat!, resolvedLon!]
    return DEFAULT_CENTER
  }, [resolvedLat, resolvedLon, hasCoords])

  const distanceToKremlin = useMemo(() => {
    if (!hasCoords) return null
    return distanceKm(resolvedLat!, resolvedLon!, KREMLIN_COORDS.lat, KREMLIN_COORDS.lon)
  }, [hasCoords, resolvedLat, resolvedLon])

  const ensureCategoryLoaded = useCallback(async (key: string) => {
    if (!hasCoords || poiData[key]) return
    setLoading((prev) => new Set(prev).add(key))
    try {
      const results = await fetchPOIs(resolvedLat!, resolvedLon!, key)
      setPoiData((prev) => ({ ...prev, [key]: results }))
    } finally {
      setLoading((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [hasCoords, poiData, resolvedLat, resolvedLon])

  useEffect(() => {
    ensureCategoryLoaded('metro').catch(() => {})
  }, [ensureCategoryLoaded])

  useEffect(() => {
    if (!hasCoords) {
      setNearestMetro(null)
      return
    }
    const metros = poiData.metro || []
    if (!metros.length) {
      if (metro?.[0]) setNearestMetro({ name: metro[0], walkMinutes: 0 })
      return
    }
    let min: { item: PoiResult; dist: number } | null = null
    for (const item of metros) {
      const dist = distanceKm(resolvedLat!, resolvedLon!, item.lat, item.lon)
      if (!min || dist < min.dist) min = { item, dist }
    }
    if (!min) return
    const walkMinutes = Math.max(1, Math.round((min.dist * 1000) / 80))
    setNearestMetro({ name: min.item.name || metro?.[0] || 'Метро', walkMinutes })
  }, [hasCoords, metro, poiData.metro, resolvedLat, resolvedLon])

  const toggleCategory = useCallback(async (key: string) => {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        return next
      }
      next.add(key)
      return next
    })
    try {
      await ensureCategoryLoaded(key)
    } catch {
      setEnabled((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [ensureCategoryLoaded])

  const visiblePois = useMemo(() => {
    const result: Array<{ id: string; name: string; position: LatLngExpression; color: string }> = []
    for (const cat of POI_CATEGORIES) {
      if (!enabled.has(cat.key)) continue
      const items = poiData[cat.key]
      if (!items) continue
      for (let i = 0; i < items.length; i += 1) {
        result.push({
          id: `${cat.key}-${i}`,
          name: items[i].name || cat.label,
          position: [items[i].lat, items[i].lon],
          color: cat.color,
        })
      }
    }
    return result
  }, [enabled, poiData])

  return (
    <section className="rounded-3xl border border-[#22343d] bg-[#041019] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading size="h3" className="text-white uppercase tracking-wide">
            {title} на карте
          </Heading>
          <Text className="mt-1 text-[#8fa0a7]">{district}</Text>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {nearestMetro?.name && (
            <span className="rounded-full border border-white/20 bg-black/30 px-3 py-1 text-white/90">
              {nearestMetro.name}{nearestMetro.walkMinutes > 0 ? `, ${nearestMetro.walkMinutes} мин` : ''}
            </span>
          )}
          {typeof distanceToKremlin === 'number' && (
            <span className="rounded-full border border-[#A6A267]/40 bg-[#A6A267]/10 px-3 py-1 text-[#d9d6a6]">
              До Кремля: {distanceToKremlin.toFixed(1).replace('.', ',')} км
            </span>
          )}
        </div>
      </div>

      {geocoding && (
        <Text className="mb-3 text-sm text-[#A6A267]">Определяем местоположение...</Text>
      )}
      {!hasCoords && !geocoding && (
        <Text className="mb-3 text-sm text-rose-300/80">Не удалось определить координаты объекта.</Text>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-[#22343d]/80">
        <MapContainer
          key={`${String(center)}`}
          center={center}
          zoom={12}
          scrollWheelZoom={false}
          className="h-[360px] w-full md:h-[560px]"
        >
          <TileLayer attribution={TILE_ATTR} url={TILE_URL} />
          {hasCoords && (
            <CircleMarker
              center={center}
              radius={11}
              pathOptions={{ color: '#C2A87A', fillColor: '#C2A87A', fillOpacity: 1, weight: 3 }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={1} permanent className="map-tooltip-main">
                {title}
              </Tooltip>
            </CircleMarker>
          )}
          {visiblePois.map((poi) => (
            <CircleMarker
              key={poi.id}
              center={poi.position}
              radius={6}
              pathOptions={{ color: poi.color, fillColor: poi.color, fillOpacity: 0.9, weight: 2 }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={0.95} className="map-tooltip-poi">
                {poi.name}
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>

        {onCtaClick && (
          <div className="pointer-events-none absolute bottom-4 right-4 z-[500]">
            <button
              type="button"
              onClick={onCtaClick}
              className="pointer-events-auto rounded-md bg-[#C2A87A] px-6 py-3 text-sm font-medium uppercase tracking-wide text-[#041019] transition hover:brightness-110"
            >
              {ctaLabel}
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {POI_CATEGORIES.map((cat) => {
          const isOn = enabled.has(cat.key)
          const isLoading = loading.has(cat.key)
          return (
            <button
              key={cat.key}
              type="button"
              disabled={isLoading || !hasCoords}
              onClick={() => toggleCategory(cat.key)}
              className={`inline-flex items-center gap-2 text-sm transition ${
                !hasCoords ? 'cursor-not-allowed text-white/25' : isOn ? 'text-white' : 'text-white/55 hover:text-white/85'
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full border ${isOn ? 'border-transparent' : 'border-white/40'}`}
                style={{ backgroundColor: isOn ? cat.color : 'transparent' }}
              />
              <span className={isLoading ? 'animate-pulse' : ''}>{cat.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
