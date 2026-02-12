import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, MapPin, Phone } from 'lucide-react'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { useUiStore } from '@/store/useUiStore'
import { trackEvent } from '@/lib/analytics'

const NAV_LINKS = [
  { to: '/catalog?tab=newbuild', label: '\u041d\u043e\u0432\u043e\u0441\u0442\u0440\u043e\u0439\u043a\u0438' },
  { to: '/catalog?tab=secondary', label: '\u0412\u0442\u043e\u0440\u0438\u0447\u043d\u0430\u044f \u043d\u0435\u0434\u0432\u0438\u0436\u0438\u043c\u043e\u0441\u0442\u044c' },
  { to: '/catalog?tab=rent', label: '\u0410\u0440\u0435\u043d\u0434\u0430 \u043a\u0432\u0430\u0440\u0442\u0438\u0440' },
]

const NAV_SECTIONS = [
  { href: '/#team', label: '\u041a\u043e\u043c\u0430\u043d\u0434\u0430' },
  { href: '/#catalog-categories', label: '\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438' },
]

export default function Header() {
  const loc = useLocation()
  const { openLeadModal, isMenuOpen, toggleMenu } = useUiStore()

  useEffect(() => {
    toggleMenu(false)
  }, [loc.pathname, loc.search, loc.hash, toggleMenu])

  const handleNavClick = () => {
    toggleMenu(false)
  }

  return (
    <>
      <header className="sticky top-0 z-[1200] border-b border-white/10 bg-background/90 text-white backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-4 py-3 md:py-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3 lg:gap-6">
            <Link to="/" className="flex items-center">
              <img src="/rwgroup.svg" alt="RWgroup" className="h-11 w-auto object-contain invert sm:h-14 md:h-20" />
            </Link>

            <div className="hidden h-10 w-px bg-white/20 sm:block" />

            <h1 className="hidden max-w-[120px] text-xs font-medium uppercase leading-tight tracking-wide text-gray-300 sm:block">
              {`\u0422\u043e\u0447\u043d\u043e\u0441\u0442\u044c`}<br />
              {`\u0432 \u043a\u0430\u0436\u0434\u043e\u0439 \u0441\u0434\u0435\u043b\u043a\u0435`}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 lg:gap-8">
            <div className="hidden flex-col items-end gap-1 text-right lg:flex">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <MapPin className="h-4 w-4 text-accent" />
                <span>{`\u041c\u043e\u0441\u043a\u0432\u0430, \u041a\u0443\u0442\u0443\u0437\u043e\u0432\u0441\u043a\u0438\u0439 \u043f\u0440-\u0442 36 \u0410`}</span>
              </div>
              <a href="tel:+74954101568" className="flex items-center gap-2 text-lg font-semibold transition-colors hover:text-accent">
                <Phone className="h-4 w-4 text-accent" />
                +7 (495) 410-15-68
              </a>
            </div>

            <Button
              variant="default"
              className="hidden font-semibold md:flex"
              onClick={() => {
                trackEvent('click_consultation', { page: loc.pathname, block: 'header' })
                openLeadModal('consultation', { page: loc.pathname, block: 'header' })
              }}
            >
              {`\u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u043a\u043e\u043d\u0441\u0443\u043b\u044c\u0442\u0430\u0446\u0438\u044e`}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              aria-label={isMenuOpen ? `\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u043c\u0435\u043d\u044e` : `\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043c\u0435\u043d\u044e`}
              aria-expanded={isMenuOpen}
              onClick={() => toggleMenu(true)}
              className="shrink-0 text-white hover:bg-transparent hover:text-accent"
            >
              <Menu className="h-8 w-8" />
            </Button>
          </div>
        </div>
      </header>

      <Drawer isOpen={isMenuOpen} onClose={() => toggleMenu(false)} side="right">
        <div className="flex h-full flex-col gap-8 pt-8">
          <div className="px-2">
            <img src="/rwgroup.svg" alt="RWgroup" className="h-16 w-auto object-contain invert" />
          </div>

          <nav className="flex flex-col gap-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-xl font-medium transition-colors hover:text-accent"
                onClick={handleNavClick}
              >
                {link.label}
              </Link>
            ))}
            <div className="my-2 h-px bg-border" />
            {NAV_SECTIONS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-lg transition-colors hover:text-accent"
                onClick={handleNavClick}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="mt-auto space-y-4">
            <Button
              className="w-full"
              onClick={() => {
                handleNavClick()
                trackEvent('click_consultation', { page: loc.pathname, block: 'drawer' })
                openLeadModal('consultation', { page: loc.pathname, block: 'drawer' })
              }}
            >
              {`\u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u043a\u043e\u043d\u0441\u0443\u043b\u044c\u0442\u0430\u0446\u0438\u044e`}
            </Button>

            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>{`\u041c\u043e\u0441\u043a\u0432\u0430, \u041a\u0443\u0442\u0443\u0437\u043e\u0432\u0441\u043a\u0438\u0439 \u043f\u0440-\u0442 36 \u0410`}</p>
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
