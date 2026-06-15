import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createJobs } from '../src/services/registry.js';

describe('service registry', () => {
  it('does not register CodexRadar by default', () => {
    const config = loadConfig({
      DATABASE_PATH: './data/test-service-registry.sqlite',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123'
    });

    expect(createJobs(config)).toEqual([]);
  });

  it('registers CodexRadar when explicitly enabled', () => {
    const config = loadConfig({
      DATABASE_PATH: './data/test-service-registry.sqlite',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_CHAT_IDS: '123',
      CODEX_RADAR_ENABLED: 'true'
    });

    expect(createJobs(config).map((job) => job.id)).toEqual(['codex-radar']);
  });
});
