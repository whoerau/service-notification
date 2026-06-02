import type { Logger } from 'pino';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { StateStore } from './state-store.js';

export class RetentionService {
  private task: ScheduledTask | null = null;

  constructor(
    private readonly state: StateStore,
    private readonly logger: Logger,
    private readonly retentionDays: number,
    private readonly timezone: string
  ) {}

  start(): void {
    this.task = cron.schedule(
      '17 3 * * *',
      () => {
        void this.run();
      },
      {
        timezone: this.timezone
      }
    );
  }

  async run(now = new Date()): Promise<void> {
    const result = await this.state.cleanupHistory(this.retentionDays, now);

    if (result.deletedJobRuns > 0 || result.deletedNotificationDeliveries > 0) {
      await this.state.vacuum();
    }

    this.logger.info(
      { result, retentionDays: this.retentionDays },
      'retention cleanup finished'
    );
  }

  stop(): void {
    void this.task?.stop();
    this.task = null;
  }
}
