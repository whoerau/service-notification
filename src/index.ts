import 'dotenv/config';
import { openDatabase } from './db/database.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { HttpFetchService } from './fetch/fetch-service.js';
import { HealthServer } from './health/health-server.js';
import { JobRunner } from './jobs/job-runner.js';
import { createJobs } from './jobs/index.js';
import { SchedulerService } from './jobs/scheduler-service.js';
import { NoopTelegramNotifier } from './notifications/noop-notifier.js';
import { NotificationRouter } from './notifications/notification-router.js';
import { StateStore } from './state/state-store.js';
import { RetentionService } from './state/retention-service.js';
import { TelegramService } from './telegram/telegram-service.js';
import type { Notifier } from './types.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const database = openDatabase(config.database.path);
  const state = new StateStore(database.db, database.sqlite);
  const fetcher = new HttpFetchService();
  const jobs = createJobs(config);

  let scheduler: SchedulerService | null = null;
  let telegram: TelegramService | null = null;
  const notifiers: Notifier[] = [];

  if (config.telegram.botToken) {
    telegram = new TelegramService({
      botToken: config.telegram.botToken,
      allowedChatIds: config.telegram.allowedChatIds,
      state,
      getJobStatuses: () => scheduler?.statuses() ?? [],
      logger
    });
    notifiers.push(telegram);
  } else {
    notifiers.push(new NoopTelegramNotifier(logger));
  }

  const notificationRouter = new NotificationRouter(notifiers, state, logger);
  const runner = new JobRunner(fetcher, state, notificationRouter, logger, {
    failureAlertThreshold: config.scheduler.failureAlertThreshold
  });
  scheduler = new SchedulerService(jobs, runner, logger);
  const retention = new RetentionService(
    state,
    logger,
    config.scheduler.historyRetentionDays,
    config.scheduler.timezone
  );
  const health = new HealthServer(config.health.port, logger, () => true);

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'shutdown requested');
    scheduler?.stop();
    retention.stop();
    await telegram?.stop();
    await health.stop();
    database.close();
    process.exit(0);
  };

  process.once('SIGINT', (signal) => {
    void shutdown(signal);
  });
  process.once('SIGTERM', (signal) => {
    void shutdown(signal);
  });

  await health.start();
  telegram?.start();
  scheduler.start();
  retention.start();
  await retention.run();

  logger.info(
    { jobs: jobs.map((job) => job.id) },
    'service-notification started'
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
