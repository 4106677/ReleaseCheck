# Состояние проекта

## 28 сентября 2026 — контейнерный образ controlled runner

- Собран отдельный Node 24 + Chromium image с fixture внутри. Build context
  исключает `.env`, `.env.local`, git и локальные артефакты.
- Проверены network=none, read-only root, UID 1000, пустые capabilities,
  отсутствие host mounts/Docker socket/credentials, CPU/RAM/PID limits.
- Chromium sandbox включён; seccomp основан на профиле Playwright с разрешением
  chroot для sandbox внутри user namespace без capabilities внешнего контейнера.
- Настоящие desktop/mobile captures: baseline → matched repeat → changed regression,
  browser findings и broken link. Проверен cleanup контейнера после attach timeout.
- Добавлен отдельный Linux CI job. Это образ и test harness; очередь пока не
  переключена. Следующий этап — lifecycle по container ID и crash reconciliation.

Локальные проверки: build/TypeScript/lint, 38 unit; container smoke на Linux ARM64.
Ветка `codex/runner-container-image`, поверх PR #14.

## 28 сентября 2026 — подключена локальная OAuth-конфигурация

Пользователь сохранил OAuth credentials в игнорируемом `.env.local`. API теперь
читает этот файл после `.env`; worker и fixture его не загружают. В локальном
файле включён AUTH_MODE=session. Проверено без вывода секретов: anonymous → 401,
начало OAuth → 302 на GitHub, PKCE S256 и правильный callback. Пользователь прошёл
реальный GitHub-вход: браузер показывает Owner session и загруженную историю
проверок, в БД подтверждена активная сессия владельца. Реальные logout/re-login
и отказ другому аккаунту пока не проверены вручную; их покрывают тесты.

Ветка `codex/local-oauth-config`, поверх PR #13.

## 28 сентября 2026 — завершение runner и Chromium

- Исправлен риск orphan Chromium: supervisor отслеживает browser process group
  через приватный IPC от доверенного runner и завершает её при timeout, output
  overflow или аварийном выходе Node, до ожидания закрытия унаследованных pipes.
- Chromium запускается через launchServer/connect с включённым sandbox и endpoint
  только на 127.0.0.1. После штатного server.close runner снимает регистрацию PID.
- При потере IPC с worker runner закрывает зарегистрированный браузер; если связь
  потеряна во время запуска, callback прерывает capture с finally cleanup.
- Лимит stdout считается в bytes, stderr не попадает в исключения. Malformed JSON,
  неуспешный exit и timeout имеют стабильные коды. Среда runner без credentials.
- Этот supervisor поддерживает POSIX (macOS/Linux), Windows явно отклонён.
  Это управление процессами, не контейнерная изоляция. Внешние URL закрыты.

Проверки: 38 unit + 24 integration, build/TypeScript/lint. Настоящие detached
процессы проверяют timeout, byte overflow и exit с удерживаемыми pipes. Chromium
captures, queue retries, baseline и link checks проходят с новым способом запуска.
Browser smoke проверяет полный desktop/mobile цикл.

Ветка `codex/runner-process-lifecycle`, поверх `codex/github-login` (PR #12).
Следующий этап: контейнерная среда с отдельными ресурсными/сетевыми ограничениями,
затем конфигурация публикации. Требования и ограничения — runner-isolation.md.

## 27 сентября 2026 — GitHub OAuth и экран входа

- Реализован owner-only OAuth flow с state, PKCE S256 и browser binding.
  Одноразовый state хранится в PostgreSQL (миграция 007), срок — 10 минут.
- GitHub ID проверяется по GITHUB_OWNER_ID; существующий demo не переходит
  первому вошедшему. Это доступ к одному workspace, не multi-user SaaS.
- Token exchange и проверка /user происходят только на сервере; GitHub token
  не сохраняется. Session cookie HttpOnly/SameSite=Lax, logout отзывает сессию.
- Экран входа, недоступный API, ошибка callback, выход и ошибка выхода проверены
  браузером; compact-карточка в выбранном стиле утверждена пользователем.
- Main поддерживает AUTH_MODE=session с обязательной конфигурацией. По умолчанию
  local, production по-прежнему запрещён. Logger не пишет OAuth query parameters.

Проверки: 34 unit + 24 integration, сборка/типы/lint. Provider exchange проверен
с подменённым fetch; callback с тестовым identity resolver и настоящей БД.
Auth UI smoke добавлен в CI; full baseline/navigation и Recovery UI проверены.
Реальный GitHub-вход не проверен: OAuth App credentials пока не настроены.

Ветка `codex/github-login`, поверх `codex/session-access` (PR #11, CI прошёл).
Следующий шаг: пользователь настраивает OAuth App по github-login.md; независимо
можно продолжать подготовку изоляции runner и конфигурации среды для публикации.

## 27 сентября 2026 — серверные сессии и граница доступа

- Миграция 006 добавляет users, sessions и owner_id. Старый demo принадлежит
  локальному пользователю; у новых проектов владелец должен задаваться явно.
- Сессии: случайный 256-bit token, только SHA-256 hash в PostgreSQL, срок 7 дней,
  отзыв при logout. Неверные и истёкшие сессии отвергаются.
- Session-mode API требует cookie и владельца для project/run/baseline/artifact
  endpoints. Чужие ресурсы возвращают 404. Мутации требуют допустимый Origin.
- История ограничена demo project ID, принятие baseline записывает ID текущего
  пользователя. Auth/API ответы имеют private/no-store.
- Локальный entrypoint по-прежнему local-only с доверенной локальной identity.
  Session-mode пока включается через buildApp для интеграции: GitHub callback,
  выдача cookie браузеру и экран входа ещё не реализованы. Публичный запуск закрыт.

Проверки: build, TypeScript, lint; 32 unit + 23 integration. Проверены anonymous,
forged/expired token, чужие PNG/Run/project/baseline, запрещённые мутации без Origin,
успешное изменение владельцем и отзыв сессии. Полный browser smoke local-mode.

Ветка `codex/session-access`, поверх `codex/runner-retries` (PR #10, CI прошёл).
Следующий этап: GitHub OAuth поверх этой границы, с state/PKCE, выдачей сессии
и экраном входа. Для реального входа потребуется настройка OAuth application;
секреты не добавляются в репозиторий. Этап авторизации целиком ещё не закрыт.

## 27 сентября 2026 — обычные retry/backoff runner

- После временной infrastructure error Run возвращается в queued, с сохранением
  attempt. Deadline завершившейся попытки снимается; следующий claim получает новый.
- UI явно сообщает об ожидании автоматического повтора. Ошибки страницы остаются
  терминальными; максимум три infrastructure-попытки, затем доступен новый Run.
- awaitRetry ограждён attempt/status/deadline: старая или просроченная попытка не
  может вернуть завершённый Run в очередь. Публикация по-прежнему атомарна.
- startWorker принимает необязательный executor для fault injection в тестах;
  production/local startup продолжает использовать изолированный child runner.

Проверки: 32 unit + 22 integration, сборка/типы/lint; настоящая очередь Graphile
с обычными задержками (без reschedule для новых тестов). Проверены transient →
success с единственным capture, три сбоя → failed → новый успешный Run,
page error без повторов. Recovery UI проверяет сообщение ожидания retry.

Ветка `codex/runner-retries`, поверх `codex/internal-links` (PR #9, CI прошёл).
Пользователь попросил ускорить завершение: новые функции вне текущего MVP не
добавляем. Следующий приоритет — доступ пользователей и границы публичного демо,
затем hosting, упаковка и внешний сценарий. Текущая сборка остаётся local-only.
Остаток до выпуска описан в release-readiness.md; срок 24 октября — верхняя граница,
а не причина ждать, если обязательные проверки и подготовка завершатся раньше.

## 27 сентября 2026 — ограниченная проверка внутренних ссылок

- После screenshot runner собирает первые 200 anchor href, нормализует адреса
  и проверяет до 20 уникальных same-origin ссылок методом HEAD.
- До 1 секунды на запрос, до 8 секунд на весь проход; редиректы не выполняются,
  внешние адреса, credentials и неподдерживаемые схемы исключены. Cookie не передаются.
- Results отдельно от browser observations: available, broken и unverified.
  Таймауты, redirects и 405/501 не объявляются исправными. Превышение лимита видно.
- Миграция 005 добавляет nullable links JSON; старые отчёты явно говорят, что
  ссылки не проверялись. Captures и link evidence публикуются одной транзакцией.
- Broken link даёт attention даже при matched pixels. Непроверенные адреса или
  лимит дают inconclusive, если нет других обнаруженных проблем.
- В отчёте отдельная секция Internal links с URL и HTTP status; baseline approval
  не снимает проблемы ссылок. Демо regression обнаруживает /missing-shipping → 404.

Проверки: сборка, TypeScript, lint; 32 unit + 19 integration. Локальный HTTP server
проверяет deduplication, redirect/no-follow, предел запросов и timeout. Integration
проверяет сохранение и verdict для broken/unverified/truncated при matched visual.
Browser smoke проверяет Internal links в mobile capture и полный baseline-цикл.

Ветка `codex/internal-links`, поверх `codex/mobile-captures` (PR #8, CI прошёл).
Следующий этап: надёжность обычных retry/backoff runner и ясное разделение ошибок
исполнения от ошибок сайта. Внешние URL остаются закрыты; link check не crawler.

## 27 сентября 2026 — мобильный размер захвата

- Capture size выбирается перед запуском: Desktop 1440×900 или Mobile width 390×844.
  Это responsive viewport в Chromium, без эмуляции телефона/touch/UA.
- Размер фиксируется в Run snapshot и учитывается в idempotency. Retry сохраняет
  размер исходной проверки. Старые Run без viewport читаются как desktop.
- Baseline candidates ограничены размером capture; profile hash уже включает
  размеры. Первый mobile Run не использует desktop baseline. Версии независимы.
- Viewer показывает фактические размеры и пропорции изображения; mobile capture
  ограничен шириной 390 px, ползунок и difference доступны в обоих режимах.
- По-прежнему один viewport на Run: сроки runner и модель атомарного результата
  не расширялись до batch/partial results. Внешние URL закрыты.

Проверки: build, TypeScript, lint; 29 unit + 18 integration. Реальный Chromium
проверяет mobile first baseline, unchanged pass, regression diff, независимость
эталонов и snapshot queued Run. Browser smoke покрывает оба размера и mobile retry.

Ветка `codex/mobile-captures`, поверх `codex/project-settings` (PR #7, CI прошёл).
Следующий этап: ограниченная проверка внутренних ссылок контролируемой страницы,
с отдельным представлением результата и лимитами запросов. Решений пользователя нет.

## 26 сентября 2026 — настройки демо-проекта

- Добавлена страница `/projects/<demo-id>` в выбранном Release Console.
- Allowed visual difference: 0–5%, шаг 0.01%, исходное значение 0.1%.
- Миграция 004 хранит целые basis points и версию настроек. PATCH использует
  optimistic concurrency; точный повтор сохранения не увеличивает версию.
- Run получает копию порога при постановке в очередь. Изменение проекта не
  переписывает queued/completed отчёты или baseline; browser findings независимы.
- При конфликте форма сохраняет введённое значение; Reload settings явно
  загружает актуальные настройки. Есть прямой адрес и адаптивный экран.

Проверки: 28 unit + 17 integration; реальные captures подтверждают старый порог
у queued Run и новый у следующего. Browser smoke проверяет сохранение, reload,
конкурентный PATCH, сохранность черновика, явную перезагрузку и мобильную ширину.

Ветка `codex/project-settings`, поверх `codex/report-navigation` (PR #6).
Следующий этап: второй viewport и отдельные baseline для него. Пока остаётся
один контролируемый demo-проект; внешние URL и multi-project не открыты.

## 26 сентября 2026 — адреса отчётов и навигация

Завершено:

- Каждый Run открывается по `/runs/<uuid>`; новый запуск и Retry check обновляют URL.
- История использует настоящие ссылки с aria-current и открытием в новой вкладке.
- Reload, Back/Forward и возврат через Checks сохраняют ожидаемый выбор.
- Отчёт загружается по ID независимо от последних 20 запусков в истории.
- Неверные адреса показывают Page not found; неизвестный Run — понятную ошибку API.
- Заголовок браузерной вкладки содержит ID проверки. Для двух рабочих маршрутов
  используется History API без новой зависимости; требования к SPA fallback описаны.

Проверки: сборка, TypeScript, lint, 28 unit-тестов; полный browser smoke с реальным
baseline-циклом и новыми сценариями URL/reload/history/new tab. Отдельно проверены
неверный UUID, неизвестный Run и прямой адрес с пустым ответом списка history.
Recovery UI проверяет адрес нового Run после Retry check. Серверная логика не менялась.

Ветка `codex/report-navigation`, поверх `codex/grouped-findings`.
Предыдущая группировка опубликована в PR #5, commit `16f5b90`, CI прошёл.

Следующий этап: отдельная страница демо-проекта и настройки проверки, затем
расширение capture до второго viewport с отдельными эталонами. Произвольные
внешние URL по-прежнему закрыты до изоляции runner. Решений по дизайну сейчас нет.

## 26 сентября 2026 — связанные ошибки и исходные доказательства

После этапа recovery реализована группировка browser observations:

- Capture сохраняет request method/status/resourceType, console source и позиции,
  стек JS-ошибки. Старые JSON findings совместимы; миграция БД не нужна.
- `groupFindings` объединяет точные повторы и связывает HTTP/console по полному
  URL/status только при единственном подходящем HTTP-контексте.
- Query strings, неоднозначные методы, обрезанные URL и legacy observations
  не объединяются по предположению. Все исходные записи сохранены, verdict не меняется.
- Release Console показывает число проблем и число observations. Original evidence
  раскрывает каждый источник, запрос и стек; доступно клавиатурой и на мобильной ширине.
- На реальном regression fixture: 3 browser observations → 2 browser issues
  (JavaScript и HTTP 404 со связанным console). С visual change очередь содержит 3 пункта.

Проверки: сборка, TypeScript, lint; 28 unit + 15 integration-тестов.
Реальный Chromium подтверждает контекст и группировку. Browser smoke проверяет
счётчики, раскрытие evidence через Enter, два исходных сообщения, baseline-цикл
и mobile 390 px. Recovery UI также прошёл; desktop/mobile снимки просмотрены.

Ветка `codex/grouped-findings`, поверх `codex/run-recovery`; отдельный draft PR.
Предыдущий recovery опубликован в PR #4, commit `f03f551`, CI прошёл.

Следующий этап: навигация и адреса отчётов — сохранение выбранного Run при
обновлении страницы, переходы назад/вперёд и удобное открытие истории.
После этого — проекты и несколько viewport. Нового выбора дизайна сейчас не требуется.

## 26 сентября 2026 — восстановление прерванных проверок

Завершён следующий этап:

- Миграция 003 добавляет двухминутный deadline попытки. Старые active Run
  получают grace period; история и эталоны сохраняются.
- API выполняет recovery при старте и раз в 15 секунд, независимо от worker.
  Worker тоже сверяет очередь перед запуском. Просроченные, исчерпанные и
  потерявшие queue job проверки получают failed/inconclusive.
- Late completion не публикует артефакты после deadline; одновременные проходы
  безопасны. Живая последняя попытка, backoff и queued job без worker сохраняются.
- API recovery переживает ошибку БД, не запускает перекрывающиеся проходы и
  корректно останавливается до закрытия пула.
- В Release Console — понятная причина сбоя и Retry check, создающий новый
  Run исходного variant; повтор после сетевой ошибки сохраняет idempotency key.
- CI включает отдельную проверку error/retry UI. Дизайн B сохранён.

Проверки: сборка, TypeScript, ESLint; 23 unit и 15 integration-тестов.
Новый integration-тест реально завершает отдельный worker SIGKILL на последней
попытке, ждёт восстановления через API и выполняет новый захват Chromium.
Для ускорения ожидания меняется только deadline в тестовой доменной строке.
Browser smoke прошёл полный baseline-цикл; recovery UI проверен с HTTP stubs
на desktop/390 px, снимки просмотрены. Существующие прототипы не изменялись.

Ветка `codex/run-recovery`, поверх `codex/baseline-comparison`; отдельный draft PR.
Предыдущий этап опубликован в PR #3, commit `e7f2788`, CI прошёл.

Выбранная политика hard crash: failed + явный новый запуск. Queue locks
принудительно не снимаются; старые jobs и сиротские PNG потребуют retention.
При отключённых API/БД recovery ждёт возвращения сервиса.
Подробности и ограничения — local-development.md и decisions.md.

Следующий этап: группировка browser observations с сохранением исходных
доказательств (например, HTTP 404 и связанное console-сообщение), контекст ошибки
и улучшение навигации по отчёту. Затем — проекты/viewport и частичные результаты.

Решений от пользователя для текущего этапа не требуется.

## 25 сентября 2026 — рабочие эталоны и Release Console

Выполнено после утверждения направления B:

- Добавлена миграция 002 без сброса существующих запусков. Новые capture сохраняют
  профиль; старые остаются доступны, но не принимаются в baseline без нового захвата.
- Подтверждение baseline хранит источник, автора `local-dev-user`, время и версию.
  Конкурирующие решения защищены expectedVersion; повтор успешного запроса безопасен.
- Run запоминает эталоны и пороги при создании, под блокировкой проекта. Новый
  baseline не переписывает queued/завершённые отчёты.
- Worker сравнивает совместимые PNG, атомарно сохраняет capture, diff и результат.
  Без эталона/совместимого профиля нет `pass`; принятие внешнего вида не скрывает ошибки.
- Утверждённый Release Console подключён к API: запуск, история, реальные PNG,
  ползунок, Difference, observations, диалог принятия и состояния ошибок.
  Просмотрщик общий с прототипами. Элементы запуска доступны и на мобильной ширине.
- CI расширен полным браузерным циклом с API, worker, fixture и PostgreSQL.

Проверки: сборка, TypeScript, lint, 21 unit + 11 integration-тестов.
Integration проверяет версии, повторы, конкурирующие решения, неизменяемый snapshot,
несовместимые профили и реальные diff-артефакты. Browser smoke проверяет
исходный baseline → совпадение → regression → принятие → совпадение с сохранёнными
JS/network errors, Escape и работу на ширине 390 px. Оба прототипа проверяются отдельно.

Ветка: `codex/baseline-comparison`, поверх `codex/report-directions`.
Подготовка отдельного PR с этой базой; автоматическое слияние запрещено.

Следующий законченный этап:

1. Восстановление Run после жёсткого падения worker на последней попытке:
   reconciler, явный failed и проверка повторного запуска.
2. Группировка наблюдений и контекст ошибок без сокрытия исходных доказательств.
3. Отдельные страницы проектов/истории и расширение модели до нескольких viewport.

Для просмотра: `http://127.0.0.1:5173`. Открыть запуск из истории либо сделать новый.
Сначала проверить исходный storefront и явно принять эталон; затем — изменённый.
Smoke-тест сам сохраняет и принимает демо-эталоны, поэтому версия может быть выше v1.

Ограничения: локальный demo-проект и один viewport, авторизация и production-изоляция
ещё не реализованы; cleanup файлов и восстановление после последнего hard crash впереди.

## 25 сентября 2026 — дизайн отчёта и модуль сравнения

Выполнено:

- Исправлен вчерашний Linux CI: Ubuntu AppArmor теперь разрешает namespace
  только Chromium из cache конкретного GitHub job. Sandbox браузера включён.
  Обновлены checkout/setup-node на Node 24 actions. Первый PR успешно проверен
  на GitHub: run `36106605884`, commit `b97c4f4`.
- Созданы интерактивные прототипы A (Review Studio) и B (Release Console).
  Адреса и различия — в docs/design-review.md. Пользователь утвердил B —
  Release Console; он открывается по умолчанию на `/design`.
- Реальные PNG before/after/diff включены в репозиторий. Ползунок работает
  мышью и клавиатурой; есть режимы сравнения, выбор issue и modal summary.
- Добавлен модуль `compareCaptures`: подсчёт отличий, PNG diff, явные пороги,
  проверка совместимости профиля и размеров. Профиль содержит OS release,
  browser version, platform/architecture, viewport и настройки рендера.
- Добавлен скрипт воспроизводимого обновления assets и браузерный тест дизайна.

Проверки: сборка, TypeScript и lint; 21 unit-тест; 8 integration-тестов, включая
три независимых браузерных захвата. Неизменённый fixture даёт 0 отличий,
изменённый — diff выше порога. Оба макета проверены на desktop и mobile;
выбор issue, режим Difference, ползунок мышью и Escape в modal работают.

Подготовленные демо-изображения: 14 323 изменённых пикселя (1,11%). Это результат
сравнения, но ещё не интеграция baseline в рабочие Run. Утверждение эталона
и его хранение в БД остаются следующим этапом.

Ветка сегодняшнего этапа — `codex/report-directions`, поверх `codex/first-capture`.
Изменения отправлены: PR https://github.com/4106677/personal-roadmap/pull/2
с базой `codex/first-capture`. CI commit `8eff683` прошёл: run `36107163084`.
Не сливать автоматически.
Предыдущий PR: https://github.com/4106677/personal-roadmap/pull/1.

Следующая работа:

1. Сохранение capture profile и подтверждённых baseline в БД.
2. API принятия baseline с expected version и защитой от конкурирующих решений.
3. Неизменяемая привязка Run к baseline, сравнение из worker и артефакт diff.
4. Перенос утверждённого Release Console в живой отчёт.

## 24 сентября 2026 — первый работающий сценарий

Архитектура утверждена пользователем. Предпочтение: работать последовательно,
уделяя время качеству; ежедневное участие пользователя — около 20 минут.

Выполнено:

- npm workspaces: web, API, worker, contracts, db, storage, checks и demo-site.
- TypeScript, ESLint, Prettier, lockfile и GitHub Actions для Node.js 24.
- PostgreSQL 17 в Docker; проверяемые SQL-миграции; очередь Graphile Worker.
- Атомарное создание Run/job, конкурентная идемпотентность и лимит активного Run.
- Отдельный runner-процесс с Chromium, PNG и JS/HTTP/transport observations.
- Защита финализации от устаревшей попытки; ограничение времени и объёма вывода runner.
- React-интерфейс запуска, истории, состояний, просмотра скриншота и findings.
- Инструкции запуска в README и docs/local-development.md.

Проверено локально: сборка всех workspaces, TypeScript приложения и тестов, lint,
11 unit-тестов и 7 integration-тестов на реальных PostgreSQL и Chromium.
Browser smoke проходит исходный и изменённый fixture через UI, проверяет PNG,
findings, отсутствие JS-ошибок приложения и переполнения на 390 px.
Скриншоты desktop/mobile просмотрены. Окончательный статус GitHub CI — в PR.

Текущее окружение этой машины:

- Node.js 24.21.0 подготовлен отдельно: `/private/tmp/releasecheck-toolchain/node_modules/.bin`.
  При необходимости добавить этот каталог в PATH; системный Node не менялся.
  Каталог временный: если удалён, установить Node 24 через nvm или отдельный toolchain.
- Локальный `.env` создан из примера; Chromium установлен в `.local/browsers`.
- Docker Compose: PostgreSQL на 127.0.0.1:55432; app DB `releasecheck`, test DB `releasecheck_test`.
- Ветка реализации: `codex/first-capture`, база: `codex/releasecheck-foundation`.
  Первая отправленная ветка автоматически стала default в исходно пустом GitHub-репозитории.
  Никакого слияния или переименования default branch не выполнялось.

Границы этапа: только локальный fixture, один desktop viewport, без OAuth,
baseline/diff и production-деплоя. Полный список ограничений — в local-development.md.
Vite предупреждает об основном JS chunk >500 kB (около 169 kB gzip); измерить
и разделить загрузку при разработке итоговых экранов, не скрывать предупреждение.

Следующий шаг:

1. Подготовить два варианта дизайна экрана отчёта, дать пользователю выбрать.
2. Добавить подтверждение baseline и visual diff на том же fixture.
3. Закрыть восстановление Run после жёсткого падения worker, затем расширять страницы/viewport.

## 24 сентября 2026 — архитектура

Выполнено:

- Выбран ReleaseCheck и React + Vite; текущий GitHub-репозиторий сохранён.
- Определены MVP, критерии готовности и план до 24 октября.
- Описаны процессы web/API/worker/runner, модель данных и HTTP API.
- Определены правила очереди, повторов, baseline и частичных результатов.
- Создана ежедневная автоматизация на 10:00 по Киеву.

На момент этого первого этапа приложений, миграций и тестов ещё не было.
Актуальное состояние — в записи выше. Дизайн пока не выбран.

Окружение:

- Default Node.js: 20.15.1; Homebrew Node: 23.10.0.
- Целевой runtime проекта: Node.js 24 LTS, установка ещё не выполнена.
- Репозиторий изначально не содержит файлов и коммитов.
- Первый коммит архитектуры `1a3facc` отправлен на GitHub.

Первоначальные следующие шаги (выполнение см. выше):

1. Подготовить Node.js 24 для проекта, npm workspaces и CI.
2. Сделать сквозной технический эксперимент с одной страницей fixture.
3. Подготовить два интерактивных варианта экрана отчёта для согласования.

Сейчас от пользователя не требуется техническое решение. Визуальное направление
обсуждаем по готовым прототипам, а не по абстрактным описаниям.
