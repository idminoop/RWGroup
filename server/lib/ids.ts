import { randomUUID } from 'crypto'

export function newId(): string {
  return randomUUID()
}

export function slugify(input: string): string {
  const base = (input || '').trim().toLowerCase()
  const mapped = base
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return mapped || 'item'
}
