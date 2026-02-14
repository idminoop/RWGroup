import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { AdminRole, AdminUserPublic } from '../../../../shared/types'

type UserDraft = {
  login: string
  roles: AdminRole[]
  is_active: boolean
  password: string
}

const ROLE_OPTIONS: Array<{ value: AdminRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'content', label: 'Content' },
  { value: 'import', label: 'Import' },
  { value: 'sales', label: 'Sales' },
]

const LOGIN_PATTERN = /^[a-zA-Z0-9._-]+$/

function normalizeRoles(input: AdminRole[]): AdminRole[] {
  const set = new Set(input)
  return ROLE_OPTIONS.map((item) => item.value).filter((role) => set.has(role))
}

function rolesEqual(left: AdminRole[], right: AdminRole[]): boolean {
  const a = normalizeRoles(left)
  const b = normalizeRoles(right)
  if (a.length !== b.length) return false
  return a.every((role, index) => role === b[index])
}

function toggleRole(list: AdminRole[], role: AdminRole, checked: boolean): AdminRole[] {
  const set = new Set(list)
  if (checked) set.add(role)
  else set.delete(role)
  return normalizeRoles(Array.from(set))
}

function nextDraft(user: AdminUserPublic): UserDraft {
  return {
    login: user.login,
    roles: normalizeRoles(user.roles),
    is_active: user.is_active,
    password: '',
  }
}

export default function AdminUsersPage() {
  const token = useUiStore((s) => s.adminToken)
  const currentUserId = useUiStore((s) => s.adminId)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [users, setUsers] = useState<AdminUserPublic[]>([])
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({})
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [newLogin, setNewLogin] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRoles, setNewRoles] = useState<AdminRole[]>(['content'])
  const [newIsActive, setNewIsActive] = useState(true)
  const [creating, setCreating] = useState(false)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<AdminUserPublic[]>('/api/admin/users', headers)
      setUsers(data)
      setDrafts(
        data.reduce<Record<string, UserDraft>>((acc, user) => {
          acc[user.id] = nextDraft(user)
          return acc
        }, {}),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить пользователей')
    } finally {
      setLoading(false)
    }
  }, [headers])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const setDraft = (id: string, patch: Partial<UserDraft>) => {
    setDrafts((prev) => {
      const current = prev[id]
      if (!current) return prev
      return { ...prev, [id]: { ...current, ...patch } }
    })
  }

  const createUser = async () => {
    const login = newLogin.trim().toLowerCase()
    const roles = normalizeRoles(newRoles)
    if (!login || !newPassword) return
    if (!roles.length) {
      setError('Нужно выбрать хотя бы одну роль')
      return
    }
    if (!LOGIN_PATTERN.test(login)) {
      setError('Логин: только a-z, 0-9, ., _, -')
      return
    }

    setCreating(true)
    setError(null)
    try {
      const created = await apiPost<AdminUserPublic>(
        '/api/admin/users',
        { login, password: newPassword, roles, is_active: newIsActive },
        headers,
      )
      setUsers((prev) => [...prev, created].sort((a, b) => a.login.localeCompare(b.login)))
      setDrafts((prev) => ({ ...prev, [created.id]: nextDraft(created) }))
      setNewLogin('')
      setNewPassword('')
      setNewRoles(['content'])
      setNewIsActive(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать пользователя')
    } finally {
      setCreating(false)
    }
  }

  const saveUser = async (user: AdminUserPublic) => {
    const draft = drafts[user.id]
    if (!draft) return

    const normalizedLogin = draft.login.trim().toLowerCase()
    const normalizedRoles = normalizeRoles(draft.roles)
    if (!normalizedLogin) {
      setError('Логин не может быть пустым')
      return
    }
    if (!normalizedRoles.length) {
      setError('Нужно выбрать хотя бы одну роль')
      return
    }
    if (!LOGIN_PATTERN.test(normalizedLogin)) {
      setError('Логин: только a-z, 0-9, ., _, -')
      return
    }

    const patch: Record<string, unknown> = {}
    if (normalizedLogin !== user.login) patch.login = normalizedLogin
    if (!rolesEqual(normalizedRoles, user.roles)) patch.roles = normalizedRoles
    if (draft.is_active !== user.is_active) patch.is_active = draft.is_active
    if (draft.password.trim()) patch.password = draft.password
    if (!Object.keys(patch).length) return

    setSavingId(user.id)
    setError(null)
    try {
      const updated = await apiPut<AdminUserPublic>(`/api/admin/users/${user.id}`, patch, headers)
      setUsers((prev) =>
        prev
          .map((item) => (item.id === updated.id ? updated : item))
          .sort((a, b) => a.login.localeCompare(b.login)),
      )
      setDrafts((prev) => ({ ...prev, [updated.id]: nextDraft(updated) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить изменения')
    } finally {
      setSavingId((prev) => (prev === user.id ? null : prev))
    }
  }

  const deleteUser = async (user: AdminUserPublic) => {
    if (!window.confirm(`Удалить пользователя ${user.login}?`)) return
    setSavingId(user.id)
    setError(null)
    try {
      await apiDelete<unknown>(`/api/admin/users/${user.id}`, headers)
      setUsers((prev) => prev.filter((item) => item.id !== user.id))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[user.id]
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить пользователя')
    } finally {
      setSavingId((prev) => (prev === user.id ? null : prev))
    }
  }

  return (
    <div className="space-y-6 text-slate-100">
      <div>
        <div className="text-sm font-semibold">Пользователи и роли</div>
        <div className="mt-1 text-sm text-slate-400">
          Owner управляет логинами, паролями и набором ролей для каждого пользователя.
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0b1d2b]/60 p-4">
        <div className="mb-3 text-xs font-medium text-slate-300">Новый пользователь</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_1fr_1.5fr_auto_auto] md:items-end">
          <div>
            <div className="mb-1 text-xs text-slate-400">Логин</div>
            <Input value={newLogin} onChange={(e) => setNewLogin(e.target.value)} placeholder="user_login" />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-400">Пароль</div>
            <Input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="password"
              type="password"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-400">Роли</div>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-white/10 p-2 text-xs">
              {ROLE_OPTIONS.map((role) => (
                <label key={role.value} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newRoles.includes(role.value)}
                    onChange={(e) => setNewRoles((prev) => toggleRole(prev, role.value, e.target.checked))}
                  />
                  {role.label}
                </label>
              ))}
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={newIsActive} onChange={(e) => setNewIsActive(e.target.checked)} />
            Active
          </label>
          <Button onClick={createUser} disabled={creating || !newLogin.trim() || !newPassword || !newRoles.length}>
            {creating ? 'Создание...' : 'Создать'}
          </Button>
        </div>
      </div>

      {error ? <div className="text-sm text-rose-300">{error}</div> : null}
      {loading ? (
        <div className="h-28 animate-pulse rounded-lg bg-white/5" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[1020px] text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2">Логин</th>
                <th className="px-3 py-2">Роли</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">Новый пароль</th>
                <th className="px-3 py-2">Обновлен</th>
                <th className="px-3 py-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const draft = drafts[user.id] || nextDraft(user)
                const disabled = savingId === user.id
                return (
                  <tr key={user.id} className="border-t border-white/10">
                    <td className="px-3 py-2">
                      <Input value={draft.login} onChange={(e) => setDraft(user.id, { login: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="grid grid-cols-2 gap-2 rounded-md border border-white/10 p-2 text-xs">
                        {ROLE_OPTIONS.map((role) => (
                          <label key={role.value} className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={draft.roles.includes(role.value)}
                              onChange={(e) => {
                                setDraft(user.id, { roles: toggleRole(draft.roles, role.value, e.target.checked) })
                              }}
                            />
                            {role.label}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={draft.is_active}
                          onChange={(e) => setDraft(user.id, { is_active: e.target.checked })}
                        />
                        {draft.is_active ? 'on' : 'off'}
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={draft.password}
                        type="password"
                        placeholder="leave empty"
                        onChange={(e) => setDraft(user.id, { password: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {new Date(user.updated_at).toLocaleString('ru-RU')}
                      {user.id === currentUserId ? ' (you)' : ''}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => void saveUser(user)} disabled={disabled}>
                          {disabled ? 'Сохр...' : 'Сохранить'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => void deleteUser(user)} disabled={disabled}>
                          Удалить
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {users.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-slate-400" colSpan={6}>
                    Нет пользователей
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
