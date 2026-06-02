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

export function createCodexRadarJob(config: AppConfig): JobDefinition {
  return {
    id: 'codex-radar',
    name: 'CodexRadar 速蹬窗口监控',
    schedule: config.jobs.codexRadar.cron,
    timezone: config.scheduler.timezone,
    timeoutMs: 30_000,
    async run({ fetcher, signal }) {
      const response = await fetcher.json<unknown>(config.jobs.codexRadar.url, {
        timeoutMs: 20_000,
        signal
      });
      const data = codexRadarSchema.parse(response.data);
      const isOpen = isWindowOpen(data);

      return {
        ok: true,
        notifications: isOpen
          ? [createOpenWindowNotification(data, response.url)]
          : [],
        metadata: {
          checkedAt: data.checked_at ?? data.monitored_at,
          status: data.status,
          windowOpen: isOpen,
          message: data.message,
          predictionLevel: data.prediction?.level,
          probability24h: data.prediction?.probability_24h,
          probability48h: data.prediction?.probability_48h
        }
      };
    }
  };
}

function isWindowOpen(data: CodexRadarResponse): boolean {
  return (
    data.window_open === true ||
    data.status === 'open' ||
    data.current_window?.state === 'open' ||
    data.current_window?.status === 'open'
  );
}

function createOpenWindowNotification(
  data: CodexRadarResponse,
  sourceUrl: string
): NotificationEnvelope {
  const current = data.current_window;
  const fallback = data.last_window;
  const window = current ?? fallback;
  const windowId = stableWindowId(data);
  const title = window?.title ?? 'Codex 速蹬窗口已开启';
  const openedAt = window?.opened_at;
  const closedAt = window ? (window.closed_at ?? '尚未关闭') : undefined;
  const source = window?.source ?? sourceUrl;
  const summary = window?.summary ?? data.message;
  const scope = window?.scope;
  const lines = [
    'CodexRadar 检测到当前存在有效速蹬窗口。',
    '',
    `窗口：${title}`,
    window ? `开启时间：${openedAt ?? '未知'}` : null,
    window ? `关闭时间：${closedAt}` : null,
    scope ? `范围：${scope}` : null,
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
      windowId,
      openedAt,
      closedAt,
      source,
      checkedAt: data.checked_at ?? data.monitored_at
    }
  };
}

function stableWindowId(data: CodexRadarResponse): string {
  const current = data.current_window;
  const fallback = data.last_window;

  return (
    current?.id ??
    current?.opened_at ??
    current?.source ??
    current?.title ??
    fallback?.id ??
    fallback?.opened_at ??
    data.checked_at ??
    data.monitored_at ??
    'unknown'
  );
}
