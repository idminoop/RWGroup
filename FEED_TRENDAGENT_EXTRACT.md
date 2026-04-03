# Выписка по новому фиду (TrendAgent) для каталога

Дата анализа: `2026-03-31`  
Источник: `feed_mirror/dataout.trendagent.ru/msk`

## 1) Что входит в фид

| Файл | Размер | Записей | Полей в записи |
|---|---:|---:|---:|
| `apartments.json` | 148,938,556 B (142.04 MB) | 63,593 | 41 |
| `buildings.json` | 12,126,734 B (11.57 MB) | 9,318 | 11 |
| `blocks.json` | 5,164,487 B (4.93 MB) | 1,302 | 10 |
| `builders.json` | 60,307 B | 563 | 3 |
| `subways.json` | 49,356 B | 447 | 3 |
| `regions.json` | 19,951 B | 181 | 3 |
| `rooms.json` | 2,643 B | 28 | 3 |
| `finishings.json` | 722 B | 7 | 3 |
| `buildingtypes.json` | 1,107 B | 11 | 3 |

Итого полезных данных (без `about.json`): около `158.66 MB`.

## 2) Фактический объем данных для каталога

- Лоты/квартиры: `63,593` (уникальные `_id`, дублей нет).
- Корпуса, покрытые квартирами: `2,516` из `9,318` (`27.0%`).
- ЖК/блоки, покрытые квартирами: `489` из `1,302` (`37.56%`).
- География в лотах: `120` районов, `319` станций метро, `189` застройщиков.

## 3) Что можно выгрузить из `apartments` уже сейчас

Критичные поля для карточки лота заполнены практически полностью:

- `_id`, `price`, `area_total`, `area_rooms_total`, `area_kitchen`, `floor`, `floors`, `room`, `finishing`, `block_id`, `building_id`, `block_name`, `building_name`, `block_district_name`, `block_subway_name`, `block_geometry` = `100%`.
- `plan` = `99.96%`.
- `block_renderer` = `99.98%`.
- `building_deadline` = `100%`.

Дополнительно по распределениям:

- Комнатности (топ): `2Е` 24.56%, `3Е` 18.70%, `1к` 16.20%, `студии` 14.09%, `2к` 10.92%.
- Отделка: `Без стен` 46.72%, `Чистовая` 19.89%, `Подчистовая` 18.05%, `Без отделки` 14.67%.
- Цена: min/median/max = `1` / `18,725,450` / `4,866,880,000`.
- Площадь `area_total`: min/median/max = `9.7` / `48.1` / `1852.6`.

## 4) Связность и качество справочников

Связи корректные (по `_id` и `crm_id`, где применимо):

- `apartments.building_id -> buildings._id`: 100% матч.
- `apartments.block_id -> blocks._id`: 100% матч.
- `buildings.block_id -> blocks._id`: 100% матч.
- `apartments.room -> rooms.crm_id`: 100% матч.
- `apartments.finishing -> finishings._id`: 100% матч.
- `apartments.block_builder -> builders._id`: 100% матч.

Небольшие аномалии:

- `blocks.district -> regions._id`: 4 несовпадения из 1302 (`0.31%`).
- `block_subway[].subway_id` (из `apartments`) не найдено в `subways`: 309 ссылок (`0.28%`), 2 уникальных ID.

## 5) Важный момент по изображениям

- `apartments.plan` содержит полноценные URL (все непустые элементы — URL).
- `apartments.block_renderer` содержит в основном ID медиа, не URL.
- `blocks.renderer` содержит URL и может использоваться как источник фотографий ЖК.

Практически это значит:

- Планировки лота можно брать прямо из `apartments.plan`.
- Фото для карточек лучше тянуть через join `apartments.block_id -> blocks._id -> blocks.renderer`.

## 6) Что можно выгрузить в текущую модель проекта

### Лоты (`Property`)

Без доработки схемы проекта можно заполнить:

- `external_id <- _id`
- `complex_external_id <- block_id`
- `lot_number <- number`
- `bedrooms <- room` (нужна бизнес-нормализация кодов 22/23/24 и т.д.)
- `price <- price`
- `area_total <- area_total`
- `area_living <- area_rooms_total`
- `area_kitchen <- area_kitchen`
- `district <- block_district_name`
- `metro <- block_subway_name`
- `images <- plan` (или фото ЖК через join с `blocks.renderer`)
- `floor <- floor`
- `floors_total <- floors`
- `renovation <- finishing` (сейчас это ID, для красивого текста нужен join с `finishings`)
- `building_section <- building_name`

### ЖК (`Complex`)

Можно стабильно собрать:

- `external_id <- block_id`
- `title <- block_name`
- `district <- block_district_name`
- `metro <- block_subway_name`
- `images <- blocks.renderer` (через join)
- `developer <- block_builder_name`
- `price_from <- MIN(price)` по лотам блока
- `area_from <- MIN(area_total)` по лотам блока
- `handover_date <- building_deadline` (агрегация по корпусам/лотам блока)
- `geo_lat/geo_lon <- block_geometry.coordinates`

## 7) Ограничения текущего импортера (критично)

По умолчанию в проекте стоят лимиты:

- `RW_FEED_FETCH_MAX_BYTES = 20MB`
- `RW_FEED_MAX_ROWS = 50000`
- upload через админку: `15MB` (multer)

Поэтому `apartments.json` (`~142MB`, `63,593` строк) в дефолтной конфигурации не импортируется полностью.

Минимум для полного импорта этого файла:

- поднять `RW_FEED_FETCH_MAX_BYTES` выше `148,938,556` (лучше с запасом, например 200MB),
- поднять `RW_FEED_MAX_ROWS` выше `63,593` (например 100000),
- увеличить `RW_FEED_FETCH_TIMEOUT_MS` (для большого файла по URL).

## 8) Краткий ответ на вопрос «какой объём информации можем выгрузить»

- Потенциал фида: до `63,593` лотов и до `489` ЖК для каталога (по фактическому покрытию `apartments`).
- Доступные атрибуты: цена, площади, этажность, комнатность, отделка, сроки сдачи, локация, метро, застройщик, гео-точка, планировки, фото ЖК.
- В текущем коде без смены лимитов полный объём не пройдет.
- После повышения лимитов и корректного маппинга можно выгружать практически полный каталог из этого фида.
