const DEFAULT_TITLE = 'RWgroup — агентство недвижимости в Москве'
const DEFAULT_DESCRIPTION =
  'Эксперты по недвижимости. Новостройки, вторичное жильё, аренда. Подбор, сопровождение сделки, юридическая проверка.'
const SITE_NAME = 'RWgroup'

interface PageMeta {
  title?: string
  description?: string
  ogImage?: string
  ogType?: string
  canonical?: string
}

function setTag(property: string, content: string) {
  let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('property', property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setNameTag(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

export function setPageMeta(meta: PageMeta) {
  const title = meta.title ? `${meta.title} | ${SITE_NAME}` : DEFAULT_TITLE
  const description = meta.description || DEFAULT_DESCRIPTION

  document.title = title
  setNameTag('description', description)
  setTag('og:title', title)
  setTag('og:description', description)
  if (meta.ogImage) setTag('og:image', meta.ogImage)
  if (meta.ogType) setTag('og:type', meta.ogType)

  if (meta.canonical) {
    setCanonical(meta.canonical)
  } else if (typeof window !== 'undefined') {
    setCanonical(window.location.origin + window.location.pathname)
  }
}

export function resetPageMeta() {
  document.title = DEFAULT_TITLE
  setNameTag('description', DEFAULT_DESCRIPTION)
  setTag('og:title', DEFAULT_TITLE)
  setTag('og:description', DEFAULT_DESCRIPTION)
  setTag('og:image', '/hero-bg.jpg')
  setTag('og:type', 'website')
}
