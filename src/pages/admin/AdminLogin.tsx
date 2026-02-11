import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { apiPost } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'

const UI = {
  title: 'Админка',
  subtitle: 'Введите пароль администратора.',
  error: 'Ошибка',
  password: 'Пароль',
  login: 'Войти',
  loading: 'Вход…',
  hint: 'По умолчанию пароль: admin',
}

export default function AdminLoginPage() {
  const nav = useNavigate()
  const setAdminToken = useUiStore((s) => s.setAdminToken)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiPost<{ token: string }>('/api/admin/login', { password })
      setAdminToken(data.token)
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
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={UI.password} type="password" />
            {error ? <div className="text-sm text-rose-300">{error}</div> : null}
            <Button onClick={submit} disabled={!password || loading}>
              {loading ? UI.loading : UI.login}
            </Button>
          </div>
          <div className="mt-4 text-xs text-slate-400">{UI.hint}</div>
        </div>
      </div>
    </div>
  )
}
