import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { AdminPermission } from '../../../../shared/types'

type BackupKind = 'auto' | 'manual'

type BackupMeta = {
  id: string
  kind: BackupKind
  label?: string
  created_at: string
  created_by_admin_id?: string
  created_by_login?: string
  size_bytes: number
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function hasAnyPermission(permissionSet: Set<AdminPermission>, ...needed: AdminPermission[]): boolean {
  return needed.some((permission) => permissionSet.has(permission))
}

export default function AdminBackupsPage() {
  const token = useUiStore((s) => s.adminToken)
  const adminPermissions = useUiStore((s) => s.adminPermissions)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const permissionSet = useMemo(() => new Set(adminPermissions), [adminPermissions])

  const canRead = hasAnyPermission(permissionSet, 'publish.read', 'publish.apply')
  const canApply = hasAnyPermission(permissionSet, 'publish.apply')

  const [backups, setBackups] = useState<BackupMeta[]>([])
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token || !canRead) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<BackupMeta[]>('/api/admin/backups', headers)
      setBackups(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить бекапы')
    } finally {
      setLoading(false)
    }
  }, [canRead, headers, token])

  useEffect(() => {
    void load()
  }, [load])

  const createManual = async () => {
    if (!canApply || creating) return
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const created = await apiPost<BackupMeta>(
        '/api/admin/backups',
        {
          label: label.trim() || undefined,
        },
        headers,
      )
      setLabel('')
      setBackups((prev) => [created, ...prev])
      setNotice('Ручной бекап создан')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать бекап')
    } finally {
      setCreating(false)
    }
  }

  const restoreBackup = async (backup: BackupMeta) => {
    if (!canApply || busyId) return
    if (!window.confirm(`Восстановить бекап от ${new Date(backup.created_at).toLocaleString('ru-RU')}?`)) return
    setBusyId(backup.id)
    setError(null)
    setNotice(null)
    try {
      await apiPost<BackupMeta>(`/api/admin/backups/${backup.id}/restore`, {}, headers)
      setNotice('Черновой контент восстановлен из бекапа. Для выкладки на сайт нажмите "Применить изменения".')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось восстановить бекап')
    } finally {
      setBusyId(null)
    }
  }

  const deleteBackup = async (backup: BackupMeta) => {
    if (!canApply || busyId) return
    if (!window.confirm(`Удалить бекап "${backup.label || backup.id}"?`)) return
    setBusyId(backup.id)
    setError(null)
    setNotice(null)
    try {
      await apiDelete<{ id: string }>(`/api/admin/backups/${backup.id}`, headers)
      setBackups((prev) => prev.filter((item) => item.id !== backup.id))
      setNotice('Бекап удален')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить бекап')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6 text-slate-100">
      <div>
        <h2 className="text-xl font-semibold text-white">Бекапы контента</h2>
        <p className="mt-1 text-sm text-slate-400">
          Автобекап создается раз в день и хранится до 3 последних версий. Ручные бекапы хранятся, пока вы их не удалите.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0b1d2b]/60 p-4">
        <div className="mb-2 text-xs text-slate-400">Создать ручной бекап</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Метка (необязательно)"
            maxLength={120}
            disabled={!canApply || creating}
          />
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? 'Обновление...' : 'Обновить список'}
          </Button>
          <Button onClick={createManual} disabled={!canApply || creating}>
            {creating ? 'Создание...' : 'Создать бекап'}
          </Button>
        </div>
        {!canApply ? (
          <div className="mt-2 text-xs text-slate-500">У вас только просмотр бекапов. Восстановление/удаление недоступно.</div>
        ) : null}
      </div>

      {error ? <div className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm text-rose-300">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{notice}</div> : null}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Метка</th>
              <th className="px-3 py-2">Создан</th>
              <th className="px-3 py-2">Кем</th>
              <th className="px-3 py-2">Размер</th>
              <th className="px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {!loading && backups.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                  Бекапов пока нет
                </td>
              </tr>
            ) : null}
            {backups.map((backup) => {
              const isBusy = busyId === backup.id
              return (
                <tr key={backup.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-3">
                    <span
                      className={
                        backup.kind === 'auto'
                          ? 'inline-block rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-300'
                          : 'inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300'
                      }
                    >
                      {backup.kind === 'auto' ? 'Авто' : 'Ручной'}
                    </span>
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-3 text-slate-200" title={backup.label || backup.id}>
                    {backup.label || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-300">
                    {new Date(backup.created_at).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-3 py-3 text-slate-300">{backup.created_by_login || 'system'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-400">{formatSize(backup.size_bytes)}</td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void restoreBackup(backup)}
                        disabled={!canApply || isBusy}
                      >
                        {isBusy ? '...' : 'Восстановить'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void deleteBackup(backup)}
                        disabled={!canApply || isBusy}
                      >
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
