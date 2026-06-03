import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createCodexRadarJob } from '../src/jobs/codex-radar-job.js';
import type { FetchService } from '../src/fetch/fetch-service.js';
import type { JobDefinition, JobResult } from '../src/types.js';
import { createTestStateStore } from './helpers.js';

describe('createCodexRadarJob', () => {
  it('waits for two complete window confirmations before emitting a report', async () => {
    const { database, state } = createTestStateStore();
    const config = loadConfig({
      CODEX_RADAR_URL: 'https://codexradar.com/current.json',
      CODEX_RADAR_CRON: '*/10 * * * *',
      TELEGRAM_ALLOWED_CHAT_IDS: '123'
    });
    const job = createCodexRadarJob(config);
    const fetcher = createJsonFetcher(
      completeWindowPayload('2026-06-03T10:10:00+08:00'),
      completeWindowPayload('2026-06-03T10:20:00+08:00')
    );

    const first = await runAndPersist(job, state, fetcher);
    const second = await runAndPersist(job, state, fetcher);

    expect(job.schedule).toBe('*/10 * * * *');
    expect(first.notifications).toEqual([]);
    expect(first.metadata).toMatchObject({
      decision: 'pending',
      reportReady: false,
      candidateWindowId: 'window-1',
      candidateOpenCount: 1
    });
    expect(second.notifications).toHaveLength(1);
    expect(second.metadata).toMatchObject({
      decision: 'confirmed',
      reportReady: true,
      candidateWindowId: 'window-1',
      candidateOpenCount: 2
    });
    expect(second.notifications[0]?.dedupeKey).toBe(
      'codex-radar:window-report:window-1'
    );
    expect(second.notifications[0]?.message).toContain(
      '开启时间：2026-06-03T10:00:00+08:00'
    );
    expect(second.notifications[0]?.message).toContain(
      '关闭时间：2026-06-03T10:05:00+08:00'
    );
    expect(second.notifications[0]?.message).not.toContain('尚未关闭');

    database.close();
  });

  it('does not report a current open window without closed_at', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      loadConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createJsonFetcher({
      checked_at: '2026-06-03T10:10:00+08:00',
      status: 'open',
      window_open: true,
      current_window: {
        id: 'window-1',
        title: '测试窗口',
        state: 'open',
        opened_at: '2026-06-03T10:00:00+08:00',
        source: 'https://example.com/source'
      }
    });

    const result = await runAndPersist(job, state, fetcher);

    expect(result.notifications).toEqual([]);
    expect(result.metadata).toMatchObject({
      decision: 'insufficient',
      reportReady: false,
      windowOpen: true,
      openedAt: '2026-06-03T10:00:00+08:00'
    });

    database.close();
  });

  it('does not report when the radar window is closed without complete times', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      loadConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createJsonFetcher({
      checked_at: '2026-06-03T10:10:00+08:00',
      status: 'none',
      window_open: false,
      current_window: {
        state: 'none'
      }
    });

    const result = await runAndPersist(job, state, fetcher);

    expect(result.notifications).toEqual([]);
    expect(result.metadata).toMatchObject({
      decision: 'closed',
      reportReady: false,
      windowOpen: false
    });

    database.close();
  });

  it('resets confirmation when the window id changes', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      loadConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createJsonFetcher(
      completeWindowPayload('2026-06-03T10:10:00+08:00', 'window-1'),
      completeWindowPayload('2026-06-03T10:20:00+08:00', 'window-2')
    );

    const first = await runAndPersist(job, state, fetcher);
    const second = await runAndPersist(job, state, fetcher);

    expect(first.metadata).toMatchObject({
      decision: 'pending',
      candidateWindowId: 'window-1',
      candidateOpenCount: 1
    });
    expect(second.notifications).toEqual([]);
    expect(second.metadata).toMatchObject({
      decision: 'pending',
      candidateWindowId: 'window-2',
      candidateOpenCount: 1
    });

    database.close();
  });

  it('ignores last_window when current_window is absent', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      loadConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createJsonFetcher({
      checked_at: '2026-06-03T10:10:00+08:00',
      status: 'open',
      window_open: true,
      last_window: {
        id: 'window-1',
        state: 'open',
        opened_at: '2026-06-03T10:00:00+08:00',
        closed_at: '2026-06-03T10:05:00+08:00'
      }
    });

    const result = await runAndPersist(job, state, fetcher);

    expect(result.notifications).toEqual([]);
    expect(result.metadata).toMatchObject({
      decision: 'insufficient',
      reportReady: false
    });

    database.close();
  });

  it('suppresses known bad window ids and sources', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      loadConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123',
        CODEX_RADAR_SUPPRESSED_WINDOW_IDS: 'window-1',
        CODEX_RADAR_SUPPRESSED_SOURCES: 'https://example.com/bad-source'
      })
    );
    const idFetcher = createJsonFetcher(
      completeWindowPayload('2026-06-03T10:10:00+08:00', 'window-1')
    );
    const sourceFetcher = createJsonFetcher(
      completeWindowPayload(
        '2026-06-03T10:20:00+08:00',
        'window-2',
        'https://example.com/bad-source'
      )
    );

    const idResult = await runAndPersist(job, state, idFetcher);
    const sourceResult = await runAndPersist(job, state, sourceFetcher);

    expect(idResult.notifications).toEqual([]);
    expect(idResult.metadata).toMatchObject({
      decision: 'suppressed',
      suppressionReason: 'window_id',
      candidateWindowId: 'window-1'
    });
    expect(sourceResult.notifications).toEqual([]);
    expect(sourceResult.metadata).toMatchObject({
      decision: 'suppressed',
      suppressionReason: 'source',
      candidateWindowId: 'window-2',
      candidateSource: 'https://example.com/bad-source'
    });

    database.close();
  });
});

function completeWindowPayload(
  checkedAt: string,
  id = 'window-1',
  source = 'https://example.com/source'
) {
  return {
    checked_at: checkedAt,
    status: 'closed',
    window_open: false,
    current_window: {
      id,
      title: '测试窗口',
      state: 'closed',
      opened_at: '2026-06-03T10:00:00+08:00',
      closed_at: '2026-06-03T10:05:00+08:00',
      source
    }
  };
}

function createJsonFetcher(...payloads: unknown[]): FetchService {
  let calls = 0;

  return {
    async json() {
      const data = payloads[Math.min(calls, payloads.length - 1)];
      calls += 1;

      return {
        url: 'https://codexradar.com/current.json',
        status: 200,
        headers: new Headers(),
        data
      };
    },
    async html() {
      throw new Error('unused');
    }
  };
}

async function runAndPersist(
  job: JobDefinition,
  state: ReturnType<typeof createTestStateStore>['state'],
  fetcher: FetchService
): Promise<JobResult> {
  const now = new Date('2026-06-03T02:00:00.000Z');
  const result = await job.run({
    fetcher,
    state,
    logger: {} as never,
    signal: new AbortController().signal
  });

  await state.recordJobRun({
    jobId: job.id,
    status: 'success',
    startedAt: now,
    finishedAt: now,
    metadata: result.metadata
  });

  return result;
}
