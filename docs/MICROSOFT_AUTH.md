# Microsoft OAuth в Cerberus Launcher

Cerberus использует **device code flow** Microsoft Identity Platform. Пользователь вводит код
на официальной странице Microsoft в браузере, а лаунчер получает токен и обменивает его на
сессию Minecraft. Пароль не попадает в приложение, redirect URI и client secret не нужны.

## 1. Зачем нужен свой Client ID

Client ID — публичный идентификатор приложения Microsoft Entra. Он не является секретом, но
привязан к вашему приложению: политики входа, разрешённые аккаунты и журнал использования
будут вашими.

В коде Client ID берётся из:

1. `settings.json` → поле `microsoftClientId` (его задают в **Настройки → Microsoft**);
2. либо из переменной окружения `CERBERUS_MS_CLIENT_ID` — как значение по умолчанию, пока в
   `settings.json` поле не заполнено.

Формат: UUID, например `12345678-1234-1234-1234-1234567890ab`.

## 2. Регистрация приложения

1. Откройте [Microsoft Entra admin center](https://entra.microsoft.com) → **App registrations**
   → **New registration**.
2. Имя: `Cerberus Launcher` (любое).
3. **Supported account types**: выберите вариант, включающий **personal Microsoft accounts**
   (например, «Accounts in any organizational directory and personal Microsoft accounts»).
   Для Minecraft нужны именно личные аккаунты Microsoft.
4. **Redirect URI**: оставьте пустым. Device code flow не использует redirect.
5. Создайте приложение и скопируйте **Application (client) ID**.
6. Откройте **Authentication** → **Advanced settings** → **Allow public client flows** →
   **Yes** → **Save**. Без этого device code flow вернёт ошибку.
7. **Certificates & secrets** не нужны. Никогда не встраивайте client secret в лаунчер:
   любой секрет в desktop-приложении считается скомпрометированным.
8. Вставьте Client ID в **Настройки → Microsoft** и нажмите «Сохранить».

В коде используется endpoint `https://login.microsoftonline.com/consumers/oauth2/v2.0/...`.
Он предназначен для личных аккаунтов Microsoft. Если ваше приложение зарегистрировано только
для организаций, вход вернёт `unauthorized_client`.

## 3. Как проходит вход

```text
Cerberus                         Microsoft Identity Platform
   │                                        │
   │ POST /devicecode                       │
   │ scope=XboxLive.signin offline_access   │
   ├───────────────────────────────────────►│
   │◄──── device_code, user_code, URI ──────┤
   │                                        │
   │  Показываем user_code пользователю     │
   │  Открываем verification_uri            │
   │                                        │
   │ POST /token (grant_type=device_code)   │
   ├───────────────────────────────────────►│  каждые N секунд
   │◄──── access_token / authorization_pending / slow_down
   │                                        │
   │ POST user.auth.xboxlive.com            │
   ├───────────────────────────────────────►│
   │◄──── Xbox Live token                   │
   │                                        │
   │ POST xsts.auth.xboxlive.com            │
   ├───────────────────────────────────────►│
   │◄──── XSTS token + user hash (uhs)      │
   │                                        │
   │ POST api.minecraftservices.com/        │
   │      authentication/login_with_xbox    │
   ├───────────────────────────────────────►│
   │◄──── Minecraft access token            │
   │                                        │
   │ GET /minecraft/profile                 │
   ├───────────────────────────────────────►│
   │◄──── id, name, skins                   │
```

### Параметры запросов

| Этап | Метод и URL | Ключевые поля |
| --- | --- | --- |
| Device code | `POST https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode` | `client_id`, `scope=XboxLive.signin offline_access` |
| Poll token | `POST .../oauth2/v2.0/token` | `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `client_id`, `device_code` |
| Refresh | `POST .../oauth2/v2.0/token` | `grant_type=refresh_token`, `client_id`, `refresh_token`, тот же scope |
| Xbox Live | `POST https://user.auth.xboxlive.com/user/authenticate` | `RpsTicket=d=<Microsoft access token>`, `RelyingParty=http://auth.xboxlive.com` |
| XSTS | `POST https://xsts.auth.xboxlive.com/xsts/authorize` | `SandboxId=RETAIL`, `UserTokens=[xbl.Token]`, `RelyingParty=rp://api.minecraftservices.com/` |
| Minecraft login | `POST https://api.minecraftservices.com/authentication/login_with_xbox` | `identityToken=XBL3.0 x=<uhs>;<xsts token>` |
| Профиль | `GET https://api.minecraftservices.com/minecraft/profile` | `Authorization: Bearer <Minecraft token>` |

### Поведение polling

- Интервал берётся из ответа (`interval`, обычно 5 секунд).
- `authorization_pending` — пользователь ещё не подтвердил вход, продолжаем.
- `slow_down` — увеличиваем интервал на 5 секунд.
- `expired_token`, `authorization_declined`, `bad_verification_code` — показываем ошибку.
- HTTP 429 и 5xx — повторяем.
- Поток можно отменить кнопкой «Отменить вход»; `AbortController` прерывает ожидание.

Код живёт около 15 минут. После успешного входа Cerberus показывает профиль и делает его
активным.

## 4. Хранение токенов

| Данные | Где хранятся | Как защищены |
| --- | --- | --- |
| Xbox/Minecraft access token | `accounts.json` (main) | `safeStorage.encryptString` → base64 |
| Refresh token | `accounts.json` (main) | `safeStorage.encryptString` → base64 |
| Публичный профиль (ник, UUID, скин) | `accounts.json` | Открытый текст, это не секрет |
| Пароль Microsoft | нигде | Пользователь вводит его только на сайте Microsoft |

На Windows `safeStorage` использует DPAPI, то есть токены привязаны к учётной записи Windows.
Если шифрование недоступно, Cerberus **не сохраняет** токены на диск: вход будет работать до
перезапуска, после чего потребуется повторить его. Это сделано намеренно — открытый refresh
token на диске хуже, чем повторный вход.

Access token Minecraft кэшируется до истечения; за 60 секунд до конца сессии выполняется
refresh. Если refresh token отклонён (`invalid_grant` / `invalid_request`), сохранённые токены
удаляются и лаунчер просит войти заново.

## 5. Ошибки и что они значат

### OAuth / Microsoft

| Симптом | Причина | Решение |
| --- | --- | --- |
| `invalid_client` | Неверный Client ID, приложение не public client или запрос идёт не в тот tenant | Проверьте UUID и «Allow public client flows» |
| `unauthorized_client` | Тип аккаунтов в приложении не допускает личные аккаунты | Перерегистрируйте поддержку personal accounts |
| `authorization_pending` | Нормальное состояние до подтверждения | Введите код на странице Microsoft |
| `expired_token` | Код истёк | Начните вход заново |
| `authorization_declined` | Вход отклонён в браузере | Повторите и подтвердите доступ |
| `bad_verification_code` | Код введён неверно или устарел | Запросите новый код |

### Xbox Live / XSTS

Cerberus переводит коды XSTS в понятные сообщения:

| Код | Значение |
| --- | --- |
| `2148916233` | У аккаунта нет профиля Xbox. Создайте его на xbox.com. |
| `2148916235` | Xbox Live недоступен в регионе аккаунта. |
| `2148916236`, `2148916237` | Нужна проверка возраста (взрослый аккаунт). |
| `2148916238` | Детский аккаунт должен быть в семейной группе Microsoft. |

### Minecraft Services

| Симптом | Причина |
| --- | --- |
| 404 на `/minecraft/profile` | У аккаунта нет лицензии Minecraft: Java Edition. |
| Ошибка входа Xbox при наличии лицензии | Профиль Xbox не создан или аккаунт ограничен. |
| Сессия истекла сразу после перезапуска | Недоступен `safeStorage`, токены не сохранились. |

## 6. Проверка вручную

1. Зарегистрируйте приложение и включите public client flows.
2. Вставьте Client ID в настройки, сохраните.
3. Откройте **Аккаунты** → **Войти через Microsoft**.
4. Убедитесь, что показан код и кнопка открывает `microsoft.com` (HTTPS).
5. Введите код в браузере, подтвердите вход.
6. Дождитесь появления профиля: ник и скин должны совпасть с профилем Minecraft.
7. Перезапустите лаунчер — аккаунт должен остаться активным.
8. Запустите игру; в логах не должно быть ошибок авторизации.
9. Удалите аккаунт — запись и токены должны исчезнуть из `accounts.json`.

Не используйте для проверки аккаунт без лицензии, если хотите проверить полный путь: профиль
Minecraft вернёт 404, и это ожидаемое поведение.

## 7. Безопасность

- В приложении нет client secret; он не нужен для public client.
- Device code нельзя использовать как «логин и пароль»: он одноразовый и быстро истекает.
- Пользователь должен вводить код только на домене Microsoft. Cerberus открывает URL из
  ответа Microsoft, а не произвольную ссылку.
- Токены никогда не отправляются в renderer и не пишутся в лог.
- При удалении аккаунта удаляются и зашифрованные токены.
- Не добавляйте refresh token в bug report или скриншот `accounts.json`.

## 8. Ограничения текущей реализации

- Нет поддержки нескольких tenant'ов и корпоративных политик условного доступа.
- Нет интерактивного выбора аккаунта внутри приложения — выбор происходит в браузере.
- Нет автоматического создания профиля Xbox.
- Нет загрузки скинов; отображается текущий скин профиля.
- При недоступном `safeStorage` сессия не переживает перезапуск (осознанный fail-safe).
