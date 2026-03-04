/**
 * Utility functions for working with property/complex images
 */

type ComplexCoverSource = {
  images?: string[]
  landing?: {
    hero_image?: string
  }
}

function normalizeImageUrl(url: string | undefined): string {
  return typeof url === 'string' ? url.trim() : ''
}

/**
 * Check if image URL is a floor plan/layout (not presentable for cover)
 */
export function isLayoutImage(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes('/preset/') || lower.includes('/layout/')
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
  return sorted[0]
}

/**
 * Get all presentable images (exclude floor plans for gallery)
 */
export function getPresentableImages(images: string[] | undefined): string[] {
  if (!images || images.length === 0) return []
  return images.filter((url) => !isLayoutImage(url))
}

/**
 * Get all floor plan images
 */
export function getLayoutImages(images: string[] | undefined): string[] {
  if (!images || images.length === 0) return []
  return images.filter((url) => isLayoutImage(url))
}

/**
 * Select cover image for a Property catalog card.
 * Prefers floor plan/layout images - they are shown as the main photo.
 * Falls back to building/facade photos if no layout found.
 */
export function selectPropertyCoverImage(images: string[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined
  const firstLayout = images.find((url) => isLayoutImage(url))
  if (firstLayout) return firstLayout
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
    if (firstPresentation) return firstPresentation
  }

  const heroImage = normalizeImageUrl(complex.landing?.hero_image)
  if (heroImage) return heroImage

  return selectCoverImage(images)
}
