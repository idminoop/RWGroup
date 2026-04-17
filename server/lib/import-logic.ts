
import { newId, slugify } from './ids.js'
import type { Category, Complex, DbShape, Property } from '../../shared/types.js'

export function asString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return ''
}

export function asNumber(v: unknown): number | undefined {
  const n = Number(String(v).replace(/\s/g, '').replace(/,/g, '.'))
  return Number.isFinite(n) ? n : undefined
}

export function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') {
    if (v === 1) return true
    if (v === 0) return false
  }
  const s = asString(v).toLowerCase().trim()
  if (!s) return undefined
  if (['1', 'true', 'yes', 'on', 'да', 'истина'].includes(s)) return true
  if (['0', 'false', 'no', 'off', 'нет', 'ложь'].includes(s)) return false
  return undefined
}

function asInteger(v: unknown): number | undefined {
  const n = asNumber(v)
  if (typeof n !== 'number') return undefined
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).map((s) => s.trim()).filter(Boolean)
  const s = asString(v)
  if (!s) return []
  return s
    .split(/[,;|]/g)
    .map((x) => x.trim())
    .filter(Boolean)
}

function normalizeLocationValue(v: unknown): string {
  const s = asString(v).trim()
  if (!s) return ''
  if (s.toLowerCase() === 'array') return ''
  if (s === '[object Object]') return ''
  return s
}

function pickLocationText(loc: Record<string, unknown>): string {
  const address = normalizeLocationValue(loc.address ?? loc['address'])
  if (address) return address
  const subLocality = normalizeLocationValue(loc['sub-locality-name'] ?? loc['sub_locality_name'])
  if (subLocality) return subLocality
  const locality = normalizeLocationValue(loc['locality-name'] ?? loc['locality_name'])
  if (locality) return locality
  const region = normalizeLocationValue(loc.region ?? loc['region'])
  if (region) return region
  return ''
}

export function getField(row: Record<string, unknown>, field: string, mapping?: Record<string, string>, aliases: string[] = []): unknown {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined
  if (mapping && mapping[field]) {
    return row[mapping[field]]
  }
  if (field in row) return row[field]
  for (const alias of aliases) {
    if (alias in row) return row[alias]
  }
  return undefined
}

export function normalizeStatus(v: unknown): 'active' | 'hidden' | 'archived' {
  const s = asString(v).toLowerCase().trim()
  if (s === 'hidden' || s === 'archived') return s
  return 'active'
}

function transitionMissingRecordStatus(
  record: { status: 'active' | 'hidden' | 'archived'; updated_at: string },
  now: string,
): 'hidden' | 'archived' | null {
  if (record.status === 'active') {
    record.status = 'hidden'
    record.updated_at = now
    return 'hidden'
  }
  if (record.status === 'hidden') {
    record.status = 'archived'
    record.updated_at = now
    return 'archived'
  }
  return null
}

export function normalizeCategory(v: unknown): Category {
  const s = asString(v).toLowerCase().trim()
  if (s === 'secondary') return 'secondary'
  if (s === 'rent') return 'rent'
  return 'newbuild'
}

export function normalizeDealType(v: unknown): 'sale' | 'rent' {
  const s = asString(v).toLowerCase().trim()
  return s === 'rent' ? 'rent' : 'sale'
}

function extractGeoPoint(value: unknown): { lat?: number; lon?: number } {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>

  const directLat = asNumber(record.lat ?? record.latitude)
  const directLon = asNumber(record.lon ?? record.lng ?? record.longitude)
  if (typeof directLat === 'number' && typeof directLon === 'number') {
    return { lat: directLat, lon: directLon }
  }

  const geometry = (record.geometry ?? record.block_geometry ?? record.geo) as Record<string, unknown> | undefined
  if (geometry && typeof geometry === 'object') {
    const coords = geometry.coordinates
    if (Array.isArray(coords) && coords.length >= 2) {
      const lon = asNumber(coords[0])
      const lat = asNumber(coords[1])
      if (typeof lat === 'number' && typeof lon === 'number') {
        return { lat, lon }
      }
    }
  }

  return {}
}

function normalizeKey(value: unknown): string {
  return asString(value).trim().toLowerCase()
}

const LAYOUT_IMAGE_RX = /(^|[\/_.-])(plan|plans|planirovka|layout|preset|floorplan|floor-plan|room-plan|flat-plan|unit-plan)([\/_.-]|$)/i

function isLikelyLayoutImageUrl(value: string): boolean {
  const source = value.trim()
  if (!source) return false
  const lower = source.toLowerCase()
  if (lower.includes('/preset/') || lower.includes('/layout/')) return true
  if (LAYOUT_IMAGE_RX.test(lower)) return true

  try {
    const parsed = new URL(source)
    const path = decodeURIComponent(parsed.pathname).toLowerCase()
    if (path.includes('/preset/') || path.includes('/layout/')) return true
    if (LAYOUT_IMAGE_RX.test(path)) return true
    const query = decodeURIComponent(parsed.search).toLowerCase()
    if (LAYOUT_IMAGE_RX.test(query)) return true
  } catch {
    // keep best-effort checks above
  }

  return false
}

function canMergeComplexAcrossSources(
  existing: Complex,
  incoming: Omit<Complex, 'id'>,
): boolean {
  const existingDistrict = normalizeKey(existing.district)
  const incomingDistrict = normalizeKey(incoming.district)
  if (existingDistrict && incomingDistrict && existingDistrict !== incomingDistrict) {
    return false
  }

  const existingDeveloper = normalizeKey(existing.developer)
  const incomingDeveloper = normalizeKey(incoming.developer)
  if (existingDeveloper && incomingDeveloper && existingDeveloper !== incomingDeveloper) {
    return false
  }

  return true
}

function canMergePropertyAcrossSources(
  existing: Property,
  incoming: Omit<Property, 'id'>,
): boolean {
  if (existing.deal_type !== incoming.deal_type) return false
  if (existing.category !== incoming.category) return false

  const existingComplexExternal = normalizeKey(existing.complex_external_id)
  const incomingComplexExternal = normalizeKey(incoming.complex_external_id)
  const sameComplexExternal =
    Boolean(existingComplexExternal) &&
    Boolean(incomingComplexExternal) &&
    existingComplexExternal === incomingComplexExternal

  const existingTitle = normalizeKey(existing.title)
  const incomingTitle = normalizeKey(incoming.title)
  const sameTitle = Boolean(existingTitle) && existingTitle === incomingTitle

  if (!sameComplexExternal && !sameTitle) return false

  if (existing.bedrooms !== incoming.bedrooms) return false
  return true
}

export function normalizeYandexRealty(row: Record<string, unknown>): Record<string, unknown> {
  // Yandex Realty XML format normalization
  const normalized: Record<string, unknown> = {}

  // Internal ID from attribute
  normalized.external_id = asString(row['@_internal-id'] || row.internal_id || row.id)
  normalized.crm_id = row.crm_id

  // Deal type from <type>продажа</type>
  const type = asString(row.type)
  normalized.deal_type = type === 'аренда' || type === 'rent' ? 'rent' : 'sale'

  // Rooms -> bedrooms
  normalized.bedrooms = asNumber(row.rooms)

  // Nested price: <price><value>27490000</value></price>
  if (row.price && typeof row.price === 'object' && 'value' in row.price) {
    normalized.price = asNumber((row.price as Record<string, unknown>).value)
  } else {
    normalized.price = asNumber(row.price)
  }

  // Old price for discount display: <oldprice><value>29533333</value></oldprice>
  if (row.oldprice && typeof row.oldprice === 'object' && 'value' in row.oldprice) {
    normalized.old_price = asNumber((row.oldprice as Record<string, unknown>).value)
  } else if (row.oldprice) {
    normalized.old_price = asNumber(row.oldprice)
  }

  // Nested area: <area><value>59.5</value></area>
  if (row.area && typeof row.area === 'object' && 'value' in row.area) {
    normalized.area_total = asNumber((row.area as Record<string, unknown>).value)
  } else {
    normalized.area_total = asNumber(row.area)
  }

  // Living space: <living-space><value>43.81</value></living-space>
  if (row['living-space'] && typeof row['living-space'] === 'object' && 'value' in row['living-space']) {
    normalized.area_living = asNumber((row['living-space'] as Record<string, unknown>).value)
  } else if (row.living_space) {
    normalized.area_living = asNumber(row.living_space)
  }

  // Kitchen space: <kitchen-space><value>6.65</value></kitchen-space>
  if (row['kitchen-space'] && typeof row['kitchen-space'] === 'object' && 'value' in row['kitchen-space']) {
    normalized.area_kitchen = asNumber((row['kitchen-space'] as Record<string, unknown>).value)
  } else if (row.kitchen_space) {
    normalized.area_kitchen = asNumber(row.kitchen_space)
  }

  // Location: <location><address>...</address><metro>...</metro></location>
  if (row.location && typeof row.location === 'object') {
    const loc = row.location as Record<string, unknown>

    // District from address (temporary - will be mapped to reference list later)
    normalized.district = pickLocationText(loc)

    // Metro: extract from <metro><name>...</name></metro> if present
    const metros: string[] = []
    if (loc.metro) {
      if (Array.isArray(loc.metro)) {
        for (const m of loc.metro) {
          if (typeof m === 'object' && m && 'name' in m) {
            metros.push(asString((m as Record<string, unknown>).name))
          } else if (typeof m === 'string') {
            metros.push(m)
          }
        }
      } else if (typeof loc.metro === 'object' && 'name' in loc.metro) {
        metros.push(asString((loc.metro as Record<string, unknown>).name))
      } else if (typeof loc.metro === 'string') {
        metros.push(loc.metro)
      }
    }
    normalized.metro = metros.filter(Boolean).join(',')
  } else {
    normalized.district = ''
    normalized.metro = ''
  }

  // Building name -> complex_external_id
  const buildingName = asString(row['building-name'] || row.building_name)
  if (buildingName) {
    normalized.complex_external_id = buildingName
    normalized.complex_title = buildingName
  }

  // Developer
  const salesAgent = row['sales-agent'] as Record<string, unknown> | undefined
  if (salesAgent && asString(salesAgent.category) === 'developer') {
    normalized.developer = asString(salesAgent.organization)
  }

  // Dates
  const builtYear = asNumber(row['built-year'])
  const readyQuarter = asNumber(row['ready-quarter'])
  if (builtYear) {
    normalized.handover_date = readyQuarter ? `${readyQuarter} кв. ${builtYear}` : String(builtYear)
  }

  // Images: extract images but PRIORITIZE presentable photos over floor plans
  // In XML: images WITHOUT tag attribute are building photos
  //         images WITH tag="plan" are floor plans
  // Order: building photos first, then plans
  const buildingImages: string[] = []
  const planImages: string[] = []

  if (Array.isArray(row.image)) {
    for (const img of row.image) {
      let url = ''
      let tag = ''

      if (typeof img === 'string') {
        url = img
      } else if (img && typeof img === 'object') {
        // Get URL from #text or url property
        url = asString((img as Record<string, unknown>)['#text'] || (img as Record<string, unknown>).url)
        // Get tag attribute if present
        tag = asString((img as Record<string, unknown>)['@_tag'] || '')
      }

      if (url) {
        // If tag="plan" or URL contains /preset/ or /layout/ => floor plan
        if (tag === 'plan' || url.includes('/preset/') || url.includes('/layout/')) {
          planImages.push(url)
        } else {
          // Building photo or other presentable image
          buildingImages.push(url)
        }
      }
    }
  } else if (row.image) {
    let url = ''
    let tag = ''

    if (typeof row.image === 'string') {
      url = row.image
    } else if (typeof row.image === 'object') {
      url = asString((row.image as Record<string, unknown>)['#text'] || (row.image as Record<string, unknown>).url)
      tag = asString((row.image as Record<string, unknown>)['@_tag'] || '')
    }

    if (url) {
      if (tag === 'plan' || url.includes('/preset/') || url.includes('/layout/')) {
        planImages.push(url)
      } else {
        buildingImages.push(url)
      }
    }
  }

  // Put building images FIRST, then floor plans
  // This way selectCoverImage() will pick building photos
  const allImages = [...buildingImages, ...planImages]
  normalized.images = allImages.filter(Boolean).join(',')

  // Category: determine by deal type and property status
  const dealStatus = asString(row['deal-status'] || row.deal_status)
  const newFlat = asString(row['new-flat'] || row.new_flat)
  const dealType = asString(normalized.deal_type)

  if (dealType === 'rent') {
    normalized.category = 'rent'
  } else if (newFlat === '1' || dealStatus.includes('первичн')) {
    normalized.category = 'newbuild'
  } else {
    normalized.category = 'secondary'
  }

  // Title: generate from rooms + building
  const rooms = asNumber(row.rooms)
  const roomsStr = rooms ? `${rooms}-комнатная` : 'квартира'
  normalized.title = buildingName ? `${roomsStr} в ${buildingName}` : roomsStr

  // Description
  normalized.description = asString(row.description)

  // Additional fields
  normalized.floor = asNumber(row.floor)
  normalized.floors_total = asNumber(row['floors-total'] || row.floors_total)
  normalized.renovation = asString(row.renovation)
  normalized.is_euroflat = asString(row.euroflat) === '1' || asString(row.is_euroflat) === 'true'
  normalized.building_section = asString(row['building-section'] || row.building_section)
  normalized.building_state = asString(row['building-state'] || row.building_state)
  normalized.ready_quarter = asNumber(row['ready-quarter'] || row.ready_quarter)
  normalized.built_year = asNumber(row['built-year'] || row.built_year)

  // Lot number from apartment field
  normalized.lot_number = asString(row.apartment || row.lot_number)

  return normalized
}

export function aggregateComplexesFromRows(rows: Record<string, unknown>[], sourceId: string, mapping?: Record<string, string>): Omit<Complex, 'id'>[] {
  const now = new Date().toISOString()
  
  // Group by complex_external_id (or external_id if that fails)
  const complexes = new Map<string, {
    rows: Record<string, unknown>[]
    minPrice?: number
    minArea?: number
    title?: string
    images: Set<string>
    developer?: string
    handover_date?: string
    class?: string
    finish_type?: string
    district?: string
    metro: Set<string>
    description?: string
    address?: string
    mortgage_available?: boolean
    installment_available?: boolean
    subsidy_available?: boolean
    military_mortgage_available?: boolean
    queue_min?: number
    building_type?: string
    geo_lat?: number
    geo_lon?: number
  }>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    let complexId = asString(getField(row, 'complex_external_id', mapping, ['complexExternalId', 'complex_id', 'building-name', 'yandex-building-id', 'block_id']))
    const isChild = !!complexId
    
    // Fallback: if no complex_id found, assume the row itself represents a complex and use its ID
    if (!complexId) {
      complexId = asString(getField(row, 'external_id', mapping, ['id', 'externalId', '_id']))
    }

    if (!complexId) continue

    if (!complexes.has(complexId)) {
      complexes.set(complexId, {
        rows: [],
        images: new Set(),
        metro: new Set()
      })
    }
    const c = complexes.get(complexId)!
    c.rows.push(row)
    
    // Aggregate data
    // Price: look for complex-specific price first, then fallback to lot price (min)
    const priceRaw = getField(row, 'price_from', mapping, ['priceFrom', 'price_min']) 
      ?? getField(row, 'price', mapping)
    const price = asNumber(priceRaw)
    if (price && (!c.minPrice || price < c.minPrice)) c.minPrice = price

    // Area: look for complex-specific area first, then fallback to lot area (min)
    const areaRaw = getField(row, 'area_from', mapping, ['areaFrom', 'area_min'])
      ?? getField(row, 'area_total', mapping, ['area'])
    const area = asNumber(areaRaw)
    if (area && (!c.minArea || area < c.minArea)) c.minArea = area

    // Title: look for complex name
    // If it's a lot feed, 'title' might be "2-room apt", so we prefer 'building-name'
    const complexTitle = asString(getField(row, 'complex_title', mapping, ['building-name', 'complex_name', 'zhk_name', 'complexName', 'block_name']))
    // If no complex title, maybe use the row title (if this is a complex feed)
    const rowTitle = asString(getField(row, 'title', mapping, ['name']))
    
    // Prefer explicit complex title over row title if we are aggregating lots
    if (complexTitle) {
      c.title = complexTitle
    } else if (!c.title && rowTitle && !isChild) {
      // Only use rowTitle if this row IS the complex (not a child lot)
      c.title = rowTitle
    } else if (!c.title) {
      c.title = complexId
    }

    const imgs = asStringArray(getField(row, 'images', mapping, ['image_urls', 'photos', 'renderer', 'block_renderer']))
    imgs
      .filter((img) => !isLikelyLayoutImageUrl(img))
      .forEach((img) => c.images.add(img))

    const dev = asString(getField(row, 'developer', mapping, ['block_builder_name']))
    if (dev) c.developer = dev

    const date = asString(getField(row, 'handover_date', mapping, ['handoverDate', 'building_deadline']))
    if (date) c.handover_date = date

    const district = normalizeLocationValue(getField(row, 'district', mapping, ['area', 'region', 'block_district_name']))
    if (district) c.district = district

    const metros = asStringArray(getField(row, 'metro', mapping, ['block_subway_name']))
    metros.forEach(m => c.metro.add(m))

    const desc = asString(getField(row, 'description', mapping, ['block_description']))
    if (desc && !c.description) c.description = desc

    const address = asString(getField(row, 'address', mapping, ['block_address']))
    if (address && !c.address) c.address = address

    const classType = asString(getField(row, 'class', mapping, ['class_type', 'housing_class']))
    if (classType && !c.class) c.class = classType

    const finishType = asString(getField(row, 'finish_type', mapping, ['finishType', 'renovation', 'finishing_name', 'finishing']))
    if (finishType && !c.finish_type) c.finish_type = finishType

    const mortgageAvailable = asBoolean(getField(row, 'mortgage_available', mapping, ['building_mortgage', 'mortgage']))
    if (mortgageAvailable === true) c.mortgage_available = true
    if (mortgageAvailable === false && c.mortgage_available === undefined) c.mortgage_available = false

    const installmentAvailable = asBoolean(getField(row, 'installment_available', mapping, ['building_installment', 'installment']))
    if (installmentAvailable === true) c.installment_available = true
    if (installmentAvailable === false && c.installment_available === undefined) c.installment_available = false

    const subsidyAvailable = asBoolean(getField(row, 'subsidy_available', mapping, ['building_subsidy', 'subsidy']))
    if (subsidyAvailable === true) c.subsidy_available = true
    if (subsidyAvailable === false && c.subsidy_available === undefined) c.subsidy_available = false

    const militaryMortgageAvailable = asBoolean(getField(row, 'military_mortgage_available', mapping, ['building_voen_mortgage', 'military_mortgage']))
    if (militaryMortgageAvailable === true) c.military_mortgage_available = true
    if (militaryMortgageAvailable === false && c.military_mortgage_available === undefined) c.military_mortgage_available = false

    const queue = asInteger(getField(row, 'queue_min', mapping, ['building_queue', 'queue']))
    if (typeof queue === 'number' && queue > 0 && (typeof c.queue_min !== 'number' || queue < c.queue_min)) c.queue_min = queue

    const buildingType = asString(getField(row, 'building_type', mapping, ['buildingType', 'building_type_name']))
    if (buildingType && !c.building_type) c.building_type = buildingType

    const geoLat = asNumber(getField(row, 'geo_lat', mapping, ['lat']))
    const geoLon = asNumber(getField(row, 'geo_lon', mapping, ['lon', 'lng']))
    if (typeof geoLat === 'number' && typeof geoLon === 'number') {
      c.geo_lat = geoLat
      c.geo_lon = geoLon
    } else {
      const point = extractGeoPoint(row)
      if (typeof point.lat === 'number' && typeof point.lon === 'number') {
        c.geo_lat = point.lat
        c.geo_lon = point.lon
      }
    }
  }

  const result: Omit<Complex, 'id'>[] = []
  for (const [externalId, data] of complexes) {
    result.push({
      source_id: sourceId,
      external_id: externalId,
      slug: slugify(data.title || externalId),
      title: data.title || externalId,
      category: 'newbuild',
      district: data.district || '',
      metro: Array.from(data.metro),
      price_from: data.minPrice,
      area_from: data.minArea,
      images: Array.from(data.images),
      status: 'active',
      developer: data.developer,
      class: data.class,
      finish_type: data.finish_type,
      handover_date: data.handover_date,
      description: data.description,
      address: data.address,
      mortgage_available: data.mortgage_available,
      installment_available: data.installment_available,
      subsidy_available: data.subsidy_available,
      military_mortgage_available: data.military_mortgage_available,
      queue_min: data.queue_min,
      building_type: data.building_type,
      geo_lat: data.geo_lat,
      geo_lon: data.geo_lon,
      last_seen_at: now,
      updated_at: now,
    })
  }
  return result
}

type UpsertBehaviorOptions = {
  restoreArchived?: boolean
  skipMissingLifecycle?: boolean
}

export type UpsertPropertiesRuntime = {
  index?: Map<string, Property[]>
  complexByExternal?: Map<string, Complex>
  seen?: Set<string>
  now?: string
}

export function upsertComplexes(
  db: DbShape,
  sourceId: string,
  rows: Record<string, unknown>[],
  mapping?: Record<string, string>,
  options?: UpsertBehaviorOptions,
) {
  const now = new Date().toISOString()
  const allowRestoreArchived = options?.restoreArchived === true
  const skipMissingLifecycle = options?.skipMissingLifecycle === true
  const seen = new Set<string>()
  const index = new Map(db.complexes.filter((c) => c.source_id === sourceId).map((c) => [c.external_id, c]))
  // Global slug index for cross-source deduplication (same ЖК in multiple feeds)
  const slugIndex = new Map<string, Complex[]>()
  for (const complex of db.complexes) {
    const bucket = slugIndex.get(complex.slug)
    if (bucket) bucket.push(complex)
    else slugIndex.set(complex.slug, [complex])
  }

  const aggregated = aggregateComplexesFromRows(rows, sourceId, mapping)

  let inserted = 0
  let updated = 0
  let hidden = 0
  let targetComplexId: string | undefined
  const errors: Array<{ rowIndex: number; externalId?: string; error: string }> = [] // Not used by aggregation but kept for signature compatibility if needed

  for (const next of aggregated) {
    seen.add(next.external_id)
    const existing = index.get(next.external_id)
    if (existing) {
      if (existing.status === 'archived' && !allowRestoreArchived) continue
      const preservedLanding = existing.landing
      Object.assign(existing, next)
      if (preservedLanding) existing.landing = preservedLanding
      if (!targetComplexId) targetComplexId = existing.id
      updated += 1
    } else {
      // Cross-source dedup: if a complex with the same slug already exists, update it
      const slugCandidates = slugIndex.get(next.slug) || []
      const slugMatch = slugCandidates.find((candidate) => canMergeComplexAcrossSources(candidate, next))
      if (slugMatch) {
        if (slugMatch.status === 'archived' && !allowRestoreArchived) continue
        const preservedLanding = slugMatch.landing
        Object.assign(slugMatch, next)
        // Ownership is moved to the latest source that has this slug.
        // This prevents lifecycle transitions from a stale source from hiding the shared record.
        index.set(next.external_id, slugMatch)
        if (preservedLanding) slugMatch.landing = preservedLanding
        if (!targetComplexId) targetComplexId = slugMatch.id
        updated += 1
      } else {
        const createdId = newId()
        const newRecord = { id: createdId, ...next }
        db.complexes.unshift(newRecord)
        const bucket = slugIndex.get(next.slug)
        if (bucket) bucket.push(newRecord)
        else slugIndex.set(next.slug, [newRecord])
        if (!targetComplexId) targetComplexId = createdId
        inserted += 1
      }
    }
  }

  // Lifecycle for complexes missing in the current feed: active -> hidden -> archived
  if (!skipMissingLifecycle) {
    for (const c of db.complexes) {
      if (c.source_id !== sourceId) continue
      if (!seen.has(c.external_id)) {
        const transition = transitionMissingRecordStatus(c, now)
        if (transition === 'hidden') {
          hidden += 1
        }
      }
    }
  }

  return { inserted, updated, hidden, errors, targetComplexId }
}

export function upsertComplexesFromProperties(
  db: DbShape,
  sourceId: string,
  rows: Record<string, unknown>[],
  mapping?: Record<string, string>,
  options?: UpsertBehaviorOptions,
) {
  // Now just an alias for upsertComplexes, as it handles aggregation automatically
  const res = upsertComplexes(db, sourceId, rows, mapping, options)
  return { inserted: res.inserted, updated: res.updated, targetComplexId: res.targetComplexId }
}

export function upsertProperties(
  db: DbShape,
  sourceId: string,
  rows: Record<string, unknown>[],
  mapping?: Record<string, string>,
  options?: {
    hideInvalid?: boolean
    restoreArchived?: boolean
    skipMissingLifecycle?: boolean
    runtime?: UpsertPropertiesRuntime
  },
) {
  const runtime = options?.runtime
  const now = runtime?.now || new Date().toISOString()
  if (runtime && !runtime.now) runtime.now = now
  const allowRestoreArchived = options?.restoreArchived === true
  const skipMissingLifecycle = options?.skipMissingLifecycle === true
  if (runtime && !runtime.seen) runtime.seen = new Set<string>()
  const seen = runtime?.seen || new Set<string>()
  // Global index by external_id with collision buckets.
  if (runtime && !runtime.index) {
    const nextIndex = new Map<string, Property[]>()
    for (const property of db.properties) {
      const bucket = nextIndex.get(property.external_id)
      if (bucket) bucket.push(property)
      else nextIndex.set(property.external_id, [property])
    }
    runtime.index = nextIndex
  }
  const index = runtime?.index || (() => {
    const nextIndex = new Map<string, Property[]>()
    for (const property of db.properties) {
      const bucket = nextIndex.get(property.external_id)
      if (bucket) bucket.push(property)
      else nextIndex.set(property.external_id, [property])
    }
    return nextIndex
  })()
  if (runtime && !runtime.complexByExternal) {
    runtime.complexByExternal = new Map(db.complexes.map((c) => [c.external_id, c]))
  }
  const complexByExternal = runtime?.complexByExternal || new Map(db.complexes.map((c) => [c.external_id, c]))
  let inserted = 0
  let updated = 0
  let hidden = 0
  const errors: Array<{ rowIndex: number; externalId?: string; error: string }> = []
  const resolveCandidate = (
    externalId: string,
    incoming: Omit<Property, 'id'>,
  ): Property | undefined => {
    const bucket = index.get(externalId)
    if (!bucket || bucket.length === 0) return undefined

    const sameSource = bucket.find((item) => item.source_id === sourceId)
    if (sameSource) return sameSource

    return bucket.find((item) => canMergePropertyAcrossSources(item, incoming))
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const externalId = asString(getField(row, 'external_id', mapping, ['id', 'externalId', '_id']))
      if (!externalId) {
        errors.push({ rowIndex: i + 1, error: 'Отсутствует external_id' })
        continue
      }
      seen.add(externalId)

      const title = asString(getField(row, 'title', mapping, ['name', 'block_name']))
      const complexExternal = asString(getField(row, 'complex_external_id', mapping, ['complexExternalId', 'complex_id', 'block_id']))
      const complexId = complexExternal ? complexByExternal.get(complexExternal)?.id : undefined
      const cat = normalizeCategory(getField(row, 'category', mapping))
      const dealType = normalizeDealType(getField(row, 'deal_type', mapping, ['dealType']))

      const bedrooms = asNumber(getField(row, 'bedrooms', mapping, ['rooms', 'room']))
      const price = asNumber(getField(row, 'price', mapping))
      const area = asNumber(getField(row, 'area_total', mapping, ['area']))
      if (typeof bedrooms !== 'number' || typeof price !== 'number' || typeof area !== 'number') {
        errors.push({
          rowIndex: i + 1,
          externalId,
          error: `Некорректные данные - bedrooms: ${bedrooms}, price: ${price}, area: ${area}`
        })
        if (options?.hideInvalid) {
          const fallbackTitle = title || externalId
          const invalidNext: Omit<Property, 'id'> = {
            source_id: sourceId,
            external_id: externalId,
            slug: slugify(fallbackTitle),
            lot_number: asString(getField(row, 'lot_number', mapping, ['lotNumber', 'apartment', 'number'])),
            complex_id: complexId,
            complex_external_id: complexExternal || undefined,
            deal_type: dealType,
            category: cat,
            title: fallbackTitle,
            bedrooms: typeof bedrooms === 'number' ? bedrooms : 0,
            price: typeof price === 'number' ? price : 0,
            old_price: asNumber(getField(row, 'old_price', mapping, ['oldPrice', 'oldprice'])) || undefined,
            price_period: dealType === 'rent' ? 'month' : undefined,
            area_total: typeof area === 'number' ? area : 0,
            area_living: asNumber(getField(row, 'area_living', mapping, ['areaLiving', 'living_space', 'area_rooms_total'])) || undefined,
            area_kitchen: asNumber(getField(row, 'area_kitchen', mapping, ['areaKitchen', 'kitchen_space'])) || undefined,
            floor: asNumber(getField(row, 'floor', mapping)) || undefined,
            floors_total: asNumber(getField(row, 'floors_total', mapping, ['floorsTotal', 'floors-total', 'floors'])) || undefined,
            district: normalizeLocationValue(getField(row, 'district', mapping, ['area', 'region', 'block_district_name'])),
            metro: asStringArray(getField(row, 'metro', mapping, ['block_subway_name'])),
            images: asStringArray(getField(row, 'images', mapping, ['image_urls', 'photos', 'plan'])),
            renovation: asString(getField(row, 'renovation', mapping, ['finishing_name', 'finishing'])) || undefined,
            is_euroflat: asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === 'true' || asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === '1' || false,
            building_section: asString(getField(row, 'building_section', mapping, ['buildingSection', 'building-section', 'building_name'])) || undefined,
            building_state: asString(getField(row, 'building_state', mapping, ['buildingState', 'building-state'])) || undefined,
            ready_quarter: asNumber(getField(row, 'ready_quarter', mapping, ['readyQuarter', 'ready-quarter'])) || undefined,
            built_year: asNumber(getField(row, 'built_year', mapping, ['builtYear', 'built-year'])) || undefined,
            description: asString(getField(row, 'description', mapping, ['block_description'])) || undefined,
            mortgage_available: asBoolean(getField(row, 'mortgage_available', mapping, ['building_mortgage', 'mortgage'])) ?? undefined,
            installment_available: asBoolean(getField(row, 'installment_available', mapping, ['building_installment', 'installment'])) ?? undefined,
            subsidy_available: asBoolean(getField(row, 'subsidy_available', mapping, ['building_subsidy', 'subsidy'])) ?? undefined,
            military_mortgage_available: asBoolean(getField(row, 'military_mortgage_available', mapping, ['building_voen_mortgage', 'military_mortgage'])) ?? undefined,
            building_queue: asInteger(getField(row, 'building_queue', mapping, ['queue', 'building_queue'])) || undefined,
            building_type: asString(getField(row, 'building_type', mapping, ['buildingType', 'building_type_name'])) || undefined,
            status: 'hidden',
            last_seen_at: now,
            updated_at: now,
          }
          const existingInvalid = resolveCandidate(externalId, invalidNext)
          if (existingInvalid) {
            if (existingInvalid.status === 'archived' && !allowRestoreArchived) {
              continue
            }
            if (existingInvalid.status !== 'hidden') hidden += 1
            Object.assign(existingInvalid, invalidNext)
            updated += 1
          } else {
            const created = { id: newId(), ...invalidNext }
            db.properties.unshift(created)
            const bucket = index.get(externalId)
            if (bucket) bucket.push(created)
            else index.set(externalId, [created])
            inserted += 1
            hidden += 1
          }
        }
        continue
      }

      const next: Omit<Property, 'id'> = {
        source_id: sourceId,
        external_id: externalId,
        slug: slugify(title || externalId),
        lot_number: asString(getField(row, 'lot_number', mapping, ['lotNumber', 'apartment', 'number'])),
        complex_id: complexId,
        complex_external_id: complexExternal || undefined,
        deal_type: dealType,
        category: cat,
        title: title || externalId,
        bedrooms,
        price,
        old_price: asNumber(getField(row, 'old_price', mapping, ['oldPrice', 'oldprice'])) || undefined,
        price_period: dealType === 'rent' ? 'month' : undefined,
        area_total: area,
        area_living: asNumber(getField(row, 'area_living', mapping, ['areaLiving', 'living_space', 'area_rooms_total'])) || undefined,
        area_kitchen: asNumber(getField(row, 'area_kitchen', mapping, ['areaKitchen', 'kitchen_space'])) || undefined,
        floor: asNumber(getField(row, 'floor', mapping)) || undefined,
        floors_total: asNumber(getField(row, 'floors_total', mapping, ['floorsTotal', 'floors-total', 'floors'])) || undefined,
        district: normalizeLocationValue(getField(row, 'district', mapping, ['area', 'region', 'block_district_name'])),
        metro: asStringArray(getField(row, 'metro', mapping, ['block_subway_name'])),
        images: asStringArray(getField(row, 'images', mapping, ['image_urls', 'photos', 'plan'])),
        renovation: asString(getField(row, 'renovation', mapping, ['finishing_name', 'finishing'])) || undefined,
        is_euroflat: asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === 'true' || asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === '1' || false,
        building_section: asString(getField(row, 'building_section', mapping, ['buildingSection', 'building-section', 'building_name'])) || undefined,
        building_state: asString(getField(row, 'building_state', mapping, ['buildingState', 'building-state'])) || undefined,
        ready_quarter: asNumber(getField(row, 'ready_quarter', mapping, ['readyQuarter', 'ready-quarter'])) || undefined,
        built_year: asNumber(getField(row, 'built_year', mapping, ['builtYear', 'built-year'])) || undefined,
        description: asString(getField(row, 'description', mapping, ['block_description'])) || undefined,
        mortgage_available: asBoolean(getField(row, 'mortgage_available', mapping, ['building_mortgage', 'mortgage'])) ?? undefined,
        installment_available: asBoolean(getField(row, 'installment_available', mapping, ['building_installment', 'installment'])) ?? undefined,
        subsidy_available: asBoolean(getField(row, 'subsidy_available', mapping, ['building_subsidy', 'subsidy'])) ?? undefined,
        military_mortgage_available: asBoolean(getField(row, 'military_mortgage_available', mapping, ['building_voen_mortgage', 'military_mortgage'])) ?? undefined,
        building_queue: asInteger(getField(row, 'building_queue', mapping, ['queue', 'building_queue'])) || undefined,
        building_type: asString(getField(row, 'building_type', mapping, ['buildingType', 'building_type_name'])) || undefined,
        status: normalizeStatus(getField(row, 'status', mapping)),
        last_seen_at: now,
        updated_at: now,
      }

      const existing = resolveCandidate(externalId, next)
      if (existing) {
        if (existing.status === 'archived' && !allowRestoreArchived) continue
        Object.assign(existing, next)
        updated += 1
      } else {
        const created = { id: newId(), ...next }
        db.properties.unshift(created)
        const bucket = index.get(externalId)
        if (bucket) bucket.push(created)
        else index.set(externalId, [created])
        inserted += 1
      }
    } catch (e) {
      errors.push({
        rowIndex: i + 1,
        externalId: asString(getField(row, 'external_id', mapping, ['id', 'externalId', '_id'])),
        error: e instanceof Error ? e.message : 'Неизвестная ошибка'
      })
    }
  }

  // Lifecycle for properties missing in the current feed: active -> hidden -> archived
  if (!skipMissingLifecycle) {
    for (const p of db.properties) {
      if (p.source_id !== sourceId) continue
      if (!seen.has(p.external_id)) {
        const transition = transitionMissingRecordStatus(p, now)
        if (transition === 'hidden') {
          hidden += 1
        }
      }
    }
  }
  return { inserted, updated, hidden, errors }
}

export function mapRowToProperty(row: Record<string, unknown>, mapping?: Record<string, string>): Property {
  const title = asString(getField(row, 'title', mapping, ['name', 'block_name']))
  const externalId = asString(getField(row, 'external_id', mapping, ['id', 'externalId', '_id']))

  return {
    id: externalId, // Temporary ID for preview
    source_id: 'preview',
    external_id: externalId,
    slug: slugify(title || externalId),
    title: title || externalId || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f',
    category: normalizeCategory(getField(row, 'category', mapping)),
    deal_type: normalizeDealType(getField(row, 'deal_type', mapping, ['dealType'])),
    bedrooms: asNumber(getField(row, 'bedrooms', mapping, ['rooms', 'room'])) || 0,
    price: asNumber(getField(row, 'price', mapping)) || 0,
    old_price: asNumber(getField(row, 'old_price', mapping, ['oldPrice', 'oldprice'])),
    area_total: asNumber(getField(row, 'area_total', mapping, ['area'])) || 0,
    area_living: asNumber(getField(row, 'area_living', mapping, ['areaLiving', 'living_space', 'area_rooms_total'])),
    area_kitchen: asNumber(getField(row, 'area_kitchen', mapping, ['areaKitchen', 'kitchen_space'])),
    district: normalizeLocationValue(getField(row, 'district', mapping, ['area', 'region', 'block_district_name'])) || '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d',
    metro: asStringArray(getField(row, 'metro', mapping, ['block_subway_name'])),
    images: asStringArray(getField(row, 'images', mapping, ['image_urls', 'photos', 'plan'])),
    status: normalizeStatus(getField(row, 'status', mapping)),
    floor: asNumber(getField(row, 'floor', mapping)),
    floors_total: asNumber(getField(row, 'floors_total', mapping, ['floorsTotal', 'floors-total', 'floors'])),
    renovation: asString(getField(row, 'renovation', mapping, ['finishing_name', 'finishing'])),
    is_euroflat: asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === 'true' || asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === '1',
    building_section: asString(getField(row, 'building_section', mapping, ['buildingSection', 'building-section', 'building_name'])),
    building_state: asString(getField(row, 'building_state', mapping, ['buildingState', 'building-state'])),
    ready_quarter: asNumber(getField(row, 'ready_quarter', mapping, ['readyQuarter', 'ready-quarter'])),
    built_year: asNumber(getField(row, 'built_year', mapping, ['builtYear', 'built-year'])),
    description: asString(getField(row, 'description', mapping, ['block_description'])),
    lot_number: asString(getField(row, 'lot_number', mapping, ['lotNumber', 'apartment', 'number'])),
    mortgage_available: asBoolean(getField(row, 'mortgage_available', mapping, ['building_mortgage', 'mortgage'])),
    installment_available: asBoolean(getField(row, 'installment_available', mapping, ['building_installment', 'installment'])),
    subsidy_available: asBoolean(getField(row, 'subsidy_available', mapping, ['building_subsidy', 'subsidy'])),
    military_mortgage_available: asBoolean(getField(row, 'military_mortgage_available', mapping, ['building_voen_mortgage', 'military_mortgage'])),
    building_queue: asInteger(getField(row, 'building_queue', mapping, ['queue', 'building_queue'])),
    building_type: asString(getField(row, 'building_type', mapping, ['buildingType', 'building_type_name'])),
    updated_at: new Date().toISOString()
  }
}

export function mapRowToComplex(row: Record<string, unknown>, mapping?: Record<string, string>): Complex {
  const title = asString(getField(row, 'title', mapping, ['name', 'complex_title', 'block_name']))
  const externalId = asString(getField(row, 'external_id', mapping, ['id', 'externalId', 'complex_external_id', 'block_id']))
  const geoPoint = extractGeoPoint(row)
  const geoLat = asNumber(getField(row, 'geo_lat', mapping, ['lat'])) ?? geoPoint.lat
  const geoLon = asNumber(getField(row, 'geo_lon', mapping, ['lon', 'lng'])) ?? geoPoint.lon

  return {
    id: externalId, // Temporary ID for preview
    source_id: 'preview',
    external_id: externalId,
    slug: slugify(title || externalId),
    title: title || externalId || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f',
    category: 'newbuild',
    district: normalizeLocationValue(getField(row, 'district', mapping, ['area', 'region'])) || '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d',
    metro: asStringArray(getField(row, 'metro', mapping)),
    price_from: asNumber(getField(row, 'price_from', mapping, ['priceFrom', 'price_min'])) || asNumber(getField(row, 'price', mapping)),
    area_from: asNumber(getField(row, 'area_from', mapping, ['areaFrom', 'area_min'])) || asNumber(getField(row, 'area_total', mapping, ['area'])),
    images: asStringArray(getField(row, 'images', mapping, ['image_urls', 'photos', 'renderer', 'block_renderer'])),
    status: normalizeStatus(getField(row, 'status', mapping)),
    developer: asString(getField(row, 'developer', mapping, ['block_builder_name'])) || undefined,
    handover_date: asString(getField(row, 'handover_date', mapping, ['handoverDate', 'building_deadline'])) || undefined,
    finish_type: asString(getField(row, 'finish_type', mapping, ['finishType', 'renovation', 'finishing_name', 'finishing'])) || undefined,
    description: asString(getField(row, 'description', mapping, ['block_description'])) || undefined,
    address: asString(getField(row, 'address', mapping, ['block_address'])) || undefined,
    mortgage_available: asBoolean(getField(row, 'mortgage_available', mapping, ['building_mortgage', 'mortgage'])),
    installment_available: asBoolean(getField(row, 'installment_available', mapping, ['building_installment', 'installment'])),
    subsidy_available: asBoolean(getField(row, 'subsidy_available', mapping, ['building_subsidy', 'subsidy'])),
    military_mortgage_available: asBoolean(getField(row, 'military_mortgage_available', mapping, ['building_voen_mortgage', 'military_mortgage'])),
    queue_min: asInteger(getField(row, 'queue_min', mapping, ['building_queue', 'queue'])),
    building_type: asString(getField(row, 'building_type', mapping, ['buildingType', 'building_type_name'])) || undefined,
    geo_lat: geoLat,
    geo_lon: geoLon,
    updated_at: new Date().toISOString()
  }
}
