# Runner: текущая граница и требования среды

28 сентября 2026. Process supervisor завершает Chromium при сбое доверенного
runner. Это уменьшает риск оставшихся процессов и зависших pipes; не защищает
host от произвольного кода. Runner пока имеет доступ к файловой системе текущего
пользователя, а allowlist сетевых запросов браузера не заменяет сетевой namespace.

Реализовано:

- Отдельный Node process, runtime-only env без DB/OAuth credentials.
- Sandbox Chromium включён. BrowserServer websocket привязан к 127.0.0.1.
- Browser PID регистрируется через IPC; cleanup использует POSIX process group,
  которую Playwright создаёт для браузера. Штатное закрытие снимает регистрацию.
- Таймаут 60 секунд, stdout 6 MiB в bytes, стабильные ошибки без сырого stderr.
- Ограждение публикации по attempt/deadline в БД, retry и recovery.

Ограничения:

- IPC доверяет нашему runner. Оно не должно принимать PID от внешнего сервиса
  или произвольного исполняемого файла.
- Потеря IPC обрабатывается runner; это не kernel guarantee. Полная авария host
  или зависание до регистрации browser PID требуют container/cgroup teardown.
- Нет лимитов CPU/RAM/PID на уровне ядра, отдельного filesystem/network namespace.
- Windows не поддерживается этим supervisor. CI и планируемый host — Linux.

Следующая законченная граница для controlled demo:

1. Одноразовый runner container, fixture внутри той же изолированной среды;
   network=none, без доступа к DB/API/storage, Docker socket и host mounts.
2. Непривилегированный UID, read-only root, ограниченный tmpfs для профиля браузера,
   лимиты памяти/CPU/PID. Не отключать Chromium sandbox ради запуска.
3. Parent управляет жизненным циклом по container ID, включая timeout и исчезновение
   worker; сборщик оставшихся контейнеров должен иметь bounded ownership label.
4. Проверить невозможность доступа к host/network и секретам, завершение всех
   процессов, потребление ресурсов и полноценный baseline-цикл на Linux.
5. Только после этого готовить production origins/HTTPS и публикацию. Для внешних
   URL потребуется отдельная egress/SSRF policy; network=none подходит лишь fixture.

Привилегированный Docker socket нельзя монтировать внутрь runner. Доступ оркестратора
к нему сам по себе привилегирован и должен быть ограничен средой deployment.
Выбор hosting и расходов ещё не сделан; текущий запуск остаётся local-only.
