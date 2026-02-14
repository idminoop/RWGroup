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
import AdminUsersPage from './pages/AdminUsers'
import AdminLogsPage from './pages/AdminLogs'
import type { AdminPermission, AdminRole } from '../../../shared/types'

type PublishStatus = {
  has_pending_changes: boolean
  draft_updated_at?: string
  published_at?: string
}

type AdminSessionInfo = {
  id: string
  login: string
  roles: AdminRole[]
  permissions: AdminPermission[]
}

function usePermissionSet(permissions: AdminPermission[]) {
  return useMemo(() => new Set(permissions), [permissions])
}

export default function AdminLayout() {
  const token = useUiStore((s) => s.adminToken)
  const adminLogin = useUiStore((s) => s.adminLogin)
  const adminRoles = useUiStore((s) => s.adminRoles)
  const adminPermissions = useUiStore((s) => s.adminPermissions)
  const setAdminSession = useUiStore((s) => s.setAdminSession)
  const loc = useLocation()
  const headers = useMemo(() => ({ 'x-admin-token': token || '' }), [token])
  const permissionSet = usePermissionSet(adminPermissions)

  const [authLoading, setAuthLoading] = useState(false)
  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const hasAnyPermission = useCallback(
    (...needed: AdminPermission[]) => needed.some((permission) => permissionSet.has(permission)),
    [permissionSet],
  )

  const canAccessHome = hasAnyPermission('home.write')
  const canAccessCatalog = hasAnyPermission('catalog.write')
  const canAccessComplexSettings = canAccessCatalog
  const canAccessCollections = hasAnyPermission('collections.write')
  const canAccessImport = hasAnyPermission('import.write')
  const canAccessLeads = hasAnyPermission('leads.write')
  const canAccessUsers = hasAnyPermission('admin_users.read', 'admin_users.write')
  const canAccessLogs = hasAnyPermission('logs.read')
  const canReadPublishStatus = hasAnyPermission('publish.read')
  const canApplyPublish = hasAnyPermission('publish.apply')

  const defaultAdminPath = useMemo(() => {
    if (canAccessHome) return '/admin'
    if (canAccessCatalog) return '/admin/catalog'
    if (canAccessComplexSettings) return '/admin/complex-settings'
    if (canAccessCollections) return '/admin/collections'
    if (canAccessImport) return '/admin/import'
    if (canAccessLeads) return '/admin/leads'
    if (canAccessUsers) return '/admin/users'
    if (canAccessLogs) return '/admin/logs'
    return null
  }, [canAccessCatalog, canAccessCollections, canAccessComplexSettings, canAccessHome, canAccessImport, canAccessLeads, canAccessLogs, canAccessUsers])

  useEffect(() => {
    if (!token) return

    let active = true
    setAuthLoading(true)
    apiGet<AdminSessionInfo>('/api/admin/me', headers)
      .then((session) => {
        if (!active) return
        setAdminSession({
          token,
          id: session.id,
          login: session.login,
          roles: session.roles,
          permissions: session.permissions,
        })
      })
      .catch(() => {
        if (!active) return
        setAdminSession(null)
      })
      .finally(() => {
        if (!active) return
        setAuthLoading(false)
      })

    return () => {
      active = false
    }
  }, [headers, setAdminSession, token])

  const loadPublishStatus = useCallback(async () => {
    if (!token || !canReadPublishStatus) return
    try {
      const status = await apiGet<PublishStatus>('/api/admin/publish/status', headers)
      setPublishStatus(status)
      setPublishError(null)
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Не удалось получить статус публикации')
    }
  }, [canReadPublishStatus, headers, token])

  useEffect(() => {
    if (!token || !canReadPublishStatus) {
      setPublishStatus(null)
      return
    }
    void loadPublishStatus()
    const timer = window.setInterval(() => {
      void loadPublishStatus()
    }, 15000)
    return () => window.clearInterval(timer)
  }, [canReadPublishStatus, loadPublishStatus, token])

  const handlePublish = async () => {
    if (!canApplyPublish || !publishStatus?.has_pending_changes || publishLoading) return
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
  if (authLoading) {
    return (
      <div className="admin-shell min-h-screen">
        <div className="mx-auto max-w-2xl px-4 py-16 text-sm text-slate-300">Проверяем права доступа...</div>
      </div>
    )
  }
  if (!defaultAdminPath) {
    return (
      <div className="admin-shell min-h-screen">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-16 text-slate-200">
          <div className="text-lg font-semibold">Нет доступа к разделам админки</div>
          <Button variant="secondary" onClick={() => setAdminSession(null)}>
            Выйти
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-shell min-h-screen overflow-x-hidden">
      <div className="mx-auto w-full max-w-[1800px] px-[2vw] py-[2vw] sm:px-4 md:py-6">
        <div className="admin-topbar flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0b1d2b]/75 p-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-white">Админка</div>
            <div className="mt-1 text-sm text-slate-300">
              Пользователь: <span className="font-medium">{adminLogin || 'unknown'}</span>
              {' · '}
              Роли:{' '}
              <span className="font-medium uppercase">
                {adminRoles.length ? adminRoles.join(', ') : 'unknown'}
              </span>
            </div>
            {canReadPublishStatus ? (
              <div className="mt-1 text-xs text-slate-400">
                {publishStatus?.has_pending_changes ? 'Есть черновые изменения' : 'Сайт синхронизирован'}
                {publishStatus?.published_at ? ` · опубликовано: ${new Date(publishStatus.published_at).toLocaleString('ru-RU')}` : ''}
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-400">У вас нет права публикации, только доступ к разрешенным разделам.</div>
            )}
            {publishError ? <div className="mt-1 text-xs text-rose-300">{publishError}</div> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handlePublish}
              disabled={!canApplyPublish || publishLoading || !publishStatus?.has_pending_changes}
            >
              {publishLoading ? 'Публикация...' : 'Применить изменения на сайт'}
            </Button>
            <Link className="text-sm text-slate-300 hover:text-white" to="/">
              На сайт
            </Link>
            <Button variant="secondary" onClick={() => setAdminSession(null)}>
              Выйти
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-[220px_1fr]">
          <aside className="rounded-2xl border border-white/10 bg-[#081724]/80 p-3 backdrop-blur-md md:sticky md:top-4">
            <nav className="flex gap-2 overflow-x-auto text-sm md:block md:space-y-1 md:overflow-visible">
              {canAccessHome && <NavLink to="/admin" current={loc.pathname === '/admin'} title="Витрина" />}
              {canAccessCatalog && <NavLink to="/admin/catalog" current={loc.pathname.startsWith('/admin/catalog')} title="Каталог" />}
              {canAccessComplexSettings && <NavLink to="/admin/complex-settings" current={loc.pathname.startsWith('/admin/complex-settings')} title="Настройка ЖК" />}
              {canAccessCollections && <NavLink to="/admin/collections" current={loc.pathname.startsWith('/admin/collections')} title="Подборки" />}
              {canAccessImport && <NavLink to="/admin/import" current={loc.pathname.startsWith('/admin/import')} title="Импорт" />}
              {canAccessLeads && <NavLink to="/admin/leads" current={loc.pathname.startsWith('/admin/leads')} title="Лиды" />}
              {canAccessUsers && <NavLink to="/admin/users" current={loc.pathname.startsWith('/admin/users')} title="Пользователи" />}
              {canAccessLogs && <NavLink to="/admin/logs" current={loc.pathname.startsWith('/admin/logs')} title="Логи" />}
            </nav>
          </aside>
          <section className="admin-content min-w-0 rounded-2xl border border-white/10 bg-[#0a1b29]/82 p-4 backdrop-blur-md sm:p-[3vw] md:p-5">
            <Routes>
              <Route path="/" element={canAccessHome ? <AdminHomePage /> : <Navigate to={defaultAdminPath} replace />} />
              <Route path="/catalog" element={canAccessCatalog ? <AdminCatalogPage /> : <Navigate to={defaultAdminPath} replace />} />
              <Route path="/complex-settings" element={canAccessComplexSettings ? <AdminComplexSettingsPage /> : <Navigate to={defaultAdminPath} replace />} />
              <Route path="/collections" element={canAccessCollections ? <AdminCollectionsPage /> : <Navigate to={defaultAdminPath} replace />} />
              <Route path="/import" element={canAccessImport ? <AdminImportPage /> : <Navigate to={defaultAdminPath} replace />} />
              <Route path="/leads" element={canAccessLeads ? <AdminLeadsPage /> : <Navigate to={defaultAdminPath} replace />} />
              <Route path="/users" element={canAccessUsers ? <AdminUsersPage /> : <Navigate to={defaultAdminPath} replace />} />
              <Route path="/logs" element={canAccessLogs ? <AdminLogsPage /> : <Navigate to={defaultAdminPath} replace />} />
              <Route path="*" element={<Navigate to={defaultAdminPath} replace />} />
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
