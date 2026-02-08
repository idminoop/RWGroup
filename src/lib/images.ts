/**
 * Utility functions for working with property/complex images
 */

/**
 * Check if image URL is a floor plan/layout (not presentable for cover)
 */
function isLayoutImage(url: string): boolean {
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
