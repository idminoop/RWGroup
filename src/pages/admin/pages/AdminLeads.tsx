import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { apiGet, apiPost, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { Lead, LeadStatus } from '../../../../shared/types'

type LeadStatusFilter = LeadStatus | 'all'
type BackupKind = 'auto' | 'manual'

type LeadProcessingBackupMeta = {
  id: string
  kind: BackupKind
  label?: string
  created_at: string
  snapshot_leads_count: number
}

type LeadProcessingRestoreResult = {
  backup_id: string
  total_snapshot: number
  applied: number
  unchanged: number
  missing: number
}

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  done: 'Закрыт',
  spam: 'Спам',
}

export default function AdminLeadsPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [list, setList] = useState<Lead[]>([])
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<LeadStatusFilter>('all')
  const [query, setQuery] = useState('')

  const [restoreOptions, setRestoreOptions] = useState<LeadProcessingBackupMeta[]>([])
  const [selectedBackupId, setSelectedBackupId] = useState('')
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null)

  const labelType = (lead: Lead) => {
    switch (lead.form_type) {
      case 'consultation':
        return 'Консультация'
      case 'buy_sell':
        return `Купить / Продать${lead.tab ? `: ${lead.tab === 'buy' ? 'покупка' : 'продажа'}` : ''}`
      case 'view_details':
        return 'Запрос по объекту'
      case 'partner':
        return 'Партнерство'
      default:
        return lead.form_type
    }
  }

  const loadLeads = useCallback(() => {
    apiGet<Lead[]>('/api/admin/leads', headers)
      .then((rows) => setList(rows))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
  }, [headers])

  const loadRestoreOptions = useCallback(() => {
    apiGet<LeadProcessingBackupMeta[]>('/api/admin/leads/processing-backups', headers)
      .then((rows) => {
        setRestoreOptions(rows)
        setSelectedBackupId((prev) => prev || rows[0]?.id || '')
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки бекапов лидов'))
  }, [headers])

  useEffect(() => {
    loadLeads()
    loadRestoreOptions()
  }, [loadLeads, loadRestoreOptions])

  const patchLeadLocal = (id: string, patch: Partial<Lead>) => {
    setList((prev) => prev.map((lead) => (lead.id === id ? { ...lead, ...patch } : lead)))
  }

  const updateLead = async (
    id: string,
    patch: { lead_status?: LeadStatus; assignee?: string; admin_note?: string },
  ) => {
    setUpdatingId(id)
    setError(null)
    try {
      const updated = await apiPut<Lead>(`/api/admin/leads/${id}`, patch, headers)
      patchLeadLocal(id, updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения лида')
      loadLeads()
    } finally {
      setUpdatingId((prev) => (prev === id ? null : prev))
    }
  }

  const restoreLeadProcessing = async () => {
    if (!selectedBackupId || restoreLoading || restoreOptions.length === 0) return
    if (
      !window.confirm(
        'Восстановить обработку лидов из выбранного бекапа? Новые лиды не удаляются.',
      )
    ) {
      return
    }

    setRestoreLoading(true)
    setError(null)
    setRestoreNotice(null)
    try {
      const result = await apiPost<LeadProcessingRestoreResult>(
        '/api/admin/leads/restore-processing',
        { backup_id: selectedBackupId },
        headers,
      )
      setRestoreNotice(
        `Готово: применено ${result.applied}, без изменений ${result.unchanged}, отсутствуют ${result.missing}, всего в снимке ${result.total_snapshot}.`,
      )
      loadLeads()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка восстановления обработки лидов')
    } finally {
      setRestoreLoading(false)
    }
  }

  const counters = useMemo(() => {
    return list.reduce(
      (acc, lead) => {
        const status = lead.lead_status || 'new'
        acc.all += 1
        acc[status] += 1
        return acc
      },
      { all: 0, new: 0, in_progress: 0, done: 0, spam: 0 } as Record<LeadStatusFilter, number>,
    )
  }, [list])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list.filter((lead) => {
      const leadStatus = lead.lead_status || 'new'
      if (statusFilter !== 'all' && leadStatus !== statusFilter) return false
      if (!q) return true

      const text = [
        lead.name,
        lead.phone,
        lead.comment || '',
        lead.admin_note || '',
        lead.assignee || '',
        lead.source.page,
        lead.source.block || '',
        lead.source.object_id || '',
      ]
        .join(' ')
        .toLowerCase()

      return text.includes(q)
    })
  }, [list, query, statusFilter])

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold">CRM лидов</div>
        <div className="mt-1 text-sm text-slate-600">Контроль заявок, статусов и ответственных.</div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="text-xs font-medium text-slate-700">
          Восстановление обработки лидов из бекапа
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Select value={selectedBackupId} onChange={(e) => setSelectedBackupId(e.target.value)}>
            {restoreOptions.length === 0 ? <option value="">Нет доступных бекапов</option> : null}
            {restoreOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {new Date(item.created_at).toLocaleString('ru-RU')} ·{' '}
                {item.kind === 'manual' ? 'Ручной' : 'Авто'} · {item.label || item.id} · лидов:{' '}
                {item.snapshot_leads_count}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={loadRestoreOptions}>
            Обновить бекапы
          </Button>
          <Button
            onClick={restoreLeadProcessing}
            disabled={!selectedBackupId || restoreLoading || restoreOptions.length === 0}
          >
            {restoreLoading ? 'Восстановление...' : 'Восстановить обработку'}
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-slate-500">
          Обновляются только поля обработки (`status`, `assignee`, `admin_note`) у уже существующих лидов.
        </div>
        {restoreNotice ? <div className="mt-2 text-xs text-emerald-700">{restoreNotice}</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <Stat title="Все" value={counters.all} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <Stat title="Новые" value={counters.new} active={statusFilter === 'new'} onClick={() => setStatusFilter('new')} />
        <Stat
          title="В работе"
          value={counters.in_progress}
          active={statusFilter === 'in_progress'}
          onClick={() => setStatusFilter('in_progress')}
        />
        <Stat title="Закрыты" value={counters.done} active={statusFilter === 'done'} onClick={() => setStatusFilter('done')} />
        <Stat title="Спам" value={counters.spam} active={statusFilter === 'spam'} onClick={() => setStatusFilter('spam')} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Фильтр статуса</label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as LeadStatusFilter)}>
            <option value="all">Все</option>
            <option value="new">Новые</option>
            <option value="in_progress">В работе</option>
            <option value="done">Закрытые</option>
            <option value="spam">Спам</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Поиск</label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя, телефон, источник, комментарий..."
          />
        </div>
      </div>

      {error ? <div className="text-sm text-rose-600">{error}</div> : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">Время</th>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Имя</th>
              <th className="px-3 py-2">Телефон</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Ответственный</th>
              <th className="px-3 py-2">Заметка</th>
              <th className="px-3 py-2">Источник</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead) => (
              <tr key={lead.id} className="border-t border-slate-200">
                <td className="px-3 py-2 text-slate-700">{new Date(lead.created_at).toLocaleString('ru-RU')}</td>
                <td className="px-3 py-2 text-slate-700">{labelType(lead)}</td>
                <td className="px-3 py-2 font-medium text-slate-900">{lead.name}</td>
                <td className="px-3 py-2 text-slate-700">{lead.phone}</td>
                <td className="px-3 py-2">
                  <Select
                    value={lead.lead_status || 'new'}
                    onChange={(e) => {
                      const next = e.target.value as LeadStatus
                      patchLeadLocal(lead.id, { lead_status: next })
                      void updateLead(lead.id, { lead_status: next })
                    }}
                    className="h-9 min-w-[130px]"
                  >
                    <option value="new">{STATUS_LABELS.new}</option>
                    <option value="in_progress">{STATUS_LABELS.in_progress}</option>
                    <option value="done">{STATUS_LABELS.done}</option>
                    <option value="spam">{STATUS_LABELS.spam}</option>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={lead.assignee || ''}
                    placeholder="Менеджер"
                    className="h-9 min-w-[130px]"
                    onChange={(e) => patchLeadLocal(lead.id, { assignee: e.target.value })}
                    onBlur={(e) => void updateLead(lead.id, { assignee: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={lead.admin_note || ''}
                    placeholder={
                      lead.comment?.trim()
                        ? `Клиент: ${lead.comment}`
                        : 'Комментарий по обработке'
                    }
                    className="h-9 min-w-[220px]"
                    onChange={(e) => patchLeadLocal(lead.id, { admin_note: e.target.value })}
                    onBlur={(e) => void updateLead(lead.id, { admin_note: e.target.value })}
                  />
                  {updatingId === lead.id ? (
                    <div className="mt-1 text-[10px] text-slate-500">Сохранение...</div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {lead.source.page}
                  {lead.source.block ? ` / ${lead.source.block}` : ''}
                  {lead.source.object_id ? ` / ${lead.source.object_id}` : ''}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({
  title,
  value,
  active,
  onClick,
}: {
  title: string
  value: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-lg border border-primary/40 bg-primary/10 p-3 text-left'
          : 'rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-slate-300'
      }
    >
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </button>
  )
}
