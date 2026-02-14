import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import Button from '@/components/ui/Button'
import type { AuditAction, AuditEntity, AuditLog } from '../../../../shared/types'

type LogsResponse = {
  items: AuditLog[]
  total: number
  page: number
  limit: number
}

const ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Создание',
  update: 'Редактирование',
  delete: 'Удаление',
  login: 'Вход',
  publish: 'Публикация',
  import: 'Импорт',
}

const ACTION_COLORS: Record<AuditAction, string> = {
  create: 'bg-emerald-500/20 text-emerald-300',
  update: 'bg-blue-500/20 text-blue-300',
  delete: 'bg-rose-500/20 text-rose-300',
  login: 'bg-slate-500/20 text-slate-300',
  publish: 'bg-violet-500/20 text-violet-300',
  import: 'bg-amber-500/20 text-amber-300',
}

const ENTITY_LABELS: Record<AuditEntity, string> = {
  property: 'Лот',
  complex: 'ЖК',
  collection: 'Подборка',
  feed: 'Источник',
  lead: 'Лид',
  user: 'Пользователь',
  home: 'Витрина',
  settings: 'Настройки',
}

const LIMIT = 30

export default function AdminLogsPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [entityFilter, setEntityFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')

  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (entityFilter) params.set('entity', entityFilter)
      if (actionFilter) params.set('action', actionFilter)
      const data = await apiGet<LogsResponse>(`/api/admin/logs?${params}`, headers)
      setLogs(data.items)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки логов')
    } finally {
      setLoading(false)
    }
  }, [actionFilter, entityFilter, headers, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [entityFilter, actionFilter])

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold text-white">Логи действий</h2>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-white/10 bg-[#0d2238] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">Все действия</option>
          {(Object.keys(ACTION_LABELS) as AuditAction[]).map((key) => (
            <option key={key} value={key}>{ACTION_LABELS[key]}</option>
          ))}
        </select>

        <select
          className="rounded-lg border border-white/10 bg-[#0d2238] px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
        >
          <option value="">Все сущности</option>
          {(Object.keys(ENTITY_LABELS) as AuditEntity[]).map((key) => (
            <option key={key} value={key}>{ENTITY_LABELS[key]}</option>
          ))}
        </select>

        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? 'Загрузка…' : 'Обновить'}
        </Button>
      </div>

      {error && <div className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm text-rose-300">{error}</div>}

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs uppercase text-slate-400">
              <th className="px-4 py-3">Время</th>
              <th className="px-4 py-3">Пользователь</th>
              <th className="px-4 py-3">Действие</th>
              <th className="px-4 py-3">Сущность</th>
              <th className="px-4 py-3">Описание</th>
              <th className="px-4 py-3">Детали</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Нет записей
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                  {new Date(log.timestamp).toLocaleString('ru-RU')}
                </td>
                <td className="px-4 py-3 text-slate-200">{log.admin_login}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] || 'bg-slate-500/20 text-slate-300'}`}>
                    {ACTION_LABELS[log.action] || log.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {ENTITY_LABELS[log.entity] || log.entity}
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-slate-300" title={log.description}>
                  {log.description}
                </td>
                <td className="max-w-[200px] truncate px-4 py-3 text-xs text-slate-500" title={log.details || ''}>
                  {log.details || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > LIMIT && (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            Страница {page} из {totalPages} · Всего: {total}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              Назад
            </Button>
            <Button variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Вперёд
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
