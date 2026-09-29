# IoT SIGNALING SERVER

Лёгкий REST API / реестр устройств для IoT Modular System.
Соединяет приложение и ESP32-устройства: регистрация, heartbeat, список устройств,
алерты и правила умного дома. **Телеметрию не хранит** — только реестр и правила.

Ноль внешних зависимостей (только встроенные модули Node.js ≥ 18).
С версии 0.4 поставляется **веб-панель** (`/panel`, Vue 3, стиль 3X-UI):
дашборд с графиками производительности, карточки устройств с аптаймом,
CRUD устройств/алертов/правил и настройки сервера в рантайме.

## Состав

| Файл | Назначение |
|---|---|
| `src/index.js` | Точка входа: HTTP-сервер + graceful shutdown |
| `src/app.js` | Маршруты, rate-limit, CORS, auth, panel API + статика `/panel` |
| `src/registry.js` | Реестр устройств (статусы, stale-таймаут, лимиты по IP) |
| `src/rules.js` | Правила умного дома (CRUD + персист) |
| `src/alerts.js` | CRUD алертов |
| `src/metrics.js` | Метрики сервера (CPU/MEM/load/сеть/req/latency, персист) |
| `src/stability.js` | Журнал статусов устройств + аптайм 24ч/7д |
| `src/settings.js` | Переопределение настроек в рантайме (валидация, персист) |
| `src/session.js` | HMAC-сессии панели (HttpOnly cookie) |
| `src/persist.js` | Атомарная запись JSON в файл |
| `src/config.js` | Вся конфигурация через env |
| `web/` | Фронтенд панели (Vue 3 + Vite + Element Plus + uPlot); `web/dist` собирается в образ |

## Запуск

```bash
node src/index.js
```

Здоровье: `GET /api/v1/health`. Тесты: `npm test` (= `node --test test/*.test.js`), 88 тестов.
Сборка фронтенда: `npm --prefix web install && npm --prefix web run build` (dist уже в образ/репо).

## Конфигурация (env)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `3000` | Порт HTTP |
| `HOST` | `127.0.0.1` | Адрес (наружу — через прокси, `0.0.0.0` — публично) |
| `API_PREFIX` | `/api/v1` | Префикс API |
| `REGISTER_TOKEN` | (пусто) | Токен записи; при задании `register/delete/alerts` и `GET /devices` требуют `Authorization: Bearer <token>` |
| `REGISTRY_FILE` | `data/devices.json` | Файл реестра устройств |
| `ALERTS_FILE` | `data/alerts.json` | Файл алертов |
| `RULES_FILE` | `data/rules.json` | Файл правил |
| `METRICS_FILE` | `data/metrics.json` | История метрик сервера |
| `STABILITY_FILE` | `data/stability.json` | Журнал статусов устройств |
| `SETTINGS_FILE` | `data/settings.json` | Настройки панели (переопределяют env) |
| `METRICS_INTERVAL_MS` | `10000` | Период сэмпла метрик |
| `METRICS_FLUSH_SECONDS` | `120` | Период персиста метрик |
| `METRICS_HOURS` | `24` | Глубина истории метрик (агрегация по мере роста) |
| `PANEL_PASSWORD` | (пусто) | Пароль веб-панели; **пусто = панель отключена (503)** |
| `PANEL_SESSION_TTL_MS` | `86400000` | TTL сессии панели |
| `STALE_MS` | `180000` | Без heartbeat за это время устройство считается offline |
| `MAX_DEVICES_PER_IP` | `3` | Максимум устройств с одного IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Окно rate-limit |
| `RATE_LIMIT_*` | — | Лимиты register/heartbeat/write/read |

## Веб-панель

Открывается на `GET {API host}/panel` (краткая форма — `/panel`). Требует
`PANEL_PASSWORD` (в противном случае отдаёт 503). Вход — единый пароль, сессия —
HMAC-cookie `iot_panel` (HttpOnly, SameSite=Lax, Secure при HTTPS).

- `POST /panel/api/auth/login` `{ password }` · `POST /panel/api/auth/logout`
- `GET  /panel/api/session` — статус сессии, версия, путь панели
- `GET  /panel/api/system` — сводка (devices/alerts/rules/cpu/mem/uptime)
- `GET  /panel/api/system/history?points=120` — метрики для графиков
- `GET/POST/PUT/DELETE /panel/api/devices[/:id]` — CRUD устройств (detail отдаёт
  stability + связанные алерты/правила)
- `GET  /panel/api/settings`, `PUT /panel/api/settings` — настройки рантайма
  (`stale_ms`, `metrics_hours`, `max_devices_per_ip`, `session_ttl_ms`,
  `rate_limits`, `api_token`, `panel_password`)
- `POST /panel/api/restart` — flush и перезапуск процесса

Все panel-эндпоинты требуют живую сессию (или Bearer-токен при его задании).
API-контракт для приложения (`/api/v1/*`) не меняется.

## API

- `GET  /api/v1/health`
- `GET  /api/v1/devices` (+ фильтры `status`/`online`, поиск `q`)
- `POST /api/v1/devices/register` — регистрация устройства (rate-limit)
- `POST /api/v1/devices/heartbeat` — обновление статуса (rate-limit)
- `DELETE /api/v1/devices/:id`
- `GET/POST /api/v1/alerts`, `PUT/DELETE /api/v1/alerts/:id`
- `GET/POST /api/v1/rules`, `PUT/DELETE /api/v1/rules/:id`

Формат правил (`models/smart_rule.dart` в приложении): `trigger = threshold_above |
threshold_below | online | offline | no_data`, `action = notify | mqtt_command |
device_command`.

## Docker

```bash
# конфигурация
REGISTER_TOKEN=... docker compose up -d --build
# или напрямую
docker build -t iot-signaling-server .
docker run -d -p 3100:3100 \
  -e REGISTER_TOKEN=... -v "$PWD/data:/app/data" iot-signaling-server
```

Полный self-hosted стек (node + mosquitto + nginx + certbot) описан в
монориложении в `deploy/docker/README.md` — там этот сервер используется как
контейнер `server` внутри сети `iot`.

## Лицензия

MIT