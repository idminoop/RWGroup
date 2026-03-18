import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { apiGet, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { HomeContent } from '../../../../shared/types'

export default function AdminMapSettingsPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiGet<HomeContent>('/api/admin/home', headers)
      .then((home) => setApiKey((home.maps?.yandex_maps_api_key || '').trim()))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки настроек'))
      .finally(() => setLoading(false))
  }, [headers])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await apiPut<unknown>('/api/admin/home', {
        home: {
          maps: {
            yandex_maps_api_key: apiKey.trim(),
          },
        },
      }, headers)
      setSavedAt(new Date().toISOString())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="h-40 animate-pulse rounded-lg bg-white/5" />
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-base font-semibold text-white">Карты</div>
        <div className="mt-1 text-sm text-slate-300">
          Укажите API-ключ Яндекс.Карт для публичной карты ЖК. После сохранения ключ начнет использоваться картой.
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <label className="mb-2 block text-xs uppercase tracking-wide text-slate-300">API-ключ Яндекс.Карт</label>
        <Input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Введите API-ключ"
          className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
        />
        <div className="mt-2 space-y-1 text-xs text-slate-400">
          <div>Используется для публичной карты ЖК (JavaScript API) и для автоматического поиска мест поблизости (Search API HTTP).</div>
          <div>Создайте ключ в кабинете разработчика Яндекса и убедитесь, что для него включены сервисы <strong className="text-slate-300">JavaScript API</strong> и <strong className="text-slate-300">Search API HTTP</strong>.</div>
        </div>
      </div>

      {error ? <div className="text-sm text-rose-300">{error}</div> : null}
      {savedAt ? <div className="text-xs text-emerald-300">Сохранено: {new Date(savedAt).toLocaleString('ru-RU')}</div> : null}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>
    </div>
  )
}
