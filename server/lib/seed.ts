import type { DbShape, HomeContent, Complex, Property, Collection } from '../../shared/types.js'
import { newId, slugify } from './ids.js'
import { dbExists, ensureDataDir, writeDb } from './storage.js'

function nowIso(): string {
  return new Date().toISOString()
}

// Helper to generate random numbers in range
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min)

// Helper to pick random item from array
const sample = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

const METRO_STATIONS = [
  'Киевская', 'Смоленская', 'Арбатская', 'Кропоткинская', 'Парк Культуры',
  'Фрунзенская', 'Октябрьская', 'Добрынинская', 'Таганская', 'Павелецкая',
  'Серпуховская', 'Полянка', 'Боровицкая', 'Цветной бульвар', 'Чеховская',
  'Тверская', 'Пушкинская', 'Маяковская', 'Белорусская', 'Динамо'
]

const DISTRICTS = ['ЦАО', 'САО', 'ЗАО', 'ЮЗАО', 'ЮАО', 'ЮВАО', 'ВАО', 'СВАО', 'СЗАО']

const DEVELOPERS = ['Stone Hedge', 'Vesper', 'MR Group', 'Sminex-Inteco', 'Capital Group', 'Pioneer']

const IMAGES_COMPLEX = [
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=modern%20residential%20complex%20in%20moscow%2C%20sunset%2C%20wide%20angle%2C%20real%20estate%20photography%2C%20clean%20facades%2C%20high%20detail&image_size=landscape_16_9',
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=luxury%20skyscraper%20moscow%20city%20style%2C%20night%20view%2C%20glass%20facade%2C%20cinematic%20lighting&image_size=landscape_16_9',
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=premium%20club%20house%20moscow%20center%2C%20classic%20architecture%2C%20morning%20light&image_size=landscape_16_9',
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=elite%20residential%20quarter%20with%20park%2C%20summer%20day%2C%20greenery%2C%20modern%20design&image_size=landscape_16_9',
]

const IMAGES_INTERIOR = [
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=bright%20modern%20apartment%20interior%2C%20living%20room%20with%20panoramic%20windows%2C%20real%20estate%20photography%2C%20neutral%20colors%2C%20high%20detail&image_size=landscape_16_9',
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=luxury%20classic%20bedroom%20interior%2C%20beige%20tones%2C%20king%20size%20bed%2C%20soft%20lighting&image_size=landscape_16_9',
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=modern%20kitchen%20with%20island%2C%20marble%20countertops%2C%20premium%20appliances%2C%20dark%20wood&image_size=landscape_16_9',
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=spacious%20bathroom%20with%20freestanding%20tub%2C%20stone%20tiles%2C%20spa%20atmosphere&image_size=landscape_16_9',
  'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cozy%20living%20room%20with%20fireplace%2C%20evening%20mood%2C%20warm%20light%2C%20scandinavian%20style&image_size=landscape_16_9',
]

export function ensureSeed(): void {
  ensureDataDir()
  if (dbExists()) return // Force re-seed for this task to populate data

  const sourceId = newId()
  
  // --- Generate Complexes ---
  const complexes: Complex[] = []
  for (let i = 1; i <= 15; i++) {
    const title = `ЖК ${['River', 'Sky', 'City', 'Park', 'View', 'Prime', 'Elite', 'Grand', 'Tower'][randomInt(0, 8)]} ${['Plaza', 'Residence', 'House', 'Quarter', 'Estate'][randomInt(0, 4)]} ${i}`
    complexes.push({
      id: newId(),
      source_id: sourceId,
      external_id: `c-${String(i).padStart(3, '0')}`,
      slug: slugify(title),
      title,
      category: 'newbuild',
      district: sample(DISTRICTS),
      metro: [sample(METRO_STATIONS)],
      price_from: randomInt(15, 80) * 1000000,
      area_from: randomInt(35, 80),
      images: [sample(IMAGES_COMPLEX), sample(IMAGES_COMPLEX)],
      developer: sample(DEVELOPERS),
      class: sample(['Business', 'Premium', 'De Luxe']),
      finish_type: sample(['Без отделки', 'Whitebox', 'С отделкой']),
      handover_date: `IV кв. ${randomInt(2024, 2027)}`,
      status: 'active',
      updated_at: nowIso(),
    })
  }

  // --- Generate Properties ---
  const properties: Property[] = []
  
  // Newbuilds (linked to complexes)
  for (let i = 1; i <= 40; i++) {
    const complex = sample(complexes)
    const rooms = randomInt(1, 4)
    const area = randomInt(40, 200)
    const pricePerM2 = randomInt(400, 1200) * 1000
    const price = Math.round(area * pricePerM2 / 100000) * 100000 // Round to 100k

    properties.push({
      id: newId(),
      source_id: sourceId,
      external_id: `p-nb-${String(i).padStart(3, '0')}`,
      slug: slugify(`${rooms}-комнатная в ${complex.title} ${i}`),
      lot_number: `A-${randomInt(100, 999)}`,
      complex_id: complex.id,
      complex_external_id: complex.external_id,
      deal_type: 'sale',
      category: 'newbuild',
      title: `${rooms}-комнатная квартира, ${area} м²`,
      bedrooms: rooms,
      price,
      area_total: area,
      district: complex.district,
      metro: complex.metro,
      images: [sample(IMAGES_INTERIOR), sample(IMAGES_INTERIOR), sample(IMAGES_INTERIOR)],
      status: 'active',
      updated_at: nowIso(),
    })
  }

  // Secondary
  for (let i = 1; i <= 30; i++) {
    const rooms = randomInt(1, 5)
    const area = randomInt(45, 250)
    const price = randomInt(25, 150) * 1000000
    const district = sample(DISTRICTS)
    
    properties.push({
      id: newId(),
      source_id: sourceId,
      external_id: `p-sec-${String(i).padStart(3, '0')}`,
      slug: slugify(`Квартира на ${sample(['Патриарших', 'Арбате', 'Остоженке', 'Тверской', 'Якиманке'])} ${i}`),
      deal_type: 'sale',
      category: 'secondary',
      title: `${rooms}-комнатная квартира, ${area} м²`,
      bedrooms: rooms,
      price,
      area_total: area,
      district,
      metro: [sample(METRO_STATIONS)],
      images: [sample(IMAGES_INTERIOR), sample(IMAGES_INTERIOR)],
      status: 'active',
      updated_at: nowIso(),
    })
  }

  // Rent
  for (let i = 1; i <= 25; i++) {
    const rooms = randomInt(1, 4)
    const area = randomInt(40, 150)
    const price = randomInt(100, 800) * 1000
    
    properties.push({
      id: newId(),
      source_id: sourceId,
      external_id: `p-rent-${String(i).padStart(3, '0')}`,
      slug: slugify(`Аренда ${rooms}-к квартиры ${i}`),
      deal_type: 'rent',
      category: 'rent',
      title: `${rooms}-комнатная квартира, ${area} м²`,
      bedrooms: rooms,
      price,
      price_period: 'month',
      area_total: area,
      district: sample(DISTRICTS),
      metro: [sample(METRO_STATIONS)],
      images: [sample(IMAGES_INTERIOR), sample(IMAGES_INTERIOR)],
      status: 'active',
      updated_at: nowIso(),
    })
  }

  // --- Generate Collections ---
  const col1Id = newId()
  const col2Id = newId()
  const collections: Collection[] = [
    {
      id: col1Id,
      slug: slugify('Лучшие предложения недели'),
      title: 'Лучшие предложения недели',
      description: 'Подборка актуальных объектов и ЖК на этой неделе.',
      cover_image: sample(IMAGES_COMPLEX),
      priority: 10,
      status: 'visible',
      mode: 'manual',
      items: [
        { type: 'complex', ref_id: complexes[0].id },
        { type: 'property', ref_id: properties[0].id },
        { type: 'property', ref_id: properties[45].id }, // Secondary
      ],
      updated_at: nowIso(),
    },
    {
      id: col2Id,
      slug: slugify('Старт продаж 2025'),
      title: 'Старт продаж 2025',
      description: 'Самые ожидаемые премьеры года.',
      cover_image: sample(IMAGES_COMPLEX),
      priority: 9,
      status: 'visible',
      mode: 'manual',
      items: [
        { type: 'complex', ref_id: complexes[1].id },
        { type: 'complex', ref_id: complexes[2].id },
      ],
      updated_at: nowIso(),
    },
  ]

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
        { name: 'Саша', role: 'Основатель', story: 'Личный подход и внимание к деталям.', photo_url: 'https://ui-avatars.com/api/?name=Sasha&background=random&size=200' },
        { name: 'Настя', role: 'Сооснователь', story: 'Фокус на сервисе и доверии.', photo_url: 'https://ui-avatars.com/api/?name=Nastya&background=random&size=200' },
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
    featured: { 
      complexes: complexes.slice(0, 3).map(c => c.id), 
      properties: properties.slice(0, 6).map(p => p.id), 
      collections: [col1Id, col2Id] 
    },
    updated_at: nowIso(),
  }

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
    complexes,
    properties,
    collections,
    leads: [],
    import_runs: [],
  }

  writeDb(db)
  console.log(`Seeded DB with ${complexes.length} complexes, ${properties.length} properties`)
}
