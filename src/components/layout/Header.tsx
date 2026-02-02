import { Link, useLocation } from 'react-router-dom'
import { Menu, MapPin, Phone } from 'lucide-react'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { useUiStore } from '@/store/useUiStore'
import { trackEvent } from '@/lib/analytics'

export default function Header() {
  const loc = useLocation()
  const { openLeadModal, isMenuOpen, toggleMenu } = useUiStore()
  
  const handleNavClick = () => {
    toggleMenu(false)
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#000A0D]/90 backdrop-blur text-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4">
          
          {/* Left: Logo + Tagline */}
          <div className="flex items-center gap-4 lg:gap-6">
            <Link to="/" className="flex items-center">
              <img src="/rwgroup.svg" alt="RWgroup" className="h-16 md:h-20 w-auto object-contain invert" />
            </Link>
            
            <div className="hidden h-10 w-[1px] bg-white/20 sm:block" />
            
            <h1 className="hidden max-w-[120px] text-xs font-medium uppercase leading-tight tracking-wide text-gray-300 sm:block">
              Эксперты по<br />недвижимости
            </h1>
          </div>

          {/* Right: Contacts + CTA + Menu */}
          <div className="flex items-center gap-4 lg:gap-8">
            <div className="hidden flex-col items-end gap-1 text-right lg:flex">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <MapPin className="h-4 w-4 text-accent" />
                <span>Москва, Кутузовский пр-т 36 А</span>
              </div>
              <a href="tel:+74954101568" className="flex items-center gap-2 text-lg font-semibold hover:text-accent transition-colors">
                <Phone className="h-4 w-4 text-accent" />
                +7 (495) 410-15-68
              </a>
            </div>

            <Button
              variant="default"
              className="bg-white text-black hover:bg-gray-200 border-none font-semibold hidden sm:flex"
              onClick={() => {
                trackEvent('click_consultation', { page: loc.pathname, block: 'header' })
                openLeadModal('consultation', { page: loc.pathname, block: 'header' })
              }}
            >
              Получить консультацию
            </Button>

            <button 
              onClick={() => toggleMenu(true)}
              className="p-1 hover:text-accent transition-colors"
            >
              <Menu className="h-8 w-8" />
            </button>
          </div>
        </div>
      </header>

      <Drawer isOpen={isMenuOpen} onClose={() => toggleMenu(false)} side="right">
        <div className="flex flex-col gap-8 pt-8">
          <div className="px-2">
            <img src="/rwgroup.svg" alt="RWgroup" className="h-16 w-auto object-contain invert" />
          </div>
          
          <nav className="flex flex-col gap-4">
            <Link 
              to="/catalog?tab=newbuild" 
              className="text-xl font-medium hover:text-accent transition-colors"
              onClick={handleNavClick}
            >
              Новостройки
            </Link>
            <Link 
              to="/catalog?tab=secondary" 
              className="text-xl font-medium hover:text-accent transition-colors"
              onClick={handleNavClick}
            >
              Вторичная недвижимость
            </Link>
            <Link 
              to="/catalog?tab=rent" 
              className="text-xl font-medium hover:text-accent transition-colors"
              onClick={handleNavClick}
            >
              Аренда квартир
            </Link>
            <div className="my-2 h-[1px] bg-border" />
            <a href="#team" className="text-lg hover:text-accent transition-colors" onClick={handleNavClick}>
              Команда
            </a>
            <a href="#blog" className="text-lg hover:text-accent transition-colors" onClick={handleNavClick}>
              Блог
            </a>
          </nav>

          <div className="mt-auto flex flex-col gap-4">
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>Москва, Кутузовский пр-т 36 А</p>
              <a href="tel:+74954101568" className="text-lg font-semibold text-foreground">
                +7 (495) 410-15-68
              </a>
            </div>
          </div>
        </div>
      </Drawer>
    </>
  )
}
