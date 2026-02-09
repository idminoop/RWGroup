
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
  }>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    let complexId = asString(getField(row, 'complex_external_id', mapping, ['complexExternalId', 'complex_id', 'building-name', 'yandex-building-id']))
    const isChild = !!complexId
    
    // Fallback: if no complex_id found, assume the row itself represents a complex and use its ID
    if (!complexId) {
      complexId = asString(getField(row, 'external_id', mapping, ['id', 'externalId']))
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
    const complexTitle = asString(getField(row, 'complex_title', mapping, ['building-name', 'complex_name', 'zhk_name', 'complexName']))
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

    const imgs = asStringArray(getField(row, 'images', mapping, ['image_urls', 'photos']))
    imgs.forEach(img => c.images.add(img))

    const dev = asString(getField(row, 'developer', mapping))
    if (dev) c.developer = dev

    const date = asString(getField(row, 'handover_date', mapping, ['handoverDate']))
    if (date) c.handover_date = date

    const district = normalizeLocationValue(getField(row, 'district', mapping, ['area', 'region']))
    if (district) c.district = district

    const metros = asStringArray(getField(row, 'metro', mapping))
    metros.forEach(m => c.metro.add(m))

    const desc = asString(getField(row, 'description', mapping))
    if (desc && !c.description) c.description = desc

    const classType = asString(getField(row, 'class', mapping, ['class_type', 'housing_class']))
    if (classType && !c.class) c.class = classType

    const finishType = asString(getField(row, 'finish_type', mapping, ['finishType', 'finishing']))
    if (finishType && !c.finish_type) c.finish_type = finishType
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
      geo_lat: undefined,
      geo_lon: undefined,
      last_seen_at: now,
      updated_at: now,
    })
  }
  return result
}

export function upsertComplexes(db: DbShape, sourceId: string, rows: Record<string, unknown>[], mapping?: Record<string, string>) {
  const now = new Date().toISOString()
  const seen = new Set<string>()
  const index = new Map(db.complexes.filter((c) => c.source_id === sourceId).map((c) => [c.external_id, c]))
  
  const aggregated = aggregateComplexesFromRows(rows, sourceId, mapping)
  
  let inserted = 0
  let updated = 0
  let hidden = 0
  let errors: Array<{ rowIndex: number; externalId?: string; error: string }> = [] // Not used by aggregation but kept for signature compatibility if needed

  for (const next of aggregated) {
    seen.add(next.external_id)
    const existing = index.get(next.external_id)
    if (existing) {
      Object.assign(existing, next)
      updated += 1
    } else {
      db.complexes.unshift({ id: newId(), ...next })
      inserted += 1
    }
  }

  // Handle hidden/removed complexes
  for (const c of db.complexes) {
    if (c.source_id !== sourceId) continue
    if (!seen.has(c.external_id) && c.status === 'active') {
      c.status = 'hidden'
      c.updated_at = now
      hidden += 1
    }
  }

  return { inserted, updated, hidden, errors }
}

export function upsertComplexesFromProperties(db: DbShape, sourceId: string, rows: Record<string, unknown>[], mapping?: Record<string, string>) {
  // Now just an alias for upsertComplexes, as it handles aggregation automatically
  const res = upsertComplexes(db, sourceId, rows, mapping)
  return { inserted: res.inserted, updated: res.updated }
}

export function upsertProperties(db: DbShape, sourceId: string, rows: Record<string, unknown>[], mapping?: Record<string, string>) {
  const now = new Date().toISOString()
  const seen = new Set<string>()
  const index = new Map(db.properties.filter((p) => p.source_id === sourceId).map((p) => [p.external_id, p]))
  const complexByExternal = new Map(db.complexes.filter((c) => c.source_id === sourceId).map((c) => [c.external_id, c]))
  let inserted = 0
  let updated = 0
  const errors: Array<{ rowIndex: number; externalId?: string; error: string }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const externalId = asString(getField(row, 'external_id', mapping, ['id', 'externalId']))
      if (!externalId) {
        errors.push({ rowIndex: i + 1, error: 'Отсутствует external_id' })
        continue
      }
      seen.add(externalId)

      const title = asString(getField(row, 'title', mapping, ['name']))
      const complexExternal = asString(getField(row, 'complex_external_id', mapping, ['complexExternalId', 'complex_id']))
      const complexId = complexExternal ? complexByExternal.get(complexExternal)?.id : undefined
      const cat = normalizeCategory(getField(row, 'category', mapping))
      const dealType = normalizeDealType(getField(row, 'deal_type', mapping, ['dealType']))

      const bedrooms = asNumber(getField(row, 'bedrooms', mapping, ['rooms']))
      const price = asNumber(getField(row, 'price', mapping))
      const area = asNumber(getField(row, 'area_total', mapping, ['area']))
      if (typeof bedrooms !== 'number' || typeof price !== 'number' || typeof area !== 'number') {
        errors.push({
          rowIndex: i + 1,
          externalId,
          error: `Некорректные данные - bedrooms: ${bedrooms}, price: ${price}, area: ${area}`
        })
        continue
      }

      const next: Omit<Property, 'id'> = {
        source_id: sourceId,
        external_id: externalId,
        slug: slugify(title || externalId),
        lot_number: asString(getField(row, 'lot_number', mapping, ['lotNumber', 'apartment'])),
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
        area_living: asNumber(getField(row, 'area_living', mapping, ['areaLiving', 'living_space'])) || undefined,
        area_kitchen: asNumber(getField(row, 'area_kitchen', mapping, ['areaKitchen', 'kitchen_space'])) || undefined,
        floor: asNumber(getField(row, 'floor', mapping)) || undefined,
        floors_total: asNumber(getField(row, 'floors_total', mapping, ['floorsTotal', 'floors-total'])) || undefined,
        district: normalizeLocationValue(getField(row, 'district', mapping, ['area', 'region'])),
        metro: asStringArray(getField(row, 'metro', mapping)),
        images: asStringArray(getField(row, 'images', mapping, ['image_urls', 'photos'])),
        renovation: asString(getField(row, 'renovation', mapping)) || undefined,
        is_euroflat: asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === 'true' || asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === '1' || false,
        building_section: asString(getField(row, 'building_section', mapping, ['buildingSection', 'building-section'])) || undefined,
        building_state: asString(getField(row, 'building_state', mapping, ['buildingState', 'building-state'])) || undefined,
        ready_quarter: asNumber(getField(row, 'ready_quarter', mapping, ['readyQuarter', 'ready-quarter'])) || undefined,
        built_year: asNumber(getField(row, 'built_year', mapping, ['builtYear', 'built-year'])) || undefined,
        description: asString(getField(row, 'description', mapping)) || undefined,
        status: normalizeStatus(getField(row, 'status', mapping)),
        last_seen_at: now,
        updated_at: now,
      }

      const existing = index.get(externalId)
      if (existing) {
        Object.assign(existing, next)
        updated += 1
      } else {
        db.properties.unshift({ id: newId(), ...next })
        inserted += 1
      }
    } catch (e) {
      errors.push({
        rowIndex: i + 1,
        externalId: asString(getField(row, 'external_id', mapping, ['id', 'externalId'])),
        error: e instanceof Error ? e.message : 'Неизвестная ошибка'
      })
    }
  }

  let hidden = 0
  for (const p of db.properties) {
    if (p.source_id !== sourceId) continue
    if (!seen.has(p.external_id) && p.status === 'active') {
      p.status = 'hidden'
      p.updated_at = now
      hidden += 1
    }
  }
  return { inserted, updated, hidden, errors }
}

export function mapRowToProperty(row: Record<string, unknown>, mapping?: Record<string, string>): Property {
  const title = asString(getField(row, 'title', mapping, ['name']))
  const externalId = asString(getField(row, 'external_id', mapping, ['id', 'externalId']))

  return {
    id: externalId, // Temporary ID for preview
    source_id: 'preview',
    external_id: externalId,
    slug: slugify(title || externalId),
    title: title || externalId || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f',
    category: normalizeCategory(getField(row, 'category', mapping)),
    deal_type: normalizeDealType(getField(row, 'deal_type', mapping, ['dealType'])),
    bedrooms: asNumber(getField(row, 'bedrooms', mapping, ['rooms'])) || 0,
    price: asNumber(getField(row, 'price', mapping)) || 0,
    old_price: asNumber(getField(row, 'old_price', mapping, ['oldPrice', 'oldprice'])),
    area_total: asNumber(getField(row, 'area_total', mapping, ['area'])) || 0,
    area_living: asNumber(getField(row, 'area_living', mapping, ['areaLiving', 'living_space'])),
    area_kitchen: asNumber(getField(row, 'area_kitchen', mapping, ['areaKitchen', 'kitchen_space'])),
    district: normalizeLocationValue(getField(row, 'district', mapping, ['area', 'region'])) || '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d',
    metro: asStringArray(getField(row, 'metro', mapping)),
    images: asStringArray(getField(row, 'images', mapping, ['image_urls', 'photos'])),
    status: normalizeStatus(getField(row, 'status', mapping)),
    floor: asNumber(getField(row, 'floor', mapping)),
    floors_total: asNumber(getField(row, 'floors_total', mapping, ['floorsTotal', 'floors-total'])),
    renovation: asString(getField(row, 'renovation', mapping)),
    is_euroflat: asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === 'true' || asString(getField(row, 'is_euroflat', mapping, ['euroflat'])) === '1',
    building_section: asString(getField(row, 'building_section', mapping, ['buildingSection', 'building-section'])),
    building_state: asString(getField(row, 'building_state', mapping, ['buildingState', 'building-state'])),
    ready_quarter: asNumber(getField(row, 'ready_quarter', mapping, ['readyQuarter', 'ready-quarter'])),
    built_year: asNumber(getField(row, 'built_year', mapping, ['builtYear', 'built-year'])),
    description: asString(getField(row, 'description', mapping)),
    lot_number: asString(getField(row, 'lot_number', mapping, ['lotNumber', 'apartment'])),
    updated_at: new Date().toISOString()
  }
}

export function mapRowToComplex(row: Record<string, unknown>, mapping?: Record<string, string>): Complex {
  const title = asString(getField(row, 'title', mapping, ['name']))
  const externalId = asString(getField(row, 'external_id', mapping, ['id', 'externalId']))

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
    images: asStringArray(getField(row, 'images', mapping, ['image_urls', 'photos'])),
    status: normalizeStatus(getField(row, 'status', mapping)),
    updated_at: new Date().toISOString()
  }
}
