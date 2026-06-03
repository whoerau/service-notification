import { Bot, type Context } from 'grammy';
import type { Logger } from 'pino';
import type { StateStore } from '../state/state-store.js';
import type {
  Notifier,
  NotificationEnvelope,
  RegisteredJobStatus
} from '../types.js';

export interface TelegramServiceOptions {
  botToken: string;
  allowedChatIds: Set<number>;
  state: StateStore;
  getJobStatuses(): RegisteredJobStatus[];
  timezone: string;
  logger: Logger;
}

export class TelegramService implements Notifier {
  readonly destination = 'telegram' as const;
  private readonly bot: Bot;

  constructor(private readonly options: TelegramServiceOptions) {
    if (options.allowedChatIds.size === 0) {
      throw new Error(
        'TELEGRAM_ALLOWED_CHAT_IDS must contain at least one chat id'
      );
    }

    this.bot = new Bot(options.botToken);
    this.configureHandlers();
  }

  start(): void {
    void this.bot.start({
      onStart: (botInfo) => {
        this.options.logger.info(
          { username: botInfo.username },
          'telegram bot started'
        );
      }
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  async send(envelope: NotificationEnvelope): Promise<void> {
    const text = formatEnvelope(envelope);
    const errors: string[] = [];

    for (const chatId of this.options.allowedChatIds) {
      try {
        await this.bot.api.sendMessage(chatId, text, {
          disable_web_page_preview: true
        });
      } catch (error) {
        errors.push(
          `${chatId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(`Telegram delivery failed: ${errors.join('; ')}`);
    }
  }

  private configureHandlers(): void {
    this.bot.use(async (ctx, next) => {
      if (!isAllowedChat(ctx, this.options.allowedChatIds)) {
        return;
      }

      await next();
    });

    this.bot.command('start', async (ctx) => {
      await ctx.reply('service-notification 已启用。可用命令：/status /jobs');
    });

    this.bot.command('status', async (ctx) => {
      const runs = await this.options.state.getRecentRuns(5);
      const jobStatuses = this.options.getJobStatuses();
      const lines = [
        '服务状态：running',
        `注册任务：${jobStatuses.length}`,
        '',
        '最近运行：',
        ...runs.map((run) => {
          const error = run.error ? ` (${run.error})` : '';
          return `- ${run.jobId}: ${run.status} @ ${formatDisplayTime(
            run.finishedAt,
            this.options.timezone
          )}${error}`;
        })
      ];

      await ctx.reply(lines.join('\n'));
    });

    this.bot.command('jobs', async (ctx) => {
      const taskStates = await this.options.state.getTaskStates();
      const stateByJob = new Map(
        taskStates.map((state) => [state.jobId, state])
      );
      const lines = this.options.getJobStatuses().map((job) => {
        const state = stateByJob.get(job.id);
        const current = job.running ? 'running' : 'idle';
        const last = state
          ? `${state.lastStatus} @ ${formatDisplayTime(
              state.lastRunAt,
              this.options.timezone
            )}`
          : 'no runs yet';

        return `- ${job.id}: ${job.name}, ${job.schedule}, ${current}, ${last}`;
      });

      await ctx.reply(lines.length > 0 ? lines.join('\n') : '暂无注册任务');
    });

    this.bot.catch((error) => {
      this.options.logger.error({ error }, 'telegram bot error');
    });
  }
}

export function isAllowedChat(
  ctx: Context,
  allowedChatIds: Set<number>
): boolean {
  const chatId = ctx.chat?.id;
  return typeof chatId === 'number' && allowedChatIds.has(chatId);
}

function formatEnvelope(envelope: NotificationEnvelope): string {
  const severity = envelope.severity.toUpperCase();

  return [`[${severity}] ${envelope.title}`, '', envelope.message].join('\n');
}

export function formatDisplayTime(value: string, timezone: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  const second = parts.find((part) => part.type === 'second')?.value;

  if (!year || !month || !day || !hour || !minute || !second) {
    return value;
  }

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${timezone}`;
}
