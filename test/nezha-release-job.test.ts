import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createNezhaReleaseJob } from '../src/services/nezha-release/job.js';
import type { FetchService } from '../src/fetch/fetch-service.js';
import type { JobDefinition, JobResult } from '../src/types.js';
import { createTestStateStore } from './helpers.js';

type TestEnv = Parameters<typeof loadConfig>[0];

describe('createNezhaReleaseJob', () => {
  it('does not notify when latest stable release is the baseline tag', async () => {
    const { database, state } = createTestStateStore();
    const job = createNezhaReleaseJob(testConfig());

    const result = await runAndPersist(
      job,
      state,
      createFetcher(releasePayload('v2.2.6'))
    );

    expect(job.schedule).toBe('0 */12 * * *');
    expect(result.notifications).toEqual([]);
    expect(result.metadata).toMatchObject({
      baselineTag: 'v2.2.6',
      latestTag: 'v2.2.6',
      previousTag: 'v2.2.6',
      decision: 'current'
    });

    database.close();
  });

  it('notifies on the first run when latest stable release is newer than v2.2.6', async () => {
    const { database, state } = createTestStateStore();
    const job = createNezhaReleaseJob(testConfig());

    const result = await runAndPersist(
      job,
      state,
      createFetcher(
        releasePayload('v2.2.7', {
          body: [
            '修复 Agent 上报问题。',
            '',
            '**Full Changelog**: https://github.com/nezhahq/nezha/compare/v2.2.6...v2.2.7'
          ].join('\n')
        })
      )
    );

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]).toMatchObject({
      title: 'Nezha 发布新版本 v2.2.7',
      dedupeKey: 'nezha-release:v2.2.7',
      severity: 'info',
      metadata: {
        tagName: 'v2.2.7',
        previousTag: 'v2.2.6',
        htmlUrl: 'https://github.com/nezhahq/nezha/releases/tag/v2.2.7'
      }
    });
    expect(result.notifications[0]?.message).toContain('版本：v2.2.7');
    expect(result.notifications[0]?.message).toContain(
      '发布时间：2026-06-21T11:08:23Z'
    );
    expect(result.notifications[0]?.message).toContain('修复 Agent 上报问题。');
    expect(result.metadata).toMatchObject({
      latestTag: 'v2.2.7',
      previousTag: 'v2.2.6',
      decision: 'notify'
    });

    database.close();
  });

  it('does not notify repeatedly for the same latest tag after state is persisted', async () => {
    const { database, state } = createTestStateStore();
    const job = createNezhaReleaseJob(testConfig());
    const fetcher = createFetcher(
      releasePayload('v2.2.7'),
      releasePayload('v2.2.7')
    );

    const first = await runAndPersist(job, state, fetcher);
    const second = await runAndPersist(job, state, fetcher);

    expect(first.notifications).toHaveLength(1);
    expect(second.notifications).toEqual([]);
    expect(second.metadata).toMatchObject({
      latestTag: 'v2.2.7',
      previousTag: 'v2.2.7',
      decision: 'current'
    });

    database.close();
  });

  it('does not notify after restart when the database already recorded the latest tag', async () => {
    const { database, state } = createTestStateStore();
    const job = createNezhaReleaseJob(testConfig());

    await state.recordJobRun({
      jobId: 'nezha-release',
      status: 'success',
      startedAt: new Date('2026-06-21T00:00:00.000Z'),
      finishedAt: new Date('2026-06-21T00:00:00.000Z'),
      metadata: {
        latestTag: 'v2.2.7'
      }
    });

    const result = await runAndPersist(
      job,
      state,
      createFetcher(releasePayload('v2.2.7'))
    );

    expect(result.notifications).toEqual([]);
    expect(result.metadata).toMatchObject({
      latestTag: 'v2.2.7',
      previousTag: 'v2.2.7',
      decision: 'current'
    });

    database.close();
  });

  it('does not notify for draft or prerelease payloads', async () => {
    const { database, state } = createTestStateStore();
    const job = createNezhaReleaseJob(testConfig());
    const fetcher = createFetcher(
      releasePayload('v2.2.7-beta.1', { prerelease: true }),
      releasePayload('v2.2.7', { draft: true })
    );

    const prerelease = await runAndPersist(job, state, fetcher);
    const draft = await runAndPersist(job, state, fetcher);

    expect(prerelease.notifications).toEqual([]);
    expect(prerelease.metadata).toMatchObject({
      ignoredTag: 'v2.2.7-beta.1',
      decision: 'ignored',
      ignoredReason: 'prerelease'
    });
    expect(draft.notifications).toEqual([]);
    expect(draft.metadata).toMatchObject({
      ignoredTag: 'v2.2.7',
      decision: 'ignored',
      ignoredReason: 'draft'
    });

    database.close();
  });
});

function testConfig(env: TestEnv = {}) {
  return loadConfig({
    TELEGRAM_BOT_TOKEN: 'token',
    TELEGRAM_ALLOWED_CHAT_IDS: '123',
    ...env
  });
}

function releasePayload(
  tagName: string,
  options: { body?: string; draft?: boolean; prerelease?: boolean } = {}
) {
  return {
    tag_name: tagName,
    name: tagName,
    html_url: `https://github.com/nezhahq/nezha/releases/tag/${tagName}`,
    published_at: '2026-06-21T11:08:23Z',
    body: options.body ?? '**Full Changelog**: https://example.com/compare',
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false
  };
}

function createFetcher(...payloads: unknown[]): FetchService {
  let calls = 0;

  return {
    async json() {
      const data = payloads[Math.min(calls, payloads.length - 1)];
      calls += 1;

      return {
        url: 'https://api.github.com/repos/nezhahq/nezha/releases/latest',
        status: 200,
        headers: new Headers(),
        data
      };
    },
    async html() {
      throw new Error('Nezha release job should not fetch HTML');
    }
  };
}

async function runAndPersist(
  job: JobDefinition,
  state: ReturnType<typeof createTestStateStore>['state'],
  fetcher: FetchService
): Promise<JobResult> {
  const now = new Date('2026-06-21T12:00:00.000Z');
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
