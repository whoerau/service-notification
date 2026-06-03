import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { JobDefinition, NotificationEnvelope } from '../types.js';

const windowSchema = z
  .object({
    id: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    opened_at: z.string().optional().nullable(),
    closed_at: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    scope: z.string().optional().nullable(),
    summary: z.string().optional().nullable(),
    message: z.string().optional().nullable()
  })
  .passthrough();

const codexRadarSchema = z
  .object({
    schema_version: z.string().optional(),
    checked_at: z.string().optional(),
    monitored_at: z.string().optional(),
    status: z.string().optional(),
    window_open: z.boolean().optional(),
    message: z.string().optional(),
    current_window: windowSchema.optional(),
    last_window: windowSchema.optional(),
    prediction: z
      .object({
        level: z.string().optional(),
        probability_24h: z.number().optional(),
        probability_48h: z.number().optional(),
        expected_window: z.string().optional(),
        should_notify: z.boolean().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

type CodexRadarResponse = z.infer<typeof codexRadarSchema>;
type CodexRadarWindow = NonNullable<CodexRadarResponse['current_window']>;
type CodexRadarDecision =
  | 'closed'
  | 'pending'
  | 'confirmed'
  | 'suppressed'
  | 'insufficient';

const candidateMetadataSchema = z
  .object({
    candidateWindowId: z.string().optional(),
    candidateSource: z.string().optional(),
    candidateOpenCount: z.number().int().nonnegative().optional(),
    candidateFirstSeenAt: z.string().optional(),
    candidateLastSeenAt: z.string().optional()
  })
  .passthrough();

interface CodexRadarEvaluation {
  decision: CodexRadarDecision;
  reportReady: boolean;
  notification?: NotificationEnvelope;
  candidateWindowId?: string;
  candidateSource?: string;
  candidateOpenCount?: number;
  candidateFirstSeenAt?: string;
  candidateLastSeenAt?: string;
  openedAt?: string;
  closedAt?: string;
  source?: string;
  suppressionReason?: 'window_id' | 'source';
}

export function createCodexRadarJob(config: AppConfig): JobDefinition {
  const id = 'codex-radar';

  return {
    id,
    name: 'CodexRadar 速蹬窗口监控',
    schedule: config.jobs.codexRadar.cron,
    timezone: config.scheduler.timezone,
    timeoutMs: 30_000,
    async run({ fetcher, state, signal }) {
      const response = await fetcher.json<unknown>(config.jobs.codexRadar.url, {
        timeoutMs: 20_000,
        signal
      });
      const data = codexRadarSchema.parse(response.data);
      const previousState = await state.getTaskState(id);
      const evaluation = evaluateCodexRadarWindow(
        data,
        response.url,
        config,
        previousState?.metadata
      );

      return {
        ok: true,
        notifications: evaluation.notification ? [evaluation.notification] : [],
        metadata: {
          checkedAt: data.checked_at ?? data.monitored_at,
          status: data.status,
          windowOpen: isWindowCurrentlyOpen(data),
          decision: evaluation.decision,
          reportReady: evaluation.reportReady,
          candidateWindowId: evaluation.candidateWindowId,
          candidateSource: evaluation.candidateSource,
          candidateOpenCount: evaluation.candidateOpenCount,
          candidateFirstSeenAt: evaluation.candidateFirstSeenAt,
          candidateLastSeenAt: evaluation.candidateLastSeenAt,
          openedAt: evaluation.openedAt,
          closedAt: evaluation.closedAt,
          source: evaluation.source,
          suppressionReason: evaluation.suppressionReason,
          message: data.message,
          predictionLevel: data.prediction?.level,
          probability24h: data.prediction?.probability_24h,
          probability48h: data.prediction?.probability_48h
        }
      };
    }
  };
}

function evaluateCodexRadarWindow(
  data: CodexRadarResponse,
  sourceUrl: string,
  config: AppConfig,
  previousMetadata?: Record<string, unknown> | null
): CodexRadarEvaluation {
  const current = data.current_window;

  if (!current) {
    return {
      decision: data.window_open === false ? 'closed' : 'insufficient',
      reportReady: false
    };
  }

  const windowId = stableWindowId(current);
  const source = textOrUndefined(current.source);
  const suppressionReason = suppressionReasonFor(windowId, source, config);

  if (suppressionReason) {
    return {
      decision: 'suppressed',
      reportReady: false,
      candidateWindowId: windowId,
      candidateSource: source,
      candidateOpenCount: 0,
      openedAt: textOrUndefined(current.opened_at),
      closedAt: textOrUndefined(current.closed_at),
      source,
      suppressionReason
    };
  }

  const openedAt = textOrUndefined(current.opened_at);
  const closedAt = textOrUndefined(current.closed_at);

  if (!openedAt || !closedAt) {
    return {
      decision: isExplicitlyClosed(data, current) ? 'closed' : 'insufficient',
      reportReady: false,
      openedAt,
      closedAt,
      source
    };
  }

  const observedAt =
    data.checked_at ?? data.monitored_at ?? new Date().toISOString();
  const previous = parseCandidateMetadata(previousMetadata);
  const sameWindow = previous.candidateWindowId === windowId;
  const candidateOpenCount =
    (sameWindow ? (previous.candidateOpenCount ?? 0) : 0) + 1;
  const candidateFirstSeenAt =
    sameWindow && previous.candidateFirstSeenAt
      ? previous.candidateFirstSeenAt
      : observedAt;
  const candidateLastSeenAt = observedAt;
  const reportReady =
    candidateOpenCount >= config.jobs.codexRadar.openConfirmations;
  const decision: CodexRadarDecision = reportReady ? 'confirmed' : 'pending';

  return {
    decision,
    reportReady,
    notification: reportReady
      ? createCompletedWindowNotification(data, current, sourceUrl, windowId)
      : undefined,
    candidateWindowId: windowId,
    candidateSource: source,
    candidateOpenCount,
    candidateFirstSeenAt,
    candidateLastSeenAt,
    openedAt,
    closedAt,
    source
  };
}

function isWindowCurrentlyOpen(data: CodexRadarResponse): boolean {
  return (
    data.window_open === true ||
    isOpenValue(data.status) ||
    isOpenValue(data.current_window?.state) ||
    isOpenValue(data.current_window?.status)
  );
}

function isExplicitlyClosed(
  data: CodexRadarResponse,
  current?: CodexRadarWindow
): boolean {
  return (
    data.window_open === false ||
    isClosedValue(data.status) ||
    isClosedValue(current?.state) ||
    isClosedValue(current?.status)
  );
}

function createCompletedWindowNotification(
  data: CodexRadarResponse,
  window: CodexRadarWindow,
  sourceUrl: string,
  windowId: string
): NotificationEnvelope {
  const title = textOrUndefined(window.title) ?? 'Codex 速蹬窗口记录已确认';
  const openedAt = textOrUndefined(window.opened_at);
  const closedAt = textOrUndefined(window.closed_at);
  const source = textOrUndefined(window.source) ?? sourceUrl;
  const summary = textOrUndefined(window.summary) ?? data.message;
  const scope = textOrUndefined(window.scope);

  if (!openedAt || !closedAt) {
    throw new Error(
      'Cannot report CodexRadar window without opened_at and closed_at'
    );
  }

  const lines = [
    'CodexRadar 检测到一条已完成的速蹬窗口记录。',
    '',
    `窗口：${title}`,
    `开启时间：${openedAt}`,
    `关闭时间：${closedAt}`,
    scope ? `范围：${scope}` : null,
    summary ? `说明：${summary}` : null,
    source ? `来源：${source}` : null,
    '',
    `状态接口：${sourceUrl}`
  ].filter((line): line is string => Boolean(line));

  return {
    destination: 'telegram',
    title: 'Codex 速蹬窗口记录已确认',
    message: lines.join('\n'),
    dedupeKey: `codex-radar:window-report:${windowId}`,
    severity: 'critical',
    metadata: {
      windowId,
      openedAt,
      closedAt,
      source,
      checkedAt: data.checked_at ?? data.monitored_at
    }
  };
}

function stableWindowId(window: CodexRadarWindow): string {
  const openedAt = textOrUndefined(window.opened_at);
  const closedAt = textOrUndefined(window.closed_at);

  return (
    textOrUndefined(window.id) ??
    (openedAt && closedAt ? `${openedAt}:${closedAt}` : undefined) ??
    openedAt ??
    textOrUndefined(window.source) ??
    textOrUndefined(window.title) ??
    'unknown'
  );
}

function suppressionReasonFor(
  windowId: string,
  source: string | undefined,
  config: AppConfig
): 'window_id' | 'source' | undefined {
  if (config.jobs.codexRadar.suppressedWindowIds.has(windowId)) {
    return 'window_id';
  }

  if (source && config.jobs.codexRadar.suppressedSources.has(source)) {
    return 'source';
  }

  return undefined;
}

function parseCandidateMetadata(
  metadata?: Record<string, unknown> | null
): z.infer<typeof candidateMetadataSchema> {
  const parsed = candidateMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : {};
}

function isOpenValue(value: string | null | undefined): boolean {
  return textOrUndefined(value)?.toLowerCase() === 'open';
}

function isClosedValue(value: string | null | undefined): boolean {
  const normalized = textOrUndefined(value)?.toLowerCase();
  return (
    normalized === 'closed' ||
    normalized === 'close' ||
    normalized === 'none' ||
    normalized === 'inactive' ||
    normalized === 'ended'
  );
}

function textOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
