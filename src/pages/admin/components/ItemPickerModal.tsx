import { useState, useEffect, useMemo, useCallback } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import { apiGet } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { Property, Complex } from '../../../../shared/types'

type Props = {
  open: boolean
  onClose: () => void
  onAdd: (items: Array<{ type: 'property' | 'complex'; ref_id: string }>) => void
  existingIds?: string[]
}

export default function ItemPickerModal({ open, onClose, onAdd, existingIds = [] }: Props) {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [type, setType] = useState<'property' | 'complex'>('property')
  const [items, setItems] = useState<(Property | Complex)[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')

  const limit = 12

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ type, page: String(page), limit: String(limit) })
    if (searchQuery) params.set('q', searchQuery)

    apiGet<{ items: (Property | Complex)[]; total: number }>(`/api/admin/catalog/items?${params}`, headers)
      .then((res) => {
        setItems(res.items)
        setTotal(res.total)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false))
  }, [type, page, limit, searchQuery, headers])

  useEffect(() => {
    if (open) {
      load()
    }
  }, [open, load])

  useEffect(() => {
    setPage(1)
    setSelected(new Set())
  }, [type, searchQuery])

  const totalPages = Math.max(1, Math.ceil(total / limit))

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selected)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelected(newSelected)
  }

  const handleAdd = () => {
    const itemsToAdd = Array.from(selected).map((ref_id) => ({ type, ref_id }))
    onAdd(itemsToAdd)
    setSelected(new Set())
    onClose()
  }

  const handleClose = () => {
    setSelected(new Set())
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Добавить объекты" className="max-w-4xl">
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="flex gap-2">
            <Button size="sm" variant={type === 'property' ? 'default' : 'secondary'} onClick={() => setType('property')}>
              Лоты
            </Button>
            <Button size="sm" variant={type === 'complex' ? 'default' : 'secondary'} onClick={() => setType('complex')}>
              ЖК
            </Button>
          </div>
          <Input
            className="flex-1"
            placeholder="Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Загрузка...</div>
        ) : error ? (
          <div className="text-sm text-rose-600">{error}</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 max-h-[500px] overflow-y-auto p-1">
              {items.map((item) => {
                const isExisting = existingIds.includes(item.id)
                const isSelected = selected.has(item.id)

                return (
                  <div
                    key={item.id}
                    className={`relative ${isSelected ? 'ring-2 ring-blue-500 rounded-xl' : ''} ${isExisting ? 'opacity-50' : ''}`}
                  >
                    {type === 'property' ? <PropertyCard item={item as Property} /> : <ComplexCard item={item as Complex} />}

                    {isExisting ? (
                      <div className="absolute top-2 right-2 bg-slate-700 text-white text-xs px-2 py-1 rounded">
                        Уже добавлен
                      </div>
                    ) : (
                      <div className="absolute top-2 right-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item.id)}
                          className="h-5 w-5 cursor-pointer"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
              {items.length === 0 && <div className="col-span-full text-center text-slate-500">Нет объектов</div>}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-4">
              <div className="text-sm text-slate-600">
                Выбрано: <span className="font-semibold text-slate-900">{selected.size}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPage(Math.max(page - 1, 1))} disabled={page <= 1}>
                  Назад
                </Button>
                <span className="text-sm text-slate-600">
                  Страница {page} из {totalPages}
                </span>
                <Button size="sm" variant="secondary" onClick={() => setPage(Math.min(page + 1, totalPages))} disabled={page >= totalPages}>
                  Вперёд
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={handleClose}>
            Отмена
          </Button>
          <Button onClick={handleAdd} disabled={selected.size === 0}>
            Добавить выбранные ({selected.size})
          </Button>
        </div>
      </div>
    </Modal>
  )
}
