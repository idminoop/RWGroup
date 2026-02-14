import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import CatalogFilters, { type FiltersState } from '@/components/catalog/CatalogFilters'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import { apiDelete, apiGet, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { Complex, Property } from '../../../../shared/types'

type TabType = 'property' | 'complex'

export default function AdminCatalogPage() {
  const token = useUiStore((s) => s.adminToken)
  const navigate = useNavigate()
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [tab, setTab] = useState<TabType>('property')
  const [items, setItems] = useState<(Property | Complex)[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<FiltersState>({
    complexId: '',
    bedrooms: '',
    priceMin: '',
    priceMax: '',
    areaMin: '',
    areaMax: '',
    district: '',
    metro: '',
    q: '',
  })
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(12)
  const [total, setTotal] = useState(0)
  const [editingItem, setEditingItem] = useState<Property | Complex | null>(null)
  const [editForm, setEditForm] = useState<Record<string, unknown>>({})

  const query = useMemo(() => {
    const sp = new URLSearchParams({ type: tab, page: String(page), limit: String(limit) })
    Object.entries(filters).forEach(([key, value]) => {
      if (value) sp.set(key, value)
    })
    return sp.toString()
  }, [filters, page, limit, tab])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiGet<{ items: (Property | Complex)[]; total: number; page: number; limit: number }>(`/api/admin/catalog/items?${query}`, headers)
      .then((res) => {
        setItems(res.items)
        setTotal(res.total)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false))
  }, [headers, query])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [tab, filters, limit])

  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить объект? Действие необратимо.')) return
    try {
      await apiDelete(`/api/admin/catalog/items/${tab}/${id}`, headers)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка при удалении')
    }
  }

  const handleEdit = (item: Property | Complex) => {
    setEditingItem(item)
    setEditForm({ ...item })
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return
    const fd = new FormData()
    fd.append('file', e.target.files[0])
    try {
      const resp = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { 'x-admin-token': token || '' },
        body: fd,
      })
      const json = await resp.json()
      if (!json.success) throw new Error(json.error || 'Upload error')
      setEditForm((prev) => ({ ...prev, images: [...((prev.images as string[]) || []), json.data.url] }))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload error')
    }
  }

  const removeImage = (index: number) => {
    const next = [...((editForm.images as string[]) || [])]
    next.splice(index, 1)
    setEditForm((prev) => ({ ...prev, images: next }))
  }

  const handleSave = async () => {
    if (!editingItem) return
    try {
      await apiPut(`/api/admin/catalog/items/${tab}/${editingItem.id}`, editForm, headers)
      setEditingItem(null)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка при сохранении')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Каталог</div>
          <div className="mt-1 text-sm text-slate-600">Управление лотами и ЖК.</div>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'property' ? 'default' : 'secondary'} onClick={() => setTab('property')}>
            Лоты
          </Button>
          <Button variant={tab === 'complex' ? 'default' : 'secondary'} onClick={() => setTab('complex')}>
            ЖК
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <CatalogFilters tab={tab === 'complex' ? 'newbuild' : 'secondary'} value={filters} onChange={setFilters} />
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Загрузка...</div>
      ) : error ? (
        <div className="text-sm text-rose-600">{error}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            <div>
              Всего: <span className="font-semibold text-slate-900">{total}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>На странице</span>
              <Select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
                {[12, 24, 36, 48, 72].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <div key={item.id} className="group relative">
                {tab === 'property' ? <PropertyCard item={item as Property} showStatusBadge /> : <ComplexCard item={item as Complex} showStatusBadge />}

                <div className="absolute right-2 top-2 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <a
                    href={tab === 'property' ? `/property/${item.id}` : `/complex/${item.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center justify-center rounded-md bg-white px-3 text-xs font-medium text-slate-700 shadow hover:bg-slate-50"
                  >
                    На сайт
                  </a>
                  {tab === 'complex' && (
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/admin/complex-settings?complexId=${item.id}`)}>
                      Настройка ЖК
                    </Button>
                  )}
                  <Button size="sm" onClick={() => handleEdit(item)}>
                    Ред.
                  </Button>
                  <Button size="sm" variant="secondary" className="bg-rose-50 text-rose-600 hover:bg-rose-100" onClick={() => handleDelete(item.id)}>
                    Уд.
                  </Button>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                Ничего не найдено
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            <div>Страница {page} из {totalPages}</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Назад
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Вперед
              </Button>
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <Modal
          open={Boolean(editingItem)}
          onClose={() => setEditingItem(null)}
          title={`${tab === 'property' ? 'Лот' : 'ЖК'}: ${String(editForm.title || '')}`}
          className="max-w-4xl"
        >
          <div className="max-h-[75vh] space-y-4 overflow-y-auto p-1">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Название</label>
                <Input value={String(editForm.title || '')} onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Статус</label>
                <Select value={String(editForm.status || 'active')} onChange={(e) => setEditForm((prev) => ({ ...prev, status: e.target.value }))}>
                  <option value="active">Активен</option>
                  <option value="hidden">Скрыт</option>
                  <option value="archived">Архив</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Район</label>
                <Input value={String(editForm.district || '')} onChange={(e) => setEditForm((prev) => ({ ...prev, district: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Метро (через запятую)</label>
                <Input
                  value={Array.isArray(editForm.metro) ? (editForm.metro as string[]).join(', ') : ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, metro: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }))}
                />
              </div>
            </div>

            {tab === 'property' ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Цена</label>
                  <Input
                    type="number"
                    value={String(editForm.price || '')}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, price: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Площадь</label>
                  <Input
                    type="number"
                    value={String(editForm.area_total || '')}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, area_total: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Спален</label>
                  <Input
                    type="number"
                    value={String(editForm.bedrooms || '')}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, bedrooms: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Цена от</label>
                  <Input
                    type="number"
                    value={String(editForm.price_from || '')}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, price_from: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Площадь от</label>
                  <Input
                    type="number"
                    value={String(editForm.area_from || '')}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, area_from: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Класс</label>
                  <Input value={String(editForm.class || '')} onChange={(e) => setEditForm((prev) => ({ ...prev, class: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Застройщик</label>
                  <Input value={String(editForm.developer || '')} onChange={(e) => setEditForm((prev) => ({ ...prev, developer: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Срок сдачи</label>
                  <Input value={String(editForm.handover_date || '')} onChange={(e) => setEditForm((prev) => ({ ...prev, handover_date: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Отделка</label>
                  <Input value={String(editForm.finish_type || '')} onChange={(e) => setEditForm((prev) => ({ ...prev, finish_type: e.target.value }))} />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Описание</label>
              <textarea
                className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                value={String(editForm.description || '')}
                onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-slate-700">Фото</label>
                <label className="cursor-pointer text-xs font-medium text-sky-700 hover:text-sky-900">
                  + Добавить
                  <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {((editForm.images as string[]) || []).map((img, idx) => (
                  <div key={`${img}-${idx}`} className="group relative aspect-square overflow-hidden rounded-md border border-slate-200">
                    <img src={img} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {tab === 'complex' && editingItem && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Дизайн страницы Этого ЖК настраивается в разделе «Настройка ЖК».
                <div className="mt-2">
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/admin/complex-settings?complexId=${editingItem.id}`)}>
                    Перейти к конструктору
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="secondary" onClick={() => setEditingItem(null)}>Отмена</Button>
              <Button onClick={handleSave}>Сохранить</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

