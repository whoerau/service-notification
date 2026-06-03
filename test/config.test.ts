import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  parseAllowedChatIds,
  parseStringSet
} from '../src/config.js';

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

    expect(config.jobs.codexRadar.openConfirmations).toBe(2);
    expect(config.jobs.codexRadar.suppressedWindowIds).toEqual(new Set());
    expect(config.jobs.codexRadar.suppressedSources).toEqual(new Set());
  });

  it('parses CodexRadar suppression lists', () => {
    const config = loadConfig({
      DATABASE_PATH: './data/test-config.sqlite',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      CODEX_RADAR_OPEN_CONFIRMATIONS: '3',
      CODEX_RADAR_SUPPRESSED_WINDOW_IDS: 'window-1, window-2,',
      CODEX_RADAR_SUPPRESSED_SOURCES:
        'https://example.com/source, https://example.com/other'
    });

    expect(config.jobs.codexRadar.openConfirmations).toBe(3);
    expect(config.jobs.codexRadar.suppressedWindowIds).toEqual(
      new Set(['window-1', 'window-2'])
    );
    expect(config.jobs.codexRadar.suppressedSources).toEqual(
      new Set(['https://example.com/source', 'https://example.com/other'])
    );
  });
});

describe('parseStringSet', () => {
  it('trims comma separated strings and drops empty values', () => {
    expect(parseStringSet(' one, two ,, three ')).toEqual(
      new Set(['one', 'two', 'three'])
    );
  });
});
