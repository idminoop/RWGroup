import { Car, Footprints, Navigation } from 'lucide-react'
import { Heading } from '@/components/ui/Typography'
import type { ComplexNearbyPlace } from '../../../shared/types'

type NearbyPlacesProps = {
  title?: string
  subtitle?: string
  items: ComplexNearbyPlace[]
  originLat?: number
  originLon?: number
  surfaceColor?: string
}

function formatMinutes(minutes: number): string {
  const value = Math.max(1, Math.round(minutes || 0))
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return `${value} минута`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${value} минуты`
  return `${value} минут`
}

function routeUrl(originLat: number | undefined, originLon: number | undefined, lat: number, lon: number): string {
  if (typeof originLat === 'number' && typeof originLon === 'number') {
    return `https://yandex.ru/maps/?rtext=${originLat},${originLon}~${lat},${lon}&rtt=auto`
  }
  return `https://yandex.ru/maps/?pt=${lon},${lat}&z=15`
}

export default function NearbyPlaces({
  title = 'Места поблизости',
  subtitle = 'Пешком и на машине от жилого комплекса',
  items,
  originLat,
  originLon,
  surfaceColor = '#071520',
}: NearbyPlacesProps) {
  const visibleItems = items.slice(0, 20)
  if (!visibleItems.length) return null

  return (
    <section className="rounded-3xl border border-white/10 p-4 md:p-6" style={{ backgroundColor: surfaceColor }}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading size="h3" className="text-white uppercase tracking-[0.08em]">
            {title}
          </Heading>
          <p className="mt-1 text-sm text-white/60">{subtitle}</p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/65">
          Показано: {visibleItems.length}
        </span>
      </div>

      <div className="-mx-1 overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3 px-1">
          {visibleItems.map((item) => (
            <article
              key={item.id}
              className="group relative h-[260px] w-[280px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#0a1a26] sm:w-[320px]"
            >
              {item.image_url ? (
                <img
                  src={item.image_url}
                  alt={item.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
              ) : (
                <div className="h-full w-full bg-white/5" />
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#041019]/95 via-[#041019]/40 to-transparent" />

              <div className="absolute inset-x-0 bottom-0 z-10 p-3 sm:p-4">
                <div className="line-clamp-2 text-base font-semibold text-white sm:text-lg">{item.name}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-medium text-white/90 sm:text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/35 px-2.5 py-1">
                    <Footprints className="h-3.5 w-3.5" />
                    {formatMinutes(item.walk_minutes)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/35 px-2.5 py-1">
                    <Car className="h-3.5 w-3.5" />
                    {formatMinutes(item.drive_minutes)}
                  </span>
                  <a
                    href={routeUrl(originLat, originLon, item.lat, item.lon)}
                    target="_blank"
                    rel="noreferrer"
                    className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/35 px-2.5 py-1 text-white/95 transition hover:bg-black/55"
                    aria-label={`Маршрут до ${item.name}`}
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    Маршрут
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
