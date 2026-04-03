import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, LayoutGrid, Users, Award, ShieldCheck, Lock, MapPin, Star, ExternalLink } from 'lucide-react'
import SiteLayout from '@/components/layout/SiteLayout'
import JsonLd from '@/components/seo/JsonLd'
import { resetPageMeta } from '@/lib/meta'
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
    title: 'РќРѕРІРѕСЃС‚СЂРѕР№РєРё',
    tab: 'newbuild',
    image:
      'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=modern%20skyscraper%20architecture%20abstract%2C%20glass%20facade%2C%20dark%20mood&image_size=square',
  },
  {
    title: 'Р’С‚РѕСЂРёС‡РЅР°СЏ',
    tab: 'secondary',
    image:
      'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=luxury%20classic%20apartment%20interior%2C%20dark%20mood%2C%20elegant&image_size=square',
  },
  {
    title: 'РђСЂРµРЅРґР°',
    tab: 'rent',
    image:
      'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cozy%20modern%20living%20room%20evening%2C%20warm%20light%2C%20dark%20mood&image_size=square',
  },
]

const TEAM_QUOTES = [
  'РњС‹ РѕС‚РІРµС‡Р°РµРј Р·Р° СЂРµР·СѓР»СЊС‚Р°С‚ Р»РёС‡РЅРѕ вЂ” РѕС‚ РїРµСЂРІРѕР№ РІСЃС‚СЂРµС‡Рё РґРѕ РєР»СЋС‡РµР№.',
  'РЎРґРµР»РєР° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РїСЂРѕР·СЂР°С‡РЅРѕР№, СЃРїРѕРєРѕР№РЅРѕР№ Рё РІС‹РіРѕРґРЅРѕР№ РґР»СЏ РєР»РёРµРЅС‚Р°.',
]

const FALLBACK_TEAM = [
  { name: 'РђРЅР°СЃС‚Р°СЃРёСЏ РЁСѓР»РµРїРѕРІР°', role: 'РџР°СЂС‚РЅС‘СЂ, Р¶РёР»Р°СЏ РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ', photo_url: '' },
  { name: 'РђР»РµРєСЃР°РЅРґСЂ РЁСѓР»РµРїРѕРІ', role: 'РџР°СЂС‚РЅС‘СЂ, РёРЅРІРµСЃС‚РёС†РёРё Рё Р°СЂРµРЅРґР°', photo_url: '' },
]

export default function Home() {
  const navigate = useNavigate()
  const { openLeadModal } = useUiStore()
  const [home, setHome] = useState<HomeApi | null>(null)

  useEffect(() => {
    resetPageMeta()
  }, [])

  useEffect(() => {
    apiGet<HomeApi>('/api/home').then(setHome).catch(() => setHome(null))
  }, [])

  const teamMembers = (home?.home?.team?.founders?.length ? home.home.team.founders : FALLBACK_TEAM).slice(0, 2)

  const organizationLd = {
    '@context': 'https://schema.org',
    '@type': ['RealEstateAgent', 'Organization'],
    name: 'RWgroup',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://rwgroup.ru',
    logo: typeof window !== 'undefined' ? `${window.location.origin}/logo.svg` : 'https://rwgroup.ru/logo.svg',
    telephone: '+7 (495) 410-15-68',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'РљСѓС‚СѓР·РѕРІСЃРєРёР№ РїСЂ-С‚ 36 Рђ',
      addressLocality: 'РњРѕСЃРєРІР°',
      addressCountry: 'RU',
    },
    description: 'Р­РєСЃРїРµСЂС‚С‹ РїРѕ РЅРµРґРІРёР¶РёРјРѕСЃС‚Рё. РќРѕРІРѕСЃС‚СЂРѕР№РєРё, РІС‚РѕСЂРёС‡РЅРѕРµ Р¶РёР»СЊС‘, Р°СЂРµРЅРґР°. РџРѕРґР±РѕСЂ, СЃРѕРїСЂРѕРІРѕР¶РґРµРЅРёРµ СЃРґРµР»РєРё, СЋСЂРёРґРёС‡РµСЃРєР°СЏ РїСЂРѕРІРµСЂРєР°.',
    sameAs: [],
  }

  return (
    <SiteLayout>
      <JsonLd data={organizationLd} />
      {/* 1. Hero Section - Full Screen */}
      <section className="relative h-[calc(100svh-72px)] min-h-[520px] w-full overflow-hidden bg-background md:h-[calc(100vh-80px)] md:min-h-[620px]">
        <div className="absolute inset-0">
          <img
            src="/hero-bg.png"
            alt="Luxury Real Estate"
            className="h-full w-full max-h-full max-w-full object-cover object-[70%_8%] opacity-60 sm:object-[72%_10%] lg:object-[74%_12%]"
          />
          <div className="absolute inset-0 bg-background/72" />
        </div>

        <div className="relative mx-auto flex h-full w-full max-w-[1400px] flex-col justify-center px-4 pb-12 pt-8 sm:px-6 sm:pt-10 md:px-8 md:pb-20">
          <div className="max-w-[860px]">
            <Heading
              size="h1"
              className="text-left text-[clamp(2.7rem,7.8vw,7.4rem)] font-bold leading-[0.9] tracking-[-0.02em] text-white"
            >
              <span className="block">Р­РєСЃРїРµСЂС‚С‹ РїРѕ</span>
              <span className="block text-slate-300">РЅРµРґРІРёР¶РёРјРѕСЃС‚Рё</span>
            </Heading>

            <Text className="mt-4 max-w-lg text-base text-gray-400 sm:mt-6 sm:text-lg">
              Р’Р°С€Р° Р±РµР·РѕРїР°СЃРЅР°СЏ СЃРґРµР»РєР° вЂ” РЅР°С€Р° СЂРµРїСѓС‚Р°С†РёСЏ
            </Text>

            <div className="mt-4 flex">
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300 backdrop-blur sm:px-4 sm:text-sm">
                <span className="h-2 w-2 rounded-full bg-accent" />
                13 Р»РµС‚ РЅР° СЂС‹РЅРєРµ РЅРµРґРІРёР¶РёРјРѕСЃС‚Рё
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
                РџРѕР»СѓС‡РёС‚СЊ РєРѕРЅСЃСѓР»СЊС‚Р°С†РёСЋ
              </Button>
              <Button
                variant="outline"
                className="h-12 w-full border-white/20 px-6 text-base text-white hover:bg-white/10 hover:text-white sm:h-14 sm:w-auto sm:px-8 sm:text-lg"
                onClick={() => {
                  trackEvent('click_catalog', { page: 'home', block: 'hero' })
                  navigate('/catalog')
                }}
              >
                РЎРјРѕС‚СЂРµС‚СЊ РѕР±СЉРµРєС‚С‹
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Catalog Categories (Whitewill style blocks) */}
      <section id="catalog-categories" className="bg-[#0B1620] py-20">
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
                    РџРµСЂРµР№С‚Рё РІ РєР°С‚Р°Р»РѕРі <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* РљСѓРїРёС‚СЊ / РџСЂРѕРґР°С‚СЊ / РЎРґР°С‚СЊ CTA */}
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {/* РљСѓРїРёС‚СЊ РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ */}
            <div
              onClick={() => {
                trackEvent('click_buy_sell', { page: 'home', block: 'buy_cta', tab: 'buy' })
                openLeadModal('buy_sell', { page: 'home', block: 'buy_cta' }, { initialTab: 'buy' })
              }}
              className="group relative flex min-h-[180px] cursor-pointer items-stretch overflow-hidden rounded-sm border border-white/10 transition-colors hover:border-white/25 sm:min-h-[220px]"
            >
              <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-10">
                <Heading size="h3" className="font-serif text-2xl font-normal leading-tight text-white lg:text-3xl">
                  РљСѓРїРёС‚СЊ<br />РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ
                </Heading>
              </div>
              <div className="relative hidden w-1/2 overflow-hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80"
                  alt="РљСѓРїРёС‚СЊ РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-background/55" />
              </div>
            </div>

            {/* РџСЂРѕРґР°С‚СЊ РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ */}
            <div
              onClick={() => {
                trackEvent('click_buy_sell', { page: 'home', block: 'sell_cta', tab: 'sell' })
                openLeadModal('buy_sell', { page: 'home', block: 'sell_cta' }, { initialTab: 'sell' })
              }}
              className="group relative flex min-h-[180px] cursor-pointer items-stretch overflow-hidden rounded-sm border border-white/10 transition-colors hover:border-white/25 sm:min-h-[220px]"
            >
              <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-10">
                <Heading size="h3" className="font-serif text-2xl font-normal leading-tight text-white lg:text-3xl">
                  РџСЂРѕРґР°С‚СЊ<br />РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ
                </Heading>
              </div>
              <div className="relative hidden w-1/2 overflow-hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80"
                  alt="РџСЂРѕРґР°С‚СЊ РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-background/55" />
              </div>
            </div>

            {/* РЎРґР°С‚СЊ РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ */}
            <div
              onClick={() => {
                trackEvent('click_buy_sell', { page: 'home', block: 'rent_cta', tab: 'sell' })
                openLeadModal('consultation', { page: 'home', block: 'rent_cta' })
              }}
              className="group relative flex min-h-[180px] cursor-pointer items-stretch overflow-hidden rounded-sm border border-white/10 transition-colors hover:border-white/25 sm:min-h-[220px]"
            >
              <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-10">
                <Heading size="h3" className="font-serif text-2xl font-normal leading-tight text-white lg:text-3xl">
                  РЎРґР°С‚СЊ<br />РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ
                </Heading>
              </div>
              <div className="relative hidden w-1/2 overflow-hidden sm:block">
                <img
                  src="https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80"
                  alt="РЎРґР°С‚СЊ РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-background/55" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Best Offers (Featured) */}
      <section className="bg-[#101E2A] py-16 text-white md:py-24">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-12 flex items-end justify-between">
            <div>
              <Heading size="h2" className="text-white">Р›СѓС‡С€РёРµ РїСЂРµРґР»РѕР¶РµРЅРёСЏ</Heading>
              <Text className="mt-2 text-slate-300">РђРєС‚СѓР°Р»СЊРЅС‹Рµ Р»РѕС‚С‹ Рё РїСЂРѕРµРєС‚С‹ СЌС‚РѕР№ РЅРµРґРµР»Рё</Text>
            </div>
            <Link to="/catalog" className="hidden items-center gap-2 text-sm font-medium hover:text-accent md:flex">
              РЎРјРѕС‚СЂРµС‚СЊ РІСЃРµ <ArrowRight className="h-4 w-4" />
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
               РЎРјРѕС‚СЂРµС‚СЊ РІСЃРµ <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 5. РџРѕС‡РµРјСѓ РІС‹Р±РёСЂР°СЋС‚ РЅР°СЃ */}
      <section className="relative overflow-hidden bg-[#0F1D28] py-16 text-white md:py-24">
        <div className="pointer-events-none absolute left-[-140px] top-24 h-80 w-80 rounded-full bg-[#1B3143]/35" />
        <div className="pointer-events-none absolute right-[-120px] bottom-10 h-72 w-72 rounded-full bg-[#22394C]/30" />
        <div className="relative z-10 mx-auto max-w-7xl px-4">
          <Heading size="h2">РџРѕС‡РµРјСѓ РІС‹Р±РёСЂР°СЋС‚ РЅР°СЃ</Heading>
          <Text className="mt-2 mb-12 text-slate-300">РњС‹ РґРµР»Р°РµРј РІСЃС‘, С‡С‚РѕР±С‹ РєР°Р¶РґР°СЏ СЃРґРµР»РєР° РїСЂРѕС€Р»Р° Р±РµР·СѓРїСЂРµС‡РЅРѕ</Text>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: LayoutGrid, title: 'РЁРёСЂРѕРєРёР№ РІС‹Р±РѕСЂ', desc: 'Р”РѕСЃС‚СѓРї Рє РѕР±СЉРµРєС‚Р°Рј РѕС‚ Р·Р°СЃС‚СЂРѕР№С‰РёРєРѕРІ Рё РЅР° РІС‚РѕСЂРёС‡РЅРѕРј СЂС‹РЅРєРµ. РќРѕРІРѕСЃС‚СЂРѕР№РєРё, РІС‚РѕСЂРёС‡РєР°, Р°СЂРµРЅРґР° вЂ” РІСЃС‘ РІ РѕРґРЅРѕРј РјРµСЃС‚Рµ.' },
              { icon: Users, title: 'РРЅРґРёРІРёРґСѓР°Р»СЊРЅС‹Р№ РїРѕРґС…РѕРґ', desc: 'РџРѕРґР±РёСЂР°РµРј РЅРµРґРІРёР¶РёРјРѕСЃС‚СЊ СЃ СѓС‡С‘С‚РѕРј РІР°С€РёС… С†РµР»РµР№, Р±СЋРґР¶РµС‚Р° Рё РїСЂРµРґРїРѕС‡С‚РµРЅРёР№. РљР°Р¶РґС‹Р№ РєР»РёРµРЅС‚ вЂ” СѓРЅРёРєР°Р»РµРЅ.' },
              { icon: Award, title: 'РџСЂРѕС„РµСЃСЃРёРѕРЅР°Р»РёР·Рј', desc: 'Р­РєСЃРїРµСЂС‚РёР·Р° СЂС‹РЅРєР°, С‚РѕС‡РЅР°СЏ РѕС†РµРЅРєР° Рё РіСЂР°РјРѕС‚РЅС‹Рµ РїРµСЂРµРіРѕРІРѕСЂС‹. Р Р°Р±РѕС‚Р°РµРј РЅР° СЂРµР·СѓР»СЊС‚Р°С‚.' },
              { icon: ShieldCheck, title: 'Р®СЂРёРґРёС‡РµСЃРєР°СЏ С‡РёСЃС‚РѕС‚Р°', desc: 'РџСЂРѕРІРµСЂСЏРµРј РєР°Р¶РґС‹Р№ РѕР±СЉРµРєС‚: РґРѕРєСѓРјРµРЅС‚С‹, РѕР±СЂРµРјРµРЅРµРЅРёСЏ, РёСЃС‚РѕСЂРёСЏ. Р’С‹ РїРѕР»СѓС‡Р°РµС‚Рµ С‚РѕР»СЊРєРѕ РїСЂРѕРІРµСЂРµРЅРЅС‹Рµ РІР°СЂРёР°РЅС‚С‹.' },
              { icon: Lock, title: 'Р‘РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ СЃРґРµР»РєРё', desc: 'РЎРѕРїСЂРѕРІРѕР¶РґР°РµРј РЅР° РєР°Р¶РґРѕРј СЌС‚Р°РїРµ вЂ” РѕС‚ Р·Р°РґР°С‚РєР° РґРѕ СЂРµРіРёСЃС‚СЂР°С†РёРё РїСЂР°РІР° СЃРѕР±СЃС‚РІРµРЅРЅРѕСЃС‚Рё.' },
              { icon: MapPin, title: 'РЈРґРѕР±РЅС‹Р№ РѕС„РёСЃ РІ С†РµРЅС‚СЂРµ РњРѕСЃРєРІС‹', desc: 'Р’СЃС‚СЂРµС‡Р°РµРјСЃСЏ РІ РєРѕРјС„РѕСЂС‚РЅРѕР№ РѕР±СЃС‚Р°РЅРѕРІРєРµ РґР»СЏ РѕР±СЃСѓР¶РґРµРЅРёСЏ РґРµС‚Р°Р»РµР№ Рё РїРѕРґРїРёСЃР°РЅРёСЏ РґРѕРєСѓРјРµРЅС‚РѕРІ.' },
            ].map((item) => (
              <div key={item.title} className="group rounded-xl border border-white/10 bg-white/[0.04] p-8 shadow-sm transition-colors hover:border-[#C2A87A]/45">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 text-[#D8C4A3]">
                  <item.icon className="h-6 w-6" />
                </div>
                <Heading size="h4">{item.title}</Heading>
                <Text size="sm" className="mt-2 text-slate-300">{item.desc}</Text>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. РЎС‚РѕРёРјРѕСЃС‚СЊ СѓСЃР»СѓРі */}
      <section className="relative overflow-hidden bg-[#F3EEE4] py-16 text-background md:py-24">
        <div className="pointer-events-none absolute right-[-140px] top-12 h-80 w-80 rounded-full bg-[#E7DCC8]/22" />
        <div className="pointer-events-none absolute left-[-120px] bottom-12 h-72 w-72 rounded-full bg-[#D6E0EC]/18" />
        <div className="relative z-10 mx-auto max-w-7xl px-4">
          <Heading size="h2" className="text-center">РЎС‚РѕРёРјРѕСЃС‚СЊ СѓСЃР»СѓРі</Heading>

          {/* Р“Р»Р°РІРЅС‹Р№ Р°РєС†РµРЅС‚ вЂ” Р±РµСЃРїР»Р°С‚РЅРѕ */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border-2 border-[#C2A87A]/40 bg-[#C2A87A]/10 p-8 text-center shadow-sm">
            <Text size="sm" className="uppercase tracking-widest text-[#9C7E54]">РќРѕРІРѕСЃС‚СЂРѕР№РєРё</Text>
            <div className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl md:text-7xl">Р‘РµСЃРїР»Р°С‚РЅРѕ</div>
            <Text size="lg" className="mt-3 text-slate-600">
              РџРѕРґР±РѕСЂ РЅРѕРІРѕСЃС‚СЂРѕР№РєРё РѕС‚ Р·Р°СЃС‚СЂРѕР№С‰РёРєР° вЂ” Р±РµР· РєРѕРјРёСЃСЃРёРё РґР»СЏ РїРѕРєСѓРїР°С‚РµР»СЏ
            </Text>
            <Button
              variant="dark"
              className="mt-6 h-12 px-8"
              onClick={() => {
                trackEvent('click_pricing_cta', { page: 'home', block: 'pricing_free' })
                openLeadModal('consultation', { page: 'home', block: 'pricing_free' })
              }}
            >
              РџРѕР»СѓС‡РёС‚СЊ РїРѕРґР±РѕСЂРєСѓ
            </Button>
          </div>

          {/* РћСЃС‚Р°Р»СЊРЅС‹Рµ СѓСЃР»СѓРіРё */}
          <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'РџРѕРґР±РѕСЂ РІС‚РѕСЂРёС‡РєРё', value: 'РѕС‚ 2,5%', sub: 'РѕС‚ СЃС‚РѕРёРјРѕСЃС‚Рё' },
              { label: 'РџСЂРѕРґР°Р¶Р°', value: 'РѕС‚ 3%', sub: 'РѕС‚ СЃС‚РѕРёРјРѕСЃС‚Рё' },
              { label: 'РђСЂРµРЅРґР°', value: 'РѕС‚ 50%', sub: 'РјРµСЃСЏС‡РЅРѕР№ СЃС‚Р°РІРєРё' },
              { label: 'Р®СЂ. СЃРѕРїСЂРѕРІРѕР¶РґРµРЅРёРµ', value: 'РѕС‚ 100 000 в‚Ѕ' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-[#D8CAB2]/60 bg-[#FFFDF8] p-5 shadow-sm text-center">
                <Text size="sm" className="text-slate-500">{s.label}</Text>
                <div className="mt-2 text-xl font-semibold">{s.value}</div>
                {s.sub && <Text size="sm" className="text-slate-400">{s.sub}</Text>}
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Text className="text-slate-500">
              РўРѕС‡РЅР°СЏ СЃС‚РѕРёРјРѕСЃС‚СЊ С„РѕСЂРјРёСЂСѓРµС‚СЃСЏ РёРЅРґРёРІРёРґСѓР°Р»СЊРЅРѕ Рё Р·Р°РІРёСЃРёС‚ РѕС‚ С‚РёРїР° СЃРґРµР»РєРё Рё РѕР±СЉС‘РјР° СЂР°Р±РѕС‚.
            </Text>
            <Button
              variant="dark"
              className="mt-4 h-12 px-8"
              onClick={() => {
                trackEvent('click_pricing_cta', { page: 'home', block: 'pricing' })
                openLeadModal('consultation', { page: 'home', block: 'pricing' })
              }}
            >
              РЈР·РЅР°С‚СЊ С‚РѕС‡РЅСѓСЋ СЃС‚РѕРёРјРѕСЃС‚СЊ
            </Button>
          </div>
        </div>
      </section>

      {/* 7. Roadmap */}
      <Roadmap />

      {/* 6. Mission */}
      <section className="relative w-full overflow-hidden bg-[#0B1821] py-16 md:py-32">
        {/* Background Image */}
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?ixlib=rb-4.0.3&auto=format&fit=crop&w=1974&q=80"
            alt="Mission Background"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[#0B1821]/62" />
        </div>

        <div className="relative z-10 mx-auto max-w-5xl px-4">
          <div className="rounded-3xl border border-[#E9DCC6]/70 bg-[#FCFAF5]/88 p-6 text-center shadow-sm backdrop-blur-md sm:p-8 md:p-16">
            <Heading size="h6" className="mb-6 text-sm font-bold uppercase tracking-[0.2em] text-[#8D734C]">РњРёСЃСЃРёСЏ</Heading>
            
            <Text className="mx-auto max-w-4xl text-lg font-light leading-snug text-[#182430] sm:text-xl md:text-3xl lg:text-4xl">
              В«РњС‹ РЅРµ РїСЂРѕСЃС‚Рѕ РїСЂРѕРґР°РµРј РєРІР°РґСЂР°С‚РЅС‹Рµ РјРµС‚СЂС‹. РњС‹ РїРѕРјРѕРіР°РµРј Р»СЋРґСЏРј РЅР°Р№С‚Рё РґРѕРј, РіРґРµ РѕРЅРё Р±СѓРґСѓС‚ СЃС‡Р°СЃС‚Р»РёРІС‹, Рё СЃРѕР·РґР°РµРј Р±РµР·РѕРїР°СЃРЅРѕРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ РґР»СЏ РїСЂРёРЅСЏС‚РёСЏ РІР°Р¶РЅС‹С… СЂРµС€РµРЅРёР№В»
            </Text>
            
            <div className="mt-10 flex justify-center gap-4">
               <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#B79867] text-white font-medium text-sm shadow-sm">
                  РЎРђ
               </div>
               <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#223447] text-white font-medium text-sm shadow-sm">
                  РќРђ
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Team */}
      <section id="team" className="relative overflow-hidden bg-[#ECE5DA] py-16 text-[#0B1115] md:py-24">
        <div className="pointer-events-none absolute left-[-120px] top-10 h-72 w-72 rounded-full bg-[#D8E1EC]/16" />
        <div className="pointer-events-none absolute right-[-120px] bottom-10 h-72 w-72 rounded-full bg-[#E4D7C3]/12" />
        <div className="relative z-10 mx-auto max-w-7xl px-4">
          <div className="mb-12">
            <Heading size="h2">РљРѕРјР°РЅРґР°</Heading>
            <Text className="mt-3 max-w-2xl text-sm text-slate-600">
              Р”РІР° СЌРєСЃРїРµСЂС‚Р°, РєРѕС‚РѕСЂС‹Рµ РІРµРґСѓС‚ СЃРґРµР»РєРё Р»РёС‡РЅРѕ Рё РЅРµСЃСѓС‚ РѕС‚РІРµС‚СЃС‚РІРµРЅРЅРѕСЃС‚СЊ Р·Р° РєР°Р¶РґС‹Р№ СЌС‚Р°Рї.
            </Text>
          </div>

          <div className="grid gap-10 md:grid-cols-2">
            {teamMembers.map((f, idx) => (
              <div key={f.name} className="group grid items-center gap-6 rounded-3xl border border-[#D7C8AF]/55 bg-[#FFFDFA] p-6 shadow-[0_20px_45px_rgba(15,23,42,0.08)] backdrop-blur md:grid-cols-[220px_1fr]">
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
      {/* 9. РћС‚Р·С‹РІС‹ */}
      <section className="relative overflow-hidden bg-[#0B1821] py-16 md:py-24">
        <div className="pointer-events-none absolute right-[-140px] top-16 h-80 w-80 rounded-full bg-[#1D3446]/28" />
        <div className="pointer-events-none absolute left-[-120px] bottom-14 h-72 w-72 rounded-full bg-[#243C52]/18" />
        <div className="relative z-10 mx-auto max-w-7xl px-4">
          <Heading size="h2" className="text-white">РћС‚Р·С‹РІС‹ РєР»РёРµРЅС‚РѕРІ</Heading>
          <Text className="mt-2 mb-12 text-gray-400">Р РµР°Р»СЊРЅС‹Рµ РёСЃС‚РѕСЂРёРё Р»СЋРґРµР№, РєРѕС‚РѕСЂС‹Рј РјС‹ РїРѕРјРѕРіР»Рё</Text>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                name: 'РњР°СЂРёСЏ РРІР°РЅРѕРІР°',
                text: 'РћР±СЂР°С‚РёР»РёСЃСЊ Р·Р° РїРѕРјРѕС‰СЊСЋ РІ РїРѕРєСѓРїРєРµ РєРІР°СЂС‚РёСЂС‹ РІ РЅРѕРІРѕСЃС‚СЂРѕР№РєРµ. РџРѕРґРѕР±СЂР°Р»Рё РёРґРµР°Р»СЊРЅС‹Р№ РІР°СЂРёР°РЅС‚ Р·Р° РЅРµРґРµР»СЋ. РЎРґРµР»РєР° РїСЂРѕС€Р»Р° РіР»Р°РґРєРѕ, РІСЃС‘ СЋСЂРёРґРёС‡РµСЃРєРё С‡РёСЃС‚Рѕ.',
                rating: 5,
                source: 'РЇРЅРґРµРєСЃ РљР°СЂС‚С‹',
                sourceUrl: '#',
              },
              {
                name: 'РђР»РµРєСЃРµР№ РџРµС‚СЂРѕРІ',
                text: 'РџСЂРѕРґР°Р»Рё РєРІР°СЂС‚РёСЂСѓ РїРѕ РјР°РєСЃРёРјР°Р»СЊРЅРѕР№ С†РµРЅРµ. Р РёСЌР»С‚РѕСЂ РІС‘Р» РїРµСЂРµРіРѕРІРѕСЂС‹ РїСЂРѕС„РµСЃСЃРёРѕРЅР°Р»СЊРЅРѕ, РїРѕРєСѓРїР°С‚РµР»СЊ РЅР°Р№РґРµРЅ Р·Р° 3 РЅРµРґРµР»Рё. Р РµРєРѕРјРµРЅРґСѓСЋ!',
                rating: 5,
                source: 'Google',
                sourceUrl: '#',
              },
              {
                name: 'Р•РєР°С‚РµСЂРёРЅР° РЎРјРёСЂРЅРѕРІР°',
                text: 'РЎРЅРёРјР°Р»Рё РєРІР°СЂС‚РёСЂСѓ С‡РµСЂРµР· Р°РіРµРЅС‚СЃС‚РІРѕ. Р’СЃС‘ С‡РµСЃС‚РЅРѕ, Р±РµР· СЃРєСЂС‹С‚С‹С… РєРѕРјРёСЃСЃРёР№. РџРѕРјРѕРіР»Рё СЃ РґРѕРіРѕРІРѕСЂРѕРј Рё РїСЂРѕРІРµСЂРёР»Рё СЃРѕР±СЃС‚РІРµРЅРЅРёРєР°. РЎРїР°СЃРёР±Рѕ!',
                rating: 5,
                source: 'Р¦РРђРќ',
                sourceUrl: '#',
              },
              {
                name: 'Р”РјРёС‚СЂРёР№ РљРѕР·Р»РѕРІ',
                text: 'РРЅРІРµСЃС‚РёСЂРѕРІР°Р» РІ РЅРѕРІРѕСЃС‚СЂРѕР№РєСѓ РїРѕ СЂРµРєРѕРјРµРЅРґР°С†РёРё Р°РіРµРЅС‚СЃС‚РІР°. РћР±СЉРµРєС‚ СѓР¶Рµ РІС‹СЂРѕСЃ РІ С†РµРЅРµ РЅР° 15%. Р“СЂР°РјРѕС‚РЅР°СЏ Р°РЅР°Р»РёС‚РёРєР° Рё РїРѕРґРґРµСЂР¶РєР° РЅР° РІСЃРµС… СЌС‚Р°РїР°С….',
                rating: 5,
                source: 'РЇРЅРґРµРєСЃ РљР°СЂС‚С‹',
                sourceUrl: '#',
              },
              {
                name: 'РћР»СЊРіР° РќРѕРІРёРєРѕРІР°',
                text: 'Р”РѕР»РіРѕ РЅРµ РјРѕРіР»Рё РїСЂРѕРґР°С‚СЊ Р·Р°РіРѕСЂРѕРґРЅС‹Р№ РґРѕРј. RWGroup РѕС†РµРЅРёР»Рё, СЃРґРµР»Р°Р»Рё РєР°С‡РµСЃС‚РІРµРЅРЅС‹Рµ С„РѕС‚Рѕ Рё РЅР°С€Р»Рё РїРѕРєСѓРїР°С‚РµР»СЏ Р·Р° РјРµСЃСЏС†. РћС‡РµРЅСЊ РґРѕРІРѕР»СЊРЅС‹!',
                rating: 5,
                source: 'Google',
                sourceUrl: '#',
              },
              {
                name: 'РЎРµСЂРіРµР№ Р’РѕР»РєРѕРІ',
                text: 'РЎРѕРїСЂРѕРІРѕР¶РґРµРЅРёРµ СЃРґРµР»РєРё Р±С‹Р»Рѕ РЅР° РІС‹СЃС€РµРј СѓСЂРѕРІРЅРµ. Р®СЂРёСЃС‚ РїСЂРѕРІРµСЂРёР» РІСЃРµ РґРѕРєСѓРјРµРЅС‚С‹, РѕР±СЉСЏСЃРЅРёР» РєР°Р¶РґС‹Р№ РїСѓРЅРєС‚. Р§СѓРІСЃС‚РІРѕРІР°Р»Рё СЃРµР±СЏ РІ Р±РµР·РѕРїР°СЃРЅРѕСЃС‚Рё.',
                rating: 5,
                source: 'РЇРЅРґРµРєСЃ РљР°СЂС‚С‹',
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
      {/* 10. РЎС‚Р°С‚СЊ РїР°СЂС‚РЅС‘СЂРѕРј */}
      <section className="relative overflow-hidden bg-[#0F1D28] py-16 text-white md:py-24">
        <div className="pointer-events-none absolute right-[-140px] top-12 h-72 w-72 rounded-full bg-[#1B3143]/30" />
        <div className="pointer-events-none absolute left-[-120px] bottom-12 h-72 w-72 rounded-full bg-[#22394C]/25" />
        <div className="relative z-10 mx-auto max-w-7xl px-4">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <Heading size="h2">РЎС‚Р°С‚СЊ РїР°СЂС‚РЅС‘СЂРѕРј</Heading>
              <Text size="lg" className="mt-4 max-w-lg text-slate-300">
                РњС‹ РѕС‚РєСЂС‹С‚С‹ Рє СЃРѕС‚СЂСѓРґРЅРёС‡РµСЃС‚РІСѓ СЃ Р·Р°СЃС‚СЂРѕР№С‰РёРєР°РјРё, Р°РіРµРЅС‚СЃС‚РІР°РјРё Рё С‡Р°СЃС‚РЅС‹РјРё СЂРёСЌР»С‚РѕСЂР°РјРё. Р’РјРµСЃС‚Рµ РјС‹ СЃРјРѕР¶РµРј РїСЂРµРґР»РѕР¶РёС‚СЊ РєР»РёРµРЅС‚Р°Рј Р»СѓС‡С€РёР№ СЃРµСЂРІРёСЃ.
              </Text>
              <div className="mt-8 space-y-4">
                {[
                  'РЎРѕРІРјРµСЃС‚РЅС‹Рµ СЃРґРµР»РєРё Рё СЂРµРєРѕРјРµРЅРґР°С†РёРё',
                  'Р”РѕСЃС‚СѓРї Рє Р·Р°РєСЂС‹С‚РѕР№ Р±Р°Р·Рµ РѕР±СЉРµРєС‚РѕРІ',
                  'РџСЂРѕР·СЂР°С‡РЅС‹Рµ СѓСЃР»РѕРІРёСЏ Рё Р±С‹СЃС‚СЂС‹Рµ РІС‹РїР»Р°С‚С‹',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C2A87A] text-[#0F1D28] text-xs">вњ“</div>
                    <Text className="text-slate-200">{item}</Text>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-8 shadow-sm">
              <Heading size="h4" className="mb-6 text-white">РћСЃС‚Р°РІСЊС‚Рµ Р·Р°СЏРІРєСѓ</Heading>
              <div className="space-y-4">
                <Button
                  variant="default"
                  className="h-12 w-full px-8"
                  onClick={() => {
                    trackEvent('click_partner', { page: 'home', block: 'partner' })
                    openLeadModal('partner', { page: 'home', block: 'partner' })
                  }}
                >
                  РЎС‚Р°С‚СЊ РїР°СЂС‚РЅС‘СЂРѕРј
                </Button>
                <Text size="sm" className="text-center text-slate-400">
                  РњС‹ СЃРІСЏР¶РµРјСЃСЏ СЃ РІР°РјРё РІ С‚РµС‡РµРЅРёРµ СЂР°Р±РѕС‡РµРіРѕ РґРЅСЏ
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
      onClick={() => navigate(`/collection/${item.slug || item.id}`)}
      className="group cursor-pointer"
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-sm bg-gray-800">
        {item.cover_image ? (
          <img src={item.cover_image} alt={item.title} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : null}
        <div className="absolute top-4 left-4 bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-wider text-black">
          РџРѕРґР±РѕСЂРєР°
        </div>
      </div>
      <div className="mt-4">
        <Heading size="h4" className="text-white group-hover:text-accent transition-colors">{item.title}</Heading>
        {item.description && <Text size="sm" className="mt-1 text-gray-400 line-clamp-2">{item.description}</Text>}
      </div>
    </div>
  )
}
