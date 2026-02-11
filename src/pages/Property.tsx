import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SiteLayout from '@/components/layout/SiteLayout'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { Heading, Text } from '@/components/ui/Typography'
import ImageGallery from '@/components/ui/ImageGallery'
import ComplexMap from '@/components/complex/ComplexMap'
import { apiGet } from '@/lib/api'
import { formatArea, formatPriceRub } from '@/lib/format'
import { selectCoverImage, getPresentableImages, getLayoutImages } from '@/lib/images'
import { useUiStore } from '@/store/useUiStore'
import type { Complex, Property } from '../../shared/types'

export default function PropertyPage() {
  const { id } = useParams()
  const openLeadModal = useUiStore((s) => s.openLeadModal)
  const [data, setData] = useState<{ property: Property; complex?: Complex } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [galleryType, setGalleryType] = useState<'presentable' | 'layouts'>('presentable')

  useEffect(() => {
    if (!id) return
    apiGet<{ property: Property; complex?: Complex }>(`/api/property/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
  }, [id])

  const openGallery = (type: 'presentable' | 'layouts', index = 0) => {
    setGalleryType(type)
    setGalleryIndex(index)
    setGalleryOpen(true)
  }

  const presentableImages = data ? getPresentableImages(data.property.images) : []
  const layoutImages = data ? getLayoutImages(data.property.images) : []
  const coverImage = data ? selectCoverImage(data.property.images) : undefined

  return (
    <SiteLayout>
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
        {!data ? (
          <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="overflow-hidden border-slate-200 bg-white">
                <button
                  onClick={() => openGallery('presentable', 0)}
                  className="relative h-80 w-full cursor-pointer transition-opacity hover:opacity-90"
                >
                  {coverImage ? (
                    <img src={coverImage} alt={data.property.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-slate-100" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/10">
                    <div className="rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-900 shadow-lg opacity-0 transition-opacity hover:opacity-100">
                      Посмотреть все фото
                    </div>
                  </div>
                </button>
                {presentableImages.length > 1 && (
                  <div className="grid grid-cols-4 gap-2 p-3">
                    {presentableImages.slice(0, 4).map((src, idx) => (
                      <button
                        key={src}
                        onClick={() => openGallery('presentable', idx)}
                        className="h-16 w-full overflow-hidden rounded-md transition-opacity hover:opacity-75"
                      >
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </Card>

            <Card className="border-slate-200 bg-white p-6">
              <div className="flex items-start gap-2">
                <Badge variant="secondary">{data.property.deal_type === 'rent' ? 'Аренда' : 'Продажа'}</Badge>
                {data.property.is_euroflat && <Badge variant="accent">Европланировка</Badge>}
                {data.property.renovation && <Badge variant="outline">{data.property.renovation}</Badge>}
              </div>
              <Heading size="h2" className="mt-3">{data.property.title}</Heading>
              <Text className="mt-2 text-slate-600">
                {data.property.district}
                {data.property.metro?.[0] ? ` • ${data.property.metro[0]}` : ''}
              </Text>
              {data.complex ? (
                <div className="mt-2 text-sm">
                  ЖК:{' '}
                  <Link className="text-sky-600 hover:underline" to={`/complex/${data.complex.id}`}>
                    {data.complex.title}
                  </Link>
                </div>
              ) : null}

              <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Text size="xs" muted>Цена</Text>
                  <div className="flex items-baseline gap-2">
                    <Text size="lg" weight="semibold">
                      {formatPriceRub(data.property.price)}{data.property.price_period ? ' / мес' : ''}
                    </Text>
                    {data.property.old_price && data.property.old_price > data.property.price && (
                      <span className="text-xs text-slate-400 line-through">{formatPriceRub(data.property.old_price)}</span>
                    )}
                  </div>
                  {data.property.old_price && data.property.old_price > data.property.price && (
                    <div className="mt-1 text-xs text-green-600 font-medium">
                      Скидка {Math.round((1 - data.property.price / data.property.old_price) * 100)}%
                    </div>
                  )}
                </div>
                <div>
                  <Text size="xs" muted>Площадь общая</Text>
                  <Text size="lg" weight="semibold">{formatArea(data.property.area_total)}</Text>
                </div>
                {data.property.area_living && (
                  <div>
                    <Text size="xs" muted>Жилая площадь</Text>
                    <Text size="lg" weight="semibold">{formatArea(data.property.area_living)}</Text>
                  </div>
                )}
                {data.property.area_kitchen && (
                  <div>
                    <Text size="xs" muted>Площадь кухни</Text>
                    <Text size="lg" weight="semibold">{formatArea(data.property.area_kitchen)}</Text>
                  </div>
                )}
                <div>
                  <Text size="xs" muted>Спальни</Text>
                  <Text size="lg" weight="semibold">{data.property.bedrooms}</Text>
                </div>
                {data.property.floor && data.property.floors_total && (
                  <div>
                    <Text size="xs" muted>Этаж</Text>
                    <Text size="lg" weight="semibold">{data.property.floor} из {data.property.floors_total}</Text>
                  </div>
                )}
                {data.property.lot_number && (
                  <div>
                    <Text size="xs" muted>Номер квартиры</Text>
                    <Text size="lg" weight="semibold">{data.property.lot_number}</Text>
                  </div>
                )}
                {(data.property.ready_quarter || data.property.built_year) && (
                  <div>
                    <Text size="xs" muted>Срок сдачи</Text>
                    <Text size="lg" weight="semibold">
                      {data.property.ready_quarter && `${data.property.ready_quarter} кв. `}
                      {data.property.built_year}
                    </Text>
                  </div>
                )}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  onClick={() =>
                    openLeadModal('view_details', {
                      page: 'property',
                      block: 'cta',
                      object_id: data.property.id,
                      object_type: 'property',
                    })
                  }
                >
                  Записаться / Узнать детали
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    openLeadModal('consultation', {
                      page: 'property',
                      block: 'secondary',
                      object_id: data.property.id,
                      object_type: 'property',
                    })
                  }
                >
                  Консультация
                </Button>
              </div>
            </Card>
          </div>

          {/* Description Section */}
          {data.property.description && (
            <Card className="mt-6 border-slate-200 bg-white p-6">
              <Heading size="h3" className="mb-3">Описание</Heading>
              <Text className="whitespace-pre-line text-slate-700 leading-relaxed">
                {data.property.description}
              </Text>
            </Card>
          )}

          {/* Additional Info Section */}
          {(data.property.building_section || data.property.building_state || data.complex?.developer) && (
            <Card className="mt-6 border-slate-200 bg-white p-6">
              <Heading size="h3" className="mb-4">Дополнительная информация</Heading>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                {data.complex?.developer && (
                  <div className="flex items-start gap-2">
                    <span className="text-slate-500">Застройщик:</span>
                    <span className="font-medium text-slate-900">{data.complex.developer}</span>
                  </div>
                )}
                {data.property.building_section && (
                  <div className="flex items-start gap-2">
                    <span className="text-slate-500">Секция:</span>
                    <span className="font-medium text-slate-900">{data.property.building_section}</span>
                  </div>
                )}
                {data.property.building_state && (
                  <div className="flex items-start gap-2">
                    <span className="text-slate-500">Состояние:</span>
                    <span className="font-medium text-slate-900">
                      {data.property.building_state === 'unfinished' ? 'В процессе строительства' :
                       data.property.building_state === 'built' ? 'Построено' : data.property.building_state}
                    </span>
                  </div>
                )}
                {data.complex?.handover_date && (
                  <div className="flex items-start gap-2">
                    <span className="text-slate-500">Срок сдачи ЖК:</span>
                    <span className="font-medium text-slate-900">{data.complex.handover_date}</span>
                  </div>
                )}
                {data.complex?.class && (
                  <div className="flex items-start gap-2">
                    <span className="text-slate-500">Класс жилья:</span>
                    <span className="font-medium text-slate-900">{data.complex.class}</span>
                  </div>
                )}
                {data.complex?.finish_type && (
                  <div className="flex items-start gap-2">
                    <span className="text-slate-500">Тип отделки ЖК:</span>
                    <span className="font-medium text-slate-900">{data.complex.finish_type}</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Map Section */}
          {data.complex?.geo_lat && data.complex?.geo_lon && (
            <div className="mt-8">
              <ComplexMap
                title={data.property.title}
                district={data.property.district}
                metro={data.property.metro}
                geo_lat={data.complex.geo_lat}
                geo_lon={data.complex.geo_lon}
              />
            </div>
          )}

          {/* Floor Plans Section */}
          {layoutImages.length > 0 && (
            <div className="mt-8">
              <Heading size="h3" className="mb-4">Планировки</Heading>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {layoutImages.map((src, idx) => (
                  <button
                    key={src}
                    onClick={() => openGallery('layouts', idx)}
                    className="overflow-hidden rounded-lg border border-slate-200 transition-shadow hover:shadow-md"
                  >
                    <img src={src} alt={`План ${idx + 1}`} className="aspect-square w-full object-contain bg-white p-2" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Image Gallery Modal */}
          <ImageGallery
            images={galleryType === 'presentable' ? presentableImages : layoutImages}
            initialIndex={galleryIndex}
            open={galleryOpen}
            onClose={() => setGalleryOpen(false)}
            title={data.property.title}
          />
        </>
        )}
      </div>
    </SiteLayout>
  )
}

