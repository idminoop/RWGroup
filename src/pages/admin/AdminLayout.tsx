import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { apiGet, apiPost } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import Button from '@/components/ui/Button'
import AdminHomePage from './pages/AdminHome'
import AdminCollectionsPage from './pages/AdminCollections'
import AdminImportPage from './pages/AdminImport'
import AdminLeadsPage from './pages/AdminLeads'
import AdminCatalogPage from './pages/AdminCatalog'
import AdminComplexSettingsPage from './pages/AdminComplexSettings'

type PublishStatus = {
  has_pending_changes: boolean
  draft_updated_at?: string
  published_at?: string
}

export default function AdminLayout() {
  const token = useUiStore((s) => s.adminToken)
  const setAdminToken = useUiStore((s) => s.setAdminToken)
  const loc = useLocation()
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])

  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const loadPublishStatus = useCallback(async () => {
    if (!token) return
    try {
      const status = await apiGet<PublishStatus>('/api/admin/publish/status', headers)
      setPublishStatus(status)
      setPublishError(null)
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Не удалось получить статус публикации')
    }
  }, [headers, token])

  useEffect(() => {
    void loadPublishStatus()
    const timer = window.setInterval(() => {
      void loadPublishStatus()
    }, 15000)
    return () => window.clearInterval(timer)
  }, [loadPublishStatus])

  const handlePublish = async () => {
    if (!publishStatus?.has_pending_changes || publishLoading) return
    setPublishLoading(true)
    setPublishError(null)
    try {
      const status = await apiPost<PublishStatus>('/api/admin/publish/apply', {}, headers)
      setPublishStatus(status)
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Не удалось применить изменения')
    } finally {
      setPublishLoading(false)
    }
  }

  if (!token) return <Navigate to="/admin/login" replace />

  return (
    <div className="admin-shell min-h-screen overflow-x-hidden">
      <div className="mx-auto w-full max-w-[1800px] px-[2vw] py-[2vw] sm:px-4 md:py-6">
        <div className="admin-topbar flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0b1d2b]/75 p-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-white">Админка</div>
            <div className="mt-1 text-sm text-slate-300">Витрина, подборки, импорт и лиды.</div>
            <div className="mt-1 text-xs text-slate-400">
              {publishStatus?.has_pending_changes ? 'Есть черновые изменения' : 'Сайт синхронизирован'}
              {publishStatus?.published_at
                ? ` · опубликовано: ${new Date(publishStatus.published_at).toLocaleString('ru-RU')}`
                : ''}
            </div>
            {publishError ? <div className="mt-1 text-xs text-rose-300">{publishError}</div> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handlePublish} disabled={publishLoading || !publishStatus?.has_pending_changes}>
              {publishLoading ? 'Публикация...' : 'Применить изменения на сайт'}
            </Button>
            <Link className="text-sm text-slate-300 hover:text-white" to="/">
              На сайт
            </Link>
            <Button variant="secondary" onClick={() => setAdminToken(null)}>
              Выйти
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-[220px_1fr]">
          <aside className="rounded-2xl border border-white/10 bg-[#081724]/80 p-3 backdrop-blur-md md:sticky md:top-4">
            <nav className="flex gap-2 overflow-x-auto text-sm md:block md:space-y-1 md:overflow-visible">
              <NavLink to="/admin" current={loc.pathname === '/admin'} title="Витрина" />
              <NavLink to="/admin/catalog" current={loc.pathname.startsWith('/admin/catalog')} title="Каталог" />
              <NavLink to="/admin/complex-settings" current={loc.pathname.startsWith('/admin/complex-settings')} title="Настройка ЖК" />
              <NavLink to="/admin/collections" current={loc.pathname.startsWith('/admin/collections')} title="Подборки" />
              <NavLink to="/admin/import" current={loc.pathname.startsWith('/admin/import')} title="Импорт" />
              <NavLink to="/admin/leads" current={loc.pathname.startsWith('/admin/leads')} title="Лиды" />
            </nav>
          </aside>
          <section className="admin-content min-w-0 rounded-2xl border border-white/10 bg-[#0a1b29]/82 p-4 backdrop-blur-md sm:p-[3vw] md:p-5">
            <Routes>
              <Route path="/" element={<AdminHomePage />} />
              <Route path="/catalog" element={<AdminCatalogPage />} />
              <Route path="/complex-settings" element={<AdminComplexSettingsPage />} />
              <Route path="/collections" element={<AdminCollectionsPage />} />
              <Route path="/import" element={<AdminImportPage />} />
              <Route path="/leads" element={<AdminLeadsPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </section>
        </div>
      </div>
    </div>
  )
}

function NavLink({ to, title, current }: { to: string; title: string; current: boolean }) {
  return (
    <Link
      to={to}
      className={
        current
          ? 'inline-flex whitespace-nowrap rounded-md bg-primary px-3 py-2 font-medium text-white md:block'
          : 'inline-flex whitespace-nowrap rounded-md px-3 py-2 text-slate-300 hover:bg-white/10 hover:text-white md:block'
      }
    >
      {title}
    </Link>
  )
}
