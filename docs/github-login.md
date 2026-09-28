# GitHub-вход: настройка и границы

Реализован owner-only вход для текущего локального demo workspace. Это не
регистрация независимых пользователей/проектов и не разрешение публичного hosting.
Существующий demo сохраняет владельца: успешный GitHub ID должен совпадать с
явно настроенным GITHUB_OWNER_ID, после чего выдаётся сессия локального владельца.
Другой аккаунт не получает проект, даже если первым прошёл OAuth.

## Настройка реального входа

1. В GitHub Settings → Developer settings → OAuth Apps зарегистрировать приложение.
   Homepage URL: `http://127.0.0.1:5173`.
   Authorization callback URL: `http://127.0.0.1:5173/api/auth/github/callback`.
2. В игнорируемом `.env.local` указать `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
   `GITHUB_OWNER_ID` (числовой ID, не login), `APP_ORIGIN=http://127.0.0.1:5173`.
   ID своего авторизованного аккаунта можно получить через `gh api user --jq .id`.
   Secret не отправлять в чат и не коммитить.
3. Применить миграцию 007: `npm run db:migrate`. Установить `AUTH_MODE=session`
   и перезапустить `npm run dev`. Открывать именно APP_ORIGIN, не другой hostname.
4. Проверить Continue with GitHub → возвращение в Release Console → Sign out →
   повторный вход. Проверить отказ для другого GitHub-аккаунта.

Без OAuth credentials оставить `AUTH_MODE=local`: существующее демо работает.
API читает `.env`, затем `.env.local` с приоритетом локальных значений. Worker
и fixture не загружают `.env.local`, чтобы не получать OAuth credentials.
Session-mode отказывается стартовать при неполной конфигурации. Реальные credentials
не были предоставлены; end-to-end вход через живой GitHub пока не подтверждён.

## Реализация

Authorization code + PKCE S256 и случайный state по
[документации GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
Browser binding хранится в HttpOnly/SameSite=Lax cookie; state/browser hash и verifier
живут в PostgreSQL максимум 10 минут. Callback атомарно удаляет state, поэтому
повторное использование не проходит, в том числе после перезапуска API.
Token exchange и `/user` выполняются сервером по фиксированным HTTPS endpoint,
без редиректов, с 10-секундным timeout каждого запроса. GitHub access token не
сохраняется и не передаётся браузеру; repo/email scopes не запрашиваются.
Успешный вход отзывает прежнюю browser session и выдаёт новый случайный token.
Cookie действует 7 дней; Logout отзывает запись в БД. Query OAuth callback
исключён из штатного request logger, provider errors не логируются с token/code.

Текущие cookie работают только в локальном HTTP режиме. Для публичной среды нужны
HTTPS/Secure cookie, production origin/host policy, ограничения частоты запросов,
изоляция runner и прочие пункты release-readiness. NODE_ENV production остаётся
запрещённым. OAuth credentials не попадают в окружение дочернего runner.

## Проверки

Unit проверяет серверный token exchange и фиксированные endpoint. Integration
проверяет PKCE challenge, browser binding, одноразовый и истёкший state, отказ
чужому owner ID и выдачу сессии, используя внедрённый provider identity resolver.
`npm run test:auth-ui` проверяет экран входа, клавиатуру, mobile, ошибки API/callback
и logout. Снимки: `.local/auth/login-{desktop,mobile}.png`.
Это не заменяет ручной прогон с реальным GitHub OAuth App.
