import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { Logger } from 'pino';
import type { JobDefinition, RegisteredJobStatus } from '../types.js';
import type { JobRunner } from './job-runner.js';

export class SchedulerService {
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly running = new Set<string>();

  constructor(
    private readonly jobs: JobDefinition[],
    private readonly runner: JobRunner,
    private readonly logger: Logger
  ) {}

  start(): void {
    for (const job of this.jobs) {
      const task = cron.schedule(
        job.schedule,
        () => {
          void this.runJob(job);
        },
        {
          timezone: job.timezone
        }
      );

      this.tasks.set(job.id, task);
      this.logger.info(
        { jobId: job.id, schedule: job.schedule, timezone: job.timezone },
        'job scheduled'
      );
    }
  }

  async runNow(jobId: string): Promise<void> {
    const job = this.jobs.find((candidate) => candidate.id === jobId);

    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }

    await this.runJob(job);
  }

  stop(): void {
    for (const task of this.tasks.values()) {
      void task.stop();
    }

    this.tasks.clear();
  }

  statuses(): RegisteredJobStatus[] {
    return this.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      schedule: job.schedule,
      timezone: job.timezone,
      running: this.running.has(job.id)
    }));
  }

  private async runJob(job: JobDefinition): Promise<void> {
    if (this.running.has(job.id)) {
      await this.runner.recordSkipped(job, 'previous run still active');
      this.logger.warn(
        { jobId: job.id },
        'job skipped because previous run is still active'
      );
      return;
    }

    this.running.add(job.id);

    try {
      await this.runner.run(job);
    } finally {
      this.running.delete(job.id);
    }
  }
}
