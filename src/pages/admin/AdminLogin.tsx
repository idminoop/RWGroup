import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { apiPost } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { AdminPermission, AdminRole } from '../../../shared/types'

const UI = {
  title: 'Админка RW Group',
  subtitle: 'Войдите по логину и паролю.',
  error: 'Ошибка',
  login: 'Логин',
  password: 'Пароль',
  submit: 'Войти',
  loading: 'Вход...',
  hint:
    'По умолчанию: admin/admin. Owner может изменять доступы в разделе пользователей.',
}

type LoginResponse = {
  token: string
  id: string
  login: string
  roles: AdminRole[]
  permissions: AdminPermission[]
}

export default function AdminLoginPage() {
  const nav = useNavigate()
  const setAdminSession = useUiStore((s) => s.setAdminSession)
  const [login, setLogin] = useState('admin')
  const [password, setPassword] = useState('admin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmedLogin = login.trim()
    if (!trimmedLogin || !password) return

    setLoading(true)
    setError(null)
    try {
      const data = await apiPost<LoginResponse>('/api/admin/login', { login: trimmedLogin, password })
      setAdminSession({
        token: data.token,
        id: data.id,
        login: data.login,
        roles: data.roles,
        permissions: data.permissions,
      })
      nav('/admin', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : UI.error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-shell min-h-screen">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-16">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-white">{UI.title}</div>
          <div className="mt-1 text-sm text-slate-300">{UI.subtitle}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0b1d2b]/80 p-6 backdrop-blur-md">
          <div className="grid gap-3">
            <div>
              <div className="mb-1 text-xs font-medium text-slate-300">{UI.login}</div>
              <Input value={login} onChange={(e) => setLogin(e.target.value)} placeholder={UI.login} autoComplete="username" />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-slate-300">{UI.password}</div>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={UI.password}
                type="password"
                autoComplete="current-password"
              />
            </div>
            {error ? <div className="text-sm text-rose-300">{error}</div> : null}
            <Button onClick={submit} disabled={!login.trim() || !password || loading}>
              {loading ? UI.loading : UI.submit}
            </Button>
          </div>
          <div className="mt-4 text-xs text-slate-400">{UI.hint}</div>
        </div>
      </div>
    </div>
  )
}
