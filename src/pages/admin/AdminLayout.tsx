import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useUiStore } from '@/store/useUiStore'
import Button from '@/components/ui/Button'
import AdminHomePage from './pages/AdminHome'
import AdminCollectionsPage from './pages/AdminCollections'
import AdminFeedsPage from './pages/AdminFeeds'
import AdminImportPage from './pages/AdminImport'
import AdminLeadsPage from './pages/AdminLeads'

export default function AdminLayout() {
  const token = useUiStore((s) => s.adminToken)
  const setAdminToken = useUiStore((s) => s.setAdminToken)
  const loc = useLocation()

  if (!token) return <Navigate to="/admin/login" replace />

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight">Админка</div>
            <div className="mt-1 text-sm text-slate-600">Витрина, подборки, фиды, импорт и лиды.</div>
          </div>
          <div className="flex items-center gap-2">
            <Link className="text-sm text-slate-700 hover:text-slate-900" to="/">
              На сайт
            </Link>
            <Button variant="secondary" onClick={() => setAdminToken(null)}>
              Выйти
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-[240px_1fr]">
          <aside className="rounded-xl border border-slate-200 bg-white p-3">
            <nav className="space-y-1 text-sm">
              <NavLink to="/admin" current={loc.pathname === '/admin'} title="Витрина" />
              <NavLink to="/admin/collections" current={loc.pathname.startsWith('/admin/collections')} title="Подборки" />
              <NavLink to="/admin/feeds" current={loc.pathname.startsWith('/admin/feeds')} title="Фиды" />
              <NavLink to="/admin/import" current={loc.pathname.startsWith('/admin/import')} title="Импорт" />
              <NavLink to="/admin/leads" current={loc.pathname.startsWith('/admin/leads')} title="Лиды" />
            </nav>
          </aside>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <Routes>
              <Route path="/" element={<AdminHomePage />} />
              <Route path="/collections" element={<AdminCollectionsPage />} />
              <Route path="/feeds" element={<AdminFeedsPage />} />
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
          ? 'block rounded-md bg-slate-900 px-3 py-2 font-medium text-white'
          : 'block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
      }
    >
      {title}
    </Link>
  )
}

