import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { apiGet, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { HomeContent } from '../../../../shared/types'

export default function AdminHomePage() {
  const token = useUiStore((s) => s.adminToken)
  const [home, setHome] = useState<HomeContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  useEffect(() => {
    setLoading(true)
    apiGet<HomeContent>('/api/admin/home', headers)
      .then(setHome)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false))
  }, [headers])

  const save = async () => {
    if (!home) return
    setSaving(true)
    setError(null)
    try {
      await apiPut<unknown>('/api/admin/home', { home }, headers)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="h-40 animate-pulse rounded-lg bg-slate-50" />
  if (!home) return <div className="text-sm text-slate-600">Нет данных</div>

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold">Витрина</div>
        <div className="mt-1 text-sm text-slate-600">Быстро редактируйте заголовки и тексты (обновление без фидов).</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-700">Hero: заголовок</div>
          <Input value={home.hero.title} onChange={(e) => setHome({ ...home, hero: { ...home.hero, title: e.target.value } })} />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-700">Hero: подзаголовок</div>
          <Input value={home.hero.subtitle} onChange={(e) => setHome({ ...home, hero: { ...home.hero, subtitle: e.target.value } })} />
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-slate-700">Миссия: текст</div>
        <textarea
          value={home.mission.text}
          onChange={(e) => setHome({ ...home, mission: { ...home.mission, text: e.target.value } })}
          className="min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400"
        />
      </div>

      {error ? <div className="text-sm text-rose-600">{error}</div> : null}
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </div>
    </div>
  )
}
