import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { formatArea, formatPriceRub } from '@/lib/format'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardFooter } from '@/components/ui/Card'
import type { Complex } from '../../../shared/types'
import { useUiStore } from '@/store/useUiStore'
import { trackEvent } from '@/lib/analytics'

export default function ComplexCard({ item }: { item: Complex }) {
  const openLeadModal = useUiStore((s) => s.openLeadModal)
  const img = item.images?.[0]

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md border-slate-200 bg-white flex flex-col">
      <Link to={`/complex/${item.id}`} onClick={() => trackEvent('open_card', { type: 'complex', id: item.id })} className="block relative aspect-[4/3] w-full bg-slate-100">
        {img ? <img src={img} alt={item.title} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" loading="lazy" /> : null}
        <div className="absolute top-3 left-3">
           <Badge variant="secondary" className="bg-white/90 text-slate-900 backdrop-blur-sm shadow-sm">ЖК</Badge>
        </div>
      </Link>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            to={`/complex/${item.id}`}
            onClick={() => trackEvent('open_card', { type: 'complex', id: item.id })}
            className="text-base font-semibold leading-snug text-slate-900 hover:underline hover:text-sky-600 transition-colors"
          >
            {item.title}
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          <span className="truncate">{item.district}{item.metro?.[0] ? ` • ${item.metro[0]}` : ''}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-slate-400">Цена от</div>
            <div className="font-medium text-slate-900 text-sm">{typeof item.price_from === 'number' ? formatPriceRub(item.price_from) : '—'}</div>
          </div>
          <div>
            <div className="text-slate-400">Площадь от</div>
            <div className="font-medium text-slate-900 text-sm">{typeof item.area_from === 'number' ? formatArea(item.area_from) : '—'}</div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 mt-auto flex items-center justify-between">
        <Link to={`/complex/${item.id}`} className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
          Смотреть
        </Link>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            trackEvent('click_view_details', { page: 'catalog', block: 'complex_card', id: item.id })
            openLeadModal('view_details', { page: 'catalog', block: 'complex_card', object_id: item.id, object_type: 'complex' })
          }}
        >
          Узнать детали
        </Button>
      </CardFooter>
    </Card>
  )
}
