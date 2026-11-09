import { useEffect, useMemo, useState } from 'react'
import type { JavaInfo, Settings } from '@shared/types'
import { useLauncher } from '../context/LauncherContext'
import {
  BoxIcon,
  CheckIcon,
  CoffeeIcon,
  ExternalIcon,
  FolderIcon,
  GridIcon,
  InfoIcon,
  RefreshIcon,
  ShieldIcon,
  TerminalIcon
} from '../components/Icons'
import { PageHeader } from '../components/Layout'
import { formatMemory } from '../lib/format'

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MEMORY_MIN = 1024
const MEMORY_MAX = 32768
const MEMORY_STEP = 256

export function SettingsPage() {
  const {
    settings,
    java,
    paths,
    appVersions,
    saveSettings,
    detectJava,
    pickPath,
    openPath,
    openExternal,
    checkCurseForge
  } = useLauncher()

  const [draft, setDraft] = useState<Settings>(settings)
  const [detected, setDetected] = useState<JavaInfo[]>([])
  const [detecting, setDetecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [checkingKey, setCheckingKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  useEffect(() => {
    let mounted = true
    void detectJava().then((list) => {
      if (mounted) setDetected(list)
    })
    return () => {
      mounted = false
    }
  }, [detectJava])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(settings),
    [draft, settings]
  )

  const clientIdValid =
    draft.microsoftClientId.trim().length === 0 ||
    CLIENT_ID_PATTERN.test(draft.microsoftClientId.trim())

  const javaOptions = useMemo(() => {
    const options = [...detected]
    if (draft.javaPath && !options.some((item) => item.path === draft.javaPath)) {
      options.unshift({
        path: draft.javaPath,
        version: 'выбран вручную',
        major: java?.path === draft.javaPath ? java.major : 0
      })
    }
    return options
  }, [detected, draft.javaPath, java])

  const update = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setFormError(null)
  }

  const handleDetect = async (): Promise<void> => {
    setDetecting(true)
    const list = await detectJava()
    setDetected(list)
    setDetecting(false)
  }

  const handleGameFolder = async (): Promise<void> => {
    const selected = await pickPath('game')
    if (selected) update('gameDirectory', selected)
  }

  const handleJavaFile = async (): Promise<void> => {
    const selected = await pickPath('java')
    if (selected) update('javaPath', selected)
  }

  const handleCheckKey = async (): Promise<void> => {
    const key = draft.curseForgeApiKey.trim()
    if (!key) {
      setKeyStatus({ ok: false, text: 'Сначала укажите API-ключ CurseForge.' })
      return
    }

    setCheckingKey(true)
    const ok = await checkCurseForge(key)
    setCheckingKey(false)
    setKeyStatus({
      ok,
      text: ok
        ? 'Ключ действителен: CurseForge отвечает на запросы.'
        : 'Не удалось проверить ключ. Убедитесь, что он скопирован полностью и активен.'
    })
  }

  const handleSave = async (): Promise<void> => {
    if (!clientIdValid) {
      setFormError('Client ID Microsoft должен быть в формате UUID.')
      return
    }
    if (!draft.gameDirectory.trim()) {
      setFormError('Укажите папку игры.')
      return
    }

    setSaving(true)
    const ok = await saveSettings({
      ...draft,
      gameDirectory: draft.gameDirectory.trim(),
      javaPath: draft.javaPath?.trim() || null,
      microsoftClientId: draft.microsoftClientId.trim(),
      jvmArgs: draft.jvmArgs.trim(),
      curseForgeApiKey: draft.curseForgeApiKey.trim()
    })
    setSaving(false)
    if (ok) setFormError(null)
  }

  const currentJava =
    javaOptions.find((item) => item.path === draft.javaPath) ?? java ?? null

  return (
    <div className="page">
      <PageHeader
        eyebrow="Настройки"
        title="Параметры лаунчера"
        description="Интерфейс, пути, Java, память, официальная авторизация и ключи каталогов."
        actions={
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
            >
              {saving ? <span className="spinner spinner--small" /> : <CheckIcon size={16} />}
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        }
      />

      {formError ? (
        <div className="callout callout--error">
          <InfoIcon size={18} />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="settings-grid">
        <section className="panel settings-section settings-section--wide">
          <div className="settings-section__head">
            <span className="settings-section__icon">
              {draft.uiMode === 'prism' ? <BoxIcon size={20} /> : <GridIcon size={20} />}
            </span>
            <div>
              <h3>Интерфейс</h3>
              <p>Классический лаунчер или плиточный Prism-режим. Аккаунты и настройки общие.</p>
            </div>
            <span className="badge">{draft.uiMode === 'prism' ? 'Prism' : 'Classic'}</span>
          </div>

          <div className="ui-mode-picker" role="radiogroup" aria-label="Режим интерфейса">
            <button
              type="button"
              role="radio"
              aria-checked={draft.uiMode === 'classic'}
              className={`ui-mode-option${draft.uiMode === 'classic' ? ' ui-mode-option--active' : ''}`}
              onClick={() => update('uiMode', 'classic')}
            >
              <span className="ui-mode-option__preview ui-mode-option__preview--classic" aria-hidden="true">
                <span className="ui-mode-option__rail" />
                <span className="ui-mode-option__hero" />
                <span className="ui-mode-option__row" />
                <span className="ui-mode-option__row" />
              </span>
              <span className="ui-mode-option__text">
                <strong>Классический</strong>
                <small>Боковая навигация, герой-блок и быстрый запуск версии.</small>
              </span>
              <span className="ui-mode-option__check">
                {draft.uiMode === 'classic' ? <CheckIcon size={13} /> : null}
              </span>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={draft.uiMode === 'prism'}
              className={`ui-mode-option${draft.uiMode === 'prism' ? ' ui-mode-option--active' : ''}`}
              onClick={() => update('uiMode', 'prism')}
            >
              <span className="ui-mode-option__preview ui-mode-option__preview--prism" aria-hidden="true">
                <span className="ui-mode-option__topbar" />
                <span className="ui-mode-option__tile" />
                <span className="ui-mode-option__tile" />
                <span className="ui-mode-option__tile" />
              </span>
              <span className="ui-mode-option__text">
                <strong>Prism</strong>
                <small>Плитки инстансов, каталог контента и витрина сборок.</small>
              </span>
              <span className="ui-mode-option__check">
                {draft.uiMode === 'prism' ? <CheckIcon size={13} /> : null}
              </span>
            </button>
          </div>

          <small className="field-hint">
            Переключение применится после сохранения. Данные, аккаунты и установленные версии
            не меняются.
          </small>
        </section>

        <section className="panel settings-section">
          <div className="settings-section__head">
            <span className="settings-section__icon">
              <FolderIcon size={20} />
            </span>
            <div>
              <h3>Папка игры</h3>
              <p>Версии, библиотеки, ресурсы и сохранения Minecraft.</p>
            </div>
          </div>

          <div className="field">
            <span>Путь к папке</span>
            <div className="path-field">
              <input
                className="input input--mono"
                value={draft.gameDirectory}
                onChange={(event) => update('gameDirectory', event.target.value)}
                spellCheck={false}
              />
              <div className="path-field__actions">
                <button type="button" className="btn btn--secondary btn--small" onClick={() => void handleGameFolder()}>
                  Обзор
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => void openPath('game')}>
                  Открыть
                </button>
              </div>
            </div>
            <small className="field-hint">
              По умолчанию используется <code>{paths.defaultGameDirectory}</code>.
            </small>
          </div>

          <label className="switch-field">
            <input
              type="checkbox"
              checked={draft.showSnapshots}
              onChange={(event) => update('showSnapshots', event.target.checked)}
            />
            <span className="switch-field__track" aria-hidden="true">
              <span className="switch-field__thumb" />
            </span>
            <span className="switch-field__text">
              <strong>Показывать снапшоты</strong>
              <small>Добавляет тестовые версии в список на страницах «Играть» и «Версии».</small>
            </span>
          </label>
        </section>

        <section className="panel settings-section">
          <div className="settings-section__head">
            <span className="settings-section__icon">
              <CoffeeIcon size={20} />
            </span>
            <div>
              <h3>Java</h3>
              <p>Лаунчер подбирает версию под требования Minecraft.</p>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--small settings-section__action"
              onClick={() => void handleDetect()}
              disabled={detecting}
            >
              <RefreshIcon size={15} className={detecting ? 'spin' : undefined} />
              {detecting ? 'Ищем…' : 'Найти'}
            </button>
          </div>

          <div className="java-summary">
            <span className={`status-dot${currentJava ? '' : ' status-dot--error'}`} />
            <div>
              <strong>
                {currentJava
                  ? `Java ${currentJava.major || '?'} · ${currentJava.version}`
                  : 'Java не найдена'}
              </strong>
              <small>{currentJava?.path ?? 'Укажите путь к java.exe вручную.'}</small>
            </div>
          </div>

          <label className="field">
            <span>Исполняемый файл</span>
            <div className="path-field">
              <select
                className="input"
                value={draft.javaPath ?? ''}
                onChange={(event) => update('javaPath', event.target.value || null)}
              >
                <option value="">Автоматически</option>
                {javaOptions.map((item) => (
                  <option key={item.path} value={item.path}>
                    Java {item.major || '?'} · {item.version} — {item.path}
                  </option>
                ))}
              </select>
              <div className="path-field__actions">
                <button type="button" className="btn btn--secondary btn--small" onClick={() => void handleJavaFile()}>
                  Указать вручную
                </button>
              </div>
            </div>
            <small className="field-hint">
              Для актуальных версий Minecraft требуется Java 25+. Более новая версия допускается
              с предупреждением в логе.
            </small>
          </label>
        </section>

        <section className="panel settings-section">
          <div className="settings-section__head">
            <span className="settings-section__icon">
              <TerminalIcon size={20} />
            </span>
            <div>
              <h3>Память и JVM</h3>
              <p>Выделенная память и дополнительные аргументы запуска.</p>
            </div>
          </div>

          <div className="field">
            <div className="field__row">
              <span>Оперативная память</span>
              <strong className="field__value">{formatMemory(draft.memoryMb)}</strong>
            </div>
            <input
              className="range"
              type="range"
              min={MEMORY_MIN}
              max={MEMORY_MAX}
              step={MEMORY_STEP}
              value={draft.memoryMb}
              onChange={(event) => update('memoryMb', Number(event.target.value))}
            />
            <div className="range-labels">
              <span>{formatMemory(MEMORY_MIN)}</span>
              <span>{formatMemory(MEMORY_MAX)}</span>
            </div>
            <small className="field-hint">
              Значение выделяется флагом <code>-Xmx</code>. Для сборок с модами обычно нужно
              больше памяти.
            </small>
          </div>

          <label className="field">
            <span>Дополнительные JVM-аргументы</span>
            <textarea
              className="input textarea"
              rows={4}
              value={draft.jvmArgs}
              onChange={(event) => update('jvmArgs', event.target.value)}
              placeholder="-XX:+UseG1GC -Dfile.encoding=UTF-8"
              spellCheck={false}
            />
            <small className="field-hint">
              Необязательно. Аргументы добавляются перед аргументами выбранной версии Minecraft.
            </small>
          </label>
        </section>

        <section className="panel settings-section">
          <div className="settings-section__head">
            <span className="settings-section__icon">
              <ShieldIcon size={20} />
            </span>
            <div>
              <h3>Microsoft</h3>
              <p>Client ID приложения Microsoft Entra для входа игроков.</p>
            </div>
          </div>

          <label className="field">
            <span>Client ID</span>
            <input
              className={`input input--mono${clientIdValid ? '' : ' input--invalid'}`}
              value={draft.microsoftClientId}
              onChange={(event) => update('microsoftClientId', event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              spellCheck={false}
              autoComplete="off"
            />
            <small className="field-hint">
              {clientIdValid
                ? 'Используется device code flow. Инструкция — в docs/MICROSOFT_AUTH.md.'
                : 'Некорректный формат UUID.'}{' '}
              Можно задать через переменную окружения <code>CERBERUS_MS_CLIENT_ID</code>.
            </small>
          </label>

          <div className="settings-inline-actions">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() =>
                void openExternal('https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code')
              }
            >
              <ExternalIcon size={14} />
              Документация Microsoft
            </button>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="settings-section__head">
            <span className="settings-section__icon">
              <ShieldIcon size={20} />
            </span>
            <div>
              <h3>CurseForge</h3>
              <p>API-ключ для поиска и установки контента с CurseForge.</p>
            </div>
            {draft.curseForgeApiKey.trim() ? (
              <span className="badge badge--success">Ключ указан</span>
            ) : (
              <span className="badge">Не задан</span>
            )}
          </div>

          <label className="field">
            <span>API-ключ</span>
            <input
              className="input input--mono"
              type="password"
              value={draft.curseForgeApiKey}
              onChange={(event) => {
                update('curseForgeApiKey', event.target.value)
                setKeyStatus(null)
              }}
              placeholder="$2a$10$..."
              spellCheck={false}
              autoComplete="off"
            />
            <small className="field-hint">
              Ключ хранится локально в файле настроек лаунчера и отправляется только на
              api.curseforge.com. Modrinth работает без ключа.
            </small>
          </label>

          <div className="settings-inline-actions">
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => void handleCheckKey()}
              disabled={checkingKey}
            >
              {checkingKey ? <span className="spinner spinner--small" /> : <ShieldIcon size={14} />}
              {checkingKey ? 'Проверяем…' : 'Проверить ключ'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => void openExternal('https://console.curseforge.com/')}
            >
              <ExternalIcon size={14} />
              Получить ключ
            </button>
          </div>

          {keyStatus ? (
            <div className={`callout ${keyStatus.ok ? 'callout--success' : 'callout--error'}`}>
              <InfoIcon size={18} />
              <span>{keyStatus.text}</span>
            </div>
          ) : null}
        </section>

        <section className="panel settings-section settings-section--wide">
          <div className="settings-section__head">
            <span className="settings-section__icon">
              <InfoIcon size={20} />
            </span>
            <div>
              <h3>О приложении</h3>
              <p>Версии компонентов и служебные папки.</p>
            </div>
            <span className="badge">Cerberus {appVersions.app || '0.1.0'}</span>
          </div>

          <div className="about-grid">
            <div className="about-item">
              <span>Electron</span>
              <strong>{appVersions.electron || '—'}</strong>
            </div>
            <div className="about-item">
              <span>Chromium</span>
              <strong>{appVersions.chrome || '—'}</strong>
            </div>
            <div className="about-item">
              <span>Node.js</span>
              <strong>{appVersions.node || '—'}</strong>
            </div>
            <div className="about-item">
              <span>Java в системе</span>
              <strong>{java ? `${java.version} (${java.major})` : 'не найдена'}</strong>
            </div>
          </div>

          <div className="path-list">
            <div className="path-list__row">
              <div>
                <span>Данные лаунчера</span>
                <code>{paths.dataDirectory || '—'}</code>
              </div>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => void openPath('data')}>
                Открыть
              </button>
            </div>
            <div className="path-list__row">
              <div>
                <span>Логи</span>
                <code>{paths.logsDirectory || '—'}</code>
              </div>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => void openPath('logs')}>
                Открыть
              </button>
            </div>
            <div className="path-list__row">
              <div>
                <span>Папка игры по умолчанию</span>
                <code>{paths.defaultGameDirectory || '—'}</code>
              </div>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => void openPath('game')}>
                Открыть
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer className="settings-footer">
        <span className={dirty ? 'settings-footer__dirty' : 'muted'}>
          {dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}
        </span>
        <div className="settings-footer__actions">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              setDraft(settings)
              setFormError(null)
            }}
            disabled={!dirty || saving}
          >
            Сбросить
          </button>
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
          >
            {saving ? <span className="spinner spinner--small" /> : <CheckIcon size={16} />}
            Сохранить настройки
          </button>
        </div>
      </footer>
    </div>
  )
}
