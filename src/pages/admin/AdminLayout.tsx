import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useUiStore } from '@/store/useUiStore'
import Button from '@/components/ui/Button'
import AdminHomePage from './pages/AdminHome'
import AdminCollectionsPage from './pages/AdminCollections'
import AdminImportPage from './pages/AdminImport'
import AdminLeadsPage from './pages/AdminLeads'
import AdminCatalogPage from './pages/AdminCatalog'
import AdminComplexSettingsPage from './pages/AdminComplexSettings'

export default function AdminLayout() {
  const token = useUiStore((s) => s.adminToken)
  const setAdminToken = useUiStore((s) => s.setAdminToken)
  const loc = useLocation()

  if (!token) return <Navigate to="/admin/login" replace />

  return (
    <div className="min-h-screen bg-slate-50 overflow-x-hidden">
      <div className="mx-auto w-full max-w-[1700px] px-[2vw] py-[3vw] sm:px-4 md:py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900">{'\u0410\u0434\u043c\u0438\u043d\u043a\u0430'}</div>
            <div className="mt-1 text-sm text-slate-600">{'\u0412\u0438\u0442\u0440\u0438\u043d\u0430, \u043f\u043e\u0434\u0431\u043e\u0440\u043a\u0438, \u0438\u043c\u043f\u043e\u0440\u0442 \u0438 \u043b\u0438\u0434\u044b.'}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="text-sm text-slate-700 hover:text-slate-900" to="/">
              {'\u041d\u0430 \u0441\u0430\u0439\u0442'}
            </Link>
            <Button variant="secondary" onClick={() => setAdminToken(null)}>
              {'\u0412\u044b\u0439\u0442\u0438'}
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-[220px_1fr]">
          <aside className="rounded-xl border border-slate-200 bg-white p-3 md:sticky md:top-4">
            <nav className="flex gap-2 overflow-x-auto text-sm md:block md:space-y-1 md:overflow-visible">
              <NavLink to="/admin" current={loc.pathname === '/admin'} title={'\u0412\u0438\u0442\u0440\u0438\u043d\u0430'} />
              <NavLink to="/admin/catalog" current={loc.pathname.startsWith('/admin/catalog')} title={'\u041a\u0430\u0442\u0430\u043b\u043e\u0433'} />
              <NavLink to="/admin/complex-settings" current={loc.pathname.startsWith('/admin/complex-settings')} title="Настройка ЖК" />
              <NavLink to="/admin/collections" current={loc.pathname.startsWith('/admin/collections')} title={'\u041f\u043e\u0434\u0431\u043e\u0440\u043a\u0438'} />
              <NavLink to="/admin/import" current={loc.pathname.startsWith('/admin/import')} title={'\u0418\u043c\u043f\u043e\u0440\u0442'} />
              <NavLink to="/admin/leads" current={loc.pathname.startsWith('/admin/leads')} title={'\u041b\u0438\u0434\u044b'} />
            </nav>
          </aside>
          <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-[3vw] md:p-5">
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
          ? 'inline-flex whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 font-medium text-white md:block'
          : 'inline-flex whitespace-nowrap rounded-md px-3 py-2 text-slate-700 hover:bg-slate-50 hover:text-slate-900 md:block'
      }
    >
      {title}
    </Link>
  )
}

