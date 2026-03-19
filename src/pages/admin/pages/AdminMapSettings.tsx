import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { apiGet, apiPut } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import type { HomeContent } from '../../../../shared/types'

type ApiStatus = 'ok' | 'auth_error' | 'error' | 'no_key'
type CheckResult = { has_key: boolean; geocoder: ApiStatus; search: ApiStatus }

function StatusBadge({ status, label }: { status: ApiStatus; label: string }) {
  const config: Record<ApiStatus, { bg: string; dot: string; text: string }> = {
    ok:         { bg: 'bg-emerald-500/15 border-emerald-500/30', dot: 'bg-emerald-400', text: 'text-emerald-300' },
    auth_error: { bg: 'bg-rose-500/15 border-rose-500/30',      dot: 'bg-rose-400',    text: 'text-rose-300' },
    error:      { bg: 'bg-amber-500/15 border-amber-500/30',    dot: 'bg-amber-400',   text: 'text-amber-300' },
    no_key:     { bg: 'bg-white/5 border-white/10',             dot: 'bg-white/30',    text: 'text-white/40' },
  }
  const statusText: Record<ApiStatus, string> = {
    ok:         'Работает',
    auth_error: 'Ключ не принят (403)',
    error:      'Ошибка запроса',
    no_key:     'Ключ не задан',
  }
  const c = config[status]
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${c.bg}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`} />
      <span className="text-xs text-white/60">{label}</span>
      <span className={`ml-auto text-xs font-semibold ${c.text}`}>{statusText[status]}</span>
    </div>
  )
}

export default function AdminMapSettingsPage() {
  const token = useUiStore((s) => s.adminToken)
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

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
    setCheckResult(null)
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

  const checkKey = async () => {
    setChecking(true)
    setCheckResult(null)
    setCheckError(null)
    try {
      const result = await apiGet<CheckResult>('/api/admin/yandex-key/check', headers)
      setCheckResult(result)
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : 'Ошибка проверки')
    } finally {
      setChecking(false)
    }
  }

  if (loading) {
    return <div className="h-40 animate-pulse rounded-lg bg-white/5" />
  }

  const allOk = checkResult?.geocoder === 'ok' && checkResult?.search === 'ok'
  const hasKeyIssue = checkResult && !checkResult.has_key

  return (
    <div className="space-y-5">
      <div>
        <div className="text-base font-semibold text-white">Карты</div>
        <div className="mt-1 text-sm text-slate-300">
          API-ключ Яндекса для карты ЖК, поиска координат и мест поблизости.
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <label className="block text-xs uppercase tracking-wide text-slate-300">API-ключ Яндекс.Карт</label>
        <Input
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setCheckResult(null) }}
          placeholder="Введите API-ключ"
          className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
        />
        <div className="space-y-1 text-xs text-slate-400">
          <div>Один ключ закрывает три сервиса: <strong className="text-slate-300">JavaScript API</strong> (карта ЖК), <strong className="text-slate-300">Geocoder API</strong> (поиск координат), <strong className="text-slate-300">Search API HTTP</strong> (места поблизости).</div>
          <div>Создайте ключ в кабинете разработчика Яндекса и включите все три сервиса сразу.</div>
        </div>

        {checkResult && (
          <div className="space-y-2 pt-1">
            {hasKeyIssue ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                Ключ не задан. Сохраните ключ и нажмите «Проверить» снова.
              </div>
            ) : (
              <>
                <StatusBadge status={checkResult.geocoder} label="Geocoder API (поиск координат)" />
                <StatusBadge status={checkResult.search} label="Search API HTTP (места поблизости)" />
                {allOk && (
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                    Ключ работает корректно. Оба сервиса доступны.
                  </div>
                )}
                {!allOk && checkResult.has_key && (
                  <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    {checkResult.geocoder === 'auth_error' || checkResult.search === 'auth_error'
                      ? 'Ключ не принят. Проверьте, что для ключа включены нужные сервисы в кабинете разработчика Яндекса.'
                      : 'Один из сервисов недоступен. Возможно, временная ошибка — попробуйте ещё раз.'}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {checkError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {checkError}
          </div>
        )}
      </div>

      {error ? <div className="text-sm text-rose-300">{error}</div> : null}
      {savedAt ? <div className="text-xs text-emerald-300">Сохранено: {new Date(savedAt).toLocaleString('ru-RU')}</div> : null}

      <div className="flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={checkKey} disabled={checking || !apiKey.trim()}>
          {checking ? 'Проверка...' : 'Проверить ключ'}
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>
    </div>
  )
}
