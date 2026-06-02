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
          return `- ${run.jobId}: ${run.status} @ ${run.finishedAt}${error}`;
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
          ? `${state.lastStatus} @ ${state.lastRunAt}`
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
