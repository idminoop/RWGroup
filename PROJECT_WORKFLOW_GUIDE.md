# Гайд по эффективной работе с проектом RWGroup

Этот документ — практическая карта проекта для разработчика: как быстро стартовать, куда смотреть при изменениях, где риски и как не ломать прод.

## 1. Что это за проект

RWGroup — это сайт агентства недвижимости с двумя основными контурами:

- публичная витрина (лендинг + каталог + карточки ЖК/лотов + подборки),
- админка (контент, каталог, импорты, бэкапы, лиды, пользователи, публикация).

Ключевая особенность: состояние данных ведётся в двух скоупах:

- `draft` — рабочий черновик,
- `published` — опубликованная версия, которую видит публичная часть.

Из админки изменения сначала попадают в `draft`, а затем вручную публикуются в `published` через `/api/admin/publish/apply`.

## 2. Быстрый старт

### Локальная разработка

Требования:

- Node.js 22+
- npm

Команды:

```bash
npm ci
npm run dev
```

Что запускается:

- фронт: Vite на `http://localhost:5173` (по умолчанию),
- бэк: Express на `http://localhost:3001`.

В `vite.config.ts` настроен proxy:

- `/api` -> `http://localhost:3001`
- `/uploads` -> `http://localhost:3001`

### Docker (production-like)

```bash
docker compose up --build
```

Что поднимется:

- `app` (Node runtime, порт `3001`),
- `postgres` (по умолчанию порт `5432`).

Entry-point контейнера (`docker-entrypoint.sh`) перед стартом приложения запускает миграции (`npm run db:migrate`), если не отключено `RW_RUN_DB_MIGRATIONS_ON_START=false`.

## 3. Карта проекта

### Корень

- `package.json` — все скрипты запуска/проверок.
- `docker-compose.yml`, `Dockerfile`, `docker-entrypoint.sh` — контейнеризация.
- `api/index.ts` — serverless entrypoint для Vercel.
- `about.json` — локальная копия описания feed-эндпоинтов (TrendAgent).
- `scripts/mirror_trendagent_feed.py` — зеркало внешнего фида в локальные файлы.

### Frontend

- `src/main.tsx` — bootstrap React.
- `src/App.tsx` — роутинг публички + `/admin/*`.
- `src/pages/*` — публичные страницы.
- `src/pages/admin/*` — админка (layout + разделы).
- `src/components/*` — UI/feature-компоненты.
- `src/lib/api.ts` — общий HTTP-клиент с валидацией формата API.
- `src/store/*` — Zustand-сторы (`useUiStore`, кэши каталога/импорта).

### Backend

- `server/server.ts` — локальный entrypoint + graceful shutdown.
- `server/app.ts` — инициализация storage, middleware, роутов и статики.
- `server/routes/public.ts` — публичный API.
- `server/routes/admin.ts` — весь admin API (крупный модуль).
- `server/routes/leads.ts` — приём лидов.
- `server/routes/analytics.ts` — приём событий аналитики.
- `server/routes/auth.ts` — заглушка (не реализован).

### Данные и хранилище

- `shared/types.ts` — единый доменный контракт фронта/бэка.
- `server/lib/storage.ts` — runtime-слой доступа к `draft/published`.
- `server/lib/state-repository.ts` — драйверы `file|postgres`.
- `server/lib/pg/domain-repositories.ts` — нормализованные таблицы Postgres.
- `server/migrations/*.sql` — SQL-миграции.

### Импорты/автоматика

- `server/lib/import-logic.ts` — маппинг и upsert фидов.
- `server/lib/feed-fetch.ts` — безопасная загрузка URL-фидов (таймауты, лимиты, анти-SSRF).
- `server/lib/feed-scheduler.ts` — автообновление URL-фидов.
- `server/lib/backups.ts` — бэкапы + restore + scheduler.
- `server/lib/nearby.ts` — генерация nearby POI для ЖК (Yandex/OSM/OSRM).

## 4. Ключевые runtime-потоки

### 4.1 Инициализация сервера

Порядок в `server/app.ts`:

1. `initializeStorage()`
2. `ensureSeed()` (если разрешён)
3. `flushStorage()`
4. запуск feed scheduler (если включён)
5. запуск backup scheduler (если включён)
6. регистрация API + статики + health + error handlers

### 4.2 Draft vs Published

- Все админ-изменения пишутся в `draft`.
- Публичные роуты используют `withPublishedDb(...)`.
- Публикация — явный вызов `/api/admin/publish/apply`.

Следствие: если «в админке видно, а на сайте нет», сначала проверяйте publish status и наличие pending changes.

### 4.3 Импорт фидов

Критичный путь:

- загрузка/URL фида -> парсинг (`csv/xlsx/xml/json`) -> маппинг -> upsert
- lifecycle отсутствующих записей: `active -> hidden -> archived`
- cross-source dedup есть и для `complex`, и для `property`
- для TrendAgent (`about.json`) используйте ручной поток `/api/admin/import/trendagent/*`:
  список ЖК (`/import/trendagent/complexes`), выборочный импорт или full-city импорт (`/import/trendagent/run` c `full_city=true`)

Рекомендуемая точка входа при проблемах импорта:

- `server/routes/admin.ts` (`/import/preview`, `/import/run`, `/import/trendagent/*`)
- `server/lib/import-logic.ts`
- `server/lib/feed-fetch.ts`

### 4.4 Бэкапы

Что восстанавливается из backup content:

- home/feed/catalog/collections/landing presets.

Что **не** откатывается обычным restore:

- обработка лидов (`lead_status`, `assignee`, `admin_note`) откатывается отдельным endpoint'ом `/api/admin/leads/restore-processing`.

## 5. Основные API-сегменты

Публичные:

- `GET /api/home`
- `GET /api/facets`
- `GET /api/catalog`
- `GET /api/property/:idOrSlug`
- `GET /api/complex/:idOrSlug`
- `GET /api/collection/:idOrSlug`
- `GET /api/geocode`
- `POST /api/leads`
- `POST /api/analytics/event`

Админские:

- auth/session: `/api/admin/login`, `/api/admin/me`
- publish: `/api/admin/publish/status`, `/api/admin/publish/apply`
- home/maps: `/api/admin/home`, `/api/admin/yandex-key/check`
- catalog: `/api/admin/catalog/*`
- collections: `/api/admin/collections*`
- feeds/import: `/api/admin/feeds*`, `/api/admin/import/*`
- backups: `/api/admin/backups*`
- leads: `/api/admin/leads*`
- users: `/api/admin/users*`
- logs: `/api/admin/logs`

## 6. Где что менять

### Меняем публичную страницу

- Роут: `src/App.tsx`
- Страница: `src/pages/...`
- API-контракт: `shared/types.ts`
- Серверный endpoint: `server/routes/public.ts`

### Меняем админский раздел

- Навигация/доступы: `src/pages/admin/AdminLayout.tsx`
- UI раздела: `src/pages/admin/pages/...`
- Endpoint: `server/routes/admin.ts`
- Разрешения: `shared/types.ts` + `server/lib/admin-users.ts`

### Меняем модель данных

1. Правим типы в `shared/types.ts`.
2. Обновляем backend логику (`import-logic`, `public/admin` routes).
3. Для Postgres — правим миграции/репозитории (`server/migrations`, `server/lib/pg/domain-repositories.ts`).
4. Проверяем клиентские формы/карточки.

### Меняем импорт

- Парсинг/нормализация: `server/lib/import-logic.ts`
- Ограничения загрузки: `server/lib/feed-fetch.ts`
- Админский UX предпросмотра: `src/pages/admin/pages/AdminImport.tsx`

### Меняем SEO/meta

- Клиентские meta: `src/lib/meta.ts`, `src/components/seo/JsonLd.tsx`
- Bot prerender на сервере: `server/lib/bot-renderer.ts`

## 7. Важные переменные окружения

### Хранилище

- `RW_STORAGE_DRIVER=auto|file|postgres`
- `DATABASE_URL=postgres://...`
- `RW_MIGRATIONS_DIR=...`
- `RW_ALLOW_FILE_STORAGE_IN_PROD=true|false`
- `RW_PG_BOOTSTRAP_FROM_LOCAL=true|false`
- `RW_SEED_ENABLED=true|false`

### Планировщики

- `RW_FEED_SCHEDULER_ENABLED=true|false`
- `RW_BACKUP_SCHEDULER_ENABLED=true|false`

### Feed fetch safeguards

- `RW_FEED_FETCH_TIMEOUT_MS`
- `RW_FEED_FETCH_MAX_BYTES`
- `RW_FEED_FETCH_MAX_REDIRECTS`
- `RW_FEED_MAX_ROWS`
- `RW_FEED_FETCH_ALLOW_PRIVATE_HOSTS=true|false`
- `RW_FEED_FETCH_ALLOWED_HOSTS=host1,host2`

### Media storage

- `RW_MEDIA_STORAGE_DRIVER=auto|local|s3`
- `RW_S3_BUCKET`, `RW_S3_REGION`, `RW_S3_ENDPOINT`
- `RW_S3_ACCESS_KEY_ID`, `RW_S3_SECRET_ACCESS_KEY`
- `RW_S3_PREFIX`, `RW_S3_FORCE_PATH_STYLE`
- `RW_MEDIA_CDN_BASE_URL` / `RW_S3_PUBLIC_BASE_URL`

### Admin auth

- `ADMIN_DEFAULT_LOGIN`
- `ADMIN_DEFAULT_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `ADMIN_SESSION_TTL_HOURS`

### Frontend env

- `VITE_YANDEX_MAPS_API_KEY`
- `VITE_YM_ID`

## 8. Команды для повседневной работы

```bash
# dev
npm run dev

# type check
npm run check

# lint
npm run lint

# build
npm run build

# DB migrations
npm run db:migrate

# smoke tests
npm run smoke:postgres:e2e
npm run smoke:feed-import:e2e
npm run smoke:backup:e2e
npm run smoke:geocode:e2e
npm run smoke:complex-cover:e2e
```

Важно: unit/integration тестов в обычном формате (`*.test.*`, `*.spec.*`) в проекте сейчас нет, опора в основном на smoke e2e-скрипты.

## 9. Частые проблемы и быстрые проверки

### «Админка сохранила, но сайт не поменялся»

- Проверить `/api/admin/publish/status`.
- Выполнить publish (`/api/admin/publish/apply`).

### «Не грузится фид по URL»

Проверить:

- URL (http/https, без credentials),
- лимиты `RW_FEED_FETCH_*`,
- политику private hosts (`RW_FEED_FETCH_ALLOW_PRIVATE_HOSTS`).

### «Карта/геокод не работает»

- Проверить API key в `home.maps.yandex_maps_api_key` через админку.
- Проверить endpoint `/api/admin/yandex-key/check`.

### «В проде внезапно file storage»

- Явно задайте `RW_STORAGE_DRIVER=postgres`.
- Не включайте `RW_ALLOW_FILE_STORAGE_IN_PROD`, если это не осознанный сценарий.

### «Странные кракозябры в русских строках»

В отдельных файлах встречаются признаки проблем кодировки строк. При правках UI-текстов проверяйте результат в браузере и избегайте смешения кодировок при сохранении.

## 10. Замечания по текущему состоянию репозитория

- `feed_mirror/` может быть очень тяжёлым (включая большие JSON и изображения), не используйте его как рабочую директорию для регулярного поиска по коду.
- `server/routes/auth.ts` сейчас содержит заглушки `501 Not implemented`; реальная авторизация в проекте идёт через `/api/admin/*`.
- `.env.example` отсутствует — для новых участников команды полезно добавить шаблон env-файла.

## 11. Практический workflow на день

1. Поднять `npm run dev`.
2. Проверить, что `/api/health` возвращает `success: true`.
3. Работать через `shared/types.ts` как источник контракта.
4. Для админских изменений проверять и `draft`, и `published` поведение.
5. Перед merge прогонять минимум `npm run check`, `npm run lint` и релевантный smoke-сценарий.
6. Для изменений импортов/бэкапов обязательно прогонять `smoke:feed-import:e2e` и/или `smoke:backup:e2e`.

---

Если нужен, можно сделать вторую версию этого гайда в формате «по ролям» (frontend/backend/content manager) и отдельный короткий runbook для прод-инцидентов.
