import { Navigate, Route, Routes } from 'react-router-dom'
import AdminLoginPage from './AdminLogin'
import AdminLayout from './AdminLayout'

export default function AdminEntry() {
  return (
    <Routes>
      <Route path="/login" element={<AdminLoginPage />} />
      <Route path="/*" element={<AdminLayout />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}

