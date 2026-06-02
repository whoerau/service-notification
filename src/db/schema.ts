import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';

export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id').notNull(),
    status: text('status', {
      enum: ['success', 'failed', 'skipped']
    }).notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at').notNull(),
    error: text('error'),
    metadataJson: text('metadata_json')
  },
  (table) => ({
    jobIdStartedAtIdx: index('job_runs_job_id_started_at_idx').on(
      table.jobId,
      table.startedAt
    )
  })
);

export const dedupeKeys = sqliteTable(
  'dedupe_keys',
  {
    key: text('key').primaryKey(),
    jobId: text('job_id').notNull(),
    destination: text('destination').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    metadataJson: text('metadata_json')
  },
  (table) => ({
    jobDestinationIdx: index('dedupe_keys_job_destination_idx').on(
      table.jobId,
      table.destination
    )
  })
);

export const notificationDeliveries = sqliteTable(
  'notification_deliveries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    destination: text('destination').notNull(),
    title: text('title').notNull(),
    status: text('status', {
      enum: ['sent', 'failed', 'skipped_duplicate']
    }).notNull(),
    sentAt: text('sent_at').notNull(),
    error: text('error'),
    metadataJson: text('metadata_json')
  },
  (table) => ({
    dedupeDestinationUnique: uniqueIndex(
      'notification_deliveries_dedupe_destination_unique'
    ).on(table.dedupeKey, table.destination),
    jobSentAtIdx: index('notification_deliveries_job_sent_at_idx').on(
      table.jobId,
      table.sentAt
    )
  })
);

export const failureCounters = sqliteTable('failure_counters', {
  jobId: text('job_id').primaryKey(),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastFailureAt: text('last_failure_at'),
  lastError: text('last_error'),
  alertSentAt: text('alert_sent_at'),
  updatedAt: text('updated_at').notNull()
});

export const taskStates = sqliteTable('task_states', {
  jobId: text('job_id').primaryKey(),
  lastStatus: text('last_status', {
    enum: ['success', 'failed', 'skipped']
  }).notNull(),
  lastRunAt: text('last_run_at').notNull(),
  lastSuccessAt: text('last_success_at'),
  lastFailureAt: text('last_failure_at'),
  metadataJson: text('metadata_json')
});
