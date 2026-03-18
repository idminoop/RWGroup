const yandexMapsApiKey = (import.meta.env.VITE_YANDEX_MAPS_API_KEY || '').trim()

const yandexMapsBaseQuery = {
  lang: 'ru_RU' as const,
  load: 'package.full',
}

export const YANDEX_MAPS_QUERY = yandexMapsApiKey
  ? { ...yandexMapsBaseQuery, apikey: yandexMapsApiKey }
  : yandexMapsBaseQuery
