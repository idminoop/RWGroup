﻿﻿﻿import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'
import Select from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { apiGet, apiPost, apiDelete, apiPut } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/useUiStore'
import { useAdminImportCache } from '@/store/useAdminImportCache'
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

const statusLabel = (status: ImportRun['status'], action?: ImportRun['action']) => {
  if (action === 'delete') return 'Удалено'
  if (status === 'success') return 'Успешно'
  if (status === 'partial') return 'Частично'
  return 'Ошибка'
}

const normalizeUrlName = (value: string) => {
  try {
    const u = new URL(value)
    const raw = u.pathname.split('/').filter(Boolean).pop() || u.hostname
    const decoded = decodeURIComponent(raw)
    return decoded.replace(/\.[a-z0-9]+$/i, '')
  } catch {
    const raw = value.split('/').filter(Boolean).pop() || value
    return raw.replace(/\.[a-z0-9]+$/i, '')
  }
}

const normalizeFileName = (value: string) => {
  const base = value.split(/[/\\]/).pop() || value
  return base.replace(/\.[a-z0-9]+$/i, '')
}

export default function AdminImportPage() {
  const navigate = useNavigate()
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  
  // Data
  const adminCache = useAdminImportCache()
  const [feeds, setFeeds] = useState<FeedSource[]>(adminCache.feeds)
  const [runs, setRuns] = useState<ImportRun[]>(adminCache.runs)
  const [feedDiagnostics, setFeedDiagnostics] = useState<Record<string, { reason?: string; items?: { properties: number; complexes: number; total: number } }>>(
    adminCache.diagnostics,
  )
  const [dataError, setDataError] = useState<string | null>(null)
  const [runsPage, setRunsPage] = useState(1)
  
  // UI State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingSourceIds, setPendingSourceIds] = useState<Set<string>>(new Set())
  
  // Feed Management State
  const [isFeedModalOpen, setIsFeedModalOpen] = useState(false)
  const [editingFeedId, setEditingFeedId] = useState<string | null>(null)
  const [feedNameTouched, setFeedNameTouched] = useState(false)
  const [isMappingExpanded, setIsMappingExpanded] = useState(false)
  const [feedForm, setFeedForm] = useState<{
    name: string
    format: 'xlsx' | 'csv' | 'xml' | 'json'
    mode: 'upload' | 'url'
    url: string
    mapping: Record<string, string>
  }>({
    name: '',
    format: 'xml',
    mode: 'url',
    url: '',
    mapping: {}
  })
  const [feedFile, setFeedFile] = useState<File | null>(null)

  // Import State
  const [activeImportSource, setActiveImportSource] = useState<FeedSource | null>(null)
  const [entity, setEntity] = useState<'property' | 'complex'>('property')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [previewContext, setPreviewContext] = useState<{
    sourceId: string
    sourceName?: string
    entity: 'property' | 'complex'
    mode: 'upload' | 'url'
    url?: string
    fileName?: string
  } | null>(null)
  const [viewMode, setViewMode] = useState<'table' | 'visual'>('visual')
  const [cardsPerRow, setCardsPerRow] = useState(3)
  const [isMobilePreview, setIsMobilePreview] = useState(false)
  const [autoPreviewSourceId, setAutoPreviewSourceId] = useState<string | null>(null)
  const [hideInvalid, setHideInvalid] = useState(true)

  // Edit Preview State
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  const getRowExternalId = (row: ImportPreview['sampleRows'][number]) => {
    const data = row.data as Record<string, any>
    return data.external_id || data.id || data.externalId || ''
  }

  const cardsPerRowOptions = isMobilePreview ? [1] : [1, 2, 3, 4, 5]

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(max-width: 640px)')
    const apply = () => setIsMobilePreview(media.matches)
    apply()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
    media.addListener(apply)
    return () => media.removeListener(apply)
  }, [])

  useEffect(() => {
    if (!isPreviewMode || viewMode !== 'visual' || !isMobilePreview) return
    if (cardsPerRow !== 1) setCardsPerRow(1)
  }, [cardsPerRow, isMobilePreview, isPreviewMode, viewMode])

  const load = useCallback(async () => {
    if (!token) return
    setDataError(null)
    const [feedsRes, runsRes, diagRes] = await Promise.allSettled([
      apiGet<FeedSource[]>('/api/admin/feeds', headers),
      apiGet<ImportRun[]>('/api/admin/import/runs', headers),
      apiGet<Record<string, { reason?: string; items?: { properties: number; complexes: number; total: number } }>>('/api/admin/feeds/diagnostics', headers),
    ])

    if (feedsRes.status === 'fulfilled') {
      setFeeds(feedsRes.value)
      adminCache.setCache({ feeds: feedsRes.value })
    } else {
      setDataError('Не удалось загрузить список источников.')
    }

    if (runsRes.status === 'fulfilled') {
      setRuns(runsRes.value)
      adminCache.setCache({ runs: runsRes.value })
    } else {
      setDataError((prev) => prev || 'Не удалось загрузить историю импортов.')
    }

    if (diagRes.status === 'fulfilled') {
      setFeedDiagnostics(diagRes.value)
      adminCache.setCache({ diagnostics: diagRes.value })
    }
  }, [headers, token, adminCache])

  useEffect(() => {
    load()
  }, [load])

  const runsBySource = useMemo(() => {
    const map = new Map<string, ImportRun>()
    for (const r of runs) {
      const current = map.get(r.source_id)
      if (!current || (r.started_at || '') > (current.started_at || '')) {
        map.set(r.source_id, r)
      }
    }
    return map
  }, [runs])

  const runsPerPage = 10
  const runsTotalPages = Math.max(1, Math.ceil(runs.length / runsPerPage))
  const pagedRuns = useMemo(() => {
    const start = (runsPage - 1) * runsPerPage
    return runs.slice(start, start + runsPerPage)
  }, [runs, runsPage])

  useEffect(() => {
    if (runsPage > runsTotalPages) setRunsPage(runsTotalPages)
  }, [runsPage, runsTotalPages])

  const duplicateMap = useMemo(() => {
    const byUrl = new Map<string, string[]>()
    const byName = new Map<string, string[]>()
    for (const f of feeds) {
      if (f.url) {
        const list = byUrl.get(f.url) || []
        list.push(f.id)
        byUrl.set(f.url, list)
      }
      const name = f.name.trim().toLowerCase()
      if (name) {
        const list = byName.get(name) || []
        list.push(f.id)
        byName.set(name, list)
      }
    }
    const dupIds = new Set<string>()
    for (const list of [...byUrl.values(), ...byName.values()]) {
      if (list.length > 1) list.forEach((id) => dupIds.add(id))
    }
    return dupIds
  }, [feeds])

  const urlGroups = useMemo(() => {
    const map = new Map<string, FeedSource[]>()
    for (const f of feeds) {
      if (!f.url) continue
      const list = map.get(f.url) || []
      list.push(f)
      map.set(f.url, list)
    }
    return map
  }, [feeds])

  const lastRunByUrl = useMemo(() => {
    const map = new Map<string, ImportRun>()
    for (const [url, list] of urlGroups.entries()) {
      let best: ImportRun | undefined
      for (const feed of list) {
        const r = runsBySource.get(feed.id)
        if (!r) continue
        if (!best || (r.started_at || '') > (best.started_at || '')) best = r
      }
      if (best) map.set(url, best)
    }
    return map
  }, [urlGroups, runsBySource])

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

  useEffect(() => {
    if (feedForm.mode !== 'url') return
    if (!feedForm.url) return
    if (feedNameTouched) return
    const suggested = normalizeUrlName(feedForm.url)
    if (suggested && suggested !== feedForm.name) {
      setFeedForm((prev) => ({ ...prev, name: suggested }))
    }
  }, [feedForm.mode, feedForm.url, feedForm.name, feedNameTouched])

  const duplicateFeed = useMemo(() => {
    const name = feedForm.name.trim().toLowerCase()
    const url = feedForm.url.trim()
    return feeds.find((f) => {
      if (editingFeedId && f.id === editingFeedId) return false
      if (feedForm.mode === 'url' && url && f.mode === 'url' && f.url === url) return true
      if (name && f.name.trim().toLowerCase() === name) return true
      return false
    })
  }, [feeds, feedForm.mode, feedForm.name, feedForm.url, editingFeedId])

  const mappingFilledCount = Object.keys(feedForm.mapping).length


  // --- Feed Management Functions ---

  const openCreateFeed = () => {
    setEditingFeedId(null)
    setFeedNameTouched(false)
    setIsMappingExpanded(false)
    setFeedFile(null)
    setFeedForm({ name: '', format: 'xml', mode: 'url', url: '', mapping: {} })
    setIsFeedModalOpen(true)
  }

  const openEditFeed = (feed: FeedSource) => {
    setEditingFeedId(feed.id)
    setFeedNameTouched(true)
    setIsMappingExpanded(false)
    setFeedFile(null)
    setFeedForm({
      name: feed.name,
      format: feed.format,
      mode: feed.mode,
      url: feed.url || '',
      mapping: feed.mapping || {}
    })
    setIsFeedModalOpen(true)
  }

  const closeFeedModal = () => {
    setIsFeedModalOpen(false)
    setIsMappingExpanded(false)
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
      closeFeedModal()
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
        if (feedForm.mode === 'url') {
          setAutoPreviewSourceId(newFeedId)
        } else if (feedFile) {
          setFile(feedFile)
          await runPreviewForFeed(newFeed, feedFile)
        }
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
      adminCache.setCache({ feeds: nextFeeds })
      if (activeImportSource?.id === id) {
        selectFeed(nextFeeds[0] || null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления')
    }
  }

  // --- Import Functions ---

  const runPreviewForFeed = useCallback(async (feed: FeedSource, fileOverride?: File | null) => {
    if (feed.mode === 'upload' && !fileOverride) {
      setError('Для загрузки файла выберите файл перед предпросмотром.')
      return
    }
    if (feed.mode === 'url' && !feed.url) {
      setError('У источника не указан URL.')
      return
    }

    setLoading(true)
    setError(null)
    setIsPreviewMode(true)
    setPreview(null)
    setPreviewContext({
      sourceId: feed.id,
      sourceName: feed.name,
      entity,
      mode: feed.mode,
      url: feed.url,
      fileName: fileOverride?.name,
    })

    try {
      const fd = new FormData()
      if (fileOverride) fd.append('file', fileOverride)
      fd.append('source_id', feed.id)
      fd.append('entity', entity)
      if (feed.mode === 'url' && feed.url) {
        fd.append('url', feed.url)
      }

      const res = await fetch('/api/admin/import/preview', {
        method: 'POST',
        headers: { 'x-admin-token': token || '' },
        body: fd,
      })

      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.details || json.error || 'Preview failed')

      setPreview(json.data)
      setViewMode('visual')
      setHideInvalid(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
      void load()
    }
  }, [entity, token, load])

  const handleStartImport = useCallback((feed: FeedSource, autoPreview = false) => {
    selectFeed(feed)
    if (autoPreview && feed.mode === 'url') {
      void runPreviewForFeed(feed)
    }
  }, [runPreviewForFeed, selectFeed])

  const runPreview = async () => {
    if (!activeImportSource) {
      setError('Выберите источник')
      return
    }
    await runPreviewForFeed(activeImportSource, file)
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
    const sourceId = previewContext?.sourceId || activeImportSource?.id
    if (!sourceId) {
      setError('Выберите источник')
      return
    }
    setLoading(true)
    setPendingSourceIds((prev) => {
      const next = new Set(prev)
      next.add(sourceId)
      return next
    })
    setError(null)
    try {
      const fd = new FormData()
      // If we have preview data, use it as source of truth for rows (to include edits)
      if (preview && preview.sampleRows.length > 0) {
        const rows = preview.sampleRows.map(r => r.data)
        fd.append('rows', JSON.stringify(rows))
        fd.append('source_id', sourceId)
        fd.append('entity', previewContext?.entity || entity)
        fd.append('hide_invalid', String(hideInvalid))
      } else {
        if (file) fd.append('file', file)
        fd.append('source_id', sourceId)
        fd.append('entity', previewContext?.entity || entity)
        fd.append('hide_invalid', String(hideInvalid))
        if (previewContext?.mode === 'url' && previewContext.url) {
          fd.append('url', previewContext.url)
        } else if (activeImportSource?.mode === 'url' && activeImportSource.url) {
          fd.append('url', activeImportSource.url)
        }
      }

      const res = await fetch('/api/admin/import/run', {
        method: 'POST',
        headers: { 'x-admin-token': token || '' },
        body: fd,
      })
      const json = await res.json() as {
        success: boolean
        error?: string
        details?: string
        data?: { target_complex_id?: string }
      }
      if (!res.ok || !json.success) throw new Error(json.details || json.error || 'Import failed')
      const importedEntity = previewContext?.entity || entity
      const responseTargetComplexId = json.data?.target_complex_id

      setFile(null)
      setPreview(null)
      setIsPreviewMode(false)
      setPreviewContext(null)
      await load()

      let targetComplexId = responseTargetComplexId || ''
      if (!targetComplexId && importedEntity === 'complex') {
        try {
          const listRes = await apiGet<{ items: Complex[]; total: number; page: number; limit: number }>(
            `/api/admin/catalog/items?type=complex&source_id=${encodeURIComponent(sourceId)}&page=1&limit=1`,
            headers,
          )
          targetComplexId = listRes.items[0]?.id || ''
        } catch {
          // Import is already successful; ignore fallback lookup errors.
        }
      }

      if (targetComplexId) {
        navigate(`/admin/complex-settings?complexId=${encodeURIComponent(targetComplexId)}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
      setPendingSourceIds((prev) => {
        const next = new Set(prev)
        next.delete(sourceId)
        return next
      })
    }
  }

  const closePreview = () => {
    setIsPreviewMode(false)
    setPreview(null)
    setPreviewContext(null)
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Импорт и Фиды</div>
          <div className="mt-1 text-sm text-slate-600">Управление источниками данных и запуск импорта.</div>
        </div>
        <Button onClick={openCreateFeed}>Добавить источник</Button>
      </div>

      {error ? <div className="text-sm text-rose-600">{error}</div> : null}
      {dataError ? <div className="text-sm text-rose-600">{dataError}</div> : null}

      {/* Main View: Feed List */}
      <div className="space-y-6">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[720px] md:min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2">№</th>
                  <th className="px-3 py-2">Название</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Формат</th>
                  <th className="px-3 py-2">Источник</th>
                  <th className="px-3 py-2">Маппинг</th>
                  <th className="px-3 py-2 text-right sticky right-0 bg-slate-50 shadow-[-1px_0_0_#e2e8f0]">Действия</th>
                </tr>
              </thead>
              <tbody>
                {feeds.map((f, index) => {
                  const lastRun = runsBySource.get(f.id)
                  const duplicateUrlRun = f.url ? lastRunByUrl.get(f.url) : undefined
                  const displayRun = lastRun || (duplicateMap.has(f.id) ? duplicateUrlRun : undefined)
                  const isDuplicateUrl = Boolean(f.url && duplicateMap.has(f.id) && duplicateUrlRun)
                  const isPending = pendingSourceIds.has(f.id)
                  const canRun = !isDuplicateUrl && !isPending
                  const statusNote = !displayRun ? (feedDiagnostics[f.id]?.reason || 'Импорт не запускался') : null
                  return (
                  <tr key={f.id} className="border-t border-slate-200">
                    <td className="px-3 py-2 text-slate-500">{index + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        <span>{f.name}</span>
                      {duplicateMap.has(f.id) && (
                        <Badge variant="warning">Повтор</Badge>
                      )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{displayRun ? (
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={displayRun.status === 'success' ? 'default' : displayRun.status === 'partial' ? 'warning' : 'destructive'}>
                            {statusLabel(displayRun.status, displayRun.action)}
                          </Badge>
                          <span className="text-[10px] text-slate-500">{new Date(displayRun.started_at).toLocaleDateString('ru-RU')}</span>
                          {isDuplicateUrl && (
                            <span className="text-[10px] text-amber-600">Запуск у дубля URL</span>
                          )}
                          {displayRun.status !== 'success' && displayRun.error_log && (
                            <span className="text-[10px] text-rose-600">{String(displayRun.error_log).split('\n')[0]}</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-xs text-slate-600">{statusNote}</span>
                          {feedDiagnostics[f.id]?.items?.total ? (
                            <span className="text-[10px] text-slate-500">
                              Данных: {feedDiagnostics[f.id]?.items?.total}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{f.format}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {f.mode === 'url' ? (
                        <div className="flex flex-col">
                          <span className="text-[10px] text-slate-500">URL</span>
                          <span className="truncate max-w-[220px] block" title={f.url}>{f.url}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-[10px] text-slate-500">Файл</span>
                          <span className="text-slate-700">Загрузка файла</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {f.mapping ? Object.keys(f.mapping).length + ' полей' : 'Авто'}
                    </td>
                    <td className="px-3 py-2 sticky right-0 bg-white shadow-[-1px_0_0_#e2e8f0]">
                      <div className="ml-auto flex w-fit flex-col gap-2">
                        <Button
                          size="sm"
                          className="min-w-[110px]"
                          variant={displayRun ? "secondary" : "default"}
                          onClick={() => handleStartImport(f, true)}
                          disabled={!canRun}
                        >
                          {isPending ? 'Публикация…' : displayRun ? 'Импорт' : 'Запустить'}
                        </Button>
                        {f.mode === 'upload' && (
                          <label className="inline-flex items-center">
                            <input
                              type="file"
                              accept=".json,.csv,.xlsx,.xls,.xml"
                              className="hidden"
                              onChange={(e) => {
                                const selected = e.target.files?.[0] || null
                                if (!selected) return
                                setFile(selected)
                                handleStartImport(f)
                              }}
                            />
                            <span className="inline-flex">
                              <Button size="sm" className="min-w-[110px]" variant="secondary">Файл</Button>
                            </span>
                          </label>
                        )}
                        <Button size="sm" className="min-w-[110px]" variant="secondary" onClick={() => openEditFeed(f)}>
                          Настроить
                        </Button>
                        <Button size="sm" className="min-w-[110px] text-rose-600 bg-rose-50 hover:bg-rose-100" variant="secondary" onClick={() => handleDeleteFeed(f.id)}>
                          Удалить
                        </Button>
                      </div>
                    </td>
                  </tr>
                )})}
                {feeds.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                      Нет источников. Добавьте первый фид для начала работы.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-900">История импорта</div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[360px] overflow-y-auto">
              <table className="w-full min-w-[720px] md:min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Время</th>
                    <th className="px-3 py-2">Источник</th>
                    <th className="px-3 py-2">Действие</th>
                    <th className="px-3 py-2">Сущность</th>
                    <th className="px-3 py-2">Статус</th>
                    <th className="px-3 py-2">Статистика</th>
                    <th className="px-3 py-2">Ошибки</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRuns.map((r) => (
                    <tr key={r.id} className="border-t border-slate-200">
                      <td className="px-3 py-2 text-slate-700">
                        {new Date(r.started_at).toLocaleString('ru-RU')}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.feed_name || r.feed_file || r.feed_url || r.source_id}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {r.action === 'preview' ? 'Предпросмотр' : r.action === 'delete' ? 'Удаление' : 'Импорт'}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{r.entity}</td>
                      <td className="px-3 py-2 sticky right-0 bg-white shadow-[-1px_0_0_#e2e8f0]">
                        <Badge
                          variant={
                            r.status === 'success' ? 'default' :
                            r.status === 'partial' ? 'warning' :
                            'destructive'
                          }
                        >
                          {statusLabel(r.status, r.action)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        +{r.stats.inserted} / обновл. {r.stats.updated} / скрыто {r.stats.hidden}
                      </td>
                      <td className="px-3 py-2 sticky right-0 bg-white shadow-[-1px_0_0_#e2e8f0]">
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
                      <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                        История пуста
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {runs.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>Страница {runsPage} из {runsTotalPages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setRunsPage((p) => Math.max(1, p - 1))} disabled={runsPage === 1}>
                    Назад
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setRunsPage((p) => Math.min(runsTotalPages, p + 1))} disabled={runsPage === runsTotalPages}>
                    Вперёд
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

      {/* Import View */}
      <div className="space-y-6 border-t border-slate-200 pt-6">

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">
                Импорт{activeImportSource ? (
                  <>: <span className="break-words text-slate-900">{activeImportSource.name}</span></>
                ) : null}
              </div>
              <div className="text-xs text-slate-500">Настройте параметры и проверьте данные перед импортом.</div>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 items-end gap-3 md:grid-cols-4">
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

          {isPreviewMode && (
            <Modal
              open={isPreviewMode}
              onClose={closePreview}
              title="Предпросмотр"
              className="max-w-6xl"
            >
              {!preview ? (
                <div className="flex h-40 items-center justify-center text-sm text-slate-600">
                  {loading ? 'Загрузка предпросмотра...' : 'Нет данных для предпросмотра'}
                </div>
              ) : (
              <div className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="text-sm font-semibold">Предпросмотр</div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                    {previewContext?.sourceName && (
                      <div className="text-xs text-slate-500">
                        Источник: <span className="font-medium break-all text-slate-700">{previewContext.sourceName}</span>
                      </div>
                    )}
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={hideInvalid}
                        onChange={(e) => setHideInvalid(e.target.checked)}
                      />
                      Скрывать записи с ошибками
                    </label>
                    <div className="flex shrink-0 rounded bg-slate-200 p-1">
                      <button 
                        className={cn("px-3 py-1 text-xs rounded transition-colors", viewMode === 'table' ? "bg-white text-slate-900 shadow" : "text-slate-600 hover:text-slate-900")}
                        onClick={() => setViewMode('table')}
                      >
                        Таблица
                      </button>
                      <button 
                        className={cn("px-3 py-1 text-xs rounded transition-colors", viewMode === 'visual' ? "bg-white text-slate-900 shadow" : "text-slate-600 hover:text-slate-900")}
                        onClick={() => setViewMode('visual')}
                      >
                        Визуально
                      </button>
                    </div>
                    {viewMode === 'visual' && (
                      <div className="flex shrink-0 items-center gap-1">
                        {cardsPerRowOptions.map((count) => (
                          <button
                            key={count}
                            className={cn(
                              "px-2 py-1 text-xs rounded border transition-colors",
                              cardsPerRow === count
                                ? "bg-slate-900 text-white border-slate-900"
                                : "bg-white text-slate-600 border-slate-200 hover:text-slate-900"
                            )}
                            onClick={() => setCardsPerRow(count)}
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="w-full text-xs text-slate-600 sm:w-auto">
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
                        
                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
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
                  <div
                    className="grid min-w-0 max-h-[800px] gap-4 overflow-x-hidden overflow-y-auto p-2 sm:gap-6"
                    style={{ gridTemplateColumns: `repeat(${cardsPerRow}, minmax(0, 1fr))` }}
                  >
                    {preview.mappedItems.map((item, index) => (
                      <div key={index} className="group relative min-w-0">
                        {entity === 'property' ? <PropertyCard item={item as Property} showStatusBadge /> : <ComplexCard item={item as Complex} showStatusBadge />}
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <Button size="sm" onClick={() => handleEdit(index)}>Ред.</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end">
                  <Button variant="secondary" onClick={closePreview} className="w-full sm:w-auto">
                    Оставить
                  </Button>
                  <Button
                    onClick={runImport}
                    disabled={loading || (activeImportSource ? pendingSourceIds.has(activeImportSource.id) : false)}
                    className="w-full sm:w-auto"
                  >
                    {loading
                      ? 'Импорт…'
                      : (previewContext?.entity || entity) === 'complex'
                        ? 'Опубликовать и открыть настройку ЖК'
                        : 'Опубликовать'}
                  </Button>
                </div>
              </div>
              )}
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
      <Modal open={isFeedModalOpen} onClose={closeFeedModal} title={editingFeedId ? 'Редактирование источника' : 'Новый источник'}>
        <div className="space-y-4 max-h-[80vh] overflow-y-auto p-1">
          <div>
            <label className="text-xs font-medium text-slate-700">Название</label>
            <Input
              value={feedForm.name}
              onChange={(e) => {
                const next = e.target.value
                setFeedNameTouched(next.trim().length > 0)
                setFeedForm({ ...feedForm, name: next })
              }}
              placeholder="Например: Циан XML"
            />
          </div>
          
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
              <Input
                value={feedForm.url}
                onChange={(e) => setFeedForm({ ...feedForm, url: e.target.value })}
                placeholder="https://example.com/feed.xml"
              />
            </div>
          )}
          {feedForm.mode === 'upload' && (
            <div>
              <label className="text-xs font-medium text-slate-700">Файл фида</label>
              <input
                type="file"
                accept=".json,.csv,.xlsx,.xls,.xml"
                onChange={(e) => {
                  const selected = e.target.files?.[0] || null
                  setFeedFile(selected)
                  setFile(selected)
                  if (selected && !feedNameTouched) {
                    const suggested = normalizeFileName(selected.name)
                    if (suggested && suggested !== feedForm.name) {
                      setFeedForm((prev) => ({ ...prev, name: suggested }))
                    }
                  }
                }}
                className="text-sm w-full"
              />
              {feedFile && (
                <div className="mt-1 text-[10px] text-slate-500">Выбран файл: {feedFile.name}</div>
              )}
            </div>
          )}

          {duplicateFeed && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
              Такой фид уже загружен: <span className="font-medium">{duplicateFeed.name}</span>
            </div>
          )}

          <div className="border-t pt-4 mt-4">
            <button
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-left"
              onClick={() => setIsMappingExpanded((prev) => !prev)}
            >
              <span className="text-sm font-semibold">Маппинг полей</span>
              <span className="text-xs text-slate-500">
                {isMappingExpanded ? 'Свернуть' : `Развернуть${mappingFilledCount ? ` (${mappingFilledCount})` : ''}`}
              </span>
            </button>

            {isMappingExpanded ? (
              <div className="mt-3">
                <div className="mb-4 text-xs text-slate-500">
                  Укажите названия колонок в вашем фиде, соответствующие полям системы. Оставьте пустым для авто-определения.
                </div>

                <div className="space-y-2">
                  {MAPPING_CONFIG.map((field) => (
                    <div key={field.key} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-3">
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
            ) : (
              <div className="mt-2 text-xs text-slate-500">
                Маппинг скрыт для снижения нагрузки. Раскройте блок только при необходимости.
              </div>
            )}
          </div>

          <div className="pt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeFeedModal}>Отмена</Button>
            <Button
              onClick={handleSaveFeed}
              disabled={!feedForm.name || (feedForm.mode === 'upload' && !feedFile) || Boolean(duplicateFeed)}
            >
              Сохранить
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}



