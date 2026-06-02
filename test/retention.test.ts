import { describe, expect, it } from 'vitest';
import { createTestStateStore } from './helpers.js';

describe('StateStore retention', () => {
  it('removes old history but keeps dedupe keys', async () => {
    const { database, state } = createTestStateStore();
    const old = new Date('2026-04-01T00:00:00.000Z');
    const now = new Date('2026-06-02T00:00:00.000Z');
    const envelope = {
      destination: 'telegram' as const,
      title: 'test',
      message: 'test',
      dedupeKey: 'dedupe-key',
      severity: 'info' as const
    };

    await state.recordJobRun({
      jobId: 'job',
      status: 'success',
      startedAt: old,
      finishedAt: old
    });
    await state.markDedupeKey('job', envelope, old);
    await state.recordNotificationDelivery({
      jobId: 'job',
      envelope,
      status: 'sent',
      sentAt: old
    });

    const result = await state.cleanupHistory(30, now);
    const runs = await state.getRecentRuns();

    expect(result.deletedJobRuns).toBe(1);
    expect(result.deletedNotificationDeliveries).toBe(1);
    expect(runs).toHaveLength(0);
    await expect(state.hasDedupeKey('dedupe-key', 'telegram')).resolves.toBe(
      true
    );
    database.close();
  });
});
