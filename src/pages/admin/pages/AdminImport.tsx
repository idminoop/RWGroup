import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import { apiGet } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { FeedSource, ImportRun } from '../../../../shared/types'

export default function AdminImportPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const [feeds, setFeeds] = useState<FeedSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [entity, setEntity] = useState<'property' | 'complex'>('property')
  const [file, setFile] = useState<File | null>(null)
  const [runs, setRuns] = useState<ImportRun[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiGet<FeedSource[]>('/api/admin/feeds', headers).then((d) => {
      setFeeds(d)
      if (!sourceId && d[0]) setSourceId(d[0].id)
    })
    apiGet<ImportRun[]>('/api/admin/import/runs', headers).then(setRuns).catch(() => setRuns([]))
  }, [headers, sourceId])

  useEffect(() => {
    load()
  }, [load])

  const runImport = async () => {
    if (!file || !sourceId) return
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('source_id', sourceId)
      fd.append('entity', entity)
      const res = await fetch('/api/admin/import/run', {
        method: 'POST',
        headers: { 'x-admin-token': token || '' },
        body: fd,
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Import failed')
      setFile(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold">Импорт</div>
        <div className="mt-1 text-sm text-slate-600">Загрузите файл фида и обновите записи по external_id + source_id.</div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {feeds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        <Select
          value={entity}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'property' || v === 'complex') setEntity(v)
          }}
        >
          <option value="property">Лоты</option>
          <option value="complex">ЖК</option>
        </Select>
        <input
          type="file"
          accept=".json,.csv,.xlsx,.xls,.xml"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="text-sm"
        />
      </div>
      <div className="flex items-center justify-end">
        <Button onClick={runImport} disabled={!file || !sourceId || loading}>
          {loading ? 'Импорт…' : 'Запустить импорт'}
        </Button>
      </div>

      {error ? <div className="text-sm text-rose-600">{error}</div> : null}

      <div>
        <div className="mb-3 text-sm font-semibold text-slate-900">Прогоны</div>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2">Время</th>
                <th className="px-3 py-2">Сущность</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">Статистика</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 text-slate-700">{new Date(r.started_at).toLocaleString('ru-RU')}</td>
                  <td className="px-3 py-2 text-slate-700">{r.entity}</td>
                  <td className="px-3 py-2 text-slate-700">{r.status}</td>
                  <td className="px-3 py-2 text-slate-700">
                    +{r.stats.inserted} / обновл. {r.stats.updated} / скрыто {r.stats.hidden}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
