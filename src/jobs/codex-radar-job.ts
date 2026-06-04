import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { JobDefinition, NotificationEnvelope } from '../types.js';

const sourceSchema = z
  .object({
    type: z.string().optional().nullable(),
    url: z.string().optional().nullable()
  })
  .passthrough();

const windowSchema = z
  .object({
    id: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    opened_at: z.string().optional().nullable(),
    closed_at: z.string().optional().nullable(),
    window_minutes: z.number().optional().nullable(),
    window_human: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    sources: z.array(sourceSchema).optional().nullable(),
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
    candidateLastSeenAt: z.string().optional(),
    predictionHighCount: z.number().int().nonnegative().optional(),
    predictionHighFirstSeenAt: z.string().optional(),
    predictionHighLastSeenAt: z.string().optional(),
    predictionPrealertDate: z.string().optional(),
    predictionHighLevel: z.string().optional()
  })
  .passthrough();

interface CodexRadarEvaluation {
  decision: CodexRadarDecision;
  reportReady: boolean;
  notifications: NotificationEnvelope[];
  candidateWindowId?: string;
  candidateSource?: string;
  candidateOpenCount?: number;
  candidateFirstSeenAt?: string;
  candidateLastSeenAt?: string;
  predictionHighCount?: number;
  predictionHighFirstSeenAt?: string;
  predictionHighLastSeenAt?: string;
  predictionPrealertDate?: string;
  predictionHighLevel?: string;
  openedAt?: string;
  closedAt?: string;
  source?: string;
  directReset?: boolean;
  suppressionReason?: 'window_id' | 'source';
}

type CandidateMetadata = z.infer<typeof candidateMetadataSchema>;

interface CompletedWindowCandidate {
  window: CodexRadarWindow;
  windowId: string;
  source?: string;
  openedAt: string;
  closedAt: string;
  directReset: boolean;
}

interface PredictionEvaluation {
  notification?: NotificationEnvelope;
  predictionHighCount: number;
  predictionHighFirstSeenAt?: string;
  predictionHighLastSeenAt?: string;
  predictionPrealertDate?: string;
  predictionHighLevel?: string;
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
        notifications: evaluation.notifications,
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
          predictionHighCount: evaluation.predictionHighCount,
          predictionHighFirstSeenAt: evaluation.predictionHighFirstSeenAt,
          predictionHighLastSeenAt: evaluation.predictionHighLastSeenAt,
          predictionPrealertDate: evaluation.predictionPrealertDate,
          predictionHighLevel: evaluation.predictionHighLevel,
          openedAt: evaluation.openedAt,
          closedAt: evaluation.closedAt,
          source: evaluation.source,
          directReset: evaluation.directReset,
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
  const observedAt =
    data.checked_at ?? data.monitored_at ?? new Date().toISOString();
  const previous = parseCandidateMetadata(previousMetadata);
  const prediction = evaluateCodexRadarPrediction(
    data,
    sourceUrl,
    config,
    previous,
    observedAt
  );
  const current = data.current_window;
  const candidate = completedWindowCandidateFor(data);

  if (!candidate) {
    return {
      decision: isExplicitlyClosed(data, current) ? 'closed' : 'insufficient',
      reportReady: false,
      notifications: notificationList(prediction),
      ...predictionMetadata(prediction),
      openedAt: textOrUndefined(current?.opened_at),
      closedAt: textOrUndefined(current?.closed_at),
      source: sourceFromWindow(current)
    };
  }

  const { window, windowId, source, openedAt, closedAt, directReset } =
    candidate;
  const suppressionReason = suppressionReasonFor(windowId, source, config);

  if (suppressionReason) {
    return {
      decision: 'suppressed',
      reportReady: false,
      notifications: notificationList(prediction),
      candidateWindowId: windowId,
      candidateSource: source,
      candidateOpenCount: 0,
      ...predictionMetadata(prediction),
      openedAt,
      closedAt,
      source,
      directReset,
      suppressionReason
    };
  }

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
    notifications: [
      ...(reportReady
        ? [
            createCompletedWindowNotification(
              data,
              window,
              sourceUrl,
              windowId,
              directReset
            )
          ]
        : []),
      ...notificationList(prediction)
    ],
    candidateWindowId: windowId,
    candidateSource: source,
    candidateOpenCount,
    candidateFirstSeenAt,
    candidateLastSeenAt,
    ...predictionMetadata(prediction),
    openedAt,
    closedAt,
    source,
    directReset
  };
}

function evaluateCodexRadarPrediction(
  data: CodexRadarResponse,
  sourceUrl: string,
  config: AppConfig,
  previous: CandidateMetadata,
  observedAt: string
): PredictionEvaluation {
  const level = textOrUndefined(data.prediction?.level);
  const localDate = localDateFor(observedAt, config.scheduler.timezone);
  const previousPrealertDate = previous.predictionPrealertDate;

  if (!isHighPredictionLevel(level)) {
    return {
      predictionHighCount: 0,
      predictionPrealertDate: previousPrealertDate
    };
  }

  const predictionHighCount = (previous.predictionHighCount ?? 0) + 1;
  const predictionHighFirstSeenAt =
    previous.predictionHighCount && previous.predictionHighFirstSeenAt
      ? previous.predictionHighFirstSeenAt
      : observedAt;
  const predictionHighLastSeenAt = observedAt;
  const shouldPrealert =
    predictionHighCount >= config.jobs.codexRadar.predictionConfirmations &&
    previousPrealertDate !== localDate;
  const predictionPrealertDate = shouldPrealert
    ? localDate
    : previousPrealertDate;

  return {
    notification: shouldPrealert
      ? createPredictionPrealertNotification(
          data,
          sourceUrl,
          localDate,
          predictionHighCount,
          level
        )
      : undefined,
    predictionHighCount,
    predictionHighFirstSeenAt,
    predictionHighLastSeenAt,
    predictionPrealertDate,
    predictionHighLevel: level
  };
}

function notificationList(
  prediction: PredictionEvaluation
): NotificationEnvelope[] {
  return prediction.notification ? [prediction.notification] : [];
}

function predictionMetadata(prediction: PredictionEvaluation) {
  return {
    predictionHighCount: prediction.predictionHighCount,
    predictionHighFirstSeenAt: prediction.predictionHighFirstSeenAt,
    predictionHighLastSeenAt: prediction.predictionHighLastSeenAt,
    predictionPrealertDate: prediction.predictionPrealertDate,
    predictionHighLevel: prediction.predictionHighLevel
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

function completedWindowCandidateFor(
  data: CodexRadarResponse
): CompletedWindowCandidate | undefined {
  const currentCandidate = completedWindowCandidateFrom(data.current_window);

  if (currentCandidate) {
    return currentCandidate;
  }

  if (isWindowCurrentlyOpen(data)) {
    return undefined;
  }

  return completedWindowCandidateFrom(data.last_window);
}

function completedWindowCandidateFrom(
  window: CodexRadarWindow | undefined
): CompletedWindowCandidate | undefined {
  if (!window) {
    return undefined;
  }

  const openedAt = textOrUndefined(window.opened_at);
  const closedAt = textOrUndefined(window.closed_at);

  if (!openedAt || !closedAt) {
    return undefined;
  }

  return {
    window,
    windowId: stableWindowId(window),
    source: sourceFromWindow(window),
    openedAt,
    closedAt,
    directReset: isDirectResetWindow(window, openedAt, closedAt)
  };
}

function createCompletedWindowNotification(
  data: CodexRadarResponse,
  window: CodexRadarWindow,
  sourceUrl: string,
  windowId: string,
  directReset: boolean
): NotificationEnvelope {
  const title =
    textOrUndefined(window.title) ??
    (directReset ? 'Codex 使用限制已直接重置' : 'Codex 速蹬窗口记录已确认');
  const openedAt = textOrUndefined(window.opened_at);
  const closedAt = textOrUndefined(window.closed_at);
  const source = sourceFromWindow(window) ?? sourceUrl;
  const summary =
    textOrUndefined(window.summary) ??
    textOrUndefined(window.message) ??
    data.message;
  const scope = textOrUndefined(window.scope);

  if (!openedAt || !closedAt) {
    throw new Error(
      'Cannot report CodexRadar window without opened_at and closed_at'
    );
  }

  const lines = (
    directReset
      ? [
          'CodexRadar 检测到一次无速蹬窗口直接重置。',
          '',
          `事件：${title}`,
          `重置时间：${closedAt}`,
          scope ? `范围：${scope}` : null,
          summary ? `说明：${summary}` : null,
          source ? `来源：${source}` : null,
          '',
          `状态接口：${sourceUrl}`
        ]
      : [
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
        ]
  ).filter((line): line is string => Boolean(line));

  return {
    destination: 'telegram',
    title: directReset
      ? 'Codex 使用限制已直接重置'
      : 'Codex 速蹬窗口记录已确认',
    message: lines.join('\n'),
    dedupeKey: `codex-radar:window-report:${windowId}`,
    severity: 'critical',
    metadata: {
      windowId,
      openedAt,
      closedAt,
      source,
      directReset,
      windowMinutes: window.window_minutes,
      windowHuman: textOrUndefined(window.window_human),
      checkedAt: data.checked_at ?? data.monitored_at
    }
  };
}

function createPredictionPrealertNotification(
  data: CodexRadarResponse,
  sourceUrl: string,
  localDate: string,
  predictionHighCount: number,
  level: string
): NotificationEnvelope {
  const probability24h = formatProbability(data.prediction?.probability_24h);
  const probability48h = formatProbability(data.prediction?.probability_48h);
  const expectedWindow = textOrUndefined(data.prediction?.expected_window);
  const message = textOrUndefined(data.message);

  const lines = [
    'CodexRadar 预测雷达连续呈现高概率。',
    '',
    `连续确认：${predictionHighCount} 次`,
    `等级：${level}`,
    probability24h ? `24小时概率：${probability24h}` : null,
    probability48h ? `48小时概率：${probability48h}` : null,
    expectedWindow ? `预测窗口：${expectedWindow}` : null,
    message ? `说明：${message}` : null,
    '',
    `状态接口：${sourceUrl}`
  ].filter((line): line is string => Boolean(line));

  return {
    destination: 'telegram',
    title: 'Codex 速蹬窗口高概率预提醒',
    message: lines.join('\n'),
    dedupeKey: `codex-radar:prediction-prealert:${localDate}`,
    severity: 'warning',
    metadata: {
      localDate,
      predictionHighCount,
      predictionLevel: level,
      probability24h: data.prediction?.probability_24h,
      probability48h: data.prediction?.probability_48h,
      expectedWindow,
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
    sourceFromWindow(window) ??
    textOrUndefined(window.title) ??
    'unknown'
  );
}

function sourceFromWindow(
  window: CodexRadarWindow | undefined
): string | undefined {
  if (!window) {
    return undefined;
  }

  const explicitSource = textOrUndefined(window.source);

  if (explicitSource) {
    return explicitSource;
  }

  const sources = window.sources ?? [];
  const closedSource = sources.find(
    (source) =>
      textOrUndefined(source.type) === 'window_closed' &&
      textOrUndefined(source.url)
  );

  return (
    textOrUndefined(closedSource?.url) ??
    textOrUndefined(sources.find((source) => textOrUndefined(source.url))?.url)
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
): CandidateMetadata {
  const parsed = candidateMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : {};
}

function isHighPredictionLevel(value: string | null | undefined): boolean {
  const normalized = textOrUndefined(value)
    ?.toLowerCase()
    .replace(/[\s-]+/g, '_');

  return (
    normalized === 'high' ||
    normalized === 'high_probability' ||
    normalized === '高概率'
  );
}

function localDateFor(value: string, timezone: string): string {
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(
    Number.isNaN(date.valueOf()) ? new Date() : date
  );
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function formatProbability(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const percent = value <= 1 ? value * 100 : value;
  const rounded = Math.round(percent * 10) / 10;

  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}%`;
}

function isDirectResetWindow(
  window: CodexRadarWindow,
  openedAt: string,
  closedAt: string
): boolean {
  return (
    openedAt === closedAt ||
    window.window_minutes === 0 ||
    isNoWindowHumanValue(window.window_human)
  );
}

function isNoWindowHumanValue(value: string | null | undefined): boolean {
  const normalized = textOrUndefined(value)
    ?.toLowerCase()
    .replace(/[\s_-]+/g, '');

  return normalized === '无窗' || normalized === 'nowindow';
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
