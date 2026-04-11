/**
 * Utility functions for working with property/complex images
 */

type ComplexCoverSource = {
  images?: string[]
  landing?: {
    hero_image?: string
  }
}

const BLOCKED_IMAGE_HOSTS = new Set(['images.unsplash.com'])
const LOCAL_IMAGE_FALLBACK = '/images/hero-bg.jpg'
const LAYOUT_IMAGE_RX = /(^|[\/_.-])(plan|plans|planirovka|layout|preset|floorplan|floor-plan|room-plan|flat-plan|unit-plan)([\/_.-]|$)/i

function normalizeImageUrl(url: string | undefined): string {
  const value = typeof url === 'string' ? url.trim() : ''
  if (!value) return ''

  try {
    const parsed = new URL(value)
    if (BLOCKED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) {
      return LOCAL_IMAGE_FALLBACK
    }
    return parsed.toString()
  } catch {
    return value
  }
}

export function toSafeImageUrl(url: string | undefined): string | undefined {
  const normalized = normalizeImageUrl(url)
  return normalized || undefined
}

/**
 * Check if image URL is a floor plan/layout (not presentable for cover)
 */
export function isLayoutImage(url: string): boolean {
  const source = (url || '').trim()
  if (!source) return false
  const lower = source.toLowerCase()
  if (lower.includes('/preset/') || lower.includes('/layout/')) return true
  if (LAYOUT_IMAGE_RX.test(lower)) return true

  try {
    const parsed = new URL(source)
    const decodedPath = decodeURIComponent(parsed.pathname).toLowerCase()
    if (decodedPath.includes('/preset/') || decodedPath.includes('/layout/')) return true
    if (LAYOUT_IMAGE_RX.test(decodedPath)) return true
    const query = decodeURIComponent(parsed.search).toLowerCase()
    if (LAYOUT_IMAGE_RX.test(query)) return true
  } catch {
    // ignore parse/decode errors and fall back to simple checks above
  }

  return false
}

/**
 * Get priority score for image (higher = better for cover)
 */
function getImagePriority(url: string): number {
  const lower = url.toLowerCase()

  // Plans and layouts - lowest priority
  if (lower.includes('/preset/') || lower.includes('/layout/')) return 0

  // Building images - highest priority
  if (lower.includes('/building_image/') || lower.includes('/building/')) return 100

  // House photos - high priority
  if (lower.includes('/house/')) return 90

  // Interior photos
  if (lower.includes('/interior/')) return 80

  // Generic images
  return 50
}

/**
 * Select best cover image from array
 * Prioritizes building/house photos over floor plans
 */
export function selectCoverImage(images: string[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined

  // Sort by priority (highest first) and return first
  const sorted = [...images].sort((a, b) => getImagePriority(b) - getImagePriority(a))
  return normalizeImageUrl(sorted[0]) || undefined
}

/**
 * Get all presentable images (exclude floor plans for gallery)
 */
export function getPresentableImages(images: string[] | undefined): string[] {
  if (!images || images.length === 0) return []
  return images
    .filter((url) => !isLayoutImage(url))
    .map((url) => normalizeImageUrl(url))
    .filter(Boolean)
}

/**
 * Get all floor plan images
 */
export function getLayoutImages(images: string[] | undefined): string[] {
  if (!images || images.length === 0) return []
  return images
    .filter((url) => isLayoutImage(url))
    .map((url) => normalizeImageUrl(url))
    .filter(Boolean)
}

/**
 * Select cover image for a Property catalog card.
 * Prefers floor plan/layout images - they are shown as the main photo.
 * Falls back to building/facade photos if no layout found.
 */
export function selectPropertyCoverImage(images: string[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined
  const firstLayout = images.find((url) => isLayoutImage(url))
  if (firstLayout) return normalizeImageUrl(firstLayout) || undefined
  return selectCoverImage(images)
}

/**
 * Put an image URL at the beginning of the list and remove duplicates.
 * Preserves the relative order of the remaining URLs.
 */
export function promoteImageToFront(images: string[] | undefined, imageUrl: string | undefined): string[] {
  const preferred = normalizeImageUrl(imageUrl)
  const result: string[] = []
  const seen = new Set<string>()

  if (preferred) {
    seen.add(preferred)
    result.push(preferred)
  }

  for (const raw of images || []) {
    const value = normalizeImageUrl(raw)
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  return result
}

/**
 * Select cover image for a Complex catalog card.
 * Returns the first non-layout image (respects admin-defined array order).
 * Falls back to priority scoring if all images are floor plans.
 * Falls back to landing.hero_image when image array has only layout images.
 */
export function selectComplexCoverImage(complex: ComplexCoverSource): string | undefined {
  const images = complex.images
  if (images && images.length > 0) {
    const firstPresentation = images.find((url) => !isLayoutImage(url))
    if (firstPresentation) return normalizeImageUrl(firstPresentation) || undefined
  }

  const heroImage = normalizeImageUrl(complex.landing?.hero_image)
  if (heroImage) return heroImage

  return selectCoverImage(images)
}
