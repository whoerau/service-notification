import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { JobDefinition, NotificationEnvelope } from '../../types.js';

const BODY_MAX_LENGTH = 1200;

const releaseSchema = z
  .object({
    tag_name: z.string().min(1),
    name: z.string().optional().nullable(),
    html_url: z.string().url(),
    published_at: z.string().optional().nullable(),
    body: z.string().optional().nullable(),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional()
  })
  .passthrough();

const metadataSchema = z
  .object({
    latestTag: z.string().optional()
  })
  .passthrough();

type NezhaRelease = z.infer<typeof releaseSchema>;
type IgnoredReason = 'draft' | 'prerelease';

export function createNezhaReleaseJob(config: AppConfig): JobDefinition {
  const id = 'nezha-release';

  return {
    id,
    name: 'Nezha 版本发布监控',
    schedule: config.services.nezhaRelease.cron,
    timezone: config.scheduler.timezone,
    timeoutMs: 30_000,
    async run({ fetcher, state, signal }) {
      const response = await fetcher.json<unknown>(
        config.services.nezhaRelease.url,
        {
          timeoutMs: 20_000,
          signal,
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        }
      );
      const release = releaseSchema.parse(response.data);
      const ignoredReason = ignoredReasonFor(release);

      if (ignoredReason) {
        return {
          ok: true,
          notifications: [],
          metadata: {
            baselineTag: config.services.nezhaRelease.baselineTag,
            ignoredTag: release.tag_name,
            ignoredReason,
            decision: 'ignored'
          }
        };
      }

      const previousState = await state.getTaskState(id);
      // 中英: Persist the latest tag in task metadata so restarts do not replay alerts.
      // ZH/EN: 用任务 metadata 保存最新 tag，服务重启后不会重新推送同一版本。
      const previousTag =
        metadataSchema.safeParse(previousState?.metadata).data?.latestTag ??
        config.services.nezhaRelease.baselineTag;
      const shouldNotify = compareTags(release.tag_name, previousTag) > 0;

      return {
        ok: true,
        notifications: shouldNotify
          ? [createReleaseNotification(release, previousTag)]
          : [],
        metadata: {
          baselineTag: config.services.nezhaRelease.baselineTag,
          latestTag: release.tag_name,
          latestName: release.name,
          latestPublishedAt: release.published_at,
          latestHtmlUrl: release.html_url,
          previousTag,
          decision: shouldNotify ? 'notify' : 'current'
        }
      };
    }
  };
}

function ignoredReasonFor(release: NezhaRelease): IgnoredReason | undefined {
  if (release.draft) {
    return 'draft';
  }

  if (release.prerelease) {
    return 'prerelease';
  }

  return undefined;
}

function createReleaseNotification(
  release: NezhaRelease,
  previousTag: string
): NotificationEnvelope {
  const body = releaseBodySummary(release.body);
  const lines = [
    `版本：${release.tag_name}`,
    release.name && release.name !== release.tag_name
      ? `名称：${release.name}`
      : null,
    `上一已见版本：${previousTag}`,
    release.published_at ? `发布时间：${release.published_at}` : null,
    `详情：${release.html_url}`,
    body ? '' : null,
    body
  ].filter((line): line is string => line !== null && line !== undefined);

  return {
    destination: 'telegram',
    title: `Nezha 发布新版本 ${release.tag_name}`,
    message: lines.join('\n'),
    dedupeKey: `nezha-release:${release.tag_name}`,
    severity: 'info',
    metadata: {
      tagName: release.tag_name,
      name: release.name,
      previousTag,
      htmlUrl: release.html_url,
      publishedAt: release.published_at
    }
  };
}

function releaseBodySummary(body: string | null | undefined): string | null {
  const normalized = body?.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length <= BODY_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, BODY_MAX_LENGTH).trimEnd()}...`;
}

function compareTags(left: string, right: string): number {
  const leftVersion = versionParts(left);
  const rightVersion = versionParts(right);
  const length = Math.max(leftVersion.length, rightVersion.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftVersion[index] ?? 0) - (rightVersion[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function versionParts(tag: string): number[] {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(tag);

  if (!match) {
    return [0];
  }

  return match[1].split('.').map((part) => Number(part));
}
