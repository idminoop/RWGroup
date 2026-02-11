const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const GEOCODE_API = '/api/geocode'
const RADIUS = 1500 // метры

export type PoiResult = { name: string; lat: number; lon: number }
export type GeoCoords = { lat: number; lon: number }

// Маппинг категорий на Overpass QL фильтры
const CATEGORY_QUERIES: Record<string, string> = {
  sport: `node["leisure"~"fitness_centre|sports_centre"](around:${RADIUS},{LAT},{LON});`,
  kids: `node["amenity"="kindergarten"](around:${RADIUS},{LAT},{LON});way["amenity"="kindergarten"](around:${RADIUS},{LAT},{LON});`,
  market: `node["shop"="supermarket"](around:${RADIUS},{LAT},{LON});way["shop"="supermarket"](around:${RADIUS},{LAT},{LON});`,
  school: `node["amenity"="school"](around:${RADIUS},{LAT},{LON});way["amenity"="school"](around:${RADIUS},{LAT},{LON});`,
  fun: `node["amenity"~"cinema|theatre"](around:${RADIUS},{LAT},{LON});node["leisure"="playground"](around:${RADIUS},{LAT},{LON});`,
  church: `node["amenity"="place_of_worship"](around:${RADIUS},{LAT},{LON});way["amenity"="place_of_worship"](around:${RADIUS},{LAT},{LON});`,
  cafe: `node["amenity"~"cafe|restaurant"](around:${RADIUS},{LAT},{LON});`,
  metro: `node["station"="subway"](around:${RADIUS},{LAT},{LON});`,
  parks: `node["leisure"="park"](around:${RADIUS},{LAT},{LON});way["leisure"="park"](around:${RADIUS},{LAT},{LON});`,
  mall: `node["shop"="mall"](around:${RADIUS},{LAT},{LON});way["shop"="mall"](around:${RADIUS},{LAT},{LON});`,
  business: `node["building"="commercial"](around:${RADIUS},{LAT},{LON});way["building"="commercial"](around:${RADIUS},{LAT},{LON});`,
  theatre: `node["amenity"="theatre"](around:${RADIUS},{LAT},{LON});`,
  university: `node["amenity"="university"](around:${RADIUS},{LAT},{LON});way["amenity"="university"](around:${RADIUS},{LAT},{LON});`,
}

// Кэш в памяти
const cache = new Map<string, PoiResult[]>()

function cacheKey(lat: number, lon: number, category: string) {
  return `${lat.toFixed(4)}-${lon.toFixed(4)}-${category}`
}

export async function fetchPOIs(lat: number, lon: number, category: string): Promise<PoiResult[]> {
  const key = cacheKey(lat, lon, category)
  const cached = cache.get(key)
  if (cached) return cached

  const template = CATEGORY_QUERIES[category]
  if (!template) return []

  const body = template.replace(/\{LAT\}/g, String(lat)).replace(/\{LON\}/g, String(lon))
  const query = `[out:json][timeout:10];(${body});out center;`

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`)

  const json = await res.json() as {
    elements: Array<{
      tags?: Record<string, string>
      lat?: number
      lon?: number
      center?: { lat: number; lon: number }
    }>
  }

  const results: PoiResult[] = json.elements
    .map((el) => {
      const elLat = el.lat ?? el.center?.lat
      const elLon = el.lon ?? el.center?.lon
      if (typeof elLat !== 'number' || typeof elLon !== 'number') return null
      return {
        name: el.tags?.name || el.tags?.['name:ru'] || '',
        lat: elLat,
        lon: elLon,
      }
    })
    .filter((x): x is PoiResult => x !== null)

  cache.set(key, results)
  return results
}

// Геокодинг: адрес → координаты (Nominatim)
const geocodeCache = new Map<string, GeoCoords | null>()

// Нормализация русского адреса для Nominatim
function normalizeAddress(raw: string): string[] {
  let cleaned = raw
    // Убираем строение/корпус: "23с16" → "23", "10к2" → "10", "5 стр 3" → "5"
    .replace(/\s*[сc]\s*\d+/gi, '')       // с16, c16
    .replace(/\s*к\s*\d+/gi, '')           // к2
    .replace(/\s*стр\.?\s*\d+/gi, '')      // стр3, стр.3
    // Убираем тип улицы в начале (может быть ошибочным в данных)
    .replace(/^(проспект|пр-т|пр\.|улица|ул\.|переулок|пер\.|бульвар|б-р|шоссе|набережная|наб\.|проезд|пл\.|площадь|тупик)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const variants: string[] = [cleaned]

  // Без номера дома
  const withoutNumber = cleaned.replace(/\s*\d+[а-яА-Я]?\s*$/, '').trim()
  if (withoutNumber !== cleaned) variants.push(withoutNumber)

  return variants
}

async function nominatimSearch(query: string): Promise<GeoCoords | null> {
  const params = new URLSearchParams({ q: query })
  const res = await fetch(`${GEOCODE_API}?${params}`)
  if (!res.ok) return null

  const json = await res.json() as { success: boolean; data: { lat: number; lon: number } | null }
  return json.data
}

export async function geocodeAddress(address: string, city = 'Москва'): Promise<GeoCoords | null> {
  const cacheKey = `${address}|${city}`
  const cached = geocodeCache.get(cacheKey)
  if (cached !== undefined) return cached

  const variants = normalizeAddress(address)

  for (const variant of variants) {
    const result = await nominatimSearch(`${variant}, ${city}`)
    if (result) {
      geocodeCache.set(cacheKey, result)
      return result
    }
  }

  geocodeCache.set(cacheKey, null)
  return null
}
