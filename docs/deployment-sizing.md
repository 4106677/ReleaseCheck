# Ресурсы и размещение первого demo

Обновлено 30 сентября 2026. Предложение для owner-only ReleaseCheck с controlled
fixture и одной одновременно выполняемой проверкой. Сервер ещё не заказан.

## Измерения

Сырые данные: [12 запусков Linux ARM64](benchmarks/2026-09-29-linux-arm64.json).
Три повтора baseline/regression на desktop 1440×900 и mobile 390×844. Каждый
запуск создаёт отдельный контейнер с теми же ограничениями, что и worker.
Метрики cgroup v2 читаются после закрытия Chromium; image/filesystem caches тёплые.

| Показатель                     | Максимум среди 12 запусков |
| ------------------------------ | -------------------------: |
| Память контейнера, memory.peak |                  188.4 MiB |
| Capture внутри контейнера      |                     451 ms |
| Создание → capture → удаление  |                     1.36 s |
| CPU time контейнера            |                     716 ms |
| Screenshot PNG                 |               52,902 bytes |
| OOM kills                      |                          0 |

Измерен runner вместе с fixture, но не API, PostgreSQL, очередь, pixel diff,
Docker daemon и ОС. Это локальный Docker Desktop, не замер производительности VPS.
Размер локального runner image — около 1.25 GiB, без build cache и старых образов.
Лимит runner остаётся 768 MiB / 1 CPU / 128 PID; уменьшать его по одному fixture рано.

Повторить на целевом Linux-хосте (нужны cgroup v2 и memory.peak):

```sh
npm run runner:build
npm run runner:benchmark -- .local/runner-benchmark.json
```

Benchmark пишет только метрики и проверяет успешный capture, findings, отсутствие
OOM; screenshots и секреты в отчёт не попадают. Он завершается с ошибкой, если
ядро не предоставляет необходимые метрики. Обычный entrypoint runner не изменён.

## Начальная конфигурация и стоимость

Предлагается 2 vCPU / 4 GiB RAM, concurrency=1. Это инженерная оценка с запасом
для остальных процессов, а не подтверждённая вместимость полного стека.
Перед открытием demo нужны замеры всего стека и свободного диска на выбранном VPS.

| Вариант                                    | Сервер / месяц |    IPv4 |  Provider backup | Итого до налогов |
| ------------------------------------------ | -------------: | ------: | ---------------: | ---------------: |
| Hetzner CAX11, ARM, 4 GB / 40 GB           |          €5.99 |   €0.50 |      20%, ≈€1.20 |           ≈€7.69 |
| Hetzner CX23, x86, 4 GB / 40 GB            |          €5.49 |   €0.50 |      20%, ≈€1.10 |           ≈€7.09 |
| DigitalOcean Basic Regular, 4 GiB / 80 GiB |            $24 | включён | daily 30%, $7.20 |           $31.20 |

Тарифы проверены 30 сентября 2026: [Hetzner price list](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/),
[характеристики и доступность](https://www.hetzner.com/cloud/cost-optimized/),
[IPv4](https://docs.hetzner.com/cloud/servers/primary-ips/overview/),
[backup billing](https://docs.hetzner.com/cloud/billing/faq/),
[DigitalOcean pricing](https://www.digitalocean.com/pricing/droplets).
У Hetzner публичная страница помечает предложения недоступными: наличие нужно
проверить в консоли перед заказом. Резервный вариант дороже и требует отдельного выбора.
Налоги зависят от billing account. Домен и отдельное хранилище backup не включены.
Provider disk backup не заменяет проверенный согласованный backup БД и PNG.

## До размещения

1. Согласовать бюджет, провайдера и существующий домен/сервер. Ничего не покупать
   без решения владельца. Предпочтение — CAX11 при доступности и приемлемой итоговой цене.
2. Подготовить HTTPS origin, Secure cookies, reverse proxy и отдельные runtime
   secrets. Нынешний production guard остаётся до проверки этой конфигурации.
3. Настроить supervisor API/worker/независимого janitor, restart policy,
   ограничение диска/логов, health monitoring и оповещение при отказе janitor.
4. Сделать backup БД + immutable PNG с проверкой восстановления в отдельное место;
   определить retention без удаления файлов, на которые ещё ссылается БД.
5. На выбранном хосте проверить reboot/recovery, полный flow, память всего стека,
   backup/restore и OAuth callback. Baseline требует явного одобрения владельца
   после смены capture profile. Только после этого открывать demo.
