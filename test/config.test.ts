import { describe, expect, it } from 'vitest';
import { loadConfig, parseAllowedChatIds } from '../src/config.js';

describe('parseAllowedChatIds', () => {
  it('parses multiple comma separated chat ids', () => {
    expect(parseAllowedChatIds('123,-100456, 789')).toEqual(
      new Set([123, -100456, 789])
    );
  });

  it('rejects invalid chat ids', () => {
    expect(() => parseAllowedChatIds('123,abc')).toThrow(
      'Invalid Telegram chat id'
    );
  });
});

describe('loadConfig', () => {
  it('loads CodexRadar false-positive guard defaults', () => {
    const config = loadConfig({
      DATABASE_PATH: './data/test-config.sqlite',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123'
    });

    expect(config.scheduler.timezone).toBe('Asia/Hong_Kong');
    expect(config.services.codexRadar.enabled).toBe(true);
    expect(config.services.codexRadar.openConfirmations).toBe(2);
    expect(config.services.codexRadar.suppressedWindowIds).toEqual(new Set());
    expect(config.services.codexRadar.suppressedSources).toEqual(new Set());
    expect(config.thirdPartyRequests).toMatchObject({
      maxRetries: 2,
      retryBaseDelayMs: 750,
      retryMaxDelayMs: 10_000
    });
  });

  it('keeps internal tuning defaults out of environment overrides', () => {
    const config = loadConfig({
      DATABASE_PATH: './data/test-config.sqlite',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      CODEX_RADAR_OPEN_CONFIRMATIONS: '3',
      CODEX_RADAR_SUPPRESSED_WINDOW_IDS: 'window-1, window-2,',
      CODEX_RADAR_SUPPRESSED_SOURCES:
        'https://example.com/source, https://example.com/other',
      THIRD_PARTY_MAX_RETRIES: '5',
      THIRD_PARTY_RETRY_BASE_DELAY_MS: '100',
      THIRD_PARTY_RETRY_MAX_DELAY_MS: '200'
    });

    expect(config.services.codexRadar.openConfirmations).toBe(2);
    expect(config.services.codexRadar.suppressedWindowIds).toEqual(new Set());
    expect(config.services.codexRadar.suppressedSources).toEqual(new Set());
    expect(config.thirdPartyRequests.maxRetries).toBe(2);
    expect(config.thirdPartyRequests.retryBaseDelayMs).toBe(750);
    expect(config.thirdPartyRequests.retryMaxDelayMs).toBe(10_000);
  });

  it('uses source defaults for blank environment values', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      DATABASE_PATH: '',
      TZ: '',
      HISTORY_RETENTION_DAYS: '',
      FAILURE_ALERT_THRESHOLD: '',
      PORT: '',
      LOG_LEVEL: '',
      CODEX_RADAR_ENABLED: '',
      CODEX_RADAR_URL: '',
      CODEX_RADAR_CRON: ''
    });

    expect(config.telegram.botToken).toBe('token');
    expect(config.telegram.allowedChatIds).toEqual(new Set([123]));
    expect(config.database.path).toContain('data/service-notification.sqlite');
    expect(config.scheduler.timezone).toBe('Asia/Hong_Kong');
    expect(config.scheduler.historyRetentionDays).toBe(30);
    expect(config.scheduler.failureAlertThreshold).toBe(3);
    expect(config.health.port).toBe(3000);
    expect(config.logging.level).toBe('info');
    expect(config.services.codexRadar.enabled).toBe(true);
    expect(config.services.codexRadar.url).toBe(
      'https://codexradar.com/current.json'
    );
    expect(config.services.codexRadar.cron).toBe('*/10 * * * *');
  });

  it('parses CodexRadar enable flags from environment values', () => {
    const enabledConfig = loadConfig({
      DATABASE_PATH: './data/test-config.sqlite',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      CODEX_RADAR_ENABLED: 'true'
    });
    const disabledConfig = loadConfig({
      DATABASE_PATH: './data/test-config.sqlite',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      CODEX_RADAR_ENABLED: '0'
    });

    expect(enabledConfig.services.codexRadar.enabled).toBe(true);
    expect(disabledConfig.services.codexRadar.enabled).toBe(false);
  });

  it('uses source defaults for unresolved compose placeholders', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      DATABASE_PATH: './data/test-config.sqlite',
      TZ: '${TZ:-Asia/Hong_Kong}',
      HISTORY_RETENTION_DAYS: '${HISTORY_RETENTION_DAYS:-30}',
      FAILURE_ALERT_THRESHOLD: '${FAILURE_ALERT_THRESHOLD:-3}',
      PORT: '${PORT:-3000}',
      LOG_LEVEL: '${LOG_LEVEL:-info}',
      CODEX_RADAR_ENABLED: '${CODEX_RADAR_ENABLED:-true}',
      CODEX_RADAR_URL:
        '${CODEX_RADAR_URL:-https://codexradar.com/current.json}',
      CODEX_RADAR_CRON: '${CODEX_RADAR_CRON:-*/10 * * * *}'
    });

    expect(config.telegram.botToken).toBe('token');
    expect(config.telegram.allowedChatIds).toEqual(new Set([123]));
    expect(config.scheduler.timezone).toBe('Asia/Hong_Kong');
    expect(config.scheduler.historyRetentionDays).toBe(30);
    expect(config.scheduler.failureAlertThreshold).toBe(3);
    expect(config.health.port).toBe(3000);
    expect(config.logging.level).toBe('info');
    expect(config.services.codexRadar.enabled).toBe(true);
    expect(config.services.codexRadar.url).toBe(
      'https://codexradar.com/current.json'
    );
    expect(config.services.codexRadar.cron).toBe('*/10 * * * *');
  });

  it('requires Telegram delivery configuration', () => {
    expect(() =>
      loadConfig({
        TELEGRAM_BOT_TOKEN: '',
        TELEGRAM_ALLOWED_CHAT_IDS: '123',
        DATABASE_PATH: './data/test-config.sqlite'
      })
    ).toThrow('TELEGRAM_BOT_TOKEN is required');
    expect(() =>
      loadConfig({
        TELEGRAM_BOT_TOKEN: '${TELEGRAM_BOT_TOKEN}',
        TELEGRAM_ALLOWED_CHAT_IDS: '${TELEGRAM_ALLOWED_CHAT_IDS}',
        DATABASE_PATH: './data/test-config.sqlite'
      })
    ).toThrow('TELEGRAM_BOT_TOKEN is required');
    expect(() =>
      loadConfig({
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_ALLOWED_CHAT_IDS: '',
        DATABASE_PATH: './data/test-config.sqlite'
      })
    ).toThrow('TELEGRAM_ALLOWED_CHAT_IDS is required');
  });
});
