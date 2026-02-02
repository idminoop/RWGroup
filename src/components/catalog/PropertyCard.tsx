import { Link } from 'react-router-dom'
import { BedDouble, MapPin, Ruler, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatArea, formatPriceRub } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardFooter } from '@/components/ui/Card'
import { Text } from '@/components/ui/Typography'
import type { Property } from '../../../shared/types'
import { useUiStore } from '@/store/useUiStore'
import { trackEvent } from '@/lib/analytics'

export default function PropertyCard({ item, variant = 'grid' }: { item: Property; variant?: 'grid' | 'list' }) {
  const openLeadModal = useUiStore((s) => s.openLeadModal)
  const img = item.images?.[0]

  return (
    <Card
      className={cn(
        'overflow-hidden transition-shadow hover:shadow-md border-slate-200 bg-white',
        variant === 'list' && 'flex',
      )}
    >
      <Link to={`/property/${item.id}`} className={cn('block relative bg-slate-100', variant === 'list' ? 'h-full w-44 shrink-0' : 'aspect-[4/3] w-full')}>
        {img ? (
          <img src={img} alt={item.title} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" loading="lazy" />
        ) : null}
        <div className="absolute top-3 left-3">
           <Badge variant="secondary" className="bg-white/90 text-slate-900 backdrop-blur-sm shadow-sm">
             {item.deal_type === 'rent' ? 'Аренда' : 'Продажа'}
           </Badge>
        </div>
      </Link>
      <div className={cn('flex flex-col', variant === 'list' && 'flex-1')}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <Link
              to={`/property/${item.id}`}
              onClick={() => trackEvent('open_card', { type: 'property', id: item.id })}
              className="text-base font-semibold leading-snug text-slate-900 hover:underline hover:text-sky-600 transition-colors"
            >
              {item.title}
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-y-2 gap-x-4 text-xs text-slate-700">
            <div className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              <span className="truncate">{item.district}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <BedDouble className="h-3.5 w-3.5 text-slate-400" />
              <span>{item.bedrooms} спальни</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Ruler className="h-3.5 w-3.5 text-slate-400" />
              <span>{formatArea(item.area_total)}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-medium text-slate-900">{formatPriceRub(item.price)}{item.price_period ? ' / мес' : ''}</span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="p-4 pt-0 mt-auto flex items-center justify-between">
          <Link to={`/property/${item.id}`} className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
            Подробнее
          </Link>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              trackEvent('click_view_details', { page: 'catalog', block: 'property_card', id: item.id })
              openLeadModal('view_details', { page: 'catalog', block: 'property_card', object_id: item.id, object_type: 'property' })
            }}
          >
            Записаться
          </Button>
        </CardFooter>
      </div>
    </Card>
  )
}
