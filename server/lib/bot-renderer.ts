import type { Request, Response, NextFunction, RequestHandler } from 'express'
import fs from 'fs'
import path from 'path'
import type { DbShape, Complex, Property, Collection } from '../../shared/types.js'
import { withPublishedDb } from './storage.js'
import { formatPriceRub, formatArea } from './format.js'

// ────────────────────────────────────────────
// Bot detection
// ────────────────────────────────────────────

const BOT_RE = /Googlebot|Yandexbot|bingbot|Baiduspider|facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Applebot|DuckDuckBot|Slackbot|Discordbot|Pinterestbot|vkShare|redditbot|Sogou|Embedly/i

export function isBot(ua: string | undefined): boolean {
  if (!ua) return false
  return BOT_RE.test(ua)
}

// ────────────────────────────────────────────
// HTML template cache
// ────────────────────────────────────────────

let cachedTemplate: string | null = null

function loadTemplate(): string | null {
  if (cachedTemplate) return cachedTemplate
  const distIndex = path.join(process.cwd(), 'dist', 'index.html')
  if (!fs.existsSync(distIndex)) return null
  cachedTemplate = fs.readFileSync(distIndex, 'utf-8')
  return cachedTemplate
}

// ────────────────────────────────────────────
// Image selection (server-side copy of src/lib/images.ts logic)
// ────────────────────────────────────────────

function selectCoverImage(images: string[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined
  const sorted = [...images].sort((a, b) => {
    const pA = getImagePriority(a)
    const pB = getImagePriority(b)
    return pB - pA
  })
  return sorted[0]
}

function getImagePriority(url: string): number {
  const lower = url.toLowerCase()
  if (lower.includes('/preset/') || lower.includes('/layout/')) return 0
  if (lower.includes('/building_image/') || lower.includes('/building/')) return 100
  if (lower.includes('/house/')) return 90
  if (lower.includes('/interior/')) return 80
  return 50
}

// ────────────────────────────────────────────
// Meta tag structures
// ────────────────────────────────────────────

interface MetaTags {
  title: string
  description: string
  ogImage?: string
  ogType?: string
}

const SITE_NAME = 'RWgroup'

function buildTitle(raw: string): string {
  return `${raw} | ${SITE_NAME}`
}

// ────────────────────────────────────────────
// Route data resolution
// ────────────────────────────────────────────

interface RouteData {
  meta: MetaTags
  jsonLd: Record<string, unknown>
  canonical: string
}

function resolveRouteData(pathname: string, db: DbShape, siteUrl: string): RouteData | null {
  // /property/:slug
  const propertyMatch = pathname.match(/^\/property\/([^/]+)$/)
  if (propertyMatch) {
    const slug = propertyMatch[1]
    const p = db.properties.find((x) => x.status === 'active' && (x.slug === slug || x.id === slug))
    if (!p) return null
    const complex = p.complex_id ? db.complexes.find((c) => c.id === p.complex_id) : undefined
    return buildPropertyData(p, complex, siteUrl)
  }

  // /complex/:slug
  const complexMatch = pathname.match(/^\/complex\/([^/]+)$/)
  if (complexMatch) {
    const slug = complexMatch[1]
    const c = db.complexes.find((x) => x.status === 'active' && (x.slug === slug || x.id === slug))
    if (!c) return null
    return buildComplexData(c, siteUrl)
  }

  // /collection/:slug
  const collectionMatch = pathname.match(/^\/collection\/([^/]+)$/)
  if (collectionMatch) {
    const slug = collectionMatch[1]
    const col = db.collections.find((x) => (x.status === 'visible') && (x.slug === slug || x.id === slug))
    if (!col) return null
    return buildCollectionData(col, db, siteUrl)
  }

  // /catalog
  if (pathname === '/catalog') {
    return {
      meta: {
        title: buildTitle('Каталог недвижимости Москвы'),
        description: 'Новостройки, вторичное жильё, аренда квартир в Москве. Фильтры по району, метро, цене и площади.',
        ogType: 'website',
      },
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Каталог недвижимости Москвы',
        description: 'Новостройки, вторичное жильё, аренда квартир в Москве.',
        url: `${siteUrl}/catalog`,
      },
      canonical: `${siteUrl}/catalog`,
    }
  }

  // / (homepage) — use defaults from template
  return null
}

function buildPropertyData(p: Property, complex: Complex | undefined, siteUrl: string): RouteData {
  const bedroomsLabel = p.bedrooms === 0 ? 'Студия' : `${p.bedrooms}-комн.`
  const complexLabel = complex ? ` — ${complex.title}` : ''
  const title = buildTitle(`${bedroomsLabel} ${formatArea(p.area_total)}${complexLabel}`)
  const description = p.description?.slice(0, 160) || `${p.title}, ${p.district}. Цена: ${formatPriceRub(p.price)}`
  const coverImage = selectCoverImage(p.images)
  const url = `${siteUrl}/property/${p.slug || p.id}`

  return {
    meta: { title, description, ogImage: coverImage, ogType: 'product' },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'RealEstateListing',
      name: p.title,
      description: p.description || '',
      url,
      image: coverImage || '',
      offers: {
        '@type': 'Offer',
        price: p.price,
        priceCurrency: 'RUB',
      },
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Москва',
        addressRegion: p.district,
      },
      floorSize: {
        '@type': 'QuantitativeValue',
        value: p.area_total,
        unitCode: 'MTK',
      },
      ...(p.bedrooms ? { numberOfRooms: p.bedrooms } : {}),
    },
    canonical: url,
  }
}

function buildComplexData(c: Complex, siteUrl: string): RouteData {
  const priceLabel = typeof c.price_from === 'number' ? ` — от ${formatPriceRub(c.price_from)}` : ''
  const title = buildTitle(`ЖК ${c.title}${priceLabel}`)
  const description = c.description?.slice(0, 160) || `Жилой комплекс ${c.title}, ${c.district}`
  const coverImage = selectCoverImage(c.images)
  const url = `${siteUrl}/complex/${c.slug || c.id}`

  return {
    meta: { title, description, ogImage: coverImage, ogType: 'product' },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ApartmentComplex',
      name: c.title,
      description: c.description || '',
      url,
      image: coverImage || '',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Москва',
        addressRegion: c.district,
      },
      ...(c.geo_lat && c.geo_lon ? {
        geo: {
          '@type': 'GeoCoordinates',
          latitude: c.geo_lat,
          longitude: c.geo_lon,
        },
      } : {}),
      ...(typeof c.price_from === 'number' ? {
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: c.price_from,
          priceCurrency: 'RUB',
        },
      } : {}),
    },
    canonical: url,
  }
}

function buildCollectionData(col: Collection, db: DbShape, siteUrl: string): RouteData {
  const title = buildTitle(`${col.title} — подборка недвижимости`)
  const description = col.description?.slice(0, 160) || `Подборка: ${col.title}`
  const url = `${siteUrl}/collection/${col.slug || col.id}`

  const itemListElement = col.items.map((item, idx) => {
    const entity = item.type === 'property'
      ? db.properties.find((p) => p.id === item.ref_id)
      : db.complexes.find((c) => c.id === item.ref_id)
    const itemSlug = entity ? ((entity as { slug?: string }).slug || entity.id) : item.ref_id
    return {
      '@type': 'ListItem',
      position: idx + 1,
      name: entity ? (entity as { title: string }).title : '',
      url: `${siteUrl}/${item.type === 'property' ? 'property' : 'complex'}/${itemSlug}`,
    }
  })

  return {
    meta: { title, description, ogImage: col.cover_image || undefined, ogType: 'website' },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: col.title,
      description: col.description || '',
      numberOfItems: col.items.length,
      itemListElement,
    },
    canonical: url,
  }
}

// ────────────────────────────────────────────
// HTML injection
// ────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function injectMeta(template: string, data: RouteData): string {
  let html = template

  // Replace <title>
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(data.meta.title)}</title>`)

  // Replace <meta name="description">
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeHtml(data.meta.description)}" />`,
  )

  // Replace og:title
  html = html.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${escapeHtml(data.meta.title)}" />`,
  )

  // Replace og:description
  html = html.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${escapeHtml(data.meta.description)}" />`,
  )

  // Replace og:type
  if (data.meta.ogType) {
    html = html.replace(
      /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:type" content="${escapeHtml(data.meta.ogType)}" />`,
    )
  }

  // Replace og:image
  if (data.meta.ogImage) {
    html = html.replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image" content="${escapeHtml(data.meta.ogImage)}" />`,
    )
  }

  // Insert canonical + JSON-LD before </head>
  const extraTags = [
    `<link rel="canonical" href="${escapeHtml(data.canonical)}" />`,
    `<script type="application/ld+json">${JSON.stringify(data.jsonLd)}</script>`,
  ].join('\n    ')

  html = html.replace('</head>', `    ${extraTags}\n  </head>`)

  return html
}

// ────────────────────────────────────────────
// Express middleware
// ────────────────────────────────────────────

export function botPrerender(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only intercept HTML page requests from bots
    const ua = req.headers['user-agent']
    if (!isBot(ua)) { next(); return }

    const isApiOrUpload = req.path.startsWith('/api') || req.path.startsWith('/uploads')
    const isFileRequest = path.extname(req.path) !== ''
    const acceptsHtml = req.headers.accept?.includes('text/html')
    if (isApiOrUpload || isFileRequest || !acceptsHtml) { next(); return }

    const template = loadTemplate()
    if (!template) { next(); return }

    const siteUrl = `${req.protocol}://${req.get('host')}`

    try {
      const routeData = withPublishedDb((db) => resolveRouteData(req.path, db, siteUrl))
      if (!routeData) { next(); return }

      const html = injectMeta(template, routeData)
      res.set('Content-Type', 'text/html')
      res.send(html)
    } catch {
      next()
    }
  }
}
