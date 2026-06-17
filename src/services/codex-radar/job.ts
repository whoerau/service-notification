import { load } from 'cheerio';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { FetchService } from '../../fetch/fetch-service.js';
import type { JobDefinition, NotificationEnvelope } from '../../types.js';

// ponytail: RSS is a timely fallback; widen this if historical backfill is needed.
const RSS_EVENT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

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
    open: z.boolean().optional().nullable(),
    action: z.string().optional().nullable(),
    opened_at: z.string().optional().nullable(),
    closed_at: z.string().optional().nullable(),
    window_minutes: z.number().optional().nullable(),
    window_human: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    source_url: z.string().optional().nullable(),
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
    recommended_action: z.string().optional(),
    message: z.string().optional(),
    window: windowSchema.optional().nullable(),
    current_window: windowSchema.optional().nullable(),
    last_window: windowSchema.optional().nullable(),
    recent_windows: z.array(windowSchema).optional().nullable(),
    links: z
      .object({
        html: z.string().optional(),
        rss: z.string().optional()
      })
      .passthrough()
      .optional(),
    prediction: z
      .object({
        level: z.string().optional(),
        probability_24h: z.number().optional(),
        probability_48h: z.number().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

type CodexRadarResponse = z.infer<typeof codexRadarSchema>;
type CodexRadarWindow = z.infer<typeof windowSchema>;
type CodexRadarDecision =
  | 'closed'
  | 'pending'
  | 'confirmed'
  | 'suppressed'
  | 'insufficient';
type WindowEventType = 'open' | 'close';

const candidateMetadataSchema = z
  .object({
    candidateEventKey: z.string().optional(),
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
  notifications: NotificationEnvelope[];
  eventType?: WindowEventType;
  candidateEventKey?: string;
  candidateWindowId?: string;
  candidateSource?: string;
  candidateOpenCount?: number;
  candidateFirstSeenAt?: string;
  candidateLastSeenAt?: string;
  openedAt?: string;
  closedAt?: string;
  source?: string;
  action?: string;
  directReset?: boolean;
  suppressionReason?: 'window_id' | 'source';
}

type CandidateMetadata = z.infer<typeof candidateMetadataSchema>;

interface WindowEventCandidate {
  window: CodexRadarWindow;
  eventType: WindowEventType;
  eventKey: string;
  windowId: string;
  source?: string;
  openedAt: string;
  closedAt?: string;
  action?: string;
  directReset: boolean;
}

interface RssEvent {
  eventType: WindowEventType;
  guid: string;
  title: string;
  link?: string;
  pubDate?: string;
  description?: string;
}

export function createCodexRadarJob(config: AppConfig): JobDefinition {
  const id = 'codex-radar';

  return {
    id,
    name: 'CodexRadar 速蹬窗口监控',
    schedule: config.services.codexRadar.cron,
    timezone: config.scheduler.timezone,
    timeoutMs: 30_000,
    async run({ fetcher, state, signal }) {
      const response = await fetcher.json<unknown>(
        config.services.codexRadar.url,
        {
          timeoutMs: 20_000,
          signal
        }
      );
      const data = codexRadarSchema.parse(response.data);
      const previousState = await state.getTaskState(id);
      const evaluation = evaluateCodexRadarWindow(
        data,
        response.url,
        config,
        previousState?.metadata
      );
      const observedAt = observedAtFor(data);
      const rss = evaluation.candidateEventKey
        ? { feedUrl: undefined, event: undefined }
        : await latestOfficialFeedEvent(fetcher, data, response.url, signal);

      return {
        ok: true,
        notifications: [
          ...evaluation.notifications,
          ...(rss.event
            ? [createRssEventNotification(rss.event, rss.feedUrl)]
            : [])
        ],
        metadata: {
          schemaVersion: data.schema_version,
          checkedAt: observedAt,
          status: data.status,
          windowOpen: isWindowCurrentlyOpen(data),
          decision: evaluation.decision,
          reportReady: evaluation.reportReady,
          eventType: evaluation.eventType,
          candidateEventKey: evaluation.candidateEventKey,
          candidateWindowId: evaluation.candidateWindowId,
          candidateSource: evaluation.candidateSource,
          candidateOpenCount: evaluation.candidateOpenCount,
          candidateFirstSeenAt: evaluation.candidateFirstSeenAt,
          candidateLastSeenAt: evaluation.candidateLastSeenAt,
          openedAt: evaluation.openedAt,
          closedAt: evaluation.closedAt,
          source: evaluation.source,
          action: evaluation.action,
          directReset: evaluation.directReset,
          suppressionReason: evaluation.suppressionReason,
          message: currentWindowFor(data)?.message ?? data.message,
          recommendedAction: data.recommended_action,
          rssFeedUrl: rss.feedUrl,
          rssGuid: rss.event?.guid,
          rssTitle: rss.event?.title,
          rssPubDate: rss.event?.pubDate,
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
  const observedAt = observedAtFor(data);
  const previous = parseCandidateMetadata(previousMetadata);
  const current = currentWindowFor(data);
  const candidate = windowEventCandidateFor(data);

  if (!candidate) {
    return {
      decision: isExplicitlyClosed(data, current) ? 'closed' : 'insufficient',
      reportReady: false,
      notifications: [],
      openedAt: textOrUndefined(current?.opened_at),
      closedAt: textOrUndefined(current?.closed_at),
      source: sourceFromWindow(current),
      action: actionFromWindow(data, current)
    };
  }

  const suppressionReason = suppressionReasonFor(
    candidate.windowId,
    candidate.source,
    config
  );

  if (suppressionReason) {
    return {
      decision: 'suppressed',
      reportReady: false,
      notifications: [],
      ...candidateMetadata(candidate, 0, observedAt, observedAt),
      suppressionReason
    };
  }

  const sameCandidate = previous.candidateEventKey === candidate.eventKey;
  const candidateOpenCount =
    (sameCandidate ? (previous.candidateOpenCount ?? 0) : 0) + 1;
  const candidateFirstSeenAt =
    sameCandidate && previous.candidateFirstSeenAt
      ? previous.candidateFirstSeenAt
      : observedAt;
  const candidateLastSeenAt = observedAt;
  const reportReady =
    candidateOpenCount >= config.services.codexRadar.openConfirmations;
  const decision: CodexRadarDecision = reportReady ? 'confirmed' : 'pending';

  return {
    decision,
    reportReady,
    notifications: reportReady
      ? [createWindowEventNotification(data, candidate, sourceUrl)]
      : [],
    ...candidateMetadata(
      candidate,
      candidateOpenCount,
      candidateFirstSeenAt,
      candidateLastSeenAt
    )
  };
}

async function latestOfficialFeedEvent(
  fetcher: FetchService,
  data: CodexRadarResponse,
  sourceUrl: string,
  signal: AbortSignal
): Promise<{ feedUrl: string; event?: RssEvent }> {
  const feedUrl = officialFeedUrlFor(data, sourceUrl);
  const response = await fetcher.html(feedUrl, {
    timeoutMs: 20_000,
    signal,
    headers: {
      Accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const $ = load(response.html, { xmlMode: true });
  const item = $('item').first();

  if (!item.length) {
    return { feedUrl: response.url };
  }

  const title = textOrUndefined(item.find('title').first().text());
  const guid = textOrUndefined(item.find('guid').first().text());
  const pubDate = textOrUndefined(item.find('pubDate').first().text());
  const eventType = eventTypeFromTitle(title);

  if (
    !title ||
    !guid ||
    !eventType ||
    !isRecentRssEvent(pubDate, observedAtFor(data))
  ) {
    return { feedUrl: response.url };
  }

  return {
    feedUrl: response.url,
    event: {
      eventType,
      guid,
      title,
      link: textOrUndefined(item.find('link').first().text()),
      pubDate,
      description: textOrUndefined(item.find('description').first().text())
    }
  };
}

function createRssEventNotification(
  event: RssEvent,
  feedUrl: string
): NotificationEnvelope {
  const lines = [
    'CodexRadar RSS 发布官方窗口/重置提醒。',
    '',
    event.title,
    event.pubDate ? `发布时间：${event.pubDate}` : null,
    event.description,
    event.link ? `详情：${event.link}` : null,
    '',
    `RSS：${feedUrl}`
  ].filter((line): line is string => Boolean(line));

  return {
    destination: 'telegram',
    title:
      event.eventType === 'open'
        ? 'Codex 速蹬窗口已开启'
        : 'Codex 速蹬窗口已关闭',
    message: lines.join('\n'),
    dedupeKey: `codex-radar:rss:${event.guid}`,
    severity: 'critical',
    metadata: {
      eventType: event.eventType,
      guid: event.guid,
      link: event.link,
      pubDate: event.pubDate,
      feedUrl
    }
  };
}

function candidateMetadata(
  candidate: WindowEventCandidate,
  candidateOpenCount: number,
  candidateFirstSeenAt: string,
  candidateLastSeenAt: string
) {
  return {
    eventType: candidate.eventType,
    candidateEventKey: candidate.eventKey,
    candidateWindowId: candidate.windowId,
    candidateSource: candidate.source,
    candidateOpenCount,
    candidateFirstSeenAt,
    candidateLastSeenAt,
    openedAt: candidate.openedAt,
    closedAt: candidate.closedAt,
    source: candidate.source,
    action: candidate.action,
    directReset: candidate.directReset
  };
}

function windowEventCandidateFor(
  data: CodexRadarResponse
): WindowEventCandidate | undefined {
  const current = currentWindowFor(data);
  const openCandidate = openWindowCandidateFrom(data, current);

  if (openCandidate || isWindowCurrentlyOpen(data)) {
    return openCandidate;
  }

  const closedCurrentCandidate = closedWindowCandidateFrom(data, current);

  if (closedCurrentCandidate) {
    return closedCurrentCandidate;
  }

  for (const window of [...(data.recent_windows ?? []), data.last_window]) {
    const candidate = closedWindowCandidateFrom(data, window);

    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function openWindowCandidateFrom(
  data: CodexRadarResponse,
  window: CodexRadarWindow | null | undefined
): WindowEventCandidate | undefined {
  if (
    !window ||
    !(
      window.open === true ||
      isOpenValue(window.status) ||
      isOpenValue(window.state)
    )
  ) {
    return undefined;
  }

  const openedAt = textOrUndefined(window.opened_at);

  if (!openedAt) {
    return undefined;
  }

  return createCandidate(data, window, 'open', openedAt);
}

function closedWindowCandidateFrom(
  data: CodexRadarResponse,
  window: CodexRadarWindow | null | undefined
): WindowEventCandidate | undefined {
  if (!window) {
    return undefined;
  }

  const openedAt = textOrUndefined(window.opened_at);
  const closedAt = textOrUndefined(window.closed_at);

  if (!openedAt || !closedAt) {
    return undefined;
  }

  return createCandidate(data, window, 'close', openedAt, closedAt);
}

function createCandidate(
  data: CodexRadarResponse,
  window: CodexRadarWindow,
  eventType: WindowEventType,
  openedAt: string,
  closedAt?: string
): WindowEventCandidate {
  const windowId = stableWindowId(window);

  return {
    window,
    eventType,
    eventKey: `${eventType}:${windowId}`,
    windowId,
    source: sourceFromWindow(window),
    openedAt,
    closedAt,
    action: actionFromWindow(data, window),
    directReset:
      eventType === 'close' &&
      Boolean(closedAt) &&
      isDirectResetWindow(window, openedAt, closedAt)
  };
}

function createWindowEventNotification(
  data: CodexRadarResponse,
  candidate: WindowEventCandidate,
  sourceUrl: string
): NotificationEnvelope {
  if (candidate.eventType === 'open') {
    return createOpenWindowNotification(data, candidate, sourceUrl);
  }

  return createClosedWindowNotification(data, candidate, sourceUrl);
}

function createOpenWindowNotification(
  data: CodexRadarResponse,
  candidate: WindowEventCandidate,
  sourceUrl: string
): NotificationEnvelope {
  const { window, windowId, source, openedAt, action } = candidate;
  const title = textOrUndefined(window.title) ?? 'Codex 速蹬窗口已开启';
  const summary =
    textOrUndefined(window.summary) ??
    textOrUndefined(window.message) ??
    data.message;
  const scope = textOrUndefined(window.scope);
  const actionText = formatAction(action);
  const lines = [
    'CodexRadar 检测到官方速蹬窗口开启。',
    '',
    `窗口：${title}`,
    `开启时间：${openedAt}`,
    scope ? `范围：${scope}` : null,
    actionText ? `建议：${actionText}` : null,
    summary ? `说明：${summary}` : null,
    source ? `来源：${source}` : null,
    '',
    `状态接口：${sourceUrl}`
  ].filter((line): line is string => Boolean(line));

  return {
    destination: 'telegram',
    title: 'Codex 速蹬窗口已开启',
    message: lines.join('\n'),
    dedupeKey: `codex-radar:window-open:${windowId}`,
    severity: 'critical',
    metadata: {
      eventType: 'open',
      windowId,
      openedAt,
      source,
      action,
      checkedAt: data.checked_at ?? data.monitored_at
    }
  };
}

function createClosedWindowNotification(
  data: CodexRadarResponse,
  candidate: WindowEventCandidate,
  sourceUrl: string
): NotificationEnvelope {
  const { window, windowId, source, openedAt, closedAt, directReset } =
    candidate;
  const title =
    textOrUndefined(window.title) ??
    (directReset ? 'Codex 使用限制已直接重置' : 'Codex 速蹬窗口记录已确认');
  const summary =
    textOrUndefined(window.summary) ??
    textOrUndefined(window.message) ??
    data.message;
  const scope = textOrUndefined(window.scope);

  if (!closedAt) {
    throw new Error('Cannot report CodexRadar close event without closed_at');
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
          'CodexRadar 检测到速蹬窗口关闭。',
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
    title: directReset ? 'Codex 使用限制已直接重置' : 'Codex 速蹬窗口已关闭',
    message: lines.join('\n'),
    dedupeKey: `codex-radar:window-close:${windowId}`,
    severity: 'critical',
    metadata: {
      eventType: 'close',
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

function currentWindowFor(data: CodexRadarResponse): CodexRadarWindow | null {
  return data.window ?? data.current_window ?? null;
}

function observedAtFor(data: CodexRadarResponse): string {
  return data.checked_at ?? data.monitored_at ?? new Date().toISOString();
}

function officialFeedUrlFor(
  data: CodexRadarResponse,
  sourceUrl: string
): string {
  const configured = textOrUndefined(data.links?.rss);

  if (configured) {
    return configured;
  }

  return new URL('/feed.xml', sourceUrl).toString();
}

function eventTypeFromTitle(
  title: string | undefined
): WindowEventType | undefined {
  if (!title) {
    return undefined;
  }

  if (title.includes('开启')) {
    return 'open';
  }

  if (title.includes('关闭') || title.includes('重置')) {
    return 'close';
  }

  return undefined;
}

function isRecentRssEvent(
  pubDate: string | undefined,
  observedAt: string
): boolean {
  const eventMs = pubDate ? Date.parse(pubDate) : NaN;
  const observedMs = Date.parse(observedAt);

  if (!Number.isFinite(eventMs) || !Number.isFinite(observedMs)) {
    return false;
  }

  return (
    eventMs <= observedMs + 60 * 60 * 1000 &&
    observedMs - eventMs <= RSS_EVENT_MAX_AGE_MS
  );
}

function isWindowCurrentlyOpen(data: CodexRadarResponse): boolean {
  const current = currentWindowFor(data);

  return (
    data.window_open === true ||
    current?.open === true ||
    isOpenValue(data.status) ||
    isOpenValue(current?.state) ||
    isOpenValue(current?.status)
  );
}

function isExplicitlyClosed(
  data: CodexRadarResponse,
  current?: CodexRadarWindow | null
): boolean {
  return (
    data.window_open === false ||
    current?.open === false ||
    isClosedValue(data.status) ||
    isClosedValue(current?.state) ||
    isClosedValue(current?.status)
  );
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
  window: CodexRadarWindow | null | undefined
): string | undefined {
  if (!window) {
    return undefined;
  }

  const explicitSource =
    textOrUndefined(window.source) ?? textOrUndefined(window.source_url);

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

function actionFromWindow(
  data: CodexRadarResponse,
  window: CodexRadarWindow | null | undefined
): string | undefined {
  return (
    textOrUndefined(window?.action) ?? textOrUndefined(data.recommended_action)
  );
}

function suppressionReasonFor(
  windowId: string,
  source: string | undefined,
  config: AppConfig
): 'window_id' | 'source' | undefined {
  if (config.services.codexRadar.suppressedWindowIds.has(windowId)) {
    return 'window_id';
  }

  if (source && config.services.codexRadar.suppressedSources.has(source)) {
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

function formatAction(value: string | undefined): string | undefined {
  switch (textOrUndefined(value)?.toLowerCase()) {
    case 'use_remaining_tokens':
      return '尽快使用剩余额度';
    default:
      return textOrUndefined(value);
  }
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
