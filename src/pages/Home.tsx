import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, LayoutGrid, Users, Award, ShieldCheck, Lock, MapPin, Star, ExternalLink } from 'lucide-react'
import SiteLayout from '@/components/layout/SiteLayout'
import Button from '@/components/ui/Button'
import { Heading, Text } from '@/components/ui/Typography'
import PropertyCard from '@/components/catalog/PropertyCard'
import ComplexCard from '@/components/catalog/ComplexCard'
import { apiGet } from '@/lib/api'
import { useUiStore } from '@/store/useUiStore'
import { trackEvent } from '@/lib/analytics'
import Roadmap from '@/components/Roadmap'
import type { Collection, Complex, HomeContent, Property } from '../../shared/types'

type HomeApi = {
  home: HomeContent
  featured: { complexes: Complex[]; properties: Property[]; collections: Collection[] }
}

const CATALOG_CATEGORIES = [
  {
    title: 'Новостройки',
    tab: 'newbuild',
    image:
      'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=modern%20skyscraper%20architecture%20abstract%2C%20glass%20facade%2C%20dark%20mood&image_size=square',
  },
  {
    title: 'Вторичная',
    tab: 'secondary',
    image:
      'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=luxury%20classic%20apartment%20interior%2C%20dark%20mood%2C%20elegant&image_size=square',
  },
  {
    title: 'Аренда',
    tab: 'rent',
    image:
      'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cozy%20modern%20living%20room%20evening%2C%20warm%20light%2C%20dark%20mood&image_size=square',
  },
]

const TEAM_QUOTES = [
  'Мы отвечаем за результат лично — от первой встречи до ключей.',
  'Сделка должна быть прозрачной, спокойной и выгодной для клиента.',
]

const FALLBACK_TEAM = [
  { name: 'Анастасия Шулепова', role: 'Партнёр, жилая недвижимость', photo_url: '' },
  { name: 'Александр Шулепов', role: 'Партнёр, инвестиции и аренда', photo_url: '' },
]

export default function Home() {
  const navigate = useNavigate()
  const { openLeadModal } = useUiStore()
  const [home, setHome] = useState<HomeApi | null>(null)

  useEffect(() => {
    apiGet<HomeApi>('/api/home').then(setHome).catch(() => setHome(null))
  }, [])

  const teamMembers = (home?.home?.team?.founders?.length ? home.home.team.founders : FALLBACK_TEAM).slice(0, 2)


  return (
    <SiteLayout>
      {/* 1. Hero Section - Full Screen */}
      <section className="relative h-[calc(100svh-72px)] min-h-[520px] w-full overflow-hidden bg-background md:h-[calc(100vh-80px)] md:min-h-[600px]">
        <div className="absolute inset-0">
          <img src="/hero-bg.jpg" alt="Luxury Real Estate" className="h-full w-full object-cover opacity-60 max-w-full max-h-full scale-110" style={{ objectPosition: 'center 20%' }} />
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/40 to-transparent" />
        </div>
        
        <div className="relative mx-auto flex h-full w-full max-w-[1400px] flex-col justify-center px-4 pb-12 pt-8 sm:pt-10 md:pb-20">
          <Heading size="h1" className="w-full text-left text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-7xl lg:text-9xl xl:text-[10rem]">
            <span className="block">Эксперты</span>
            <span className="block text-gray-400">по недвижимости</span>
          </Heading>

          <Text className="mt-4 max-w-lg text-base text-gray-400 sm:mt-6 sm:text-lg">
            Ваша безопасная сделка — наша репутация
          </Text>

          <div className="mt-4 flex">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300 backdrop-blur sm:px-4 sm:text-sm">
              <span className="h-2 w-2 rounded-full bg-accent" />
              13 лет на рынке недвижимости
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:gap-4">
            <Button
              variant="default"
              className="h-12 w-full px-6 text-base sm:h-14 sm:w-auto sm:px-8 sm:text-lg"
              onClick={() => {
                trackEvent('click_consultation', { page: 'home', block: 'hero' })
                openLeadModal('consultation', { page: 'home', block: 'hero' })
              }}
            >
              Получить консультацию
            </Button>
            <Button
              variant="outline"
              className="h-12 w-full border-white/20 px-6 text-base text-white hover:bg-white/10 hover:text-white sm:h-14 sm:w-auto sm:px-8 sm:text-lg"
              onClick={() => {
                trackEvent('click_catalog', { page: 'home', block: 'hero' })
                navigate('/catalog')
              }}
            >
              Смотреть объекты
            </Button>
          </div>
        </div>
      </section>

      {/* 2. Catalog Categories (Whitewill style blocks) */}
      <section id="catalog-categories" className="bg-background py-20">
        <div className="mx-auto max-w-7xl px-4">
          <div className="grid gap-6 md:grid-cols-3">
            {CATALOG_CATEGORIES.map((item) => (
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

          {/* Купить / Продать / Сдать CTA */}
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {/* Купить недвижимость */}
            <div
              onClick={() => {
                trackEvent('click_buy_sell', { page: 'home', block: 'buy_cta', tab: 'buy' })
                openLeadModal('buy_sell', { page: 'home', block: 'buy_cta' }, { initialTab: 'buy' })
              }}
              className="group relative flex min-h-[180px] cursor-pointer items-stretch overflow-hidden rounded-sm border border-white/10 transition-colors hover:border-white/25 sm:min-h-[220px]"
            >
              <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-10">
                <Heading size="h3" className="font-serif text-2xl font-normal leading-tight text-white lg:text-3xl">
                  Купить<br />недвижимость
                </Heading>
              </div>
              <div className="relative hidden w-1/2 overflow-hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80"
                  alt="Купить недвижимость"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />
              </div>
            </div>

            {/* Продать недвижимость */}
            <div
              onClick={() => {
                trackEvent('click_buy_sell', { page: 'home', block: 'sell_cta', tab: 'sell' })
                openLeadModal('buy_sell', { page: 'home', block: 'sell_cta' }, { initialTab: 'sell' })
              }}
              className="group relative flex min-h-[180px] cursor-pointer items-stretch overflow-hidden rounded-sm border border-white/10 transition-colors hover:border-white/25 sm:min-h-[220px]"
            >
              <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-10">
                <Heading size="h3" className="font-serif text-2xl font-normal leading-tight text-white lg:text-3xl">
                  Продать<br />недвижимость
                </Heading>
              </div>
              <div className="relative hidden w-1/2 overflow-hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80"
                  alt="Продать недвижимость"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />
              </div>
            </div>

            {/* Сдать недвижимость */}
            <div
              onClick={() => {
                trackEvent('click_buy_sell', { page: 'home', block: 'rent_cta', tab: 'sell' })
                openLeadModal('consultation', { page: 'home', block: 'rent_cta' })
              }}
              className="group relative flex min-h-[180px] cursor-pointer items-stretch overflow-hidden rounded-sm border border-white/10 transition-colors hover:border-white/25 sm:min-h-[220px]"
            >
              <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-10">
                <Heading size="h3" className="font-serif text-2xl font-normal leading-tight text-white lg:text-3xl">
                  Сдать<br />недвижимость
                </Heading>
              </div>
              <div className="relative hidden w-1/2 overflow-hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80"
                  alt="Сдать недвижимость"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Best Offers (Featured) */}
      <section className="bg-background py-16 text-white md:py-24">
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

      {/* 5. Почему выбирают нас */}
      <section className="relative overflow-hidden bg-[linear-gradient(180deg,_#FFFFFF,_#F6F4EF)] py-16 text-background md:py-24">
        <div className="pointer-events-none absolute -top-16 left-0 h-64 w-64 rounded-full bg-[#E7EEF6] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-0 h-56 w-56 rounded-full bg-[#EFE7D9] blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4">
          <Heading size="h2">Почему выбирают нас</Heading>
          <Text className="mt-2 mb-12 text-gray-500">Мы делаем всё, чтобы каждая сделка прошла безупречно</Text>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: LayoutGrid, title: 'Широкий выбор', desc: 'Доступ к объектам от застройщиков и на вторичном рынке. Новостройки, вторичка, аренда — всё в одном месте.' },
              { icon: Users, title: 'Индивидуальный подход', desc: 'Подбираем недвижимость с учётом ваших целей, бюджета и предпочтений. Каждый клиент — уникален.' },
              { icon: Award, title: 'Профессионализм', desc: 'Экспертиза рынка, точная оценка и грамотные переговоры. Работаем на результат.' },
              { icon: ShieldCheck, title: 'Юридическая чистота', desc: 'Проверяем каждый объект: документы, обременения, история. Вы получаете только проверенные варианты.' },
              { icon: Lock, title: 'Безопасность сделки', desc: 'Сопровождаем на каждом этапе — от задатка до регистрации права собственности.' },
              { icon: MapPin, title: 'Удобный офис в центре Москвы', desc: 'Встречаемся в комфортной обстановке для обсуждения деталей и подписания документов.' },
            ].map((item) => (
              <div key={item.title} className="group rounded-xl border border-black/5 bg-white/80 p-8 shadow-sm transition-colors hover:border-black/10">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-background/5 text-background">
                  <item.icon className="h-6 w-6" />
                </div>
                <Heading size="h4">{item.title}</Heading>
                <Text size="sm" className="mt-2 text-gray-500">{item.desc}</Text>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Стоимость услуг */}
      <section className="relative overflow-hidden bg-[linear-gradient(180deg,_#FFFFFF,_#F6F4EF)] py-16 text-background md:py-24">
        <div className="pointer-events-none absolute -top-20 right-0 h-64 w-64 rounded-full bg-[#E7EEF6] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-0 h-56 w-56 rounded-full bg-[#EFE7D9] blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4">
          <Heading size="h2" className="text-center">Стоимость услуг</Heading>

          {/* Главный акцент — бесплатно */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border-2 border-accent/30 bg-accent/5 p-8 text-center shadow-sm">
            <Text size="sm" className="uppercase tracking-widest text-accent">Новостройки</Text>
            <div className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl md:text-7xl">Бесплатно</div>
            <Text size="lg" className="mt-3 text-gray-600">
              Подбор новостройки от застройщика — без комиссии для покупателя
            </Text>
            <Button
              variant="dark"
              className="mt-6 h-12 px-8"
              onClick={() => {
                trackEvent('click_pricing_cta', { page: 'home', block: 'pricing_free' })
                openLeadModal('consultation', { page: 'home', block: 'pricing_free' })
              }}
            >
              Получить подборку
            </Button>
          </div>

          {/* Остальные услуги */}
          <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Подбор вторички', value: 'от 2,5%', sub: 'от стоимости' },
              { label: 'Продажа', value: 'от 3%', sub: 'от стоимости' },
              { label: 'Аренда', value: 'от 50%', sub: 'месячной ставки' },
              { label: 'Юр. сопровождение', value: 'от 100 000 ₽' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-black/5 bg-white/80 p-5 shadow-sm text-center">
                <Text size="sm" className="text-gray-500">{s.label}</Text>
                <div className="mt-2 text-xl font-semibold">{s.value}</div>
                {s.sub && <Text size="sm" className="text-gray-400">{s.sub}</Text>}
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Text className="text-gray-500">
              Точная стоимость формируется индивидуально и зависит от типа сделки и объёма работ.
            </Text>
            <Button
              variant="dark"
              className="mt-4 h-12 px-8"
              onClick={() => {
                trackEvent('click_pricing_cta', { page: 'home', block: 'pricing' })
                openLeadModal('consultation', { page: 'home', block: 'pricing' })
              }}
            >
              Узнать точную стоимость
            </Button>
          </div>
        </div>
      </section>

      {/* 7. Roadmap */}
      <Roadmap />

      {/* 6. Mission */}
      <section className="relative w-full overflow-hidden py-16 md:py-32">
        {/* Background Image */}
        <div className="absolute inset-0">
          <img 
            src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?ixlib=rb-4.0.3&auto=format&fit=crop&w=1974&q=80" 
            alt="Mission Background" 
            className="h-full w-full object-cover"
          />
          {/* Soft white gradient overlay to blend with card */}
          <div className="absolute inset-0 bg-white/20" />
        </div>

        <div className="relative mx-auto max-w-5xl px-4">
          <div className="rounded-3xl border border-white/50 bg-white/70 p-6 text-center shadow-sm backdrop-blur-md sm:p-8 md:p-16">
            <Heading size="h6" className="mb-6 text-sm font-bold uppercase tracking-[0.2em] text-gray-500">Миссия</Heading>
            
            <Text className="mx-auto max-w-4xl text-lg font-light leading-snug text-slate-800 sm:text-xl md:text-3xl lg:text-4xl">
              «Мы не просто продаем квадратные метры. Мы помогаем людям найти дом, где они будут счастливы, и создаем безопасное пространство для принятия важных решений»
            </Text>
            
            <div className="mt-10 flex justify-center gap-4">
               <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#9FB4FF] text-white font-medium text-sm shadow-sm">
                  СА
               </div>
               <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#6B9E78] text-white font-medium text-sm shadow-sm">
                  НА
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Team */}
      <section id="team" className="relative overflow-hidden bg-[linear-gradient(180deg,_#F7F7F7,_#EFEDE8)] py-16 text-[#0B1115] md:py-24">
        <div className="pointer-events-none absolute -left-16 -top-16 h-72 w-72 rounded-full bg-[#DDE6F4] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-[#E6DCCB] blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4">
          <div className="mb-12">
            <Heading size="h2">Команда</Heading>
            <Text className="mt-3 max-w-2xl text-sm text-slate-600">
              Два эксперта, которые ведут сделки лично и несут ответственность за каждый этап.
            </Text>
          </div>

          <div className="grid gap-10 md:grid-cols-2">
            {teamMembers.map((f, idx) => (
              <div key={f.name} className="group grid items-center gap-6 rounded-3xl border border-black/5 bg-white/90 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.12)] backdrop-blur md:grid-cols-[220px_1fr]">
                <div className="relative overflow-hidden rounded-2xl bg-gray-100">
                  <div className="aspect-[3/4]">
                    {f.photo_url ? (
                      <img src={f.photo_url} alt={f.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <img
                        src={`https://ui-avatars.com/api/?name=${encodeURIComponent(f.name)}&size=600&background=F1F3F6&color=0B1115`}
                        alt={f.name}
                        className="h-full w-full object-cover grayscale"
                      />
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <Text size="lg" weight="medium">{f.name}</Text>
                    <Text size="sm" muted>{f.role}</Text>
                  </div>
                  <div className="relative pl-7">
                    <span className="absolute left-0 top-0 text-3xl font-semibold text-slate-300">&ldquo;</span>
                    <p className="text-sm italic text-slate-600">{TEAM_QUOTES[idx] || TEAM_QUOTES[0]}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* 9. Отзывы */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-4">
          <Heading size="h2" className="text-white">Отзывы клиентов</Heading>
          <Text className="mt-2 mb-12 text-gray-400">Реальные истории людей, которым мы помогли</Text>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                name: 'Мария Иванова',
                text: 'Обратились за помощью в покупке квартиры в новостройке. Подобрали идеальный вариант за неделю. Сделка прошла гладко, всё юридически чисто.',
                rating: 5,
                source: 'Яндекс Карты',
                sourceUrl: '#',
              },
              {
                name: 'Алексей Петров',
                text: 'Продали квартиру по максимальной цене. Риэлтор вёл переговоры профессионально, покупатель найден за 3 недели. Рекомендую!',
                rating: 5,
                source: 'Google',
                sourceUrl: '#',
              },
              {
                name: 'Екатерина Смирнова',
                text: 'Снимали квартиру через агентство. Всё честно, без скрытых комиссий. Помогли с договором и проверили собственника. Спасибо!',
                rating: 5,
                source: 'ЦИАН',
                sourceUrl: '#',
              },
              {
                name: 'Дмитрий Козлов',
                text: 'Инвестировал в новостройку по рекомендации агентства. Объект уже вырос в цене на 15%. Грамотная аналитика и поддержка на всех этапах.',
                rating: 5,
                source: 'Яндекс Карты',
                sourceUrl: '#',
              },
              {
                name: 'Ольга Новикова',
                text: 'Долго не могли продать загородный дом. RWGroup оценили, сделали качественные фото и нашли покупателя за месяц. Очень довольны!',
                rating: 5,
                source: 'Google',
                sourceUrl: '#',
              },
              {
                name: 'Сергей Волков',
                text: 'Сопровождение сделки было на высшем уровне. Юрист проверил все документы, объяснил каждый пункт. Чувствовали себя в безопасности.',
                rating: 5,
                source: 'Яндекс Карты',
                sourceUrl: '#',
              },
            ].map((review) => (
              <div key={review.name} className="flex flex-col rounded-sm border border-white/10 p-6">
                <div className="mb-3 flex gap-1">
                  {Array.from({ length: review.rating }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="flex-1 text-sm leading-relaxed text-gray-300">
                  &laquo;{review.text}&raquo;
                </p>
                <div className="mt-5 flex items-center justify-between">
                  <div>
                    <Text size="sm" weight="medium" className="text-white">{review.name}</Text>
                  </div>
                  <a
                    href={review.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-300"
                  >
                    {review.source} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* 10. Стать партнёром */}
      <section className="relative overflow-hidden bg-[linear-gradient(180deg,_#FFFFFF,_#F6F4EF)] py-16 text-background md:py-24">
        <div className="pointer-events-none absolute -top-16 right-0 h-64 w-64 rounded-full bg-[#E7EEF6] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-0 h-56 w-56 rounded-full bg-[#EFE7D9] blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <Heading size="h2">Стать партнёром</Heading>
              <Text size="lg" className="mt-4 max-w-lg text-gray-600">
                Мы открыты к сотрудничеству с застройщиками, агентствами и частными риэлторами. Вместе мы сможем предложить клиентам лучший сервис.
              </Text>
              <div className="mt-8 space-y-4">
                {[
                  'Совместные сделки и рекомендации',
                  'Доступ к закрытой базе объектов',
                  'Прозрачные условия и быстрые выплаты',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-white text-xs">✓</div>
                    <Text className="text-gray-700">{item}</Text>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-black/5 bg-white/80 p-8 shadow-sm">
              <Heading size="h4" className="mb-6">Оставьте заявку</Heading>
              <div className="space-y-4">
                <Button
                  variant="dark"
                  className="h-12 w-full px-8"
                  onClick={() => {
                    trackEvent('click_partner', { page: 'home', block: 'partner' })
                    openLeadModal('partner', { page: 'home', block: 'partner' })
                  }}
                >
                  Стать партнёром
                </Button>
                <Text size="sm" className="text-center text-gray-400">
                  Мы свяжемся с вами в течение рабочего дня
                </Text>
              </div>
            </div>
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
