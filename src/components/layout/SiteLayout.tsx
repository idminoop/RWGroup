import type { PropsWithChildren } from 'react'
import Header from './Header'
import Footer from './Footer'
import LeadModal from '@/components/forms/LeadModal'

export default function SiteLayout({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Header />
      <main>{children}</main>
      <Footer />
      <LeadModal />
    </div>
  )
}

