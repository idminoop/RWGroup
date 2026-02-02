import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Home from '@/pages/Home'
import CatalogPage from '@/pages/Catalog'
import PropertyPage from '@/pages/Property'
import ComplexPage from '@/pages/Complex'
import CollectionPage from '@/pages/Collection'
import PrivacyPage from '@/pages/Privacy'
import AdminEntry from '@/pages/admin/AdminEntry'

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/property/:id" element={<PropertyPage />} />
        <Route path="/complex/:id" element={<ComplexPage />} />
        <Route path="/collection/:id" element={<CollectionPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/admin/*" element={<AdminEntry />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}
