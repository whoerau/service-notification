import type { Logger } from 'pino';
import type { FetchService } from './fetch/fetch-service.js';
import type { StateStore } from './state/state-store.js';

export type NotificationDestination = 'telegram';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface NotificationEnvelope {
  destination: NotificationDestination;
  title: string;
  message: string;
  dedupeKey: string;
  severity: NotificationSeverity;
  metadata?: Record<string, unknown>;
}

export interface JobResult {
  ok: boolean;
  notifications: NotificationEnvelope[];
  metadata?: Record<string, unknown>;
}

export interface JobContext {
  fetcher: FetchService;
  state: StateStore;
  logger: Logger;
  signal: AbortSignal;
}

export interface JobDefinition {
  id: string;
  name: string;
  schedule: string;
  timezone: string;
  timeoutMs: number;
  run(context: JobContext): Promise<JobResult>;
}

export interface Notifier {
  destination: NotificationDestination;
  send(envelope: NotificationEnvelope): Promise<void>;
}

export interface RegisteredJobStatus {
  id: string;
  name: string;
  schedule: string;
  timezone: string;
  running: boolean;
}
