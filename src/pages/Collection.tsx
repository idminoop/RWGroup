import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SiteLayout from '@/components/layout/SiteLayout'
import { Card, CardContent } from '@/components/ui/Card'
import { Heading, Text } from '@/components/ui/Typography'
import { Badge } from '@/components/ui/Badge'
import JsonLd from '@/components/seo/JsonLd'
import { setPageMeta } from '@/lib/meta'
import { apiGet } from '@/lib/api'
import type { Collection as CollectionType, Complex, Property } from '../../shared/types'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'

type Item = { type: 'property'; ref: Property } | { type: 'complex'; ref: Complex }

export default function CollectionPage() {
  const { id } = useParams()
  const [data, setData] = useState<{ collection: CollectionType; items: Item[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    apiGet<{ collection: CollectionType; items: Item[] }>(`/api/collection/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
  }, [id])

  useEffect(() => {
    if (!data) return
    setPageMeta({
      title: `${data.collection.title} — подборка недвижимости`,
      description: data.collection.description?.slice(0, 160) || `Подборка: ${data.collection.title}`,
      ogImage: data.collection.cover_image || undefined,
    })
  }, [data])

  const collectionLd = data ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: data.collection.title,
    description: data.collection.description || '',
    numberOfItems: data.items.length,
    itemListElement: data.items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.ref.title,
      url: typeof window !== 'undefined'
        ? `${window.location.origin}/${it.type === 'property' ? 'property' : 'complex'}/${it.ref.slug || it.ref.id}`
        : '',
    })),
  } : null

  return (
    <SiteLayout>
      {collectionLd && <JsonLd data={collectionLd} />}
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:py-10">
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
        {!data ? (
          <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        ) : (
          <>
            <Card className="overflow-hidden border-slate-200 bg-white">
              {data.collection.cover_image ? (
                <img src={data.collection.cover_image} alt={data.collection.title} className="h-56 w-full object-cover sm:h-64 md:h-72" />
              ) : (
                <div className="h-56 w-full bg-slate-100 sm:h-64 md:h-72" />
              )}
              <CardContent className="p-4 sm:p-6">
                <Badge variant="secondary" className="mb-2">Подборка</Badge>
                <Heading size="h2" className="mt-1">{data.collection.title}</Heading>
                {data.collection.description ? <Text className="mt-2 text-slate-600">{data.collection.description}</Text> : null}
                <div className="mt-4 text-sm">
                  <Link className="text-sky-600 hover:underline" to="/catalog">
                    Перейти в каталог
                  </Link>
                </div>
              </CardContent>
            </Card>

            <div className="mt-8">
              <Heading size="h4" className="mb-3">Состав подборки</Heading>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                {data.items.map((it) =>
                  it.type === 'property' ? <PropertyCard key={it.ref.id} item={it.ref} /> : <ComplexCard key={it.ref.id} item={it.ref} />,
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </SiteLayout>
  )
}
