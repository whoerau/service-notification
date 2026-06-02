import type { Logger } from 'pino';
import type { FetchService } from '../fetch/fetch-service.js';
import type { NotificationRouter } from '../notifications/notification-router.js';
import type { StateStore } from '../state/state-store.js';
import type { JobDefinition, NotificationEnvelope } from '../types.js';

export interface JobRunnerOptions {
  failureAlertThreshold: number;
}

export class JobRunner {
  constructor(
    private readonly fetcher: FetchService,
    private readonly state: StateStore,
    private readonly notifications: NotificationRouter,
    private readonly logger: Logger,
    private readonly options: JobRunnerOptions
  ) {}

  async run(job: JobDefinition, signal?: AbortSignal): Promise<void> {
    const startedAt = new Date();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), job.timeoutMs);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), {
        once: true
      });
    }

    try {
      const result = await job.run({
        fetcher: this.fetcher,
        state: this.state,
        logger: this.logger.child({ jobId: job.id }),
        signal: controller.signal
      });

      for (const envelope of result.notifications) {
        await this.notifications.send(job.id, envelope);
      }

      await this.state.recordJobRun({
        jobId: job.id,
        status: 'success',
        startedAt,
        finishedAt: new Date(),
        metadata: result.metadata
      });
      await this.state.resetFailure(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const counter = await this.state.incrementFailure(job.id, message);

      await this.state.recordJobRun({
        jobId: job.id,
        status: 'failed',
        startedAt,
        finishedAt: new Date(),
        error: message
      });

      if (
        counter.consecutiveFailures >= this.options.failureAlertThreshold &&
        counter.alertSentAt === null
      ) {
        const alert = createFailureAlert(
          job,
          counter.consecutiveFailures,
          message,
          counter.lastFailureAt ?? new Date().toISOString()
        );
        await this.notifications.send(job.id, alert);
        await this.state.markFailureAlertSent(job.id);
      }

      this.logger.warn(
        {
          jobId: job.id,
          error: message,
          consecutiveFailures: counter.consecutiveFailures
        },
        'job failed'
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async recordSkipped(job: JobDefinition, reason: string): Promise<void> {
    const now = new Date();

    await this.state.recordJobRun({
      jobId: job.id,
      status: 'skipped',
      startedAt: now,
      finishedAt: now,
      error: reason
    });
  }
}

function createFailureAlert(
  job: JobDefinition,
  consecutiveFailures: number,
  error: string,
  alertCycleKey: string
): NotificationEnvelope {
  return {
    destination: 'telegram',
    title: `任务连续失败：${job.name}`,
    message: [
      `任务 ${job.name} 已连续失败 ${consecutiveFailures} 次。`,
      '',
      `错误：${error}`,
      '',
      '后续同一失败周期不会重复告警，任务恢复成功后会重置失败计数。'
    ].join('\n'),
    dedupeKey: `job-failure:${job.id}:${alertCycleKey}`,
    severity: 'warning',
    metadata: {
      jobId: job.id,
      consecutiveFailures
    }
  };
}
