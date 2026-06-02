import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createCodexRadarJob } from '../src/jobs/codex-radar-job.js';
import type { FetchService } from '../src/fetch/fetch-service.js';

describe('createCodexRadarJob', () => {
  it('runs every 10 minutes by default and emits one open-window notification candidate', async () => {
    const config = loadConfig({
      CODEX_RADAR_URL: 'https://codexradar.com/current.json',
      CODEX_RADAR_CRON: '*/10 * * * *',
      TELEGRAM_ALLOWED_CHAT_IDS: '123'
    });
    const job = createCodexRadarJob(config);
    const fetcher: FetchService = {
      async json() {
        return {
          url: 'https://codexradar.com/current.json',
          status: 200,
          headers: new Headers(),
          data: {
            checked_at: '2026-06-02T19:09:55+08:00',
            status: 'open',
            window_open: true,
            current_window: {
              id: 'window-1',
              title: '测试窗口',
              state: 'open',
              opened_at: '2026-06-02T19:00:00+08:00',
              source: 'https://example.com/source'
            }
          }
        };
      },
      async html() {
        throw new Error('unused');
      }
    };

    const result = await job.run({
      fetcher,
      state: {} as never,
      logger: {} as never,
      signal: new AbortController().signal
    });

    expect(job.schedule).toBe('*/10 * * * *');
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]?.dedupeKey).toBe(
      'codex-radar:window-open:window-1'
    );
    expect(result.notifications[0]?.message).toContain(
      '开启时间：2026-06-02T19:00:00+08:00'
    );
    expect(result.notifications[0]?.message).toContain('关闭时间：尚未关闭');
  });

  it('does not emit notification when the radar window is closed', async () => {
    const config = loadConfig({
      CODEX_RADAR_URL: 'https://codexradar.com/current.json',
      TELEGRAM_ALLOWED_CHAT_IDS: '123'
    });
    const job = createCodexRadarJob(config);
    const fetcher: FetchService = {
      async json() {
        return {
          url: 'https://codexradar.com/current.json',
          status: 200,
          headers: new Headers(),
          data: {
            status: 'none',
            window_open: false,
            current_window: {
              state: 'none'
            }
          }
        };
      },
      async html() {
        throw new Error('unused');
      }
    };

    const result = await job.run({
      fetcher,
      state: {} as never,
      logger: {} as never,
      signal: new AbortController().signal
    });

    expect(result.notifications).toEqual([]);
  });
});
