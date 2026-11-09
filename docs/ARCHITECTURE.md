# Архитектура Cerberus Launcher

## 1. Принципы

- **Один пакет, четыре слоя.** `main`, `preload`, `renderer`, `shared`. Слои общаются только
  через явные контракты, без импорта внутренностей друг друга.
- **Renderer ничего не знает о Node.js.** Все сетевые, файловые и системные операции — в
  main-процессе.
- **Типизированный IPC.** Формат ответа — `IpcResult<T>`; ошибки не теряются и не превращаются
  в необработанные rejection.
- **Сервисы вместо глобального состояния.** Каждый сервис получает зависимости через
  конструктор и не создаёт их сам.
- **Расширяемые точки вместо «магического» кода.** Модовые загрузчики и модпаки описаны
  интерфейсами, даже если реализация ещё не готова.

## 2. Слои и зависимости

```text
┌─────────────────────────────────────────────────────────────┐
│ renderer (React)                                            │
│ pages → context → window.cerberus → lib/format, components  │
└───────────────────────────┬─────────────────────────────────┘
                            │ contextBridge (preload)
┌───────────────────────────▼─────────────────────────────────┐
│ preload                                                     │
│ window.cerberus: CerberusApi, подписки на события           │
└───────────────────────────┬─────────────────────────────────┘
                            │ ipcRenderer.invoke / ipcRenderer.on
┌───────────────────────────▼─────────────────────────────────┐
│ main                                                        │
│ ipc.ts → services (installer, launcher, accounts, config…)  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ shared                                                      │
│ types.ts, ipc.ts, result.ts — общие для всех слоёв          │
└─────────────────────────────────────────────────────────────┘
```

Направление зависимостей: `renderer → preload → shared`, `main → shared`. Renderer не
импортирует `main`, main не импортирует React.

Псевдонимы путей заданы в `electron.vite.config.ts` и tsconfig-файлах:

- `@shared/*` → `src/shared/*`
- `@renderer/*` → `src/renderer/src/*`

## 3. Shared-контракт

| Файл | Содержимое |
| --- | --- |
| `src/shared/types.ts` | `Account`, `Settings`, `InstalledVersion`, `InstallProgress`, `LaunchState`, Microsoft-события и результаты. |
| `src/shared/ipc.ts` | Имена IPC-каналов (`IPC`, `IPC_EVENTS`), интерфейс `CerberusApi`, типы путей. |
| `src/shared/result.ts` | `IpcResult<T>` и хелперы `ipcOk` / `ipcFail`. |

`CerberusApi` — единственный контракт, который видит renderer. Preload реализует его поверх
`ipcRenderer`, а main регистрирует обработчики с теми же именами каналов. Если добавить метод,
нужно обновить три места: `ipc.ts`, `preload/index.ts`, `main/ipc.ts`.

### Формат результата

```ts
type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }
```

Исключения в main перехватываются в `run()` и превращаются в `{ ok: false, error }`.
Renderer разворачивает результат через `unwrap()` в `src/renderer/src/lib/ipc.ts`. Так в UI
попадают читаемые сообщения без `Error invoking remote method`.

### События

| Канал | Когда отправляется | Payload |
| --- | --- | --- |
| `versions:install-progress` | Во время установки, с троттлингом ~60 мс | `InstallProgress` |
| `versions:install-done` | Завершение или отмена установки | `TaskResult` |
| `versions:launch-log` | Строка stdout/stderr/системного лога | `LaunchLog` |
| `versions:launch-state` | Смена состояния запуска | `LaunchState` |
| `auth:flow-status` | Этапы device code flow | `MicrosoftFlowStatus` |
| `auth:flow-success` | Успешный вход | `MicrosoftFlowSuccess` |
| `auth:flow-error` | Ошибка входа | `MicrosoftFlowError` |
| `window:maximized` | Изменение состояния окна | `boolean` |

События идут только в renderer через `BrowserWindow.webContents.send`. Renderer подписывается
в `LauncherContext` и возвращает функции отписки при размонтировании.

## 4. Main-процесс

### Точка входа

`src/main/index.ts`:

1. `app.setName`, single-instance lock, глобальные обработчики ошибок.
2. `whenReady` → `AppPaths`, логгер, `ConfigStore`, `TaskManager`, `JavaService`,
   `VersionManifestService`, `InstalledService`.
3. `AccountStore` получает колбэки событий, `InstallerService` и `GameLauncher` — тоже.
4. `registerIpc(context, getWindow)`.
5. `createMainWindow()`.
6. `before-quit` отменяет активные задачи и OAuth-потоки. Запущенная игра при закрытии
   лаунчера не убивается.

### Сервисы

| Сервис | Файл | Ответственность |
| --- | --- | --- |
| `AppPaths` | `services/paths.ts` | userData, логи, кэш, settings/accounts, игровая папка по умолчанию. |
| `ConfigStore` | `services/config-store.ts` | Чтение/валидация/атомарная запись `settings.json`. |
| `JavaService` | `services/java.ts` | Поиск Java (PATH, JAVA_HOME, Program Files), `-version`, выбор подходящей версии. |
| `VersionManifestService` | `minecraft/version-manifest.ts` | Манифест Mojang, кэш на 30 минут, fallback на кэш при офлайне. |
| `InstalledService` | `minecraft/installed.ts` | Список установленных версий по маркеру `.cerberus.json`, удаление. |
| `InstallerService` | `minecraft/installer.ts` | Полный vanilla-пайплайн установки и прогресс. |
| `GameLauncher` | `minecraft/launcher.ts` | Проверка установки, Java, аргументы, spawn, логи, состояние. |
| `AccountStore` | `services/account-store.ts` | Аккаунты, активный профиль, сессии, refresh, шифрование токенов. |
| `microsoft-auth` | `services/microsoft-auth.ts` | HTTP-обмен с Microsoft/Xbox/Minecraft, парсинг профиля. |
| `ModLoaderRegistry` | `services/modloader.ts` | Контракт и заглушки адаптеров загрузчиков. |
| `ModpackServiceImpl` | `services/modpack.ts` | Контракт модпаков и предполагаемая раскладка. |
| `TaskManager` | `utils/task-manager.ts` | AbortController для установок, отмена всех задач при выходе. |

### Установка vanilla

`InstallerService.install(versionId)`:

1. Проверяет, что нет другой активной установки, создаёт задачу в `TaskManager`.
2. Берёт запись версии из манифеста, скачивает `<versionId>.json` с проверкой SHA-1.
3. Скачивает клиентский JAR.
4. Через `resolveLibraries(version, context, librariesDirectory)` определяет:
   - библиотеки classpath;
   - современные нативные артефакты (`natives-*`) — они попадают в classpath;
   - legacy-нативы из `natives`/`classifiers` — они распаковываются в `<version>/natives`.
5. Скачивает библиотеки параллельно (8 потоков), проверяя SHA-1 и размер.
6. Скачивает индекс ресурсов, затем объекты в `assets/objects/<xx>/<hash>` (12 потоков).
   Для `virtual`-индексов дополнительно материализует `assets/virtual/<index>/`.
7. Скачивает log4j-конфиг, если он указан.
8. Распаковывает legacy-нативы, исключая `META-INF/*` и правила `extract.exclude`.
9. Пишет маркер `.cerberus.json`, отправляет `install-done`.

Стадии прогресса: `preparing`, `version`, `client`, `libraries`, `assets`, `natives`,
`finishing`. Renderer показывает их через `STAGE_LABELS` на страницах «Играть» и «Версии».

Особенности реализации:

- Уже существующий файл пропускается, если совпал размер. Скачивание идёт во временный
  `.part`, затем атомарное переименование; при обрыве есть 3 попытки.
- `map_to_resources` (очень старые версии) намеренно не поддержан: установщик выдаёт
  понятную ошибку.
- `inheritsFrom` не раскрывается. Для vanilla он не нужен, для загрузчиков — обязателен.

### Запуск игры

`GameLauncher.launch(versionId)`:

1. Проверяет маркер установки, наличие JAR и описания версии.
2. Определяет требуемую Java из `javaVersion.majorVersion` (fallback — 8), вызывает
   `JavaService.resolve`.
3. Получает сессию активного аккаунта (`AccountStore.getSession`).
4. Собирает classpath и проверяет наличие всех библиотек.
5. Читает индекс ресурсов, выбирает `assets_root` или `virtual`-корень.
6. Подставляет переменные в аргументы JVM и игры. Поддержаны современные `arguments` и
   legacy `minecraftArguments`.
7. Добавляет `-Xmx`, `-Xms`, пользовательские JVM-аргументы, log4j-конфиг и
   `-Djava.library.path`, если версия их не задала.
8. `spawn(java, [...jvm, mainClass, ...game])`, подписывается на stdout/stderr и `close`.
9. Состояния: `starting → running → stopping/exited/error`.

Для офлайн-аккаунта передаётся access token `0`, `user_type=legacy` и offline UUID без
дефисов — этого достаточно для одиночной игры и серверов с `online-mode=false`.

### Авторизация

`AccountStore.startMicrosoftLogin`:

1. Берёт Client ID из настроек, проверяет формат UUID.
2. Запрашивает device code (`consumers` endpoint).
3. Возвращает renderer код и ссылку; параллельно опрашивает token endpoint.
4. После токена проходит Xbox Live → XSTS → Minecraft Services → профиль.
5. Сохраняет аккаунт, шифрует access/refresh token, обновляет активный профиль.
6. Отправляет `auth:flow-success`.

При запуске игры сессия берётся из памяти, затем из зашифрованного кэша, затем обновляется
через refresh token. Если refresh недействителен, сохранённые токены очищаются.

## 5. Renderer

### Состояние

`LauncherContext` — единый источник состояния UI:

- bootstrap-данные (настройки, аккаунты, установленные версии, Java, версии приложения, пути);
- удалённый список версий, загрузка и ошибка;
- прогресс установки, состояние запуска и логи;
- состояние Microsoft-входа;
- действия, которые разворачивают IPC-результаты и показывают тосты.

`ToastContext` — очередь уведомлений (success/error/info), максимум 4 одновременно.

### Экраны

| Маршрут | Компонент | Назначение |
| --- | --- | --- |
| `/` | `PlayPage` | Аккаунт, выбор версии, установка/запуск, прогресс, статус, консоль, статистика. |
| `/versions` | `VersionsPage` | Поиск и фильтры, установка, запуск, удаление версий. |
| `/modpacks` | `ModpacksPage` | Статичный roadmap раздела модпаков. |
| `/accounts` | `AccountsPage` | Активный профиль, список аккаунтов, Microsoft device flow, офлайн-профиль. |
| `/settings` | `SettingsPage` | Папка игры, Java, память, JVM-аргументы, Client ID, about. |

`App.tsx` добавляет `HashRouter`, splash на время bootstrap, экран фатальной ошибки и
ErrorBoundary. Хэш-роутинг выбран потому, что production-сборка открывается через `file://`.

### Стили

Четыре файла в `src/renderer/src/styles/`:

1. `tokens.css` — цвета, радиусы, тени, метрики, тайминги.
2. `base.css` — reset, типографика, скроллбары, фокус, анимации.
3. `components.css` — кнопки, поля, бейджи, панели, шапка, сайдбар, консоль, тосты, модалки.
4. `pages.css` — каркас приложения, hero, таблицы, аккаунты, настройки, модпаки, адаптив.

Правило: компоненты используют классы, а не inline-стили (исключения — динамические размеры
аватара и прогресс). Все цвета берутся из токенов.

## 6. Файловая раскладка

```text
<userData>/
  settings.json
  accounts.json
  logs/launcher.log
  cache/version_manifest_v2.json

<gameDirectory>/
  versions/<id>/
    <id>.json
    <id>.jar
    .cerberus.json
    natives/
  libraries/<maven-path>
  assets/
    indexes/<index>.json
    objects/<xx>/<hash>
    virtual/<index>/...        # только для virtual-индексов
    log_configs/client-*.xml
```

`<userData>` на Windows — `%APPDATA%\Cerberus Launcher`. Игровая папка по умолчанию —
`%USERPROFILE%\.cerberus`; её можно изменить в настройках.

## 7. Безопасность

- Окно: `frame: false`, `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`.
- `setWindowOpenHandler` и `will-navigate` блокируют навигацию; внешние ссылки разрешены
  только с протоколом HTTPS.
- `setPermissionRequestHandler` запрещает все permission-запросы renderer.
- CSP добавляется в packaged-режиме через `onHeadersReceived` (шрифты/стили self, картинки
  self/data/textures.minecraft.net, соединения только self).
- В preload нет доступа к файловой системе, процессам и `shell`; только фиксированный набор
  IPC-методов.
- Токены не попадают в renderer: наружу отдаются только публичные поля `Account`.
- `safeStorage` может быть недоступен (например, в некоторых окружениях без keyring). Тогда
  токены не пишутся на диск; это осознанный fail-safe.

## 8. Точки расширения

### Модовые загрузчики

Контракт — `ModLoaderAdapter` в `src/main/services/modloader.ts`:

```ts
interface ModLoaderAdapter {
  type: 'fabric' | 'quilt' | 'forge' | 'neoforge'
  displayName: string
  available: boolean
  unavailableReason?: string
  listVersions(minecraftVersion: string): Promise<LoaderVersion[]>
  install(request: LoaderInstallRequest): Promise<void>
}
```

Порядок реализации:

1. Добавить `inheritsFrom` в `VersionJson` и функцию слияния версий (родитель → загрузчик).
2. Для Fabric/Quilt: получить meta-версию, скачать профиль загрузчика, объединить библиотеки
   и аргументы, установить в `<gameDir>/versions/<loader>-<mc>`.
3. Для Forge/NeoForge: скачать installer, запустить его в отдельном Java-процессе с
   `--installClient`, дождаться выхода, прочитать созданный профиль.
4. Зарегистрировать адаптер в `ModLoaderRegistry`.
5. Добавить IPC-методы `loaders:list`, `loaders:install` и UI на странице «Версии».
6. Хранить `loader` в маркере установки (сейчас всегда `vanilla`).

### Модпаки

Контракт — `ModpackService` в `src/main/services/modpack.ts`. Предлагаемая раскладка:

```text
<gameDir>/modpacks/<id>/
  instance.json
  minecraft/        # изолированный gameDir
  mods/
```

Импорт должен переиспользовать `InstallerService` и `ModLoaderRegistry`:

1. Прочитать `manifest.json` (CurseForge) или `modrinth.index.json` (.mrpack).
2. Установить vanilla-версию и загрузчик в изолированную папку.
3. Скачать файлы модов по URL/хешам, проверить SHA-1.
4. Распаковать overrides.
5. Записать `instance.json` и показать инстанс на странице «Модпаки».

Для запуска модпака `GameLauncher` должен принимать `gameDirectory` инстанса, а не только
глобальный. Это небольшое изменение конструктора/метода `launch`.

### Скины

Сейчас `AccountStore` берёт активный скин из профиля Mojang. Для загрузки своих скинов нужен
отдельный сервис: проверка владельца, `PUT /minecraft/profile/skins`, хранение истории и
обновление `skinUrl`. В renderer уже есть `AccountAvatar` с отображением скина.

### Автоустановка Java

`JavaService` пока только ищет Java. Следующий шаг — скачивание runtime-компонента Mojang
(`javaVersion.component`) и хранение в `<userData>/java/<component>`. Это уберёт требование
ручной установки JDK.

## 9. Проверки и качество

```bash
npm run typecheck   # strict TypeScript для node и web
npm run build       # typecheck + electron-vite build
npm run build:unpack
```

Ручной smoke-тест:

1. Запустить `npm run dev`.
2. Убедиться, что окно открывается, сайдбар и страницы переключаются.
3. Добавить офлайн-аккаунт, проверить его в шапке и на странице «Играть».
4. Установить небольшую старую версию (например, `1.20.1`) и запустить.
5. Проверить консоль: логи Java должны появляться, состояние меняться на «Игра запущена».
6. Закрыть игру, убедиться, что статус стал «Игра завершилась».
7. Проверить сохранение настроек после перезапуска.

## 10. Известные ограничения и решения

| Ограничение | Причина / решение |
| --- | --- |
| Нет `inheritsFrom` | Vanilla не использует; для загрузчиков добавить слияние версий. |
| Нет `map_to_resources` | Очень старые версии; сознательно вне scope. |
| Java 26 при требовании 25 | `JavaService` разрешает более новую версию и пишет warning. |
| Токены не сохраняются без `safeStorage` | Fail-safe: лучше повторный вход, чем открытый токен на диске. |
| Установка не проверяет SHA-1 уже существующих файлов | Экономия времени; размер проверяется, повреждённый файл можно удалить вручную. |
| Нет докачки | При обрыве `.part` удаляется, попытка начинается заново. |
| Только Windows-упаковка | Текущий scope; electron-builder легко расширить. |
| Нет автообновления | Отдельная задача: electron-updater + подпись. |

## 11. Рекомендуемый порядок следующих итераций

1. Fabric/Quilt + `inheritsFrom` + UI выбора загрузчика.
2. Forge/NeoForge installer-процесс.
3. Модпаки CurseForge/Modrinth и изолированные инстансы.
4. Загрузка скинов.
5. Автоустановка Java.
6. Auto-update, подпись, CI-сборка.
