# ETF Daily Parser PRO

Сайт для автоматической загрузки дневных данных по ETF/тикерам и расчета Daily Return.

## Возможности

- ввод тикеров через запятую;
- выбор диапазона дат;
- загрузка данных через `/api/history`;
- Yahoo Finance как основной источник;
- Stooq как резервный источник;
- `MNYMKT` как денежный рынок с Daily Return = 0%;
- таблица Daily Return по каждому дню;
- контрольная таблица цен;
- сводная аналитика: Total Return, CAGR, annualized volatility, max drawdown, positive days, best/worst day;
- CSV для скачивания содержит только Daily Return, без цен.

## Запуск

```bash
npm install
npm run dev
```

## Деплой на Vercel

Загрузите проект в GitHub и подключите репозиторий к Vercel. API находится в папке `/api/history.js`.
