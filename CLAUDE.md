# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 1. Project Overview

### What is RWGroup?

**RWGroup** — это сайт агентства недвижимости, работающий как **публичная витрина объектов** и **лидогенерационная платформа** с автоматическим импортом данных из фидов застройщиков и партнёров.

### Concept

Сайт построен по модели **"витрина + фиды"**:
- **Контент доверия** (экспертиза, команда, отзывы, миссия) — управляется вручную через админку
- **Каталоги и объекты** (новостройки, вторичка, аренда) — автоматически обновляются из внешних фидов
- **Лидогенерация** — 4 типа форм заявок с отслеживанием источника (экран, объект, вкладка)

### Mission & Goals

**Основная цель:** Получение заявок на покупку/продажу/аренду недвижимости и партнёрство.

**Вторичные цели:**
- Формирование доверия к бренду RWGroup
- Демонстрация экспертности команды
- Быстрый доступ клиентов к актуальным объектам недвижимости
- Позиционирование как "персональный гарант на рынке недвижимости"

### Marketing Strategy

Сайт реализует многоуровневую маркетинговую воронку:

1. **Привлечение** — SEO-оптимизация (ЧПУ, OpenGraph, Schema.org), каталог объектов
2. **Вовлечение** — 10 экранов лендинга с якорной навигацией, фильтры каталога, карточки объектов
3. **Доверие** — блоки преимуществ, этапов работы, миссии, команды, отзывов реальных клиентов
4. **Конверсия** — 4 типа лид-форм, стратегически расположенных по всему сайту
5. **Аналитика** — фиксация источника каждой заявки (страница, блок, объект, вкладка), трекинг событий

**Целевые сценарии конверсии:**
- Главная → Каталог → Карточка → Заявка "Записаться на просмотр"
- Главная → CTA "Получить консультацию" → Заявка
- Главная → Блок "Стать партнёром" → Заявка партнёрства
- Каталог → CTA "Купить/Продать" → Заявка с вкладками

---

## 2. Architecture

### Technology Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| **Frontend** | React 18 + TypeScript + Vite | SPA с React Router v7 |
| **Backend** | Express.js REST API | Порт 3001, TypeScript через tsx |
| **Database** | JSON file storage | `server/data/db.json` (планируется миграция на PostgreSQL/Supabase) |
| **Styling** | TailwindCSS + CVA | class-variance-authority для вариантов компонентов |
| **State** | Zustand | Клиентское состояние UI |
| **Validation** | Zod | Валидация данных на сервере |
| **Maps** | Leaflet + React-Leaflet | Карты для ЖК и объектов |
| **File Import** | xlsx, csv-parse, fast-xml-parser | Парсинг фидов |
| **File Upload** | Multer | Обработка загрузки файлов |
| **Dev Tools** | Vite proxy, Nodemon, Concurrently | Параллельный запуск клиента и сервера |

### Project Structure

```
RWGroup/
├── src/                          # Frontend (React)
│   ├── components/
│   │   ├── catalog/              # Карточки объектов, фильтры, вкладки каталога
│   │   │   ├── CatalogFilters.tsx    # Фильтры: спальни, цена, район, метро
│   │   │   ├── CatalogTabs.tsx       # Вкладки: Новостройки/Вторичка/Аренда
│   │   │   ├── PropertyCard.tsx      # Карточка лота
│   │   │   └── ComplexCard.tsx       # Карточка ЖК
│   │   ├── complex/              # Компоненты страницы ЖК
│   │   │   ├── ComplexMap.tsx        # Карта расположения ЖК (Leaflet)
│   │   │   └── NearbyPlaces.tsx      # Ближайшие места
│   │   ├── forms/                # Лид-формы
│   │   │   └── LeadModal.tsx         # Универсальная модалка заявки (4 типа форм)
│   │   ├── layout/               # Общий лейаут
│   │   │   ├── Header.tsx            # Шапка: логотип, телефон, меню, CTA
│   │   │   ├── Footer.tsx            # Подвал: контакты, соцсети, политика
│   │   │   └── SiteLayout.tsx        # Обёртка страницы
│   │   └── ui/                   # Переиспользуемые UI-компоненты
│   │       ├── Button.tsx            # Кнопка с вариантами (CVA)
│   │       ├── Input.tsx             # Текстовое поле
│   │       ├── Select.tsx            # Выпадающий список
│   │       ├── Modal.tsx             # Модальное окно
│   │       ├── Drawer.tsx            # Выдвижная панель (мобильные фильтры)
│   │       ├── Card.tsx              # Карточка
│   │       ├── Badge.tsx             # Бейдж
│   │       ├── Skeleton.tsx          # Скелетон загрузки
│   │       ├── ImageGallery.tsx      # Галерея изображений
│   │       └── Typography.tsx        # Типографика
│   ├── pages/                    # Страницы маршрутов
│   │   ├── Home.tsx                  # Главная (10 экранов лендинга)
│   │   ├── Catalog.tsx               # Каталог недвижимости
│   │   ├── Property.tsx              # Карточка лота
│   │   ├── Complex.tsx               # Карточка ЖК
│   │   ├── Collection.tsx            # Страница подборки
│   │   ├── Privacy.tsx               # Политика конфиденциальности
│   │   ├── UiKit.tsx                 # UI Kit (для разработки)
│   │   └── admin/                    # Админ-панель
│   │       ├── AdminEntry.tsx        # Точка входа админки
│   │       ├── AdminLogin.tsx        # Страница авторизации
│   │       ├── AdminLayout.tsx       # Лейаут с сайдбаром
│   │       ├── components/           # Общие компоненты админки
│   │       │   ├── ManualItemsEditor.tsx    # Редактор ручных подборок
│   │       │   ├── CollectionPreview.tsx    # Превью подборки
│   │       │   ├── CollectionModal.tsx      # Модалка создания/редактирования подборки
│   │       │   ├── AutoRulesBuilder.tsx     # Конструктор авто-правил подборок
│   │       │   └── ItemPickerModal.tsx      # Выбор объектов для подборки
│   │       └── pages/                # Страницы админки
│   │           ├── AdminHome.tsx          # Управление витриной (экраны главной)
│   │           ├── AdminCatalog.tsx       # Управление каталогом
│   │           ├── AdminCollections.tsx   # Управление подборками
│   │           ├── AdminImport.tsx        # Импорт фидов (маппинг, превью)
│   │           ├── AdminLeads.tsx         # CRM лидов (заявки)
│   │           ├── AdminUsers.tsx         # Управление администраторами
│   │           ├── AdminLogs.tsx          # Аудит-логи
│   │           └── AdminComplexSettings.tsx # Настройки лендинга ЖК
│   └── store/                    # Zustand stores
│
├── server/                       # Backend (Express.js)
│   ├── app.ts                    # Express application setup
│   ├── server.ts                 # Server entry point (порт 3001)
│   ├── routes/
│   │   ├── public.ts             # Публичное API: каталог, объекты, ЖК, подборки, главная
│   │   ├── admin.ts              # Админское API: CRUD объектов, импорт, настройки
│   │   ├── auth.ts               # Авторизация: login, verify, управление пользователями
│   │   ├── leads.ts              # API лидов: создание заявок, CRM
│   │   └── analytics.ts          # API аналитики
│   ├── middleware/
│   │   ├── adminAuth.ts          # JWT-based middleware авторизации админа
│   │   └── rateLimit.ts          # Rate limiting для API
│   ├── lib/
│   │   ├── storage.ts            # Хелперы работы с БД (readDb, writeDb, withDb)
│   │   ├── seed.ts               # Начальное заполнение данными
│   │   ├── phone.ts              # Форматирование телефонов (RU маска)
│   │   └── ids.ts                # Генерация UUID
│   ├── data/
│   │   └── db.json               # JSON-база данных (файловое хранилище)
│   └── uploads/                  # Загруженные файлы (фиды)
│
├── shared/
│   └── types.ts                  # Общие TypeScript-типы (клиент + сервер)
│
├── .trae/documents/              # Проектная документация
│   ├── tech_arch_rwgroup_website.md    # Техническая архитектура
│   ├── prd_rwgroup_website.md          # PRD (Product Requirements)
│   └── page_design_rwgroup_website.md  # Дизайн-спецификация страниц
│
├── user_data/
│   └── ТЗ RW Group.docx         # Техническое задание от заказчика
│
├── Dockerfile                    # Docker multi-stage build (Node 22 Alpine)
├── captain-definition.json       # CapRover deployment config
├── vite.config.ts                # Vite config (proxy, path aliases)
├── tailwind.config.js            # TailwindCSS config
└── package.json                  # Dependencies & scripts
```

### Data Flow

```
[Пользователь] → [React SPA] → [Vite Dev Proxy /api/*] → [Express API :3001]
                                                                    ↓
                                                           [storage.ts helpers]
                                                                    ↓
                                                           [server/data/db.json]

[Администратор] → [Админ-панель /admin] → [JWT Auth] → [Admin API /api/admin/*]
                                                                    ↓
                                                           [CRUD + Import Logic]
                                                                    ↓
                                                           [db.json + uploads/]
```

### Data Model (Entities)

1. **Complex** (Жилой комплекс / ЖК) — Жилые комплексы новостроек
   - Всегда `category: 'newbuild'`
   - Содержит множество Property через `complex_external_id`
   - Поля: `price_from`, `area_from` (минимальные значения), район, метро, изображения
   - Поддерживает landing-конфигурацию (цвета, теги, факты, планировки, ближайшие места)

2. **Property** (Лот) — Отдельные объекты недвижимости
   - Категории: `newbuild | secondary | rent`
   - Типы сделки: `sale | rent`
   - Ключевые поля: bedrooms (0-4), price, area_total, district, metro
   - Дополнительно: floor, floors_total, renovation, old_price, description

3. **Collection** (Подборка) — Кураторские подборки объектов
   - Режимы: `manual` (ручной выбор) | `auto` (по правилам фильтрации)
   - Содержит items — ссылки на Property или Complex
   - Используется для "Лучших предложений недели"

4. **Lead** (Заявка) — Лиды от посетителей
   - 4 типа форм: `consultation`, `buy_sell`, `view_details`, `partner`
   - CRM-поля: `lead_status`, `assignee`, `admin_note`
   - Трекинг: IP, user_agent, source (page/block/object_id/object_type)

5. **FeedSource** (Источник фида) — Конфигурация внешних источников данных
   - Форматы: XLSX, CSV, XML, JSON
   - Режимы: ручная загрузка / автообновление по URL
   - Хранение маппинга полей

6. **ImportRun** (Прогон импорта) — Логи импорта
   - Статусы: `success | failed | partial`
   - Статистика: inserted, updated, hidden

7. **AdminUser** — Администраторы системы
   - Роли: `owner | content | import | sales`
   - Гранулярные права доступа (20+ permissions)

8. **AuditLog** — Журнал аудита действий администраторов
   - Действия: create, update, delete, login, publish, import

### API Endpoints

**Публичное API:**
- `GET /api/catalog` — Каталог с фильтрами (deal_type, category, bedrooms, price, district, metro, search)
- `GET /api/property/:slug` — Карточка лота
- `GET /api/complex/:slug` — Карточка ЖК + лоты
- `GET /api/collection/:slug` — Подборка
- `GET /api/home` — Контент главной страницы
- `POST /api/leads` — Создание заявки (лида)

**Админское API (требует JWT):**
- `POST /api/auth/login` — Авторизация
- `GET /api/auth/verify` — Проверка токена
- `GET/POST/PUT/DELETE /api/admin/...` — CRUD для всех сущностей
- `POST /api/admin/feed/upload` — Загрузка файла фида
- `POST /api/admin/import/preview` — Предпросмотр маппинга
- `POST /api/admin/import/run` — Запуск импорта
- `GET /api/admin/import/runs` — Логи импортов
- `GET /api/admin/leads` — Список лидов (CRM)

---

## 3. Development Commands

### Running the Application

```bash
npm run dev              # Запуск клиента (Vite :5173) + сервера (Express :3001) одновременно
npm run client:dev       # Только клиент на http://localhost:5173
npm run server:dev       # Только сервер на http://localhost:3001
```

### Build & Quality

```bash
npm run build           # TypeScript проверка + Vite production build
npm run check           # TypeScript type checking (без эмита)
npm run lint            # ESLint по всей кодовой базе
npm run preview         # Предпросмотр production-билда
```

### Docker

```bash
docker build -t rwgroup .                    # Сборка Docker-образа
docker run -p 3000:3000 rwgroup              # Запуск контейнера (production, порт 3000)
```

**Docker-образ** использует multi-stage build:
- Builder: `node:22-alpine` — устанавливает зависимости, собирает клиент
- Runner: `node:22-alpine` — минимальный образ с production-кодом
- Сервер запускается через `tsx` для поддержки TypeScript

### Deployment (CapRover)

Проект настроен для деплоя на CapRover:
- Файл `captain-definition.json` указывает на `Dockerfile`
- Production-сервер обслуживает и API, и статику из `dist/`
- Порт: 3000 (переменная `PORT`)

---

## 4. Management & Monitoring

### Admin Panel (`/admin`)

**Авторизация:**
- Роутинг: `/admin` → `AdminLogin.tsx` → `AdminLayout.tsx`
- JWT-based аутентификация через `server/middleware/adminAuth.ts`
- Роли: `owner` (полный доступ), `content`, `import`, `sales`

**Разделы админки:**

| Раздел | Путь | Описание |
|--------|------|----------|
| Витрина | `/admin/home` | Управление 10 экранами главной страницы |
| Каталог | `/admin/catalog` | Просмотр/редактирование объектов и ЖК |
| Подборки | `/admin/collections` | Создание подборок (ручных и автоматических) |
| Импорт | `/admin/import` | Загрузка фидов, маппинг, превью, запуск |
| Лиды | `/admin/leads` | CRM: заявки, статусы, назначение, заметки |
| Пользователи | `/admin/users` | Управление администраторами |
| Логи | `/admin/logs` | Аудит-журнал действий |
| Настройки ЖК | `/admin/complex/:id/settings` | Конфигурация лендинга ЖК |

### Feed Import Workflow

1. **Создание источника** — указать имя, формат (XLSX/CSV/XML/JSON), режим (файл/URL)
2. **Загрузка/скачивание** — загрузить файл или указать URL для автообновления
3. **Маппинг** — сопоставление колонок фида с полями системы
4. **Предпросмотр** — просмотр распознанных данных, ошибок и предупреждений
5. **Запуск импорта** — вставка/обновление записей в БД
6. **Жизненный цикл** — `external_id + source_id` = уникальный ключ; пропавшие из фида записи → `hidden`

### Database Management

- **Хранение:** `server/data/db.json` — файловое JSON-хранилище
- **Backup:** Копировать файл `db.json` перед обновлениями
- **Seed:** При первом запуске (или если `db.json` отсутствует) выполняется `ensureSeed()` из `server/lib/seed.ts`
- **Миграция:** При изменении `DbShape` в `shared/types.ts` — ручная миграция `db.json`

### Monitoring

- **Аудит-логи** в БД: все действия администраторов (CRUD, логины, импорты) записываются в `audit_logs`
- **Import logs:** каждый прогон импорта сохраняется в `import_runs` со статистикой и ошибками
- **Lead tracking:** все заявки содержат IP, user-agent, источник (страница/блок/объект)
- **Rate limiting:** защита API через `rateLimit` middleware

---

## 5. Code Patterns & Conventions

### Type Safety
- Все общие типы в `shared/types.ts`, импортируются с `.js` для ESM-совместимости
- `DbShape` — интерфейс структуры всей базы данных
- Валидация данных через Zod на серверной стороне

### UI Components (CVA pattern)
```typescript
// Компоненты в src/components/ui/ используют CVA для вариантов
import { cva } from 'class-variance-authority'
const buttonVariants = cva('base-classes', {
  variants: { variant: { primary: '...', secondary: '...' }, size: { sm: '...', md: '...' } }
})
// Объединение классов через cn() (tailwind-merge + clsx)
import { cn } from '@/lib/utils'
```

### API Response Format
```typescript
{ success: boolean, data?: any, error?: string }
```

### Storage Helpers
```typescript
import { readDb, writeDb, withDb } from './lib/storage.js'
// readDb()    — чтение всей БД
// writeDb(db) — запись всей БД
// withDb(fn)  — атомарная операция чтение→модификация→запись
```

### Path Aliases
```typescript
import { Button } from '@/components/ui/Button'  // @ → src/
```

### Design Tokens (from spec)
- Background: `#FFFFFF`, Text: `#0F172A`, Secondary: `#475569`
- Accent: `#0EA5E9`, Borders: `#E2E8F0`
- Breakpoints: Desktop ≥1200, Tablet 768–1199, Mobile <768

---

## 6. Development Workflow

### Adding a New Feature
1. Определить типы в `shared/types.ts`
2. Обновить `DbShape` если нужна новая коллекция в БД
3. Создать API route в `server/routes/`
4. Реализовать UI-компоненты в `src/components/`
5. Добавить страницу в `src/pages/` если нужна
6. Выполнить `npm run check` для проверки типов

### Modifying the Database
1. Обновить `DbShape` в `shared/types.ts`
2. Обновить seed-логику в `server/lib/seed.ts` если нужно
3. БД auto-seed при первом запуске (если `db.json` отсутствует)
4. В production — ручная миграция `db.json`

---

## 7. Important Notes

- **Database:** Сейчас JSON file-based, в ТЗ запланирован PostgreSQL (Supabase)
- **Image Handling:** URL-ы в массивах, хранилище TBD (запланировано S3-совместимое)
- **Phone Formatting:** `formatPhone()` из `server/lib/phone.ts` для RU номеров
- **ID Generation:** `newId()` из `server/lib/ids.ts` для UUID
- **Seed Data:** Запускается при старте сервера если `db.json` нет
- **Concurrent Dev:** Всегда используйте `npm run dev` для одновременного запуска клиента и сервера
- **Production Port:** 3000 (в Docker/CapRover), 3001 (dev)
- **No test framework:** В проекте нет тестов и test runner не настроен
- **Health endpoint:** `GET /api/health` — проверка работоспособности сервера
- **Vite proxy:** Проксирует и `/api/*`, и `/uploads/*` на Express :3001

---

## 8. Environment Variables

| Переменная | По умолчанию | Описание |
|------------|-------------|----------|
| `PORT` | `3001` (dev), `3000` (Docker) | Порт сервера |
| `RW_DATA_DIR` | `server/data` | Директория для `db.json` |
| `RW_UPLOADS_DIR` | `server/uploads` (или `$RW_DATA_DIR/uploads`) | Директория для загруженных файлов |
| `NODE_ENV` | `development` | Режим окружения |

Логика разрешения путей — в `server/lib/paths.ts`. Переменные поддерживают как абсолютные, так и относительные пути.

---

## 9. TypeScript Configuration

- `strict: false` — строгий режим выключен
- `noEmit: true` — только проверка типов, сборку выполняет Vite
- Target: ES2020, Module: ESNext, moduleResolution: bundler
- Path alias `@/` → `src/` настроен и в `tsconfig.json`, и в `vite.config.ts` (через `vite-tsconfig-paths`)
- Серверные импорты используют расширение `.js` для ESM-совместимости (даже если исходные файлы `.ts`)
