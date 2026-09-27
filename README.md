# ReleaseCheck

Проверка веб-сайта перед релизом: визуальные изменения, ошибки JavaScript,
неудачные запросы и битые внутренние ссылки в одном отчёте.

**Статус:** работает локальный цикл: захват → подтверждение эталона → повторная
проверка → визуальные отличия и ошибки в Release Console.
Рабочее название репозитория — `personal-roadmap`; продукт — ReleaseCheck.

Сейчас можно проверить две версии подготовленного storefront: исходную и
изменённую, с намеренной JS-ошибкой и HTTP 404. История и результаты сохраняются
в PostgreSQL. Утверждённый тёмный Release Console подключён к реальным данным:
сравнение, история и принятие эталона работают через API. Прерванные проверки
получают понятную ошибку после истечения лимита попытки и могут быть запущены
заново кнопкой **Retry check**. Связанные HTTP/console-сообщения сгруппированы;
в **Original evidence** доступны все исходные наблюдения, запрос и стек JS-ошибки.

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
- [Два варианта дизайна отчёта](docs/design-review.md)

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
**Run check**. Просмотрите исходный снимок и нажмите **Use as baseline → Confirm baseline**.
Повторная проверка исходного storefront даст совпадение; изменённого — diff и
ошибки. Принятие внешнего вида не скрывает JS/network-ошибки и не меняет старые отчёты.
Каждый отчёт имеет локальный адрес `/runs/<id>`: его можно сохранить, открыть
в другой вкладке или обновить страницу, не теряя выбранную проверку.
Не заменяйте существующий `.env`, если уже настроили окружение.
Архивные дизайн-прототипы: [Review Studio](http://127.0.0.1:5173/design?direction=studio)
или [Release Console](http://127.0.0.1:5173/design?direction=console).
На Linux для Chromium могут потребоваться системные библиотеки — используйте
`npx playwright install --with-deps chromium` с тем же `PLAYWRIGHT_BROWSERS_PATH`.

## Проверки

```sh
npm run check
docker compose exec -T postgres createdb -U releasecheck releasecheck_test
TEST_DATABASE_URL=postgres://releasecheck:releasecheck@127.0.0.1:55432/releasecheck_test PLAYWRIGHT_BROWSERS_PATH=.local/browsers npm run test:integration
# При работающем npm run dev, в другом терминале:
npm run test:smoke
npm run test:recovery-ui
```

Тестовую БД создаём один раз. Integration suite очищает только отдельно заданную
базу с именем, оканчивающимся на `_test`. GitHub Actions выполняет сборку,
проверку TypeScript, ESLint, unit- и integration-тесты с реальными PostgreSQL и Chromium,
а также полный браузерный сценарий принятия baseline, error/retry UI и оба дизайн-прототипа.
Recovery integration-тест использует SIGKILL отдельного тестового worker.

## Пока не реализовано

Несколько проектов/страниц и batch-запуски, рекурсивный обход ссылок,
авторизация, изоляция для внешних сайтов и production-деплой. API и worker
запускаются только с `NODE_ENV=development` или `test`, API слушает loopback.
Не публикуйте этот прототип через туннель или внешний reverse proxy.
После hard crash выполняется завершение по deadline и явный новый запуск;
автоматическое продолжение прерванной попытки и retention пока не реализованы.

Публичное портфолио будет включать демо с подготовленным сайтом, видео сценария
обнаружения регрессии, тесты и объяснение технических компромиссов.

Выбор Capture size запускает Desktop 1440×900 или Mobile width 390×844.
Для каждого размера сохраняется отдельный baseline; Retry сохраняет размер.

Internal links показывает результаты ограниченной HEAD-проверки ссылок страницы;
редиректы и таймауты отмечены как непроверенные, внешние адреса исключены.

Опциональный GitHub-вход владельца: [настройка OAuth App](docs/github-login.md).
