import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { formatArea, formatPriceRub } from '@/lib/format'
import { selectCoverImage } from '@/lib/images'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardFooter } from '@/components/ui/Card'
import type { Complex } from '../../../shared/types'
import { useUiStore } from '@/store/useUiStore'
import { trackEvent } from '@/lib/analytics'

const UI = {
  complex: '\u0416\u041a',
  hidden: '\u0421\u043a\u0440\u044b\u0442\u043e (\u043d\u0435 \u0432 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0435)',
  priceFrom: '\u0426\u0435\u043d\u0430 \u043e\u0442',
  areaFrom: '\u041f\u043b\u043e\u0449\u0430\u0434\u044c \u043e\u0442',
  pricePerM2: '\u0426\u0435\u043d\u0430 \u0437\u0430 \u043c\u00b2',
  view: '\u0421\u043c\u043e\u0442\u0440\u0435\u0442\u044c',
  details: '\u0423\u0437\u043d\u0430\u0442\u044c \u0434\u0435\u0442\u0430\u043b\u0438',
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export default function ComplexCard({
  item,
  showStatusBadge = false,
}: {
  item: Complex
  showStatusBadge?: boolean
}) {
  const openLeadModal = useUiStore((s) => s.openLeadModal)
  const img = selectCoverImage(item.images)
  const priceFrom = toFiniteNumber(item.price_from)
  const areaFrom = toFiniteNumber(item.area_from)
  const pricePerM2 = typeof priceFrom === 'number' && typeof areaFrom === 'number' && areaFrom > 0 ? priceFrom / areaFrom : undefined

  return (
    <Card className="flex flex-col overflow-hidden border-slate-200 bg-white transition-shadow hover:shadow-md">
      <Link
        to={`/complex/${item.id}`}
        onClick={() => trackEvent('open_card', { type: 'complex', id: item.id })}
        className="relative block aspect-[4/3] w-full bg-slate-100"
      >
        {img ? <img src={img} alt={item.title} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" loading="lazy" /> : null}
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <Badge variant="secondary" className="bg-white/90 text-slate-900 shadow-sm backdrop-blur-sm">
            {UI.complex}
          </Badge>
          {showStatusBadge && item.status !== 'active' && (
            <Badge variant="warning" className="bg-amber-600/90 text-white shadow-sm backdrop-blur-sm">
              {UI.hidden}
            </Badge>
          )}
        </div>
      </Link>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            to={`/complex/${item.id}`}
            onClick={() => trackEvent('open_card', { type: 'complex', id: item.id })}
            className="text-base font-semibold leading-snug text-slate-900 transition-colors hover:text-primary hover:underline"
          >
            {item.title}
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          <span className="truncate">
            {item.district}
            {item.metro?.[0] ? ` \u2022 ${item.metro[0]}` : ''}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-slate-400">{UI.priceFrom}</div>
            <div className="text-sm font-medium text-slate-900">{typeof priceFrom === 'number' ? formatPriceRub(priceFrom) : '\u2014'}</div>
          </div>
          <div>
            <div className="text-slate-400">{UI.areaFrom}</div>
            <div className="text-sm font-medium text-slate-900">{typeof areaFrom === 'number' ? formatArea(areaFrom) : '\u2014'}</div>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-600">
          {UI.pricePerM2}:{' '}
          <span className="font-semibold text-slate-900">{typeof pricePerM2 === 'number' ? formatPriceRub(pricePerM2) : '\u2014'}</span>
        </div>
      </CardContent>
      <CardFooter className="mt-auto flex items-center justify-between p-4 pt-0">
        <Link to={`/complex/${item.id}`} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">
          {UI.view}
        </Link>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            trackEvent('click_view_details', { page: 'catalog', block: 'complex_card', id: item.id })
            openLeadModal('view_details', { page: 'catalog', block: 'complex_card', object_id: item.id, object_type: 'complex' })
          }}
        >
          {UI.details}
        </Button>
      </CardFooter>
    </Card>
  )
}
