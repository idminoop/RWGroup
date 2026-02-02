import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { apiGet, apiPost, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { Collection } from '../../../../shared/types'

export default function AdminCollectionsPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const [list, setList] = useState<Collection[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const create = async () => {
    setError(null)
    try {
      await apiPost<{ id: string }>('/api/admin/collections', { title }, headers)
      setTitle('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const updatePriority = async (id: string, priority: number) => {
    setError(null)
    try {
      await apiPut<unknown>(`/api/admin/collections/${id}`, { priority }, headers)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold">Подборки</div>
        <div className="mt-1 text-sm text-slate-600">Создавайте подборки и выставляйте приоритет.</div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название подборки" />
        <Button onClick={create} disabled={!title.trim()}>
          Создать
        </Button>
      </div>

      {error ? <div className="text-sm text-rose-600">{error}</div> : null}

      {loading ? (
        <div className="h-32 animate-pulse rounded-lg bg-slate-50" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2">Название</th>
                <th className="px-3 py-2">Приоритет</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-medium text-slate-900">{c.title}</td>
                  <td className="px-3 py-2">
                    <Input
                      value={String(c.priority)}
                      inputMode="numeric"
                      onChange={(e) => updatePriority(c.id, Number(e.target.value || 0))}
                      className="h-9 max-w-28"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
