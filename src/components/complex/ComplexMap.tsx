import { useMemo, useState } from 'react'
import type { Complex } from '../../../shared/types'
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import { Heading, Text } from '@/components/ui/Typography'
import 'leaflet/dist/leaflet.css'

type PoiCategory = {
  key: string
  label: string
  color: string
  offsets: Array<{ lat: number; lon: number }>
}

const DEFAULT_CENTER: LatLngExpression = [55.751244, 37.618423]

const POI_CATEGORIES: PoiCategory[] = [
  { key: 'sport', label: 'Спорт и фитнес', color: '#2DD4BF', offsets: [{ lat: 0.009, lon: -0.006 }] },
  { key: 'kids', label: 'Детские сады', color: '#A855F7', offsets: [{ lat: -0.006, lon: -0.01 }] },
  { key: 'market', label: 'Супермаркеты', color: '#F97316', offsets: [{ lat: 0.004, lon: 0.012 }] },
  { key: 'school', label: 'Школы', color: '#EAB308', offsets: [{ lat: -0.01, lon: 0.006 }] },
  { key: 'fun', label: 'Развлечения', color: '#22C55E', offsets: [{ lat: 0.012, lon: 0.002 }] },
  { key: 'church', label: 'Церкви и храмы', color: '#F59E0B', offsets: [{ lat: -0.004, lon: 0.014 }] },
  { key: 'cafe', label: 'Кафе и рестораны', color: '#FB7185', offsets: [{ lat: 0.007, lon: -0.012 }] },
  { key: 'metro', label: 'Метро', color: '#38BDF8', offsets: [{ lat: -0.012, lon: -0.002 }] },
  { key: 'parks', label: 'Парки и скверы', color: '#34D399', offsets: [{ lat: 0.015, lon: -0.004 }] },
  { key: 'mall', label: 'Торговые центры', color: '#60A5FA', offsets: [{ lat: -0.008, lon: 0.012 }] },
  { key: 'business', label: 'Бизнес-центры', color: '#FACC15', offsets: [{ lat: 0.002, lon: 0.016 }] },
  { key: 'theatre', label: 'Театры', color: '#C084FC', offsets: [{ lat: -0.014, lon: 0.002 }] },
  { key: 'university', label: 'Университеты', color: '#4ADE80', offsets: [{ lat: 0.01, lon: 0.01 }] },
]

export default function ComplexMap({ complex }: { complex: Complex }) {
  const [enabled, setEnabled] = useState(() => new Set(POI_CATEGORIES.map((c) => c.key)))

  const center = useMemo<LatLngExpression>(() => {
    if (typeof complex.geo_lat === 'number' && typeof complex.geo_lon === 'number') {
      return [complex.geo_lat, complex.geo_lon]
    }
    return DEFAULT_CENTER
  }, [complex.geo_lat, complex.geo_lon])

  const hasCoords = typeof complex.geo_lat === 'number' && typeof complex.geo_lon === 'number'

  const pois = useMemo(() => {
    if (!hasCoords) return []
    const [baseLat, baseLon] = center as [number, number]
    return POI_CATEGORIES.flatMap((cat) =>
      cat.offsets.map((offset, index) => ({
        id: `${cat.key}-${index}`,
        category: cat,
        position: [baseLat + offset.lat, baseLon + offset.lon] as LatLngExpression,
      })),
    )
  }, [center, hasCoords])

  const toggleCategory = (key: string) => {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <Heading size="h3">«{complex.title}» на карте</Heading>
        <Text className="text-slate-600">
          {complex.district}
          {complex.metro?.[0] ? ` • ${complex.metro[0]}` : ''}
        </Text>
        {!hasCoords && (
          <Text className="text-rose-600 text-sm">Координаты объекта не заданы, показан центр Москвы.</Text>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
        <MapContainer
          key={`${String(center)}`}
          center={center}
          zoom={13}
          scrollWheelZoom={false}
          className="h-[320px] w-full md:h-[460px]"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {hasCoords && (
            <CircleMarker center={center} radius={10} pathOptions={{ color: '#0F172A', fillColor: '#D6B57A', fillOpacity: 1 }}>
              <Tooltip direction="top" offset={[0, -6]} opacity={1} permanent>
                {complex.title}
              </Tooltip>
            </CircleMarker>
          )}
          {pois
            .filter((poi) => enabled.has(poi.category.key))
            .map((poi) => (
              <CircleMarker
                key={poi.id}
                center={poi.position}
                radius={6}
                pathOptions={{ color: poi.category.color, fillColor: poi.category.color, fillOpacity: 0.9 }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={0.9}>
                  {poi.category.label}
                </Tooltip>
              </CircleMarker>
            ))}
        </MapContainer>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {POI_CATEGORIES.map((cat) => {
          const isOn = enabled.has(cat.key)
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => toggleCategory(cat.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                isOn
                  ? 'border-transparent text-slate-900'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
              style={isOn ? { backgroundColor: `${cat.color}22`, color: cat.color } : undefined}
            >
              {cat.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
