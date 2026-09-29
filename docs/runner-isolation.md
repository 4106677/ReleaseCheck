# Runner: текущая граница и требования среды

29 сентября 2026. Worker поддерживает `process` для локальной разработки и `docker`
для controlled fixture. Оба сохраняют ограждение публикации по attempt/deadline,
retry и recovery. Production запуск по-прежнему запрещён.

## Docker backend

Настройка и ограничения: [docker/README.md](../docker/README.md).

- Одноразовый контейнер с fixture внутри, network=none, без host mounts и секретов.
- UID/GID 1000, read-only root, пустые capabilities, no-new-privileges, seccomp,
  включённая песочница Chromium. CPU/RAM/PID и временные файловые системы ограничены.
- Образ разрешается в immutable local image ID на старте worker.
- Create → attach по container ID → remove при успехе, ошибке или таймауте 60 секунд.
  Ограничены stdin/stdout, время и объём ответа Docker CLI; наружу идут стабильные коды.
- Срок жизни 90 секунд и постоянный UUID установки записаны в labels. На старте и
  каждые 15 секунд worker удаляет только просроченные контейнеры своей установки.
- После SIGKILL cleanup выполняет другой/перезапущенный worker или независимый janitor.
  Janitor запускается отдельно, не требует БД/образа и использует тот же owner UUID.
  Для deployment нужны независимый supervisor и мониторинг: недоступность Docker/host
  всё ещё откладывает очистку до восстановления.
- Проверки включают настоящий pipeline с PostgreSQL и артефактами, attach timeout,
  SIGKILL worker, restart cleanup, сохранение live/foreign containers и новый Run.

Привилегированный Docker socket нельзя монтировать внутрь runner. Доступ worker к
Docker сам по себе привилегирован и должен быть ограничен средой deployment.
Для внешних URL потребуется отдельная egress/SSRF policy: network=none подходит
лишь controlled fixture. Профиль Linux несовместим с прежними baseline macOS.

## Process backend

Отдельный Node process получает runtime-only env без DB/OAuth credentials.
BrowserServer слушает 127.0.0.1; supervisor завершает зарегистрированную POSIX
process group Chromium при timeout/overflow/exit. IPC доверяет нашему runner.
Это не filesystem/network isolation и не лимиты CPU/RAM/PID на уровне ядра.
Windows не поддерживается этим supervisor; local development — macOS/Linux.
