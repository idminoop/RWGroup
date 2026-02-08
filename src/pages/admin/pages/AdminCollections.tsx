import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { apiGet, apiPost, apiDelete, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import CollectionModal from '../components/CollectionModal'
import CollectionPreview from '../components/CollectionPreview'
import type { Collection } from '../../../../shared/types'

export default function AdminCollectionsPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const [list, setList] = useState<Collection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null)
  const [previewCollectionId, setPreviewCollectionId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiGet<Collection[]>('/api/admin/collections', headers)
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false))
  }, [headers])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = () => {
    setEditingCollection(null)
    setModalOpen(true)
  }

  const handleEdit = (collection: Collection) => {
    setEditingCollection(collection)
    setModalOpen(true)
  }

  const handleSave = () => {
    load()
  }

  const handleToggleStatus = async (collection: Collection) => {
    try {
      await apiPost(`/api/admin/collections/${collection.id}/toggle-status`, {}, headers)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const handleDelete = async (collection: Collection) => {
    if (!confirm(`Удалить подборку "${collection.title}"? Это действие нельзя отменить.`)) return
    try {
      await apiDelete(`/api/admin/collections/${collection.id}`, headers)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const handlePriorityChange = async (id: string, priority: number) => {
    try {
      await apiPut(`/api/admin/collections/${id}`, { priority }, headers)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const getContentSummary = (collection: Collection) => {
    if (collection.mode === 'manual') {
      return `${collection.items.length} объект${collection.items.length === 1 ? '' : collection.items.length < 5 ? 'а' : 'ов'}`
    } else if (collection.auto_rules) {
      const parts: string[] = []
      const rules = collection.auto_rules
      if (rules.category) parts.push(rules.category === 'newbuild' ? 'новостройка' : rules.category === 'secondary' ? 'вторичка' : 'аренда')
      if (rules.bedrooms !== undefined) parts.push(`${rules.bedrooms} спален`)
      if (rules.priceMin || rules.priceMax) parts.push(`${rules.priceMin ? `от ${rules.priceMin}` : ''}${rules.priceMax ? ` до ${rules.priceMax}` : ''}`)
      if (rules.areaMin || rules.areaMax) parts.push(`${rules.areaMin ? `от ${rules.areaMin}м²` : ''}${rules.areaMax ? ` до ${rules.areaMax}м²` : ''}`)
      if (rules.district) parts.push(rules.district)
      return parts.length > 0 ? parts.slice(0, 3).join(', ') + (parts.length > 3 ? '...' : '') : 'Авто-правила заданы'
    }
    return '-'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Подборки</div>
          <div className="mt-1 text-sm text-slate-600">Управление подборками объектов и ЖК.</div>
        </div>
        <Button onClick={handleCreate}>Создать подборку</Button>
      </div>

      {error ? <div className="text-sm text-rose-600">{error}</div> : null}

      {loading ? (
        <div className="h-32 animate-pulse rounded-lg bg-slate-50" />
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <p className="text-sm text-slate-600">Нет созданных подборок</p>
          <Button size="sm" className="mt-3" onClick={handleCreate}>
            Создать первую подборку
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2">Название</th>
                <th className="px-3 py-2">Режим</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">Содержимое</th>
                <th className="px-3 py-2">Приоритет</th>
                <th className="px-3 py-2">Действия</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-t border-slate-200">
                  <td className="px-3 py-3 font-medium text-slate-900">{c.title}</td>
                  <td className="px-3 py-3">
                    <Badge variant={c.mode === 'manual' ? 'default' : 'accent'}>
                      {c.mode === 'manual' ? 'Ручная' : 'Авто'}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={c.status === 'visible' ? 'secondary' : 'outline'}>
                      {c.status === 'visible' ? 'Видна' : 'Скрыта'}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">{getContentSummary(c)}</td>
                  <td className="px-3 py-3">
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={String(c.priority)}
                      onChange={(e) => handlePriorityChange(c.id, Number(e.target.value || 0))}
                      className="h-9 max-w-24"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleToggleStatus(c)}
                        className="rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        title={c.status === 'visible' ? 'Скрыть' : 'Показать'}
                      >
                        {c.status === 'visible' ? '👁️' : '🔒'}
                      </button>
                      <button
                        onClick={() => setPreviewCollectionId(c.id)}
                        className="rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        title="Просмотр"
                      >
                        👀
                      </button>
                      <button
                        onClick={() => handleEdit(c)}
                        className="rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        title="Настроить"
                      >
                        ⚙️
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                        title="Удалить"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CollectionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        collection={editingCollection}
      />

      {previewCollectionId && (
        <CollectionPreview
          open={Boolean(previewCollectionId)}
          onClose={() => setPreviewCollectionId(null)}
          collectionId={previewCollectionId}
        />
      )}
    </div>
  )
}
