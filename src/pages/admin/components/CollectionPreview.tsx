import { useState, useEffect, useMemo } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import { apiGet } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { Property, Complex } from '../../../../shared/types'

type Props = {
  open: boolean
  onClose: () => void
  collectionId: string
}

type PreviewData = {
  mode: 'manual' | 'auto'
  items: Array<{ type: 'property' | 'complex'; ref: Property | Complex }>
  stats: {
    total: number
    valid: number
    invalid: number
    invalidIds?: string[]
  }
}

export default function CollectionPreview({ open, onClose, collectionId }: Props) {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [data, setData] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    apiGet<PreviewData>(`/api/admin/collections/${collectionId}/preview`, headers)
      .then((res) => setData(res))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) {
      load()
    }
  }, [open, collectionId])

  return (
    <Modal open={open} onClose={onClose} title="Превью подборки" className="max-w-4xl">
      <div className="space-y-4">
        {loading ? (
          <div className="text-sm text-slate-500">Загрузка...</div>
        ) : error ? (
          <div className="text-sm text-rose-600">{error}</div>
        ) : data ? (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex-1 text-sm">
                <div className="font-medium text-slate-900">
                  Режим: <Badge variant={data.mode === 'manual' ? 'default' : 'accent'}>{data.mode === 'manual' ? 'Ручная' : 'Автоматическая'}</Badge>
                </div>
                <div className="mt-1 text-slate-600">
                  Всего объектов: <span className="font-semibold">{data.stats.total}</span>
                  {data.mode === 'manual' && data.stats.invalid > 0 && (
                    <span className="ml-2">
                      (валидных: <span className="font-semibold text-green-600">{data.stats.valid}</span>, невалидных:{' '}
                      <span className="font-semibold text-rose-600">{data.stats.invalid}</span>)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {data.items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">
                Нет объектов в подборке
              </div>
            ) : (
              <div className="max-h-[600px] overflow-y-auto p-1">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.items.map((item, idx) => {
                    const isInvalid = data.mode === 'manual' && data.stats.invalidIds?.includes(item.ref.id)

                    return (
                      <div key={idx} className={`relative ${isInvalid ? 'opacity-50 ring-2 ring-rose-500 rounded-xl' : ''}`}>
                        {item.type === 'property' ? <PropertyCard item={item.ref as Property} /> : <ComplexCard item={item.ref as Complex} />}
                        {isInvalid && (
                          <div className="absolute top-2 left-2 bg-rose-500 text-white text-xs px-2 py-1 rounded">Невалидный</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        ) : null}

        <div className="flex justify-end border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </Modal>
  )
}
