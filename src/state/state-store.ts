import { and, desc, eq, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type * as schema from '../db/schema.js';
import {
  dedupeKeys,
  failureCounters,
  jobRuns,
  notificationDeliveries,
  taskStates
} from '../db/schema.js';
import type { NotificationEnvelope } from '../types.js';

export type JobRunStatus = 'success' | 'failed' | 'skipped';
export type DeliveryStatus = 'sent' | 'failed' | 'skipped_duplicate';

export interface RecordJobRunInput {
  jobId: string;
  status: JobRunStatus;
  startedAt: Date;
  finishedAt: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface RecentJobRun {
  jobId: string;
  status: JobRunStatus;
  startedAt: string;
  finishedAt: string;
  error: string | null;
}

export interface TaskState {
  jobId: string;
  lastStatus: JobRunStatus;
  lastRunAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface FailureCounter {
  jobId: string;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastError: string | null;
  alertSentAt: string | null;
}

export interface RetentionResult {
  deletedJobRuns: number;
  deletedNotificationDeliveries: number;
}

export class StateStore {
  constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly sqlite: Database.Database
  ) {}

  async hasDedupeKey(key: string, destination: string): Promise<boolean> {
    const row = this.db
      .select({ key: dedupeKeys.key })
      .from(dedupeKeys)
      .where(
        and(eq(dedupeKeys.key, key), eq(dedupeKeys.destination, destination))
      )
      .limit(1)
      .get();

    return Boolean(row);
  }

  async markDedupeKey(
    jobId: string,
    envelope: NotificationEnvelope,
    now = new Date()
  ): Promise<void> {
    const nowIso = now.toISOString();

    this.db
      .insert(dedupeKeys)
      .values({
        key: envelope.dedupeKey,
        jobId,
        destination: envelope.destination,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        metadataJson: stringifyMetadata(envelope.metadata)
      })
      .onConflictDoUpdate({
        target: dedupeKeys.key,
        set: {
          lastSeenAt: nowIso,
          metadataJson: stringifyMetadata(envelope.metadata)
        }
      })
      .run();
  }

  async recordNotificationDelivery(input: {
    jobId: string;
    envelope: NotificationEnvelope;
    status: DeliveryStatus;
    sentAt?: Date;
    error?: string;
  }): Promise<void> {
    this.db
      .insert(notificationDeliveries)
      .values({
        jobId: input.jobId,
        dedupeKey: input.envelope.dedupeKey,
        destination: input.envelope.destination,
        title: input.envelope.title,
        status: input.status,
        sentAt: (input.sentAt ?? new Date()).toISOString(),
        error: input.error,
        metadataJson: stringifyMetadata(input.envelope.metadata)
      })
      .onConflictDoNothing()
      .run();
  }

  async recordJobRun(input: RecordJobRunInput): Promise<void> {
    const metadataJson = stringifyMetadata(input.metadata);

    this.db
      .insert(jobRuns)
      .values({
        jobId: input.jobId,
        status: input.status,
        startedAt: input.startedAt.toISOString(),
        finishedAt: input.finishedAt.toISOString(),
        error: input.error,
        metadataJson
      })
      .run();

    const finishedAt = input.finishedAt.toISOString();
    const lastSuccessAt = input.status === 'success' ? finishedAt : undefined;
    const lastFailureAt = input.status === 'failed' ? finishedAt : undefined;
    const updateSet = {
      lastStatus: input.status,
      lastRunAt: finishedAt,
      ...(input.status === 'success' ? { lastSuccessAt: finishedAt } : {}),
      ...(input.status === 'failed' ? { lastFailureAt: finishedAt } : {}),
      metadataJson
    };

    this.db
      .insert(taskStates)
      .values({
        jobId: input.jobId,
        lastStatus: input.status,
        lastRunAt: finishedAt,
        lastSuccessAt,
        lastFailureAt,
        metadataJson
      })
      .onConflictDoUpdate({
        target: taskStates.jobId,
        set: updateSet
      })
      .run();
  }

  async incrementFailure(
    jobId: string,
    error: string,
    now = new Date()
  ): Promise<FailureCounter> {
    const nowIso = now.toISOString();
    const existing = await this.getFailureCounter(jobId);
    const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;

    this.db
      .insert(failureCounters)
      .values({
        jobId,
        consecutiveFailures,
        lastFailureAt: nowIso,
        lastError: error,
        alertSentAt: existing?.alertSentAt ?? null,
        updatedAt: nowIso
      })
      .onConflictDoUpdate({
        target: failureCounters.jobId,
        set: {
          consecutiveFailures,
          lastFailureAt: nowIso,
          lastError: error,
          updatedAt: nowIso
        }
      })
      .run();

    return {
      jobId,
      consecutiveFailures,
      lastFailureAt: nowIso,
      lastError: error,
      alertSentAt: existing?.alertSentAt ?? null
    };
  }

  async markFailureAlertSent(jobId: string, now = new Date()): Promise<void> {
    this.db
      .update(failureCounters)
      .set({
        alertSentAt: now.toISOString(),
        updatedAt: now.toISOString()
      })
      .where(eq(failureCounters.jobId, jobId))
      .run();
  }

  async resetFailure(jobId: string): Promise<void> {
    this.db
      .delete(failureCounters)
      .where(eq(failureCounters.jobId, jobId))
      .run();
  }

  async getFailureCounter(jobId: string): Promise<FailureCounter | null> {
    const row = this.db
      .select()
      .from(failureCounters)
      .where(eq(failureCounters.jobId, jobId))
      .limit(1)
      .get();

    if (!row) {
      return null;
    }

    return {
      jobId: row.jobId,
      consecutiveFailures: row.consecutiveFailures,
      lastFailureAt: row.lastFailureAt,
      lastError: row.lastError,
      alertSentAt: row.alertSentAt
    };
  }

  async getRecentRuns(limit = 10): Promise<RecentJobRun[]> {
    return this.db
      .select({
        jobId: jobRuns.jobId,
        status: jobRuns.status,
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
        error: jobRuns.error
      })
      .from(jobRuns)
      .orderBy(desc(jobRuns.startedAt))
      .limit(limit)
      .all();
  }

  async getTaskStates(): Promise<TaskState[]> {
    return this.db
      .select()
      .from(taskStates)
      .all()
      .map((row) => ({
        jobId: row.jobId,
        lastStatus: row.lastStatus,
        lastRunAt: row.lastRunAt,
        lastSuccessAt: row.lastSuccessAt,
        lastFailureAt: row.lastFailureAt,
        metadata: parseMetadata(row.metadataJson)
      }));
  }

  async cleanupHistory(
    retentionDays: number,
    now = new Date()
  ): Promise<RetentionResult> {
    const cutoff = new Date(
      now.getTime() - retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const deletedJobRuns = this.db
      .delete(jobRuns)
      .where(lt(jobRuns.finishedAt, cutoff))
      .run().changes;
    const deletedNotificationDeliveries = this.db
      .delete(notificationDeliveries)
      .where(lt(notificationDeliveries.sentAt, cutoff))
      .run().changes;

    return {
      deletedJobRuns,
      deletedNotificationDeliveries
    };
  }

  async vacuum(): Promise<void> {
    this.sqlite.exec('PRAGMA optimize;');
    this.sqlite.exec('VACUUM;');
  }
}

function stringifyMetadata(
  metadata: Record<string, unknown> | undefined
): string | undefined {
  return metadata ? JSON.stringify(metadata) : undefined;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
