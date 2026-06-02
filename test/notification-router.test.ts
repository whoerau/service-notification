import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import { NotificationRouter } from '../src/notifications/notification-router.js';
import type { NotificationEnvelope, Notifier } from '../src/types.js';
import { createTestStateStore } from './helpers.js';

describe('NotificationRouter', () => {
  it('sends the same dedupe key only once', async () => {
    const { database, state } = createTestStateStore();
    const sent: NotificationEnvelope[] = [];
    const notifier: Notifier = {
      destination: 'telegram',
      async send(envelope) {
        sent.push(envelope);
      }
    };
    const router = new NotificationRouter([notifier], state, fakeLogger());
    const envelope: NotificationEnvelope = {
      destination: 'telegram',
      title: 'Codex 速蹬窗口已开启',
      message: 'opened',
      dedupeKey: 'codex-radar:window-open:test',
      severity: 'critical'
    };

    await router.send('codex-radar', envelope);
    await router.send('codex-radar', envelope);

    expect(sent).toHaveLength(1);
    database.close();
  });
});

function fakeLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return fakeLogger();
    }
  } as unknown as Logger;
}
