import type { Logger } from 'pino';
import type { NotificationEnvelope, Notifier } from '../types.js';

export class NoopTelegramNotifier implements Notifier {
  readonly destination = 'telegram' as const;

  constructor(private readonly logger: Logger) {}

  async send(envelope: NotificationEnvelope): Promise<void> {
    this.logger.warn(
      { title: envelope.title, dedupeKey: envelope.dedupeKey },
      'telegram notification skipped because TELEGRAM_BOT_TOKEN is not configured'
    );
  }
}
