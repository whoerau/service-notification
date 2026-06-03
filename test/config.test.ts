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
      TELEGRAM_ALLOWED_CHAT_IDS: '123'
    });

    expect(config.scheduler.timezone).toBe('Asia/Hong_Kong');
    expect(config.jobs.codexRadar.openConfirmations).toBe(2);
    expect(config.jobs.codexRadar.predictionConfirmations).toBe(2);
    expect(config.jobs.codexRadar.suppressedWindowIds).toEqual(new Set());
    expect(config.jobs.codexRadar.suppressedSources).toEqual(new Set());
    expect(config.thirdPartyRequests).toMatchObject({
      maxRetries: 2,
      retryBaseDelayMs: 750,
      retryMaxDelayMs: 10_000
    });
  });

  it('keeps internal tuning defaults out of environment overrides', () => {
    const config = loadConfig({
      DATABASE_PATH: './data/test-config.sqlite',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      CODEX_RADAR_OPEN_CONFIRMATIONS: '3',
      CODEX_RADAR_PREDICTION_CONFIRMATIONS: '4',
      CODEX_RADAR_SUPPRESSED_WINDOW_IDS: 'window-1, window-2,',
      CODEX_RADAR_SUPPRESSED_SOURCES:
        'https://example.com/source, https://example.com/other',
      THIRD_PARTY_MAX_RETRIES: '5',
      THIRD_PARTY_RETRY_BASE_DELAY_MS: '100',
      THIRD_PARTY_RETRY_MAX_DELAY_MS: '200'
    });

    expect(config.jobs.codexRadar.openConfirmations).toBe(2);
    expect(config.jobs.codexRadar.predictionConfirmations).toBe(2);
    expect(config.jobs.codexRadar.suppressedWindowIds).toEqual(new Set());
    expect(config.jobs.codexRadar.suppressedSources).toEqual(new Set());
    expect(config.thirdPartyRequests.maxRetries).toBe(2);
    expect(config.thirdPartyRequests.retryBaseDelayMs).toBe(750);
    expect(config.thirdPartyRequests.retryMaxDelayMs).toBe(10_000);
  });
});
