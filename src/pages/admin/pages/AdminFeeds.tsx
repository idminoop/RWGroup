import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { apiGet, apiPost } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { FeedSource } from '../../../../shared/types'

export default function AdminFeedsPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const [list, setList] = useState<FeedSource[]>([])
  const [name, setName] = useState('')
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'xml' | 'json'>('json')
  const [mode, setMode] = useState<'upload' | 'url'>('upload')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiGet<FeedSource[]>('/api/admin/feeds', headers)
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
  }, [headers])

  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    setError(null)
    try {
      await apiPost<{ id: string }>('/api/admin/feeds', { name, format, mode, url: mode === 'url' ? url : undefined }, headers)
      setName('')
      setUrl('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold">Фиды</div>
        <div className="mt-1 text-sm text-slate-600">Заведите источники и используйте их в импорте.</div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название источника" />
        <Select
          value={format}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'json' || v === 'csv' || v === 'xlsx' || v === 'xml') setFormat(v)
          }}
        >
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="xlsx">XLSX</option>
          <option value="xml">XML</option>
        </Select>
        <Select
          value={mode}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'upload' || v === 'url') setMode(v)
          }}
        >
          <option value="upload">Загрузка файла</option>
          <option value="url">По URL</option>
        </Select>
        <Button onClick={create} disabled={!name.trim()}>
          Добавить
        </Button>
      </div>

      {mode === 'url' ? (
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL фида" />
      ) : null}

      {error ? <div className="text-sm text-rose-600">{error}</div> : null}

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">Название</th>
              <th className="px-3 py-2">Формат</th>
              <th className="px-3 py-2">Режим</th>
            </tr>
          </thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.id} className="border-t border-slate-200">
                <td className="px-3 py-2 font-medium text-slate-900">{f.name}</td>
                <td className="px-3 py-2 text-slate-700">{f.format}</td>
                <td className="px-3 py-2 text-slate-700">{f.mode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
