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
- сумма
- описание
- metadata
- время создания

Это нужно, чтобы возврат после оплаты работал стабильно даже после рестарта контейнера.

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
