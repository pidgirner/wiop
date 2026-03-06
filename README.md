# Liquid Content Studio

MVP web-приложение для генерации контента с SEO-лендингом, оплатой через Cardlink и полноценной админ-панелью.

## Реализовано

- Генерация контента: `text`, `image`, `video`, `audio`, `post`.
- Реальная AI-генерация на backend (OpenAI) с сохранением истории в таблицу `generations`.
- Тарифы: `Free`, `Plus`, `Pro`.
- Авторизация: регистрация, вход, JWT, профиль.
- Платежи: Cardlink bill creation + обработка postback + синхронизация статуса подписки.
- SEO-лендинг:
  - главная страница `/` под лидогенерацию,
  - мета-теги, OpenGraph, Schema.org JSON-LD,
  - `robots.txt` и `sitemap.xml` для Google/Yandex.
- PWA:
  - `manifest.webmanifest`,
  - `service worker`,
  - offline fallback страница,
  - install prompt на клиенте.
- Мобильный UX:
  - нижний фиксированный навбар,
  - блок подписки перенесен в профиль.
- Админ-панель:
  - аналитика по пользователям и платежам,
  - аналитика и статус-лист лидов с лендинга,
  - таблица клиентов с фильтрами,
  - смена роли/плана/статуса пользователя,
  - журнал последних платежей.

## Структура

- `index.html`, `styles.css`, `app.js` — клиент приложения (`/app`).
- `public/landing.html`, `public/landing.css`, `public/landing.js` — SEO-лендинг (`/`).
- `public/manifest.webmanifest`, `public/sw.js`, `public/offline.html` — PWA ресурсы.
- `public/icons/*` — иконки приложения.
- `api/index.js` — serverless entrypoint для Vercel.
- `vercel.json` — маршрутизация всех запросов через Express API.
- `server/index.js` — API, Cardlink интеграция, admin API.
- `server/data/db.json` — локальная fallback БД (если Supabase не настроен).
- `supabase/schema.sql` — SQL-схема для Supabase.
- `.env.example` — шаблон env.

## Настройка

```bash
cp .env.example .env
```

Заполните в `.env`:

- `JWT_SECRET`
- `CARDLINK_API_TOKEN`
- `CARDLINK_SHOP_ID`
- `CLIENT_URL`
- `GOOGLE_SITE_VERIFICATION` (если нужно подтверждение Search Console)
- `YANDEX_VERIFICATION` (если нужно подтверждение Вебмастера)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (опционально, по умолчанию `gpt-4o-mini`)
- `OPENAI_API_BASE` (опционально, по умолчанию `https://api.openai.com/v1`)
- `OPENAI_TEMPERATURE` (опционально, по умолчанию `0.7`)
- `OPENAI_MAX_TOKENS` (опционально, по умолчанию `900`)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

### Подключение Supabase

1. Создайте проект в Supabase.
2. Откройте SQL Editor и выполните `supabase/schema.sql`.
3. В `.env` заполните:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Запустите приложение. При наличии Supabase сервер автоматически использует его как БД.
5. Backend работает с нормализованными таблицами (`app_users`, `user_profiles`, `user_subscriptions`, `payments`, `leads`), без `app_state`.

### Миграция локальных данных в Supabase

```bash
# проверить, что будет загружено
npm run migrate:supabase -- --dry-run

# выполнить миграцию из server/data/db.json
npm run migrate:supabase
```

Если путь к локальной БД другой:

```bash
npm run migrate:supabase -- --file /absolute/path/to/db.json
```

`--dry-run` тоже требует заполненные `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`, потому что скрипт валидирует подключение и структуру таблиц.

## Запуск

```bash
npm install
npm run dev
```

После запуска:

- лендинг: `http://localhost:8787/`
- приложение: `http://localhost:8787/app`

## Деплой на GitHub

```bash
git add .
git commit -m "feat: supabase + vercel deployment"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## Деплой на Vercel

1. Импортируйте GitHub-репозиторий в Vercel.
2. В Project Settings -> Environment Variables добавьте:
   - `CLIENT_URL` (ваш прод-домен, например `https://your-app.vercel.app`)
   - `JWT_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `CARDLINK_*` переменные (если включаете оплату)
   - `GOOGLE_SITE_VERIFICATION` и `YANDEX_VERIFICATION` (если нужны)
3. Нажмите Deploy.

CLI-вариант:

```bash
npx vercel link
npx vercel env add SUPABASE_URL production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel --prod
```

## Cardlink flow

1. Пользователь выбирает `Plus/Pro`.
2. Клиент вызывает `POST /api/billing/cardlink/create-bill`.
3. Сервер создает bill в Cardlink (`/api/v1/bill/create`) и возвращает `link_page_url`.
4. Пользователь оплачивает на стороне Cardlink.
5. Cardlink присылает postback на `POST /api/billing/cardlink/postback`.
6. Сервер валидирует `SignatureValue`, обновляет платеж и активирует план пользователю.

## Важные URL в настройках магазина Cardlink

- Success URL: `https://your-domain.com/api/billing/cardlink/success`
- Fail URL: `https://your-domain.com/api/billing/cardlink/fail`
- Result URL: `https://your-domain.com/api/billing/cardlink/postback`

## API

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PATCH /api/profile`

### Billing

- `POST /api/billing/cardlink/create-bill`
- `GET /api/billing/cardlink/order-status?invId=...`
- `GET /api/billing/payments`
- `POST /api/billing/cardlink/postback`

### Generations

- `GET /api/generations`
- `POST /api/generations`
- `DELETE /api/generations/:id`
- `DELETE /api/generations`

### Admin

- `GET /api/admin/overview`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `GET /api/admin/payments`
- `GET /api/admin/leads`
- `PATCH /api/admin/leads/:id`

### Leads

- `POST /api/leads`

## Проверка кода

```bash
npm run check
```
