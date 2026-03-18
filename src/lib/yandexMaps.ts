import { apiGet } from '@/lib/api'

export type YandexMapsQuery = {
  lang: 'ru_RU'
  load: 'package.full'
  apikey?: string
}

const yandexMapsBaseQuery: Omit<YandexMapsQuery, 'apikey'> = {
  lang: 'ru_RU',
  load: 'package.full',
}

const envApiKey = (import.meta.env.VITE_YANDEX_MAPS_API_KEY || '').trim()
const defaultQuery: YandexMapsQuery = envApiKey
  ? { ...yandexMapsBaseQuery, apikey: envApiKey }
  : { ...yandexMapsBaseQuery }

let pendingQueryLoad: Promise<YandexMapsQuery> | null = null

function queryWithKey(apiKey?: string): YandexMapsQuery {
  const key = (apiKey || '').trim()
  if (key) return { ...yandexMapsBaseQuery, apikey: key }
  if (envApiKey) return { ...yandexMapsBaseQuery, apikey: envApiKey }
  return { ...yandexMapsBaseQuery }
}

export function getDefaultYandexMapsQuery(): YandexMapsQuery {
  return { ...defaultQuery }
}

export async function loadYandexMapsQuery(): Promise<YandexMapsQuery> {
  if (pendingQueryLoad) return pendingQueryLoad

  pendingQueryLoad = (async () => {
    try {
      const data = await apiGet<{ yandex_maps_api_key?: string }>('/api/map-config')
      return queryWithKey(data?.yandex_maps_api_key)
    } catch {
      return { ...defaultQuery }
    } finally {
      pendingQueryLoad = null
    }
  })()

  return pendingQueryLoad
}
