import type { Collection, DbShape, Property, Complex } from '../../shared/types.js'

/**
 * Resolves collection items based on collection mode (manual or auto)
 * @param collection - The collection to resolve
 * @param db - Database instance
 * @returns Array of resolved items with their full object data
 */
export function resolveCollectionItems(
  collection: Collection,
  db: DbShape
): Array<{ type: 'property' | 'complex'; ref: Property | Complex }> {
  // Manual mode: return items from the items array (only active)
  if (collection.mode === 'manual') {
    return collection.items
      .map((it) => {
        if (it.type === 'property') {
          const ref = db.properties.find((p) => p.id === it.ref_id && p.status === 'active')
          return ref ? { type: 'property' as const, ref } : null
        }
        const ref = db.complexes.find((c) => c.id === it.ref_id && c.status === 'active')
        return ref ? { type: 'complex' as const, ref } : null
      })
      .filter((item): item is { type: 'property' | 'complex'; ref: Property | Complex } => item !== null)
  }

  // Auto mode: apply filters from auto_rules
  if (!collection.auto_rules) return []

  const rules = collection.auto_rules
  const sourceItems: (Property | Complex)[] =
    rules.type === 'property'
      ? db.properties.filter((p) => p.status === 'active')
      : db.complexes.filter((c) => c.status === 'active')

  const filtered = sourceItems
    // Category filter (only for properties)
    .filter((item) => {
      if (!rules.category) return true
      return 'category' in item && item.category === rules.category
    })
    // Bedrooms filter (only for properties)
    .filter((item) => {
      if (rules.bedrooms === undefined) return true
      return 'bedrooms' in item && item.bedrooms === rules.bedrooms
    })
    // Price filter (both property.price and complex.price_from)
    .filter((item) => {
      if (rules.priceMin === undefined) return true
      if ('price' in item) return item.price >= rules.priceMin
      if ('price_from' in item && item.price_from !== undefined) return item.price_from >= rules.priceMin
      return true
    })
    .filter((item) => {
      if (rules.priceMax === undefined) return true
      if ('price' in item) return item.price <= rules.priceMax
      if ('price_from' in item && item.price_from !== undefined) return item.price_from <= rules.priceMax
      return true
    })
    // Area filter (both property.area_total and complex.area_from)
    .filter((item) => {
      if (rules.areaMin === undefined) return true
      if ('area_total' in item) return item.area_total >= rules.areaMin
      if ('area_from' in item && item.area_from !== undefined) return item.area_from >= rules.areaMin
      return true
    })
    .filter((item) => {
      if (rules.areaMax === undefined) return true
      if ('area_total' in item) return item.area_total <= rules.areaMax
      if ('area_from' in item && item.area_from !== undefined) return item.area_from <= rules.areaMax
      return true
    })
    // District filter
    .filter((item) => {
      if (!rules.district) return true
      return item.district.toLowerCase() === rules.district.toLowerCase()
    })
    // Metro filter (at least one metro station matches)
    .filter((item) => {
      if (!rules.metro || rules.metro.length === 0) return true
      return rules.metro.some((m) => item.metro.includes(m))
    })
    // Text search filter
    .filter((item) => {
      if (!rules.q) return true
      const qlc = rules.q.toLowerCase()
      return (
        item.title.toLowerCase().includes(qlc) ||
        item.district.toLowerCase().includes(qlc) ||
        item.metro.some((m) => m.toLowerCase().includes(qlc))
      )
    })
    // Sort by updated_at (newest first)
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))

  return filtered.map((ref) => ({ type: rules.type, ref }))
}
