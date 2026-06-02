import type { Logger } from 'pino';
import type { StateStore } from '../state/state-store.js';
import type { NotificationEnvelope, Notifier } from '../types.js';

export class NotificationRouter {
  private readonly notifiers: Map<string, Notifier>;

  constructor(
    notifiers: Notifier[],
    private readonly state: StateStore,
    private readonly logger: Logger
  ) {
    this.notifiers = new Map(
      notifiers.map((notifier) => [notifier.destination, notifier])
    );
  }

  async send(jobId: string, envelope: NotificationEnvelope): Promise<boolean> {
    const notifier = this.notifiers.get(envelope.destination);

    if (!notifier) {
      throw new Error(
        `No notifier configured for destination: ${envelope.destination}`
      );
    }

    if (
      await this.state.hasDedupeKey(envelope.dedupeKey, envelope.destination)
    ) {
      await this.state.recordNotificationDelivery({
        jobId,
        envelope,
        status: 'skipped_duplicate'
      });
      this.logger.debug(
        { jobId, dedupeKey: envelope.dedupeKey },
        'notification skipped duplicate'
      );
      return false;
    }

    try {
      await notifier.send(envelope);
      await this.state.markDedupeKey(jobId, envelope);
      await this.state.recordNotificationDelivery({
        jobId,
        envelope,
        status: 'sent'
      });
      this.logger.info(
        { jobId, dedupeKey: envelope.dedupeKey },
        'notification sent'
      );
      return true;
    } catch (error) {
      await this.state.recordNotificationDelivery({
        jobId,
        envelope,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
