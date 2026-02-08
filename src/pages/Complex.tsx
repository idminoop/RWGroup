import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import SiteLayout from '@/components/layout/SiteLayout'
import Button from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Heading, Text } from '@/components/ui/Typography'
import { Badge } from '@/components/ui/Badge'
import PropertyCard from '@/components/catalog/PropertyCard'
import Input from '@/components/ui/Input'
import ImageGallery from '@/components/ui/ImageGallery'
import { apiGet } from '@/lib/api'
import { selectCoverImage, getPresentableImages } from '@/lib/images'
import type { Complex, Property } from '../../shared/types'
import { useUiStore } from '@/store/useUiStore'

export default function ComplexPage() {
  const { id } = useParams()
  const openLeadModal = useUiStore((s) => s.openLeadModal)
  const [data, setData] = useState<{ complex: Complex; properties: Property[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryIndex, setGalleryIndex] = useState(0)

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

  const presentableImages = data ? getPresentableImages(data.complex.images) : []
  const coverImage = data ? selectCoverImage(data.complex.images) : undefined

  const openGallery = (index = 0) => {
    setGalleryIndex(index)
    setGalleryOpen(true)
  }

  return (
    <SiteLayout>
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
        {!data ? (
          <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        ) : (
          <>
            <Card className="overflow-hidden border-slate-200 bg-white">
              <button
                onClick={() => openGallery(0)}
                className="relative h-72 w-full cursor-pointer transition-opacity hover:opacity-90"
              >
                {coverImage ? (
                  <img src={coverImage} alt={data.complex.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-slate-100" />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/10">
                  <div className="rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-slate-900 shadow-lg opacity-0 transition-opacity hover:opacity-100">
                    Посмотреть все фото
                  </div>
                </div>
              </button>
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

            {/* Image Gallery Modal */}
            <ImageGallery
              images={presentableImages}
              initialIndex={galleryIndex}
              open={galleryOpen}
              onClose={() => setGalleryOpen(false)}
              title={data.complex.title}
            />
          </>
        )}
      </div>
    </SiteLayout>
  )
}

