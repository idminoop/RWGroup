import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SiteLayout from '@/components/layout/SiteLayout'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { Heading, Text } from '@/components/ui/Typography'
import { apiGet } from '@/lib/api'
import { formatArea, formatPriceRub } from '@/lib/format'
import { useUiStore } from '@/store/useUiStore'
import type { Complex, Property } from '../../shared/types'

export default function PropertyPage() {
  const { id } = useParams()
  const openLeadModal = useUiStore((s) => s.openLeadModal)
  const [data, setData] = useState<{ property: Property; complex?: Complex } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    apiGet<{ property: Property; complex?: Complex }>(`/api/property/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
  }, [id])

  return (
    <SiteLayout>
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
        {!data ? (
          <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden border-slate-200 bg-white">
              {data.property.images?.[0] ? (
                <img src={data.property.images[0]} alt={data.property.title} className="h-80 w-full object-cover" />
              ) : (
                <div className="h-80 w-full bg-slate-100" />
              )}
              {data.property.images?.length > 1 ? (
                <div className="grid grid-cols-4 gap-2 p-3">
                  {data.property.images.slice(0, 4).map((src) => (
                    <img key={src} src={src} alt="" className="h-16 w-full rounded-md object-cover" />
                  ))}
                </div>
              ) : null}
            </Card>

            <Card className="border-slate-200 bg-white p-6">
              <Badge variant="secondary" className="mb-2">{data.property.deal_type === 'rent' ? 'Аренда' : 'Продажа'}</Badge>
              <Heading size="h2" className="mt-1">{data.property.title}</Heading>
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
                  <Text size="lg" weight="semibold">
                    {formatPriceRub(data.property.price)}{data.property.price_period ? ' / мес' : ''}
                  </Text>
                </div>
                <div>
                  <Text size="xs" muted>Площадь</Text>
                  <Text size="lg" weight="semibold">{formatArea(data.property.area_total)}</Text>
                </div>
                <div>
                  <Text size="xs" muted>Спальни</Text>
                  <Text size="lg" weight="semibold">{data.property.bedrooms}</Text>
                </div>
                <div>
                  <Text size="xs" muted>Статус</Text>
                  <Badge variant="outline" className="mt-1">{data.property.status === 'active' ? 'Актуально' : data.property.status}</Badge>
                </div>
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
        )}
      </div>
    </SiteLayout>
  )
}

