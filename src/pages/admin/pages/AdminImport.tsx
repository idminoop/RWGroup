import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { apiGet, apiPost, apiDelete, apiPut } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/useUiStore'
import type { FeedSource, ImportRun, ImportPreview, Property, Complex } from '../../../../shared/types'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'

const MAPPING_CONFIG = [
  { key: 'external_id', label: 'External ID', required: true, placeholder: 'id, externalId' },
  { key: 'title', label: 'Title / Name', placeholder: 'title, name' },
  { key: 'price', label: 'Price (Property)', placeholder: 'price' },
  { key: 'area_total', label: 'Area (Property)', placeholder: 'area, area_total' },
  { key: 'bedrooms', label: 'Bedrooms', placeholder: 'bedrooms, rooms' },
  { key: 'district', label: 'District', placeholder: 'district, area, region' },
  { key: 'images', label: 'Images', placeholder: 'images, photos, image_urls' },
  { key: 'category', label: 'Category', placeholder: 'category (newbuild, secondary, rent)' },
  { key: 'deal_type', label: 'Deal Type', placeholder: 'deal_type (sale, rent)' },
  { key: 'complex_external_id', label: 'Complex ID (for lots)', placeholder: 'complex_id' },
  { key: 'price_from', label: 'Price From (Complex)', placeholder: 'price_from, price_min' },
  { key: 'area_from', label: 'Area From (Complex)', placeholder: 'area_from, area_min' },
  { key: 'status', label: 'Status', placeholder: 'status' },
]

export default function AdminImportPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  
  // Data
  const [feeds, setFeeds] = useState<FeedSource[]>([])
  const [runs, setRuns] = useState<ImportRun[]>([])
  
  // UI State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Feed Management State
  const [isFeedModalOpen, setIsFeedModalOpen] = useState(false)
  const [editingFeedId, setEditingFeedId] = useState<string | null>(null)
  const [feedForm, setFeedForm] = useState<{
    name: string
    format: 'xlsx' | 'csv' | 'xml' | 'json'
    mode: 'upload' | 'url'
    url: string
    mapping: Record<string, string>
  }>({
    name: '',
    format: 'json',
    mode: 'upload',
    url: '',
    mapping: {}
  })

  // Import State
  const [activeImportSource, setActiveImportSource] = useState<FeedSource | null>(null)
  const [entity, setEntity] = useState<'property' | 'complex'>('property')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'visual'>('visual')
  const [autoPreviewSourceId, setAutoPreviewSourceId] = useState<string | null>(null)

  // Edit Preview State
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  const getRowExternalId = (row: ImportPreview['sampleRows'][number]) => {
    const data = row.data as Record<string, any>
    return data.external_id || data.id || data.externalId || ''
  }

  const load = useCallback(() => {
    apiGet<FeedSource[]>('/api/admin/feeds', headers).then(setFeeds).catch(() => setFeeds([]))
    apiGet<ImportRun[]>('/api/admin/import/runs', headers).then(setRuns).catch(() => setRuns([]))
  }, [headers])

  useEffect(() => {
    load()
  }, [load])

  const selectFeed = useCallback((feed: FeedSource | null) => {
    setActiveImportSource(feed)
    setFile(null)
    setPreview(null)
    setIsPreviewMode(false)
    setViewMode('visual')
    setEditingIndex(null)
    setEditForm({})
    setError(null)
  }, [])

  useEffect(() => {
    if (feeds.length === 0) return
    if (!activeImportSource) {
      selectFeed(feeds[0])
      return
    }
    const stillExists = feeds.some((f) => f.id === activeImportSource.id)
    if (!stillExists) {
      selectFeed(feeds[0])
    }
  }, [feeds, activeImportSource, selectFeed])


  // --- Feed Management Functions ---

  const openCreateFeed = () => {
    setEditingFeedId(null)
    setFeedForm({ name: '', format: 'json', mode: 'upload', url: '', mapping: {} })
    setIsFeedModalOpen(true)
  }

  const openEditFeed = (feed: FeedSource) => {
    setEditingFeedId(feed.id)
    setFeedForm({
      name: feed.name,
      format: feed.format,
      mode: feed.mode,
      url: feed.url || '',
      mapping: feed.mapping || {}
    })
    setIsFeedModalOpen(true)
  }

  const handleSaveFeed = async () => {
    setError(null)
    try {
      const payload = {
        ...feedForm,
        url: feedForm.mode === 'url' ? feedForm.url : undefined,
        mapping: Object.keys(feedForm.mapping).length > 0 ? feedForm.mapping : undefined
      }

      let newFeedId: string | null = null

      if (editingFeedId) {
        await apiPut(`/api/admin/feeds/${editingFeedId}`, payload, headers)
      } else {
        const res = await apiPost<{ id: string }>('/api/admin/feeds', payload, headers)
        newFeedId = res.id
      }
      setIsFeedModalOpen(false)
      load()

      if (newFeedId) {
        // Auto-select new feed for import
        const newFeed: FeedSource = {
          id: newFeedId,
          name: feedForm.name,
          mode: feedForm.mode,
          url: feedForm.mode === 'url' ? feedForm.url : undefined,
          format: feedForm.format,
          is_active: true,
          mapping: feedForm.mapping,
          created_at: new Date().toISOString()
        }
        selectFeed(newFeed)
        setAutoPreviewSourceId(newFeedId)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения фида')
    }
  }

  const handleDeleteFeed = async (id: string) => {
    if (!confirm('Удалить источник?')) return
    try {
      await apiDelete(`/api/admin/feeds/${id}`, headers)
      const nextFeeds = feeds.filter((f) => f.id !== id)
      setFeeds(nextFeeds)
      if (activeImportSource?.id === id) {
        selectFeed(nextFeeds[0] || null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления')
    }
  }

  // --- Import Functions ---

  const handleStartImport = (feed: FeedSource) => {
    selectFeed(feed)
  }

  const runPreview = async () => {
    if (!activeImportSource) {
      setError('Р’С‹Р±РµСЂРёС‚Рµ РёСЃС‚РѕС‡РЅРёРє')
      return
    }
    if (activeImportSource.mode === 'upload' && !file) return
    
    setLoading(true)
    setError(null)
    setPreview(null)

    try {
      const fd = new FormData()
      if (file) fd.append('file', file)
      fd.append('source_id', activeImportSource.id)
      fd.append('entity', entity)
      if (activeImportSource.mode === 'url' && activeImportSource.url) {
        fd.append('url', activeImportSource.url)
      }

      const res = await fetch('/api/admin/import/preview', {
        method: 'POST',
        headers: { 'x-admin-token': token || '' },
        body: fd,
      })

      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.details || json.error || 'Preview failed')

      setPreview(json.data)
      setIsPreviewMode(true)
      setViewMode('visual')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!autoPreviewSourceId) return
    if (!activeImportSource || activeImportSource.id !== autoPreviewSourceId) return
    if (activeImportSource.mode !== 'url' || !activeImportSource.url) {
      setAutoPreviewSourceId(null)
      return
    }
    setAutoPreviewSourceId(null)
    void runPreview()
  }, [autoPreviewSourceId, activeImportSource, runPreview])

  const runImport = async () => {
    if (!activeImportSource) {
      setError('Р’С‹Р±РµСЂРёС‚Рµ РёСЃС‚РѕС‡РЅРёРє')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      // If we have preview data, use it as source of truth for rows (to include edits)
      if (preview && preview.sampleRows.length > 0) {
        const rows = preview.sampleRows.map(r => r.data)
        fd.append('rows', JSON.stringify(rows))
        fd.append('source_id', activeImportSource.id)
        fd.append('entity', entity)
      } else {
        if (file) fd.append('file', file)
        fd.append('source_id', activeImportSource.id)
        fd.append('entity', entity)
        if (activeImportSource.mode === 'url' && activeImportSource.url) {
          fd.append('url', activeImportSource.url)
        }
      }

      const res = await fetch('/api/admin/import/run', {
        method: 'POST',
        headers: { 'x-admin-token': token || '' },
        body: fd,
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.details || json.error || 'Import failed')
      
      setFile(null)
      setPreview(null)
      setIsPreviewMode(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  const closePreview = () => {
    setIsPreviewMode(false)
    setPreview(null)
  }

  // --- Edit Functions ---

  const handleEdit = (index: number) => {
    if (!preview) return
    setEditingIndex(index)
    setEditForm({ ...preview.sampleRows[index].data })
  }

  const handleSaveEdit = () => {
    if (!preview || editingIndex === null) return
    
    // Update sampleRows
    const newSampleRows = [...preview.sampleRows]
    newSampleRows[editingIndex] = {
      ...newSampleRows[editingIndex],
      data: editForm,
    }

    // Helper to find value using mapping
    const getValue = (data: any, field: string) => {
      if (data[field] !== undefined) return data[field]
      const aliases = preview.fieldMappings[field] || []
      for (const alias of aliases) {
        if (data[alias] !== undefined) return data[alias]
      }
      return undefined
    }

    // Update mappedItems for visual preview
    const newMappedItems = [...preview.mappedItems]
    const currentItem = newMappedItems[editingIndex]
    
    if (entity === 'property') {
      const p = currentItem as Property
      const title = getValue(editForm, 'title')
      if (title) p.title = String(title)
      const price = getValue(editForm, 'price')
      if (price) p.price = Number(price)
      const area = getValue(editForm, 'area_total')
      if (area) p.area_total = Number(area)
      const district = getValue(editForm, 'district')
      if (district) p.district = String(district)
      const bedrooms = getValue(editForm, 'bedrooms')
      if (bedrooms) p.bedrooms = Number(bedrooms)
    } else {
      const c = currentItem as Complex
      const title = getValue(editForm, 'title')
      if (title) c.title = String(title)
      const priceFrom = getValue(editForm, 'price_from')
      if (priceFrom) c.price_from = Number(priceFrom)
      const areaFrom = getValue(editForm, 'area_from')
      if (areaFrom) c.area_from = Number(areaFrom)
      const district = getValue(editForm, 'district')
      if (district) c.district = String(district)
    }

    setPreview({
      ...preview,
      sampleRows: newSampleRows,
      mappedItems: newMappedItems
    })
    setEditingIndex(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Импорт и Фиды</div>
          <div className="mt-1 text-sm text-slate-600">Управление источниками данных и запуск импорта.</div>
        </div>
        <Button onClick={openCreateFeed}>Добавить источник</Button>
      </div>

      {error ? <div className="text-sm text-rose-600">{error}</div> : null}

      {/* Main View: Feed List */}
      <div className="space-y-6">
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2">Название</th>
                  <th className="px-3 py-2">Формат</th>
                  <th className="px-3 py-2">Режим</th>
                  <th className="px-3 py-2">Маппинг</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {feeds.map((f) => {
                  const lastRun = runs.filter(r => r.source_id === f.id).sort((a,b) => (b.started_at || '').localeCompare(a.started_at || ''))[0]
                  return (
                  <tr key={f.id} className="border-t border-slate-200">
                    <td className="px-3 py-2 font-medium text-slate-900">{f.name}</td>
                    <td className="px-3 py-2 text-slate-700">{f.format}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {f.mode === 'url' ? (
                        <span className="truncate max-w-[200px] block" title={f.url}>{f.url}</span>
                      ) : 'Файл'}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {f.mapping ? Object.keys(f.mapping).length + ' полей' : 'Авто'}
                    </td>
                    <td className="px-3 py-2">
                      {lastRun ? (
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={lastRun.status === 'success' ? 'default' : lastRun.status === 'partial' ? 'warning' : 'destructive'}>{lastRun.status}</Badge>
                          <span className="text-[10px] text-slate-500">{new Date(lastRun.started_at).toLocaleDateString('ru-RU')}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Не импортировано</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <Button size="sm" variant={lastRun ? "secondary" : "default"} onClick={() => handleStartImport(f)}>
                        {lastRun ? 'Импорт' : 'Запустить'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => openEditFeed(f)}>
                        Настроить
                      </Button>
                      <Button size="sm" variant="secondary" className="text-rose-600 bg-rose-50 hover:bg-rose-100" onClick={() => handleDeleteFeed(f.id)}>
                        Удалить
                      </Button>
                    </td>
                  </tr>
                )})}
                {feeds.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      Нет источников. Добавьте первый фид для начала работы.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-900">История импорта</div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Время</th>
                    <th className="px-3 py-2">Сущность</th>
                    <th className="px-3 py-2">Статус</th>
                    <th className="px-3 py-2">Статистика</th>
                    <th className="px-3 py-2">Ошибки</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t border-slate-200">
                      <td className="px-3 py-2 text-slate-700">
                        {new Date(r.started_at).toLocaleString('ru-RU')}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{r.entity}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            r.status === 'success' ? 'default' :
                            r.status === 'partial' ? 'warning' :
                            'destructive'
                          }
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        +{r.stats.inserted} / обновл. {r.stats.updated} / скрыто {r.stats.hidden}
                      </td>
                      <td className="px-3 py-2">
                        {r.error_log ? (
                          <details>
                            <summary className="cursor-pointer text-rose-600 hover:text-rose-700">
                              Детали
                            </summary>
                            <pre className="mt-2 p-2 bg-slate-50 rounded text-xs max-w-md overflow-x-auto whitespace-pre-wrap">
                              {r.error_log}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                        История пуста
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      {/* Import View */}
      <div className="space-y-6 border-t border-slate-200 pt-6">

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">
                Импорт{activeImportSource ? (
                  <>: <span className="text-slate-900">{activeImportSource.name}</span></>
                ) : null}
              </div>
              <div className="text-xs text-slate-500">Настройте параметры и проверьте данные перед импортом.</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Источник</label>
              <Select
                value={activeImportSource?.id || ''}
                onChange={(e) => {
                  const next = feeds.find((f) => f.id === e.target.value)
                  if (next) handleStartImport(next)
                }}
              >
                {feeds.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Тип сущности</label>
              <Select
                value={entity}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'property' || v === 'complex') setEntity(v)
                }}
              >
                <option value="property">Лоты (Квартиры)</option>
                <option value="complex">Жилые Комплексы</option>
              </Select>
            </div>
            {activeImportSource?.mode === 'upload' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Файл ({activeImportSource?.format})</label>
                <input
                  type="file"
                  accept=".json,.csv,.xlsx,.xls,.xml"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="text-sm w-full"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={runPreview} disabled={loading || !activeImportSource || (activeImportSource?.mode === 'upload' && !file)}>
                {loading ? 'Анализ…' : 'Предпросмотр'}
              </Button>
            </div>
          </div>

          {preview && (
            <Modal open={isPreviewMode} onClose={closePreview} title="Предпросмотр">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Предпросмотр</div>
                  <div className="flex items-center gap-4">
                    <div className="flex bg-slate-200 rounded p-1">
                      <button 
                        className={cn("px-3 py-1 text-xs rounded transition-colors", viewMode === 'table' ? "bg-white shadow" : "text-slate-600 hover:text-slate-900")}
                        onClick={() => setViewMode('table')}
                      >
                        Таблица
                      </button>
                      <button 
                        className={cn("px-3 py-1 text-xs rounded transition-colors", viewMode === 'visual' ? "bg-white shadow" : "text-slate-600 hover:text-slate-900")}
                        onClick={() => setViewMode('visual')}
                      >
                        Визуально
                      </button>
                    </div>
                    <div className="text-xs text-slate-600">
                      Всего: {preview.totalRows} | Валидных: {preview.validRows} | Ошибок: {preview.invalidRows}
                    </div>
                  </div>
                </div>

                {preview.invalidRows > 0 && (
                  <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                    <div className="font-semibold mb-2">Ошибки в предпросмотре</div>
                    <div className="space-y-2 max-h-[220px] overflow-y-auto">
                      {preview.sampleRows
                        .filter((r) => r.errors.length > 0)
                        .slice(0, 20)
                        .map((row) => (
                          <div key={row.rowIndex} className="rounded bg-white/70 p-2 border border-rose-100">
                            <div className="font-medium">
                              Строка {row.rowIndex}
                              {getRowExternalId(row) ? ` (ID: ${getRowExternalId(row)})` : ''}
                            </div>
                            <div className="mt-1 space-y-1">
                              {row.errors.map((err, i) => (
                                <div key={i}>• {err}</div>
                              ))}
                            </div>
                          </div>
                        ))}
                      {preview.invalidRows > 20 && (
                        <div className="text-rose-600">Показаны первые 20 строк с ошибками.</div>
                      )}
                    </div>
                  </div>
                )}

                {preview.totalRows > preview.sampleRows.length && (
                  <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 p-2 rounded">
                    Внимание: Показаны первые {preview.sampleRows.length} записей. Ручные правки применятся только к ним.
                  </div>
                )}

                <div>
                  <div className="text-xs font-medium text-slate-700 mb-2">Обнаруженные поля:</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(preview.fieldMappings).map(([field, aliases]) => (
                      <Badge key={field} variant="secondary">
                        {field} ← {aliases.join(', ')}
                      </Badge>
                    ))}
                  </div>
                </div>

                {viewMode === 'table' ? (
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {preview.sampleRows.map((row, index) => (
                      <div
                        key={row.rowIndex}
                        className={cn(
                          "rounded border p-3 text-xs relative group",
                          row.errors.length > 0 ? "border-rose-200 bg-rose-50" : row.warnings.length > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
                        )}
                      >
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button size="sm" variant="secondary" onClick={() => handleEdit(index)}>Ред.</Button>
                        </div>
                        
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-medium">Строка {row.rowIndex}</span>
                          <span className="text-slate-500">{row.mappedFields.length} полей</span>
                        </div>

                        {row.errors.length > 0 && (
                          <div className="mb-2 text-rose-600">
                            {row.errors.map((err, i) => <div key={i}>• {err}</div>)}
                          </div>
                        )}
                        
                        <details>
                          <summary className="cursor-pointer text-slate-600">JSON</summary>
                          <pre className="mt-1 p-2 bg-slate-100 rounded text-[10px] overflow-x-auto">{JSON.stringify(row.data, null, 2)}</pre>
                        </details>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 max-h-[800px] overflow-y-auto p-2">
                    {preview.mappedItems.map((item, index) => (
                      <div key={index} className="relative group">
                        {entity === 'property' ? <PropertyCard item={item as Property} /> : <ComplexCard item={item as Complex} />}
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <Button size="sm" onClick={() => handleEdit(index)}>Ред.</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="secondary" onClick={closePreview}>
                    Оставить
                  </Button>
                  <Button onClick={runImport} disabled={loading}>
                    {loading ? 'Импорт…' : 'Опубликовать'}
                  </Button>
                </div>
              </div>
            </Modal>
          )}
      </div>
      {/* Edit Row Modal */}
      {editingIndex !== null && (
        <Modal open={editingIndex !== null} onClose={() => setEditingIndex(null)} title="Редактирование записи">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto p-1">
            <div className="text-xs text-slate-500 mb-4">
              Изменение сырых данных фида. Поля будут пересчитаны.
            </div>
            {Object.keys(editForm).map((key) => (
              <div key={key}>
                <label className="text-xs font-medium text-slate-700">{key}</label>
                <Input 
                  value={String(editForm[key] ?? '')} 
                  onChange={(e) => setEditForm({...editForm, [key]: e.target.value})} 
                />
              </div>
            ))}
            <div className="pt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditingIndex(null)}>Отмена</Button>
              <Button onClick={handleSaveEdit}>Применить</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Feed Management Modal */}
      <Modal open={isFeedModalOpen} onClose={() => setIsFeedModalOpen(false)} title={editingFeedId ? 'Редактирование источника' : 'Новый источник'}>
        <div className="space-y-4 max-h-[80vh] overflow-y-auto p-1">
          <div>
            <label className="text-xs font-medium text-slate-700">Название</label>
            <Input value={feedForm.name} onChange={(e) => setFeedForm({...feedForm, name: e.target.value})} placeholder="Например: Циан XML" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-700">Формат</label>
              <Select value={feedForm.format} onChange={(e) => setFeedForm({...feedForm, format: e.target.value as any})}>
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="xlsx">XLSX</option>
                <option value="xml">XML</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Режим</label>
              <Select value={feedForm.mode} onChange={(e) => setFeedForm({...feedForm, mode: e.target.value as any})}>
                <option value="upload">Загрузка файла</option>
                <option value="url">По URL</option>
              </Select>
            </div>
          </div>

          {feedForm.mode === 'url' && (
            <div>
              <label className="text-xs font-medium text-slate-700">URL фида</label>
              <Input value={feedForm.url} onChange={(e) => setFeedForm({...feedForm, url: e.target.value})} placeholder="https://example.com/feed.xml" />
            </div>
          )}

          <div className="border-t pt-4 mt-4">
            <div className="text-sm font-semibold mb-2">Маппинг полей</div>
            <div className="text-xs text-slate-500 mb-4">
              Укажите названия колонок в вашем фиде, соответствующие полям системы. Оставьте пустым для авто-определения.
            </div>
            
            <div className="space-y-2">
              {MAPPING_CONFIG.map((field) => (
                <div key={field.key} className="grid grid-cols-3 gap-2 items-center">
                  <div className="text-xs text-slate-700 font-medium col-span-1">
                    {field.label}
                    {field.required && <span className="text-rose-500">*</span>}
                  </div>
                  <div className="col-span-2">
                    <Input 
                      placeholder={field.placeholder}
                      value={feedForm.mapping[field.key] || ''}
                      onChange={(e) => {
                        const val = e.target.value
                        const newMapping = { ...feedForm.mapping }
                        if (val) newMapping[field.key] = val
                        else delete newMapping[field.key]
                        setFeedForm({ ...feedForm, mapping: newMapping })
                      }}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsFeedModalOpen(false)}>Отмена</Button>
            <Button onClick={handleSaveFeed} disabled={!feedForm.name}>Сохранить</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}


