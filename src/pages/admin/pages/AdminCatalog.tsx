import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import { apiGet, apiDelete, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import type { Complex, Property } from '../../../../shared/types'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import CatalogFilters, { type FiltersState } from '@/components/catalog/CatalogFilters'

export default function AdminCatalogPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const [tab, setTab] = useState<'property' | 'complex'>('property')
  const [items, setItems] = useState<(Property | Complex)[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<FiltersState>({
    bedrooms: '',
    priceMin: '',
    priceMax: '',
    areaMin: '',
    areaMax: '',
    q: '',
  })
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(12)
  const [total, setTotal] = useState(0)
  
  // Editing state
  const [editingItem, setEditingItem] = useState<Property | Complex | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  const query = useMemo(() => {
    const sp = new URLSearchParams({ type: tab, page: String(page), limit: String(limit) })
    Object.entries(filters).forEach(([k, v]) => {
      if (v) sp.set(k, v)
    })
    return sp.toString()
  }, [tab, page, limit, filters])

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
    if (!confirm('Вы уверены? Это действие нельзя отменить.')) return
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
    if (!e.target.files || !e.target.files[0]) return
    const file = e.target.files[0]
    
    const fd = new FormData()
    fd.append('file', file)
    
    try {
      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { 'x-admin-token': token || '' },
        body: fd
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      
      const newImages = [...(editForm.images || []), json.data.url]
      setEditForm({ ...editForm, images: newImages })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed')
    }
  }

  const removeImage = (index: number) => {
    const newImages = [...(editForm.images || [])]
    newImages.splice(index, 1)
    setEditForm({ ...editForm, images: newImages })
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
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Каталог</div>
          <div className="mt-1 text-sm text-slate-600">Управление объектами (удаление, редактирование).</div>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'property' ? 'default' : 'secondary'} onClick={() => setTab('property')}>Лоты</Button>
          <Button variant={tab === 'complex' ? 'default' : 'secondary'} onClick={() => setTab('complex')}>ЖК</Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <CatalogFilters
          tab={tab === 'complex' ? 'newbuild' : 'secondary'}
          value={filters}
          onChange={setFilters}
        />
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Загрузка...</div>
      ) : error ? (
        <div className="text-sm text-rose-600">{error}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            <div>
              Товаров: <span className="font-semibold text-slate-900">{total}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span>На странице</span>
                <Select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
                  {[12, 24, 36, 48, 72, 96].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPage(Math.max(page - 1, 1))} disabled={page <= 1}>
                  Назад
                </Button>
                <span>
                  Страница {page} из {totalPages}
                </span>
                <Button size="sm" variant="secondary" onClick={() => setPage(Math.min(page + 1, totalPages))} disabled={page >= totalPages}>
                  Вперёд
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <div key={item.id} className="relative group">
                {tab === 'property' ? (
                  <PropertyCard item={item as Property} />
                ) : (
                  <ComplexCard item={item as Complex} />
                )}
                
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                  <a 
                    href={tab === 'property' ? `/property/${item.id}` : `/complex/${item.id}`} 
                    target="_blank" 
                    rel="noreferrer"
                    className="inline-flex h-8 items-center justify-center rounded-md bg-white px-3 text-xs font-medium text-slate-700 shadow hover:bg-slate-50 hover:text-slate-900"
                  >
                    На сайт
                  </a>
                  <Button size="sm" onClick={() => handleEdit(item)}>
                    Ред.
                  </Button>
                  <Button size="sm" variant="secondary" className="bg-rose-50 text-rose-600 hover:bg-rose-100" onClick={() => handleDelete(item.id)}>
                    Уд.
                  </Button>
                </div>
              </div>
            ))}
            {items.length === 0 && <div className="col-span-full text-center text-slate-500">Нет объектов</div>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            <div>
              Товаров: <span className="font-semibold text-slate-900">{total}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span>На странице</span>
                <Select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
                  {[12, 24, 36, 48, 72, 96].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPage(Math.max(page - 1, 1))} disabled={page <= 1}>
                  Назад
                </Button>
                <span>
                  Страница {page} из {totalPages}
                </span>
                <Button size="sm" variant="secondary" onClick={() => setPage(Math.min(page + 1, totalPages))} disabled={page >= totalPages}>
                  Вперёд
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <Modal open={!!editingItem} onClose={() => setEditingItem(null)} title="Редактирование">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto p-1">
            <div>
              <label className="text-xs font-medium text-slate-700">Название</label>
              <Input 
                value={editForm.title || ''} 
                onChange={(e) => setEditForm({...editForm, title: e.target.value})} 
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-slate-700">Цена</label>
                <Input 
                  type="number"
                  value={editForm.price || editForm.price_from || 0} 
                  onChange={(e) => setEditForm({...editForm, [tab === 'property' ? 'price' : 'price_from']: Number(e.target.value)})} 
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Площадь</label>
                <Input 
                  type="number"
                  value={editForm.area_total || editForm.area_from || 0} 
                  onChange={(e) => setEditForm({...editForm, [tab === 'property' ? 'area_total' : 'area_from']: Number(e.target.value)})} 
                />
              </div>
            </div>

            {tab === 'property' && (
              <div>
                 <label className="text-xs font-medium text-slate-700">Спальни</label>
                 <Input 
                  type="number"
                  value={editForm.bedrooms || 0} 
                  onChange={(e) => setEditForm({...editForm, bedrooms: Number(e.target.value)})} 
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-slate-700">Район</label>
              <Input 
                value={editForm.district || ''} 
                onChange={(e) => setEditForm({...editForm, district: e.target.value})} 
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700 block mb-2">Фотографии</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {(editForm.images || []).map((img: string, i: number) => (
                  <div key={i} className="relative group aspect-square bg-slate-100 rounded overflow-hidden">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    <button 
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeImage(i)}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded cursor-pointer hover:bg-slate-50 aspect-square">
                  <span className="text-xs text-slate-500">+</span>
                  <input type="file" className="hidden" accept="image/*" onChange={handleUpload} />
                </label>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Статус</label>
              <Select 
                value={editForm.status || 'active'} 
                onChange={(e) => setEditForm({...editForm, status: e.target.value})}
              >
                <option value="active">Активен</option>
                <option value="hidden">Скрыт</option>
                <option value="archived">Архив</option>
              </Select>
            </div>
            
            <div className="pt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditingItem(null)}>Отмена</Button>
              <Button onClick={handleSave}>Сохранить</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
