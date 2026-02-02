import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronRight } from 'lucide-react'
import SiteLayout from '@/components/layout/SiteLayout'
import Button from '@/components/ui/Button'
import { Heading, Text } from '@/components/ui/Typography'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import { apiGet } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/useUiStore'
import { trackEvent } from '@/lib/analytics'
import type { Collection, Complex, HomeContent, Property } from '../../shared/types'

type HomeApi = {
  home: HomeContent
  featured: { complexes: Complex[]; properties: Property[]; collections: Collection[] }
}

export default function Home() {
  const navigate = useNavigate()
  const { openLeadModal } = useUiStore()
  const [home, setHome] = useState<HomeApi | null>(null)

  useEffect(() => {
    apiGet<HomeApi>('/api/home').then(setHome).catch(() => setHome(null))
  }, [])

  const heroBg = 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=moscow%20city%20skyline%20night%20lights%2C%20luxury%20real%20estate%2C%20cinematic%20dark%20atmosphere%2C%20professional%20photography%2C%208k&image_size=landscape_16_9'

  return (
    <SiteLayout>
      {/* 1. Hero Section - Full Screen */}
      <section className="relative h-[calc(100vh-80px)] min-h-[600px] w-full overflow-hidden bg-[#000A0D]">
        <div className="absolute inset-0">
          <img src={heroBg} alt="Moscow City" className="h-full w-full object-cover opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#000A0D]/90 via-[#000A0D]/40 to-transparent" />
        </div>
        
        <div className="relative mx-auto flex h-full w-full max-w-7xl flex-col justify-center px-4 pb-20 pt-10">
          <Heading size="h1" className="max-w-4xl text-white">
            Агентство <br />
            <span className="text-gray-400">элитной недвижимости</span>
          </Heading>
          
          <div className="mt-12 flex flex-col gap-4 sm:flex-row">
            <Button
              variant="default"
              className="h-14 bg-white px-8 text-lg text-black hover:bg-gray-200"
              onClick={() => {
                trackEvent('click_consultation', { page: 'home', block: 'hero' })
                openLeadModal('consultation', { page: 'home', block: 'hero' })
              }}
            >
              Получить консультацию
            </Button>
            <Button
              variant="outline"
              className="h-14 border-white/20 px-8 text-lg text-white hover:bg-white/10"
              onClick={() => {
                document.getElementById('catalog-categories')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              Смотреть объекты
            </Button>
          </div>
        </div>
      </section>

      {/* 2. Catalog Categories (Whitewill style blocks) */}
      <section id="catalog-categories" className="bg-[#000A0D] py-20">
        <div className="mx-auto max-w-7xl px-4">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { title: 'Новостройки', tab: 'newbuild', image: 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=modern%20skyscraper%20architecture%20abstract%2C%20glass%20facade%2C%20dark%20mood&image_size=square' },
              { title: 'Вторичная', tab: 'secondary', image: 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=luxury%20classic%20apartment%20interior%2C%20dark%20mood%2C%20elegant&image_size=square' },
              { title: 'Аренда', tab: 'rent', image: 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cozy%20modern%20living%20room%20evening%2C%20warm%20light%2C%20dark%20mood&image_size=square' },
            ].map((item) => (
              <div 
                key={item.tab}
                onClick={() => navigate(`/catalog?tab=${item.tab}`)}
                className="group relative aspect-[4/5] cursor-pointer overflow-hidden rounded-sm md:aspect-[3/4]"
              >
                <img 
                  src={item.image} 
                  alt={item.title}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" 
                />
                <div className="absolute inset-0 bg-black/40 transition-colors group-hover:bg-black/20" />
                <div className="absolute bottom-8 left-8">
                  <Heading size="h3" className="text-white">
                    {item.title}
                  </Heading>
                  <div className="mt-2 flex items-center gap-2 text-sm font-medium text-white/0 transition-all duration-300 group-hover:text-white group-hover:translate-x-2">
                    Перейти в каталог <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Buy / Sell / Rent (Large Typography) */}
      <section id="buy-sell" className="bg-white py-24 text-[#000A0D]">
        <div className="mx-auto max-w-7xl px-4">
          <div className="grid gap-12 lg:grid-cols-2">
            <div className="flex flex-col justify-center">
              <Heading size="h1" className="uppercase tracking-tighter md:text-8xl">
                Купить
              </Heading>
              <Text size="lg" className="mt-6 max-w-md text-gray-600">
                Подберем идеальную недвижимость для жизни или инвестиций. Доступ к закрытой базе объектов.
              </Text>
              <div className="mt-8">
                <Button 
                  variant="default" 
                  className="bg-[#000A0D] text-white hover:bg-black"
                  onClick={() => navigate('/catalog?tab=newbuild')}
                >
                  Найти квартиру
                </Button>
              </div>
            </div>
            <div className="relative aspect-video overflow-hidden rounded-sm lg:aspect-auto lg:h-[400px]">
              <img 
                src="https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=luxury%20penthouse%20living%20room%20sunlight%2C%20white%20interior&image_size=landscape_16_9" 
                alt="Buy"
                className="h-full w-full object-cover"
              />
            </div>
          </div>

          <div className="mt-24 grid gap-12 lg:grid-cols-2">
            <div className="order-2 relative aspect-video overflow-hidden rounded-sm lg:order-1 lg:aspect-auto lg:h-[400px]">
               <img 
                src="https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=modern%20business%20center%20lobby%2C%20handshake%2C%20professional&image_size=landscape_16_9" 
                alt="Sell"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="order-1 flex flex-col justify-center lg:order-2 lg:pl-12">
              <Heading size="h1" className="uppercase tracking-tighter md:text-8xl">
                Продать
              </Heading>
              <Text size="lg" className="mt-6 max-w-md text-gray-600">
                Оценим, подготовим и продадим вашу недвижимость по максимальной рыночной цене.
              </Text>
              <div className="mt-8">
                <Button 
                  variant="default" 
                  className="bg-[#000A0D] text-white hover:bg-black"
                  onClick={() => {
                    trackEvent('click_buy_sell', { page: 'home', block: 'big_sell', tab: 'sell' })
                    openLeadModal('buy_sell', { page: 'home', block: 'big_sell' }, { initialTab: 'sell' })
                  }}
                >
                  Оставить заявку
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Best Offers (Featured) */}
      <section className="bg-[#000A0D] py-24 text-white">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-12 flex items-end justify-between">
            <div>
              <Heading size="h2" className="text-white">Лучшие предложения</Heading>
              <Text className="mt-2 text-gray-400">Актуальные лоты и проекты этой недели</Text>
            </div>
            <Link to="/catalog" className="hidden items-center gap-2 text-sm font-medium hover:text-accent md:flex">
              Смотреть все <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
             {/* Collections */}
            {home?.featured.collections?.map((c) => (
              <CollectionCard key={c.id} item={c} />
            ))}
             {/* Complexes */}
            {home?.featured.complexes?.map((c) => (
              <ComplexCard key={c.id} item={c} />
            ))}
             {/* Properties */}
            {home?.featured.properties?.map((p) => (
              <PropertyCard key={p.id} item={p} />
            ))}
          </div>

          <div className="mt-12 flex justify-center md:hidden">
            <Link to="/catalog" className="flex items-center gap-2 text-sm font-medium text-white">
               Смотреть все <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 5. Stages (Miel style - Clean steps) */}
      <section className="bg-[#F5F5F5] py-24 text-[#000A0D]">
        <div className="mx-auto max-w-7xl px-4">
          <Heading size="h2" className="mb-16 text-center">Этапы работы</Heading>
          
          <div className="grid gap-8 md:grid-cols-3 lg:grid-cols-5">
            {[
              { num: '01', title: 'Заявка', text: 'Оставляете заявку на сайте или по телефону' },
              { num: '02', title: 'Подбор', text: 'Формируем персональную подборку объектов' },
              { num: '03', title: 'Показ', text: 'Организуем просмотры в удобное время' },
              { num: '04', title: 'Сделка', text: 'Полное юридическое сопровождение' },
              { num: '05', title: 'Ключи', text: 'Поздравляем вас с новосельем' },
            ].map((step) => (
              <div key={step.num} className="group relative pt-8">
                <div className="absolute top-0 h-[1px] w-full bg-gray-200 transition-colors group-hover:bg-[#000A0D]" />
                <div className="text-4xl font-light text-gray-300 transition-colors group-hover:text-accent">{step.num}</div>
                <Heading size="h4" className="mt-4">{step.title}</Heading>
                <Text size="sm" className="mt-2 text-gray-500">{step.text}</Text>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Mission (Text block) */}
      <section className="bg-[#E5E5E5] py-24 text-[#000A0D]">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <Heading size="h6" className="mb-8 font-bold uppercase tracking-widest text-gray-500">Миссия</Heading>
          <Text size="lg" className="leading-relaxed font-light md:text-4xl">
            «Мы не просто продаем квадратные метры. Мы помогаем людям найти дом, где они будут счастливы, и создаем безопасное пространство для принятия важных решений»
          </Text>
          <div className="mt-8 flex justify-center gap-4">
             <div className="h-12 w-12 rounded-full bg-gray-200 overflow-hidden">
                <img src="https://ui-avatars.com/api/?name=Саша&background=random" alt="Founder" />
             </div>
             <div className="h-12 w-12 rounded-full bg-gray-200 overflow-hidden">
                <img src="https://ui-avatars.com/api/?name=Настя&background=random" alt="Co-founder" />
             </div>
          </div>
        </div>
      </section>

      {/* 7. Team */}
      <section id="team" className="bg-[#F5F5F5] py-24 text-[#000A0D]">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-12 flex items-end justify-between">
            <Heading size="h2">Команда</Heading>
            <Button variant="outline" className="border-gray-200 text-black hover:bg-gray-50">
               Вся команда
            </Button>
          </div>
          
          <div className="grid gap-8 md:grid-cols-4">
             {(home?.home.team.founders || []).map((f) => (
                <div key={f.name} className="group cursor-pointer">
                  <div className="aspect-[3/4] overflow-hidden rounded-sm bg-gray-100">
                    {f.photo_url ? (
                       <img src={f.photo_url} alt={f.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                       <div className="flex h-full w-full items-center justify-center text-gray-400">Нет фото</div>
                    )}
                  </div>
                  <div className="mt-4">
                    <Text size="lg" weight="medium">{f.name}</Text>
                    <Text size="sm" muted>{f.role}</Text>
                  </div>
                </div>
             ))}
             {/* Placeholders for team members */}
             {[1, 2].map((i) => (
                <div key={i} className="group cursor-pointer">
                  <div className="aspect-[3/4] overflow-hidden rounded-sm bg-gray-100">
                     <img src={`https://ui-avatars.com/api/?name=Agent+${i}&size=400`} alt="Agent" className="h-full w-full object-cover grayscale transition-all group-hover:grayscale-0" />
                  </div>
                  <div className="mt-4">
                    <Text size="lg" weight="medium">Имя Фамилия</Text>
                    <Text size="sm" muted>Ведущий брокер</Text>
                  </div>
                </div>
             ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  )
}

function CollectionCard({ item }: { item: Collection }) {
  const navigate = useNavigate()
  return (
    <div 
      onClick={() => navigate(`/collection/${item.id}`)}
      className="group cursor-pointer"
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-sm bg-gray-800">
        {item.cover_image ? (
          <img src={item.cover_image} alt={item.title} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : null}
        <div className="absolute top-4 left-4 bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-wider text-black">
          Подборка
        </div>
      </div>
      <div className="mt-4">
        <Heading size="h4" className="text-white group-hover:text-accent transition-colors">{item.title}</Heading>
        {item.description && <Text size="sm" className="mt-1 text-gray-400 line-clamp-2">{item.description}</Text>}
      </div>
    </div>
  )
}
