import { Link } from 'react-router-dom'
import { BedDouble, MapPin, Ruler, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatArea, formatPriceRub } from '@/lib/format'
import { selectCoverImage } from '@/lib/images'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardFooter } from '@/components/ui/Card'
import type { Property } from '../../../shared/types'
import { useUiStore } from '@/store/useUiStore'
import { trackEvent } from '@/lib/analytics'

const UI = {
  rent: '\u0410\u0440\u0435\u043d\u0434\u0430',
  sale: '\u041f\u0440\u043e\u0434\u0430\u0436\u0430',
  month: ' / \u043c\u0435\u0441',
  hidden: '\u0421\u043a\u0440\u044b\u0442\u043e (\u043d\u0435 \u0432 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0435)',
  euro: '\u0415\u0432\u0440\u043e',
  details: '\u041f\u043e\u0434\u0440\u043e\u0431\u043d\u0435\u0435',
  signup: '\u0417\u0430\u043f\u0438\u0441\u0430\u0442\u044c\u0441\u044f',
  perM2: '\u0417\u0430 \u043c\u00b2',
  studio: '\u0421\u0442\u0443\u0434\u0438\u044f',
  bedroomOne: '\u0441\u043f\u0430\u043b\u044c\u043d\u044f',
  bedroomFew: '\u0441\u043f\u0430\u043b\u044c\u043d\u0438',
  bedroomMany: '\u0441\u043f\u0430\u043b\u0435\u043d',
}

function formatBedrooms(value: number): string {
  if (value <= 0) return UI.studio
  if (value === 1) return `1 ${UI.bedroomOne}`
  if (value >= 2 && value <= 4) return `${value} ${UI.bedroomFew}`
  return `${value} ${UI.bedroomMany}`
}

export default function PropertyCard({
  item,
  variant = 'grid',
  showStatusBadge = false,
}: {
  item: Property
  variant?: 'grid' | 'list'
  showStatusBadge?: boolean
}) {
  const openLeadModal = useUiStore((s) => s.openLeadModal)
  const img = selectCoverImage(item.images)
  const dealTypeLabel = item.deal_type === 'rent' ? UI.rent : UI.sale
  const priceSuffix = item.price_period ? UI.month : ''
  const hasDiscount = item.old_price && item.old_price > item.price
  const discount = hasDiscount ? Math.round((1 - item.price / item.old_price!) * 100) : 0
  const hasArea = typeof item.area_total === 'number' && Number.isFinite(item.area_total) && item.area_total > 0
  const pricePerM2 = hasArea ? item.price / item.area_total : undefined

  return (
    <Card
      className={cn(
        'overflow-hidden border-slate-200 bg-white transition-shadow hover:shadow-md',
        variant === 'list' && 'flex',
      )}
    >
      <Link
        to={`/property/${item.id}`}
        className={cn('relative block bg-slate-100', variant === 'list' ? 'h-full w-44 shrink-0' : 'aspect-[4/3] w-full')}
      >
        {img ? (
          <img src={img} alt={item.title} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" loading="lazy" />
        ) : null}
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <Badge variant="secondary" className="bg-white/90 text-slate-900 shadow-sm backdrop-blur-sm">
            {dealTypeLabel}
          </Badge>
          {showStatusBadge && item.status !== 'active' && (
            <Badge variant="warning" className="bg-amber-600/90 text-white shadow-sm backdrop-blur-sm">
              {UI.hidden}
            </Badge>
          )}
          {hasDiscount && (
            <Badge variant="default" className="bg-green-600/90 text-white shadow-sm backdrop-blur-sm">
              -{discount}%
            </Badge>
          )}
          {item.is_euroflat && (
            <Badge variant="accent" className="bg-blue-600/90 text-white shadow-sm backdrop-blur-sm">
              {UI.euro}
            </Badge>
          )}
        </div>
      </Link>
      <div className={cn('flex flex-col', variant === 'list' && 'flex-1')}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <Link
              to={`/property/${item.id}`}
              onClick={() => trackEvent('open_card', { type: 'property', id: item.id })}
              className="text-base font-semibold leading-snug text-slate-900 transition-colors hover:text-sky-600 hover:underline"
            >
              {item.title}
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-700">
            <div className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              <span className="truncate">{item.district}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <BedDouble className="h-3.5 w-3.5 text-slate-400" />
              <span>{formatBedrooms(item.bedrooms)}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Ruler className="h-3.5 w-3.5 text-slate-400" />
              <span>{formatArea(item.area_total)}</span>
            </div>
            <div className="inline-flex flex-col gap-0.5">
              <div className="inline-flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-medium text-slate-900">
                  {formatPriceRub(item.price)}
                  {priceSuffix}
                </span>
              </div>
              {hasDiscount && <span className="ml-5 text-[10px] text-slate-400 line-through">{formatPriceRub(item.old_price!)}</span>}
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            {UI.perM2}:{' '}
            <span className="font-semibold text-slate-900">{typeof pricePerM2 === 'number' ? formatPriceRub(pricePerM2) : '\u2014'}</span>
          </div>
        </CardContent>
        <CardFooter className="mt-auto flex items-center justify-between p-4 pt-0">
          <Link to={`/property/${item.id}`} className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
            {UI.details}
          </Link>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              trackEvent('click_view_details', { page: 'catalog', block: 'property_card', id: item.id })
              openLeadModal('view_details', { page: 'catalog', block: 'property_card', object_id: item.id, object_type: 'property' })
            }}
          >
            {UI.signup}
          </Button>
        </CardFooter>
      </div>
    </Card>
  )
}
