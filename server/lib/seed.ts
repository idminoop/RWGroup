import type { DbShape, HomeContent } from '../../shared/types.js'
import { newId, slugify } from './ids.js'
import { dbExists, ensureDataDir, writeDb } from './storage.js'

function nowIso(): string {
  return new Date().toISOString()
}

export function ensureSeed(): void {
  ensureDataDir()
  if (dbExists()) return

    const home: HomeContent = {
      hero: {
        title: 'Эксперты по недвижимости',
        subtitle: 'RWgroup — агентство недвижимости',
        address: 'Москва',
        phone: '+7 (495) 410-15-68',
        trust_badge: '13 лет на рынке',
        slogan_options: [
          'Ваша безопасная сделка — наша репутация',
          'Бережём ваши нервы, время и бюджет',
          'RWgroup — ваш персональный гарант на рынке недвижимости',
        ],
      },
      advantages: [
        { title: 'Широкий выбор', description: 'Подбираем варианты под цель и бюджет.' },
        { title: 'Индивидуальный подход', description: 'Сценарий сделки строим под ваши условия.' },
        { title: 'Профессионализм', description: 'Опытная команда брокеров и экспертов.' },
        { title: 'Юридическая чистота', description: 'Проверяем документы и риски.' },
        { title: 'Безопасность сделки', description: 'Контроль на всех этапах.' },
        { title: 'Офис в центре Москвы', description: 'Удобно встретиться и обсудить детали.' },
      ],
      pricing: [
        { title: 'Подборка новостроек', description: 'Бесплатно', highlight: true },
        { title: 'Вторичная недвижимость', description: 'Стоимость формируется индивидуально' },
        { title: 'Сопровождение сделки', description: 'По запросу — после консультации' },
      ],
      steps: [
        { title: 'Консультация' },
        { title: 'План действий' },
        { title: 'Договор' },
        { title: 'Работа и сопровождение' },
        { title: 'Закрытие сделки + документы' },
      ],
      mission: {
        title: 'Миссия и ценности',
        text: 'Мы бережно сопровождаем клиентов на всех этапах сделки и помогаем принимать уверенные решения.',
      },
      team: {
        title: 'Команда',
        founders: [
          { name: 'Саша', role: 'Основатель', story: 'Личный подход и внимание к деталям.' },
          { name: 'Настя', role: 'Сооснователь', story: 'Фокус на сервисе и доверии.' },
        ],
        links: [
          { title: 'Блог', url: '#' },
        ],
      },
      reviews: [
        { id: 'r1', name: 'Ирина', text: 'Сделка прошла спокойно и прозрачно.', source_url: '' },
        { id: 'r2', name: 'Алексей', text: 'Быстро нашли вариант и помогли с документами.', source_url: '' },
      ],
      partner: {
        title: 'Стать партнёром',
        text: 'Оставьте контакты — обсудим условия сотрудничества и обмен фидами.',
      },
      featured: { complexes: [], properties: [], collections: [] },
      updated_at: nowIso(),
    }

    const sourceId = newId()
    const c1 = {
      id: newId(),
      source_id: sourceId,
      external_id: 'c-001',
      slug: slugify('ЖК River Park'),
      title: 'ЖК River Park',
      category: 'newbuild' as const,
      district: 'ЦАО',
      metro: ['Киевская'],
      price_from: 18500000,
      area_from: 42,
      images: [
        'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=modern%20residential%20complex%20in%20moscow%2C%20sunset%2C%20wide%20angle%2C%20real%20estate%20photography%2C%20clean%20facades%2C%20high%20detail&image_size=landscape_16_9',
      ],
      status: 'active' as const,
      updated_at: nowIso(),
    }
    const p1 = {
      id: newId(),
      source_id: sourceId,
      external_id: 'p-001',
      slug: slugify('2-комнатная в ЖК River Park'),
      lot_number: 'A-1204',
      complex_id: c1.id,
      complex_external_id: c1.external_id,
      deal_type: 'sale' as const,
      category: 'newbuild' as const,
      title: '2-комнатная в ЖК River Park',
      bedrooms: 1,
      price: 23900000,
      area_total: 56.2,
      district: 'ЦАО',
      metro: ['Киевская'],
      images: [
        'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=bright%20modern%20apartment%20interior%2C%20living%20room%20with%20panoramic%20windows%2C%20real%20estate%20photography%2C%20neutral%20colors%2C%20high%20detail&image_size=landscape_16_9',
      ],
      status: 'active' as const,
      updated_at: nowIso(),
    }
    const p2 = {
      id: newId(),
      source_id: sourceId,
      external_id: 'p-002',
      slug: slugify('1-комнатная аренда у метро'),
      deal_type: 'rent' as const,
      category: 'rent' as const,
      title: '1-комнатная аренда у метро',
      bedrooms: 0,
      price: 120000,
      price_period: 'month' as const,
      area_total: 34.5,
      district: 'САО',
      metro: ['Динамо'],
      images: [
        'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cozy%20apartment%20interior%2C%20kitchen%20and%20living%20area%2C%20real%20estate%20photography%2C%20soft%20light%2C%20high%20detail&image_size=landscape_16_9',
      ],
      status: 'active' as const,
      updated_at: nowIso(),
    }

    const col1Id = newId()
    const collections = [
      {
        id: col1Id,
        slug: slugify('Лучшие предложения недели'),
        title: 'Лучшие предложения недели',
        description: 'Подборка актуальных объектов и ЖК на этой неделе.',
        cover_image:
          'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=moscow%20skyline%20panorama%2C%20premium%20real%20estate%20mood%2C%20cinematic%20lighting%2C%20high%20detail&image_size=landscape_16_9',
        priority: 10,
        items: [
          { type: 'complex' as const, ref_id: c1.id },
          { type: 'property' as const, ref_id: p1.id },
          { type: 'property' as const, ref_id: p2.id },
        ],
        updated_at: nowIso(),
      },
    ]

    home.featured = { complexes: [c1.id], properties: [p1.id, p2.id], collections: [col1Id] }
    home.updated_at = nowIso()

    const db: DbShape = {
      home,
      feed_sources: [
        {
          id: sourceId,
          name: 'Демо-источник',
          mode: 'upload',
          format: 'json',
          is_active: true,
          created_at: nowIso(),
        },
      ],
      complexes: [c1],
      properties: [p1, p2],
      collections,
      leads: [],
      import_runs: [],
    }

    writeDb(db)
}
