import { useState, useEffect, useMemo } from 'react'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import ItemPickerModal from './ItemPickerModal'
import { apiGet, apiPost } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { Property, Complex } from '../../../../shared/types'

type Props = {
  value: Array<{ type: 'property' | 'complex'; ref_id: string }>
  onChange: (items: Array<{ type: 'property' | 'complex'; ref_id: string }>) => void
  collectionId?: string
}

export default function ManualItemsEditor({ value, onChange, collectionId }: Props) {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [itemsData, setItemsData] = useState<Map<string, Property | Complex>>(new Map())
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Fetch actual item data for display
    if (value.length === 0) return

    setLoading(true)
    const promises = value.map(async ({ type, ref_id }) => {
      try {
        const res = await apiGet<{ items: (Property | Complex)[] }>(
          `/api/admin/catalog/items?type=${type}&q=${ref_id}`,
          headers
        )
        const item = res.items.find((i) => i.id === ref_id)
        return item ? { ref_id, item } : null
      } catch {
        return null
      }
    })

    Promise.all(promises).then((results) => {
      const dataMap = new Map<string, Property | Complex>()
      const invalid = new Set<string>()

      results.forEach((result, idx) => {
        const ref_id = value[idx].ref_id
        if (result && result.item) {
          dataMap.set(ref_id, result.item)
        } else {
          invalid.add(ref_id)
        }
      })

      setItemsData(dataMap)
      setInvalidIds(invalid)
      setLoading(false)
    })
  }, [value, headers])

  const handleAdd = (newItems: Array<{ type: 'property' | 'complex'; ref_id: string }>) => {
    onChange([...value, ...newItems])
  }

  const handleRemove = (ref_id: string) => {
    onChange(value.filter((item) => item.ref_id !== ref_id))
  }

  const handleCleanInvalid = async () => {
    if (!collectionId) {
      // Just filter out invalid from local state
      onChange(value.filter((item) => !invalidIds.has(item.ref_id)))
      return
    }

    try {
      await apiPost(`/api/admin/collections/${collectionId}/validate-items`, { cleanInvalid: true }, headers)
      // Refetch will happen via parent component
      onChange(value.filter((item) => !invalidIds.has(item.ref_id)))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          Объектов в подборке: <span className="font-semibold text-slate-900">{value.length}</span>
          {invalidIds.size > 0 && (
            <Badge variant="warning" className="ml-2">
              {invalidIds.size} невалидных
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          {invalidIds.size > 0 && (
            <Button size="sm" variant="secondary" onClick={handleCleanInvalid}>
              Очистить невалидные
            </Button>
          )}
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            Добавить объекты
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Загрузка...</div>
      ) : value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-600">Нет объектов в подборке</p>
          <Button size="sm" className="mt-3" onClick={() => setPickerOpen(true)}>
            Добавить первый объект
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {value.map((item) => {
            const data = itemsData.get(item.ref_id)
            const isInvalid = invalidIds.has(item.ref_id)

            return (
              <div key={item.ref_id} className={`relative ${isInvalid ? 'opacity-50 ring-2 ring-rose-500 rounded-xl' : ''}`}>
                {data ? (
                  item.type === 'property' ? (
                    <PropertyCard item={data as Property} />
                  ) : (
                    <ComplexCard item={data as Complex} />
                  )
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">ID: {item.ref_id}</div>
                    {isInvalid && <div className="text-xs text-rose-600 mt-1">Объект не найден</div>}
                  </div>
                )}

                <button
                  onClick={() => handleRemove(item.ref_id)}
                  className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 transition-colors shadow-lg"
                  title="Удалить"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                {isInvalid && (
                  <div className="absolute top-2 left-2 bg-rose-500 text-white text-xs px-2 py-1 rounded">
                    Невалидный
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ItemPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={handleAdd}
        existingIds={value.map((i) => i.ref_id)}
      />
    </div>
  )
}
