import { Link } from 'react-router-dom'
import { Text } from '@/components/ui/Typography'

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#000A0D] text-white">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 md:py-16">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2 mb-4">
               <img src="/rwgroup.svg" alt="RWgroup" className="h-8 w-auto invert" />
            </div>
            <Text size="sm" className="text-gray-400">Агентство элитной недвижимости</Text>
            <div className="mt-6">
              <a className="text-lg font-medium hover:text-accent transition-colors" href="tel:+74954101568">
                +7 (495) 410-15-68
              </a>
              <Text size="sm" className="text-gray-500 mt-1">Москва, Кутузовский пр-т 36 А</Text>
            </div>
          </div>
          
          <div>
            <Text weight="bold" className="mb-4 text-white">Недвижимость</Text>
            <div className="space-y-2 flex flex-col">
              <Link to="/catalog?tab=newbuild" className="text-sm text-gray-400 hover:text-white transition-colors">Новостройки</Link>
              <Link to="/catalog?tab=secondary" className="text-sm text-gray-400 hover:text-white transition-colors">Вторичная</Link>
              <Link to="/catalog?tab=rent" className="text-sm text-gray-400 hover:text-white transition-colors">Аренда</Link>
            </div>
          </div>

          <div>
            <Text weight="bold" className="mb-4 text-white">Компания</Text>
            <div className="space-y-2 flex flex-col">
              <a href="/#team" className="text-sm text-gray-400 hover:text-white transition-colors">Команда</a>
              <Link to="/privacy" className="text-sm text-gray-400 hover:text-white transition-colors">Политика конфиденциальности</Link>
            </div>
          </div>

          <div>
            <Text weight="bold" className="mb-4 text-white">Соцсети</Text>
            <div className="space-y-2 flex flex-col">
              <a className="text-sm text-gray-400 hover:text-white transition-colors" href="#">Telegram</a>
              <a className="text-sm text-gray-400 hover:text-white transition-colors" href="#">Instagram</a>
              <a className="text-sm text-gray-400 hover:text-white transition-colors" href="#">WhatsApp</a>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 md:mt-16 md:flex-row md:items-center md:pt-8">
           <Text size="xs" className="text-gray-600">© {new Date().getFullYear()} RWgroup. Все права защищены.</Text>
        </div>
      </div>
    </footer>
  )
}

