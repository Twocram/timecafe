# Vika

Небольшое Node.js-приложение для тайм-кафе с оплатой через YooKassa.

Стек:
- `Fastify` для API и раздачи статики
- `PostgreSQL` для хранения платёжных сессий
- `Docker` и `docker compose` для локального запуска

## Локальный запуск через Docker

1. Создайте `.env` на основе примера:

```bash
cp .env.example .env
```

2. Заполните реальные значения:

- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`
- `YOOKASSA_RETURN_URL`

Для локальной разработки можно оставить:

```env
PORT=3000
DATABASE_URL=postgresql://vika:vika_password@db:5432/vika
DATABASE_SSL=false
YOOKASSA_RETURN_URL=http://localhost:3000/?payment=return
```

Важно:
- хост `db` в `DATABASE_URL` работает только внутри `docker compose`
- для Render, Railway и других managed-хостингов нужен внешний URL вашей PostgreSQL, а не `@db:5432`

3. Поднимите проект:

```bash
docker compose up --build
```

Приложение будет доступно на `http://localhost:3000`.

Проверка health endpoint:

```bash
curl http://localhost:3000/health
```

## Переменные окружения

- `PORT` - порт HTTP-сервера внутри контейнера
- `DATABASE_URL` - строка подключения к PostgreSQL
- `DATABASE_SSL` - `true` или `false`, включает SSL для подключения к БД
- `YOOKASSA_SHOP_ID` - shop id из YooKassa
- `YOOKASSA_SECRET_KEY` - secret key из YooKassa
- `YOOKASSA_RETURN_URL` - абсолютный URL возврата после оплаты
- `IS_TESTING` - `true` или `false`, отключает проверку рабочего времени на фронтенде для тестовых платежей
- `GOOGLE_SHEETS_WEBHOOK_URL` - URL опубликованного Google Apps Script Web App для записи успешных оплат в Google Sheets

Если `DATABASE_URL` не используется, приложение также понимает:

- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`

## Что хранится в PostgreSQL

На старте приложение автоматически создаёт таблицу `payment_sessions`.

В ней хранится:
- `return_token`
- `payment_id`
- `customer_name`
- сумма
- описание
- metadata
- время создания

Это нужно, чтобы возврат после оплаты работал стабильно даже после рестарта контейнера.

Также для синхронизации с Google Sheets сохраняется отметка `google_sheets_synced_at`, чтобы один и тот же успешный платёж не попадал в таблицу повторно.

## Синхронизация с Google Sheets

Прямой ссылки вида `https://docs.google.com/spreadsheets/.../edit` недостаточно для серверной записи из Node.js. Для автоматического добавления строк нужен webhook. Самый простой вариант здесь - Google Apps Script Web App.

### 1. Создайте Apps Script для таблицы

Откройте нужную Google Sheets таблицу и выберите `Extensions -> Apps Script`, затем вставьте код:

```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const SHEET_NAME = 'Payments';

function getSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'payment_id',
      'return_token',
      'customer_name',
      'amount',
      'currency',
      'description',
      'status',
      'paid',
      'created_at',
      'paid_at',
      'metadata_json'
    ]);
  }

  return sheet;
}

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || '{}');
  const sheet = getSheet();
  const paymentId = String(payload.paymentId || '').trim();

  if (!paymentId) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'paymentId is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  let existing = null;
  if (sheet.getLastRow() > 1) {
    existing = sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 1)
      .createTextFinder(paymentId)
      .matchEntireCell(true)
      .findNext();
  }

  if (!existing) {
    sheet.appendRow([
      paymentId,
      payload.returnToken || '',
      payload.customerName || '',
      payload.amount || '',
      payload.currency || 'RUB',
      payload.description || '',
      payload.status || '',
      payload.paid ? 'true' : 'false',
      payload.createdAt || '',
      payload.paidAt || '',
      JSON.stringify(payload.metadata || {})
    ]);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

В `SPREADSHEET_ID` подставьте id из URL таблицы: часть между `/d/` и `/edit`.

### 2. Опубликуйте Web App

В Apps Script:

- `Deploy -> New deployment`
- тип: `Web app`
- `Execute as`: `Me`
- `Who has access`: `Anyone`

Скопируйте получившийся URL Web App и положите его в `.env`:

```env
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/your-web-app-id/exec
```

### 3. Как это работает в приложении

- пользователь вводит имя на фронтенде до начала визита
- когда YooKassa присылает событие `payment.succeeded` на `/api/yookassa/webhook`, сервер отправляет платёж в `GOOGLE_SHEETS_WEBHOOK_URL`
- если webhook от YooKassa ещё не настроен, резервно синхронизация также пытается выполниться при проверке `/api/payments/:paymentId` после возврата пользователя на сайт
- после успешной отправки в БД ставится `google_sheets_synced_at`
- если webhook временно недоступен, статус оплаты для клиента всё равно возвращается, а синхронизацию можно повторить позже

### 3.1 Настройка webhook в YooKassa

Чтобы таблица обновлялась сразу после успешной оплаты, а не только после возврата пользователя в браузер, настройте HTTP-уведомление YooKassa на ваш сервер:

- URL: `https://your-domain.example/api/yookassa/webhook`
- событие: `payment.succeeded`

Для локального `localhost` webhook от YooKassa не подойдёт, потому что ЮKassa должна достучаться до публичного URL. Локально можно тестировать через возврат пользователя на сайт или через туннель вроде `ngrok`.

### 4. Загрузка уже завершённых платежей

Для старых записей, которые ещё не были выгружены:

```bash
npm run sync:payments
```

Опционально можно ограничить количество проверяемых записей:

```bash
npm run sync:payments -- 50
```

## Деплой на Railway

Рекомендуемая схема:
- один сервис приложения из этого репозитория
- один managed `PostgreSQL` в том же проекте Railway

### 1. Создайте сервис приложения

- Подключите GitHub-репозиторий в Railway
- Railway увидит [Dockerfile](/Users/artyom/Documents/projects/vika/Dockerfile:1) и соберёт контейнер из него

### 2. Добавьте PostgreSQL

- В проекте Railway добавьте `PostgreSQL`
- Railway автоматически создаст `DATABASE_URL`

### 3. Настройте переменные приложения

Минимально нужны:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_SSL=true
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=...
YOOKASSA_RETURN_URL=https://your-domain.example/?payment=return
PORT=3000
```

Примечания:
- `DATABASE_SSL=true` обычно нужен для managed Postgres
- `YOOKASSA_RETURN_URL` должен указывать на ваш реальный публичный домен
- приложение уже слушает `0.0.0.0`, что подходит для Railway

### 4. Проверьте после деплоя

- откройте `/health`
- создайте тестовый платёж
- убедитесь, что возврат с YooKassa обратно на сайт проходит корректно

## Деплой на Render

Рекомендуемая схема:
- один `Web Service` для приложения из этого репозитория
- одна managed `PostgreSQL` база в Render

Что важно:
- Render не использует ваш `docker-compose.yml`
- hostname `db` из локального Docker на Render не существует
- если в Render вручную указать `DATABASE_URL=postgresql://...@db:5432/...`, приложение упадёт с `getaddrinfo ENOTFOUND db`
- в репозитории есть [render.yaml](/Users/artyom/Documents/projects/vika/render.yaml:1), поэтому проще создавать проект через `Blueprint`

### 1. Создайте Blueprint из репозитория

- в Render откройте `Blueprints` -> `New Blueprint Instance`
- выберите этот репозиторий
- Render поднимет `Web Service` и managed `PostgreSQL` по [render.yaml](/Users/artyom/Documents/projects/vika/render.yaml:1)

### 2. Заполните секреты при первом создании

- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`
- `YOOKASSA_RETURN_URL`

`DATABASE_URL` будет выставлен автоматически из managed Postgres.

### 3. Что именно задаёт Blueprint

В текущем [render.yaml](/Users/artyom/Documents/projects/vika/render.yaml:1):

```env
PORT=10000
DATABASE_URL=<берётся из Render Postgres>
DATABASE_SSL=false
YOOKASSA_SHOP_ID=<запрашивается в Render>
YOOKASSA_SECRET_KEY=<запрашивается в Render>
YOOKASSA_RETURN_URL=<запрашивается в Render>
```

Примечания:
- не используйте `@db:5432` в `DATABASE_URL`
- `DATABASE_SSL=false` выставлен специально, потому что Blueprint использует внутренний `connectionString` Render по private network
- если потом захотите подключаться к внешнему URL базы вручную, проверьте, нужен ли для него `DATABASE_SSL=true`

### 4. Проверьте после деплоя

- откройте `/health`
- если сервис не стартует, первым делом проверьте, что сервис был создан именно из Blueprint, а не со старым ручным `DATABASE_URL`

## Полезные команды

Локальный запуск:

```bash
docker compose up --build
```

Остановить контейнеры:

```bash
docker compose down
```

Остановить контейнеры и удалить volume с локальной БД:

```bash
docker compose down -v
```

## Что ещё стоит сделать дальше

- добавить миграции вместо auto-create схемы на старте
- логировать изменения статусов платежей
- добавить webhook от YooKassa, если понадобится более надёжное подтверждение оплаты
- вынести секреты только в переменные хостинга, без хранения в локальных конфигурациях прод-среды

## Деплой на VPS

Ниже самый прямой вариант для VPS: `Docker Compose + Caddy + PostgreSQL`.

Предположение:
- VPS на Ubuntu
- у вас есть домен
- DNS-запись домена уже указывает на IP сервера

### Что будет крутиться

- `app` - ваше Node.js-приложение
- `db` - PostgreSQL в Docker volume
- `caddy` - reverse proxy с автоматическим `HTTPS`

Используются файлы:
- [docker-compose.prod.yml](/Users/artyom/Documents/projects/vika/docker-compose.prod.yml:1)
- [Caddyfile](/Users/artyom/Documents/projects/vika/Caddyfile:1)

### 1. Подготовьте сервер

Подключитесь по SSH:

```bash
ssh user@your-server-ip
```

Обновите систему:

```bash
sudo apt update
sudo apt upgrade -y
```

Установите Docker и compose plugin:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

После этого лучше переподключиться по SSH.

Проверьте:

```bash
docker --version
docker compose version
```

### 2. Откройте порты

Если включён `ufw`:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 3. Скопируйте проект на сервер

Если репозиторий в Git:

```bash
git clone <repo-url> vika
cd vika
```

Или скопируйте локальную папку на сервер через `scp`/`rsync`.

### 4. Создайте продовый `.env`

На сервере:

```bash
cp .env.example .env
```

Минимум, что нужно заполнить:

```env
POSTGRES_DB=vika
POSTGRES_USER=vika
POSTGRES_PASSWORD=very_strong_password
APP_DOMAIN=your-domain.example
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=...
YOOKASSA_RETURN_URL=https://your-domain.example/?payment=return
```

Для VPS через `docker-compose.prod.yml` переменная `DATABASE_URL` вручную не нужна, она собирается автоматически из `POSTGRES_*`.

### 5. Запустите прод

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

Проверьте контейнеры:

```bash
docker compose -f docker-compose.prod.yml ps
```

Проверьте логи:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

### 6. Проверьте сайт и health endpoint

Откройте:

- `https://your-domain.example`
- `https://your-domain.example/health`

Если DNS уже указывает на сервер, `Caddy` сам выпустит и продлит TLS-сертификат.

### Как обновлять приложение

На сервере:

```bash
git pull
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

### Как сделать автозапуск после перезагрузки

В compose уже стоит `restart: unless-stopped`, поэтому после рестарта Docker контейнеры поднимутся сами.

### Что важно для продакшена

- не публикуйте порт PostgreSQL наружу
- используйте сложный `POSTGRES_PASSWORD`
- `YOOKASSA_RETURN_URL` должен быть точно на боевом домене и через `https`
- перед боевым запуском проверьте, что домен уже смотрит на VPS, иначе `Caddy` не сможет выпустить сертификат
