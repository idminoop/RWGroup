import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { apiPost } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'

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
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-16">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Админка</div>
          <div className="mt-1 text-sm text-slate-600">Введите пароль администратора.</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="grid gap-3">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" type="password" />
            {error ? <div className="text-sm text-rose-600">{error}</div> : null}
            <Button onClick={submit} disabled={!password || loading}>
              {loading ? 'Вход…' : 'Войти'}
            </Button>
          </div>
          <div className="mt-4 text-xs text-slate-500">По умолчанию пароль: admin</div>
        </div>
      </div>
    </div>
  )
}

