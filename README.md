# MOEX Daily Return Parser

Готовый Vite + React + Vercel Serverless проект для загрузки дневных данных российских активов через MOEX ISS API.

## Запуск локально

```bash
npm install
npm run dev
```

## Деплой на Vercel

Загрузите проект в GitHub и подключите репозиторий в Vercel.

## Что исправлено

- Исторические данные берутся с правильного URL: `/iss/history/engines/stock/markets/.../boards/.../securities/...`.
- API не отдает HTTP 404 в интерфейс как падение всего сайта: все ошибки возвращаются JSON-статусом по тикеру.
- Сначала пробуется справочник MOEX `/iss/securities/{ticker}.json`, затем fallback по основным рынкам и boards.
- `YNDX` автоматически заменяется на `YDEX`.
- `CASH`, `RUB`, `MNYMKT` считаются кэшем с 0% Daily Return.
- CSV содержит только Daily Return.
