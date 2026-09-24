# ReleaseCheck

Проверка веб-сайта перед релизом: визуальные изменения, ошибки JavaScript,
неудачные запросы и битые внутренние ссылки в одном отчёте.

**Статус:** работает первый локальный сквозной сценарий: React → API → PostgreSQL
→ очередь → отдельный Chromium → скриншот и найденные ошибки.
Рабочее название репозитория — `personal-roadmap`; продукт — ReleaseCheck.

Сейчас можно проверить две версии подготовленного storefront: исходную и
изменённую, с намеренной JS-ошибкой и HTTP 404. История и результаты сохраняются
в PostgreSQL. Это локальный технический прототип; дизайн ещё не утверждён.

## Целевой сценарий полной первой версии

1. Добавить проект и до пяти страниц собственного тестового сайта.
2. Запустить проверку в Chromium для desktop и mobile viewport.
3. Просмотреть скриншоты и подтвердить первый эталон.
4. Изменить сайт и повторить проверку.
5. Увидеть новые ошибки и визуальные отличия; принять ожидаемые изменения.

Проверка помогает принять решение о релизе, но не гарантирует отсутствие ошибок.
Мобильный viewport — эмуляция размеров экрана, а не тест на реальном устройстве.

## Документы

- [Архитектура и модель данных](docs/architecture.md)
- [Продукт и границы MVP](docs/product.md)
- [План на месяц](docs/roadmap.md)
- [Технические решения](docs/decisions.md)
- [Текущее состояние и следующий шаг](docs/progress.md)
- [Совместная работа и ежедневные запуски](docs/workflow.md)
- [Локальный запуск, проверки и ограничения текущего этапа](docs/local-development.md)

## Выбранное направление

TypeScript, React + Vite, Node.js + Fastify, PostgreSQL, Graphile Worker,
Playwright / Chromium. Зависимости закреплены в `package-lock.json`.
Runtime — Node.js 24 LTS; база локально — PostgreSQL 17 в Docker.

## Быстрый старт

Требуются Node.js 24, npm и запущенный Docker. Команды выполняются из корня.

```sh
nvm install
nvm use
npm ci
cp .env.example .env
docker compose up -d --wait postgres
PLAYWRIGHT_BROWSERS_PATH=.local/browsers npx playwright install chromium
npm run build
npm run db:migrate
npm run dev
```

Открыть [локальный интерфейс](http://127.0.0.1:5173), выбрать версию демо и нажать
**Run check**. Не заменяйте существующий `.env`, если уже настроили окружение.
На Linux для Chromium могут потребоваться системные библиотеки — используйте
`npx playwright install --with-deps chromium` с тем же `PLAYWRIGHT_BROWSERS_PATH`.

## Проверки

```sh
npm run check
docker compose exec -T postgres createdb -U releasecheck releasecheck_test
TEST_DATABASE_URL=postgres://releasecheck:releasecheck@127.0.0.1:55432/releasecheck_test PLAYWRIGHT_BROWSERS_PATH=.local/browsers npm run test:integration
# При работающем npm run dev, в другом терминале:
npm run test:smoke
```

Тестовую БД создаём один раз. Integration suite очищает только отдельно заданную
базу с именем, оканчивающимся на `_test`. GitHub Actions выполняет сборку,
проверку TypeScript, ESLint, unit- и integration-тесты с реальными PostgreSQL и Chromium.

## Пока не реализовано

Подтверждение baseline и visual diff, несколько страниц/viewport, проверка ссылок,
авторизация, изоляция для внешних сайтов и production-деплой. API и worker
запускаются только с `NODE_ENV=development` или `test`, API слушает loopback.
Не публикуйте этот прототип через туннель или внешний reverse proxy.

Публичное портфолио будет включать демо с подготовленным сайтом, видео сценария
обнаружения регрессии, тесты и объяснение технических компромиссов.
