import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createCodexRadarJob } from '../src/services/codex-radar/job.js';
import type { FetchService } from '../src/fetch/fetch-service.js';
import type { JobDefinition, JobResult } from '../src/types.js';
import { createTestStateStore } from './helpers.js';

type TestEnv = Parameters<typeof loadConfig>[0];

describe('createCodexRadarJob', () => {
  it('waits for two JSON v2 open confirmations before emitting an alert', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      testConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createFetcher(
      openWindowPayload('2026-06-17T05:33:25+08:00'),
      openWindowPayload('2026-06-17T05:43:25+08:00')
    );

    const first = await runAndPersist(job, state, fetcher);
    const second = await runAndPersist(job, state, fetcher);

    expect(first.notifications).toEqual([]);
    expect(first.metadata).toMatchObject({
      schemaVersion: '2.0',
      decision: 'pending',
      reportReady: false,
      eventType: 'open',
      candidateEventKey: 'open:2026-06-17T02:49:52+08:00',
      candidateOpenCount: 1,
      windowOpen: true,
      action: 'use_remaining_tokens'
    });
    expect(second.notifications).toHaveLength(1);
    expect(second.notifications[0]).toMatchObject({
      title: 'Codex 速蹬窗口已开启',
      dedupeKey: 'codex-radar:window-open:2026-06-17T02:49:52+08:00',
      severity: 'critical',
      metadata: {
        eventType: 'open',
        source: 'https://x.com/thsottiaux/status/2066956441173323943'
      }
    });
    expect(second.notifications[0]?.message).toContain(
      '建议：尽快使用剩余额度'
    );
    expect(second.notifications[0]?.message).toContain(
      '来源：https://x.com/thsottiaux/status/2066956441173323943'
    );

    database.close();
  });

  it('does not notify on prediction-only payloads', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      testConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createFetcher(
      highPredictionPayload('2026-06-17T10:10:00+08:00'),
      highPredictionPayload('2026-06-17T10:20:00+08:00')
    );

    const first = await runAndPersist(job, state, fetcher);
    const second = await runAndPersist(job, state, fetcher);

    expect(first.notifications).toEqual([]);
    expect(second.notifications).toEqual([]);
    expect(second.metadata).toMatchObject({
      decision: 'closed',
      predictionLevel: '高概率',
      probability24h: 0.46,
      probability48h: 55
    });

    database.close();
  });

  it('waits for two complete window confirmations before emitting a close report', async () => {
    const { database, state } = createTestStateStore();
    const config = testConfig({
      CODEX_RADAR_URL: 'https://codexradar.com/current.json',
      CODEX_RADAR_CRON: '*/10 * * * *',
      TELEGRAM_ALLOWED_CHAT_IDS: '123'
    });
    const job = createCodexRadarJob(config);
    const fetcher = createFetcher(
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
      eventType: 'close',
      candidateWindowId: 'window-1',
      candidateOpenCount: 1
    });
    expect(second.notifications).toHaveLength(1);
    expect(second.notifications[0]?.dedupeKey).toBe(
      'codex-radar:window-close:window-1'
    );
    expect(second.notifications[0]?.message).toContain(
      '开启时间：2026-06-03T10:00:00+08:00'
    );
    expect(second.notifications[0]?.message).toContain(
      '关闭时间：2026-06-03T10:05:00+08:00'
    );

    database.close();
  });

  it('reports a direct reset from last_window after two confirmations', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      testConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createFetcher(
      directResetPayload('2026-06-04T08:43:40+08:00'),
      directResetPayload('2026-06-04T08:53:40+08:00')
    );

    const first = await runAndPersist(job, state, fetcher);
    const second = await runAndPersist(job, state, fetcher);

    expect(first.metadata).toMatchObject({
      decision: 'pending',
      eventType: 'close',
      candidateWindowId: 'codex-speed-window-2026-06-04-codex',
      directReset: true
    });
    expect(second.notifications).toHaveLength(1);
    expect(second.notifications[0]).toMatchObject({
      title: 'Codex 使用限制已直接重置',
      dedupeKey: 'codex-radar:window-close:codex-speed-window-2026-06-04-codex',
      severity: 'critical',
      metadata: {
        eventType: 'close',
        directReset: true,
        source: 'https://x.com/thsottiaux/status/2062329981548802523',
        windowMinutes: 0,
        windowHuman: '无窗'
      }
    });
    expect(second.notifications[0]?.message).toContain('无速蹬窗口直接重置');

    database.close();
  });

  it('uses a recent RSS item when JSON has no window candidate', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      testConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createFetcher({
      monitored_at: '2026-06-17T12:00:00+08:00',
      status: 'none',
      window_open: false,
      links: {
        rss: 'https://codexradar.com/feed.xml'
      }
    }).withRss(
      rssFeed({
        guid: 'codex-speed-window-2026-06-17-open',
        title: '速蹬窗口开启：官方 24 小时重置窗口',
        pubDate: 'Wed, 17 Jun 2026 03:59:10 GMT',
        description: '发现有效重置预告，速蹬窗口开启。'
      })
    );

    const result = await runAndPersist(job, state, fetcher);

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]).toMatchObject({
      title: 'Codex 速蹬窗口已开启',
      dedupeKey: 'codex-radar:rss:codex-speed-window-2026-06-17-open',
      severity: 'critical',
      metadata: {
        eventType: 'open',
        guid: 'codex-speed-window-2026-06-17-open',
        feedUrl: 'https://codexradar.com/feed.xml'
      }
    });
    expect(result.notifications[0]?.message).toContain(
      '发现有效重置预告，速蹬窗口开启。'
    );

    database.close();
  });

  it('does not backfill stale RSS items', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      testConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createFetcher({
      monitored_at: '2026-06-17T12:00:00+08:00',
      status: 'none',
      window_open: false
    }).withRss(
      rssFeed({
        guid: 'codex-speed-window-2026-06-04-codex-close',
        title: '速蹬窗口关闭：Codex 可靠性事故补偿重置',
        pubDate: 'Thu, 04 Jun 2026 00:25:58 GMT',
        description: '速蹬窗口已关闭。'
      })
    );

    const result = await runAndPersist(job, state, fetcher);

    expect(result.notifications).toEqual([]);
    expect(result.metadata).toMatchObject({
      rssFeedUrl: 'https://codexradar.com/feed.xml',
      rssGuid: undefined
    });

    database.close();
  });

  it('does not report an open window without opened_at', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      testConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createFetcher({
      monitored_at: '2026-06-17T10:10:00+08:00',
      status: 'open',
      window_open: true,
      window: {
        open: true,
        title: '测试窗口',
        source_url: 'https://example.com/source'
      }
    });

    const result = await runAndPersist(job, state, fetcher);

    expect(result.notifications).toEqual([]);
    expect(result.metadata).toMatchObject({
      decision: 'insufficient',
      reportReady: false,
      windowOpen: true,
      source: 'https://example.com/source'
    });

    database.close();
  });

  it('resets confirmation when the event key changes', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      testConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createFetcher(
      openWindowPayload('2026-06-17T05:33:25+08:00'),
      openWindowPayload('2026-06-17T05:43:25+08:00', {
        openedAt: '2026-06-17T03:49:52+08:00'
      })
    );

    const first = await runAndPersist(job, state, fetcher);
    const second = await runAndPersist(job, state, fetcher);

    expect(first.metadata).toMatchObject({
      candidateEventKey: 'open:2026-06-17T02:49:52+08:00',
      candidateOpenCount: 1
    });
    expect(second.notifications).toEqual([]);
    expect(second.metadata).toMatchObject({
      candidateEventKey: 'open:2026-06-17T03:49:52+08:00',
      candidateOpenCount: 1
    });

    database.close();
  });

  it('ignores last_window while a current window is open', async () => {
    const { database, state } = createTestStateStore();
    const job = createCodexRadarJob(
      testConfig({
        CODEX_RADAR_URL: 'https://codexradar.com/current.json',
        TELEGRAM_ALLOWED_CHAT_IDS: '123'
      })
    );
    const fetcher = createFetcher({
      checked_at: '2026-06-03T10:10:00+08:00',
      status: 'open',
      window_open: true,
      current_window: {
        id: 'current-window',
        state: 'open',
        opened_at: '2026-06-03T10:00:00+08:00'
      },
      last_window: {
        id: 'old-direct-reset',
        status: 'closed',
        opened_at: '2026-06-03T09:00:00+08:00',
        closed_at: '2026-06-03T09:00:00+08:00',
        window_minutes: 0,
        window_human: '无窗'
      }
    });

    const result = await runAndPersist(job, state, fetcher);

    expect(result.notifications).toEqual([]);
    expect(result.metadata).toMatchObject({
      decision: 'pending',
      eventType: 'open',
      candidateWindowId: 'current-window',
      openedAt: '2026-06-03T10:00:00+08:00'
    });

    database.close();
  });

  it('suppresses known bad window ids and sources', async () => {
    const { database, state } = createTestStateStore();
    const config = testConfig({
      CODEX_RADAR_URL: 'https://codexradar.com/current.json',
      TELEGRAM_ALLOWED_CHAT_IDS: '123'
    });
    config.services.codexRadar.suppressedWindowIds.add('window-1');
    config.services.codexRadar.suppressedSources.add(
      'https://example.com/bad-source'
    );
    const job = createCodexRadarJob(config);
    const idFetcher = createFetcher(
      completeWindowPayload('2026-06-03T10:10:00+08:00', 'window-1')
    );
    const sourceFetcher = createFetcher(
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

function testConfig(env: TestEnv) {
  return loadConfig({
    TELEGRAM_BOT_TOKEN: 'token',
    ...env
  });
}

function openWindowPayload(
  monitoredAt: string,
  options: { openedAt?: string } = {}
) {
  return {
    schema_version: '2.0',
    service: 'codex-reset-radar',
    monitored_at: monitoredAt,
    timezone: 'Asia/Shanghai',
    window_open: true,
    status: 'open',
    recommended_action: 'use_remaining_tokens',
    window: {
      open: true,
      status: 'open',
      action: 'use_remaining_tokens',
      message: '当前速蹬窗口开启',
      title: 'Codex 用量限制重置',
      scope: '所有计划',
      opened_at: options.openedAt ?? '2026-06-17T02:49:52+08:00',
      closed_at: null,
      source_url: 'https://x.com/thsottiaux/status/2066956441173323943'
    },
    links: {
      html: 'https://codexradar.com/',
      rss: 'https://codexradar.com/feed.xml'
    }
  };
}

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

function highPredictionPayload(checkedAt: string) {
  return {
    checked_at: checkedAt,
    status: 'none',
    window_open: false,
    message: '预测雷达显示出现强 reset 邻近信号。',
    prediction: {
      level: '高概率',
      probability_24h: 0.46,
      probability_48h: 55,
      expected_window: '未来 48 小时'
    }
  };
}

function directResetPayload(checkedAt: string) {
  return {
    checked_at: checkedAt,
    status: 'none',
    window_open: false,
    message: '暂无正式速蹬窗口',
    current_window: {
      state: 'none',
      message: '当前没有开启的速蹬窗口',
      opened_at: null,
      source: null
    },
    last_window: {
      id: 'codex-speed-window-2026-06-04-codex',
      title: 'Codex 可靠性事故补偿重置',
      status: 'closed',
      opened_at: '2026-06-04T08:25:58+08:00',
      closed_at: '2026-06-04T08:25:58+08:00',
      window_minutes: 0,
      window_human: '无窗',
      scope: '所有付费计划',
      summary:
        'Tibo 表示过去 24 小时内有三次影响 Codex 可靠性的小事故，并已为所有付费计划重置 Codex 使用限制。',
      sources: [
        {
          type: 'window_opened',
          url: null
        },
        {
          type: 'window_closed',
          url: 'https://x.com/thsottiaux/status/2062329981548802523'
        }
      ]
    }
  };
}

function createFetcher(...payloads: unknown[]): FetchService & {
  withRss(xml: string): FetchService;
} {
  let calls = 0;
  let rssXml = rssFeed();
  const fetcher: FetchService & { withRss(xml: string): FetchService } = {
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
      return {
        url: 'https://codexradar.com/feed.xml',
        status: 200,
        headers: new Headers(),
        html: rssXml,
        $: undefined as never
      };
    },
    withRss(xml: string) {
      rssXml = xml;
      return fetcher;
    }
  };

  return fetcher;
}

function rssFeed(item?: {
  guid: string;
  title: string;
  pubDate: string;
  description: string;
  link?: string;
}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Codex 雷达</title>
    <link>https://codexradar.com/</link>
    <description>只发布 Codex 速蹬窗口开启和关闭提醒。</description>
    ${
      item
        ? `<item>
      <title>${item.title}</title>
      <link>${item.link ?? 'https://codexradar.com/'}</link>
      <guid isPermaLink="false">${item.guid}</guid>
      <pubDate>${item.pubDate}</pubDate>
      <description><![CDATA[${item.description}]]></description>
    </item>`
        : ''
    }
  </channel>
</rss>`;
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
