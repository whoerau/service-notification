import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createJobs } from '../src/services/registry.js';

describe('service registry', () => {
  it('registers default jobs', () => {
    const config = loadConfig({
      DATABASE_PATH: './data/test-service-registry.sqlite',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123'
    });

    expect(createJobs(config).map((job) => job.id)).toEqual([
      'codex-radar',
      'nezha-release'
    ]);
  });

  it('does not register disabled jobs', () => {
    const config = loadConfig({
      DATABASE_PATH: './data/test-service-registry.sqlite',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      CODEX_RADAR_ENABLED: 'false',
      NEZHA_RELEASE_ENABLED: 'false'
    });

    expect(createJobs(config)).toEqual([]);
  });

  it('keeps Nezha release enabled when CodexRadar is disabled', () => {
    const config = loadConfig({
      DATABASE_PATH: './data/test-service-registry.sqlite',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      CODEX_RADAR_ENABLED: 'false'
    });

    expect(createJobs(config).map((job) => job.id)).toEqual(['nezha-release']);
  });
});
