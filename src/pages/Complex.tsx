import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import SiteLayout from '@/components/layout/SiteLayout'
import Button from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Heading, Text } from '@/components/ui/Typography'
import { Badge } from '@/components/ui/Badge'
import PropertyCard from '@/components/catalog/PropertyCard'
import Input from '@/components/ui/Input'
import { apiGet } from '@/lib/api'
import type { Complex, Property } from '../../shared/types'
import { useUiStore } from '@/store/useUiStore'

export default function ComplexPage() {
  const { id } = useParams()
  const openLeadModal = useUiStore((s) => s.openLeadModal)
  const [data, setData] = useState<{ complex: Complex; properties: Property[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!id) return
    apiGet<{ complex: Complex; properties: Property[] }>(`/api/complex/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
  }, [id])

  const list = useMemo(() => {
    const qlc = q.trim().toLowerCase()
    if (!qlc) return data?.properties || []
    return (data?.properties || []).filter((p) => p.title.toLowerCase().includes(qlc))
  }, [data, q])

  return (
    <SiteLayout>
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
        {!data ? (
          <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        ) : (
          <>
            <Card className="overflow-hidden border-slate-200 bg-white">
              {data.complex.images?.[0] ? (
                <img src={data.complex.images[0]} alt={data.complex.title} className="h-72 w-full object-cover" />
              ) : (
                <div className="h-72 w-full bg-slate-100" />
              )}
              <CardContent className="p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <Badge variant="secondary" className="mb-2">Жилой комплекс</Badge>
                    <Heading size="h2" className="mt-1">{data.complex.title}</Heading>
                    <Text className="mt-2 text-slate-600">
                      {data.complex.district}
                      {data.complex.metro?.[0] ? ` • ${data.complex.metro[0]}` : ''}
                    </Text>
                  </div>
                  <Button
                    onClick={() =>
                      openLeadModal('view_details', {
                        page: 'complex',
                        block: 'cta',
                        object_id: data.complex.id,
                        object_type: 'complex',
                      })
                    }
                  >
                    Узнать детали
                  </Button>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по лотам" />
                  <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    Лотов: {list.length}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="mt-8">
              <Heading size="h4" className="mb-3">Лоты в ЖК</Heading>
              {list.length ? (
                <div className="grid gap-4 md:grid-cols-3">
                  {list.map((p) => (
                    <PropertyCard key={p.id} item={p} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Лотов не найдено</div>
              )}
            </div>
          </>
        )}
      </div>
    </SiteLayout>
  )
}

