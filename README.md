# IoT SIGNALING SERVER

Лёгкий REST API / реестр устройств для IoT Modular System.
Соединяет приложение и ESP32-устройства: регистрация, heartbeat, список устройств,
алерты и правила умного дома. **Телеметрию не хранит** — только реестр и правила.

Ноль внешних зависимостей (только встроенные модули Node.js ≥ 18).

## Состав

| Файл | Назначение |
|---|---|
| `src/index.js` | Точка входа: HTTP-сервер + graceful shutdown |
| `src/app.js` | Маршруты, rate-limit, CORS, auth-проверка токена |
| `src/registry.js` | Реестр устройств (статусы, stale-таймаут, лимиты по IP) |
| `src/rules.js` | Правила умного дома (CRUD + персист) |
| `src/alerts.js` | CRUD алертов |
| `src/persist.js` | Атомарная запись JSON в файл |
| `src/config.js` | Вся конфигурация через env |

## Запуск

```bash
node src/index.js
```

Здоровье: `GET /api/v1/health`. Тесты: `npm test` (= `node --test test/*.test.js`), 44 теста.

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
| `STALE_MS` | `180000` | Без heartbeat за это время устройство считается offline |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Окно rate-limit |
| `RATE_LIMIT_*` | — | Лимиты register/heartbeat/write/read |

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