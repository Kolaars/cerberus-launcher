# Cerberus Launcher

Каркас Minecraft-лаунчера на Electron + React + TypeScript. Первая итерация: рабочий
vanilla-пайплайн (установка и запуск), аккаунты Microsoft/офлайн, настройки и кастомное
безрамочное окно. Модовые загрузчики, модпаки и загрузка скинов оставлены как продуманные
контракты с `TODO`.

> Статус: **0.1.0, каркас**. Интерфейс — рабочая заготовка под макет гейм-дизайнера.

## Скачать

Готовый установщик для Windows x64 — в разделе
**[Releases](https://github.com/Kolaars/cerberus-launcher/releases/latest)**:
`Cerberus Launcher-0.1.0-setup.exe`.

Сборка не подписана кодом, поэтому SmartScreen может показать предупреждение:
«Подробнее» → «Выполнить в любом случае».

Новые релизы собираются автоматически: достаточно запушить тег `v*`
(workflow [`.github/workflows/release.yml`](.github/workflows/release.yml)).

## Что уже работает

- **Окно и оболочка:** безрамочное окно, своя шапка с перетаскиванием, сворачиванием,
  разворачиванием и закрытием; тёмная тема, адаптация под минимальный размер окна.
- **Vanilla Minecraft:** список версий из официального манифеста Mojang, установка клиента,
  библиотек, ресурсов и нативных библиотек, проверка SHA-1, прогресс и отмена установки.
- **Запуск игры:** автоматический поиск Java, проверка требуемой версии, сборка classpath и
  аргументов JVM/игры, потоковый вывод логов в консоль лаунчера, остановка игры.
- **Аккаунты:** несколько профилей, переключение, офлайн-профили с корректным offline UUID.
- **Microsoft OAuth:** device code flow, Xbox Live, Minecraft Services, обновление сессии.
  Токены хранятся только в main-процессе и шифруются через Electron `safeStorage`.
- **Настройки:** игровая папка, Java, память, JVM-аргументы, снапшоты, Microsoft Client ID.

## Чего ещё нет

Это осознанно оставлено на следующие итерации:

- Fabric, Quilt, Forge и NeoForge — есть интерфейс `ModLoaderAdapter` и заглушки адаптеров.
- Импорт и запуск модпаков — есть контракт `ModpackService`, страница показывает roadmap.
- Загрузка собственных скинов — отображается только скин лицензионного профиля Mojang.
- Автоматическая установка Java.
- Поддержка `inheritsFrom` в описании версии (понадобится для модовых загрузчиков).
- Очень старые версии с `map_to_resources` (до 1.6) — установщик явно сообщает об ошибке.
- Полноценные сборки под macOS/Linux: конфигурация ориентирована на Windows.
- Realms, сервер-лист, автообновление лаунчера.

## Требования

- **Node.js 24+** и **npm 11+**.
- **Java 25+** для актуальных версий Minecraft (манифест `26.3` требует Java 25).
  Более новая Java, например 26, допускается с предупреждением в логе.
- Windows 10/11 для упаковки в текущей конфигурации electron-builder.

## Быстрый старт

```bash
npm install
npm run dev
```

При первом запуске:

1. Откройте **Настройки → Microsoft** и укажите Application (client) ID приложения
   Microsoft Entra. Как его создать — в [docs/MICROSOFT_AUTH.md](docs/MICROSOFT_AUTH.md).
   Client ID можно также задать переменной окружения `CERBERUS_MS_CLIENT_ID`.
2. Проверьте **Настройки → Java**: лаунчер сам находит установленные JDK, но путь можно
   указать вручную.
3. На странице **Аккаунты** войдите через Microsoft или создайте офлайн-профиль.
4. На странице **Играть** выберите версию и нажмите «Установить и играть».

Если Client ID не задан, вход Microsoft недоступен, но офлайн-режим и vanilla-игра работают.

## Скрипты

| Команда | Что делает |
| --- | --- |
| `npm run dev` | Запуск Electron с HMR renderer. F12 открывает DevTools. |
| `npm run typecheck` | Проверка типов main/preload и renderer. |
| `npm run build` | Typecheck + production-сборка в `out/`. |
| `npm run start` | Preview production-сборки через electron-vite. |
| `npm run build:unpack` | Сборка и распаковка приложения в `dist/win-unpacked/`. |
| `npm run build:win` | NSIS-инсталлятор для Windows. |
| `npm run dist` | Алиас `build:win`. |

## Структура проекта

```text
src/
  main/                 Electron main process
    services/
      minecraft/        манифест, установка, библиотеки, запуск
      account-store.ts  аккаунты, сессии, safeStorage
      microsoft-auth.ts device code, Xbox Live, Minecraft Services
      java.ts           поиск и проверка Java
      modloader.ts      контракт Fabric/Quilt/Forge/NeoForge
      modpack.ts        контракт модпаков
    ipc.ts              типизированные IPC-обработчики
    window.ts           окно, CSP, внешние ссылки
  preload/              мост window.cerberus
  renderer/             React-приложение
    src/
      components/       переиспользуемые элементы
      context/          состояние лаунчера и тосты
      pages/            экраны
      styles/           токены, база, компоненты, страницы
  shared/               типы и IPC-контракт для всех слоёв
resources/              иконка приложения
docs/                   архитектура, OAuth, handoff дизайнеру
```

Подробности: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Где хранятся данные

| Что | Где |
| --- | --- |
| Настройки | `%APPDATA%\Cerberus Launcher\settings.json` |
| Аккаунты и зашифрованные токены | `%APPDATA%\Cerberus Launcher\accounts.json` |
| Логи лаунчера | `%APPDATA%\Cerberus Launcher\logs\launcher.log` |
| Игра по умолчанию | `%USERPROFILE%\.cerberus` |
| Версии | `<gameDirectory>\versions\<id>` |
| Библиотеки и ресурсы | `<gameDirectory>\libraries`, `<gameDirectory>\assets` |
| Маркер установки | `<gameDirectory>\versions\<id>\.cerberus.json` |

Игровую папку, папку данных и логи можно открыть из **Настроек → О приложении**.

## Безопасность

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Renderer не имеет доступа к Node.js и к токенам: только типизированный IPC-мост.
- `safeStorage` шифрует токены средствами ОС. Если шифрование недоступно, токены не
  сохраняются на диск, и после перезапуска потребуется повторный вход.
- Внешние ссылки разрешены только по HTTPS и открываются в системном браузере.
- Навигация внутри окна и `window.open` заблокированы.
- Пароль Microsoft никогда не попадает в лаунчер: используется device code flow.

## Решение проблем

### Electron не скачался при `npm install`

В некоторых сетях установщик Electron не может скачать бинарник с GitHub. Проверьте:

```powershell
npx electron --version
```

Если команда падает с `Electron failed to install correctly`, удалите
`node_modules/electron` и повторите:

```powershell
npx install-electron
```

Либо скачайте `electron-v<version>-win32-x64.zip` со страницы
[Electron Releases](https://github.com/electron/electron/releases), распакуйте содержимое в
`node_modules/electron/dist` и создайте файл `node_modules/electron/path.txt` с текстом
`electron.exe` (без перевода строки).

### «Для запуска нужна Java 25+»

Установите JDK 25 или новее (Temurin, Microsoft Build of OpenJDK, Oracle JDK) и нажмите
**Настройки → Java → Найти**. Если найдено несколько версий, выберите нужную вручную.

### Вход Microsoft не запускается

Проверьте, что Client ID — это UUID приложения, в настройках приложения включён
**Allow public client flows**, а тип аккаунтов допускает личные аккаунты Microsoft.
Подробнее — [docs/MICROSOFT_AUTH.md](docs/MICROSOFT_AUTH.md).

### Установка версии занимает много времени

Для `26.3` только индекс ресурсов содержит около 485 МБ ассетов. Это нормально: прогресс
показывается по стадиям, установку можно отменить. Уже скачанные файлы при повторной
попытке пропускаются.

## Документация

- [Архитектура](docs/ARCHITECTURE.md) — слои, сервисы, потоки данных, точки расширения.
- [Microsoft OAuth](docs/MICROSOFT_AUTH.md) — регистрация приложения и device code flow.
- [Handoff дизайнеру](docs/DESIGN_HANDOFF.md) — токены, компоненты, правила замены визуала.

## Лицензия

Проект приватный, лицензия не задана (`UNLICENSED`).
