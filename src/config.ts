import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const CODEX_RADAR_OPEN_CONFIRMATIONS = 2;
const CODEX_RADAR_PREDICTION_CONFIRMATIONS = 2;
const CODEX_RADAR_SUPPRESSED_WINDOW_IDS: string[] = [];
const CODEX_RADAR_SUPPRESSED_SOURCES: string[] = [];
const THIRD_PARTY_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const THIRD_PARTY_MAX_RETRIES = 2;
const THIRD_PARTY_RETRY_BASE_DELAY_MS = 750;
const THIRD_PARTY_RETRY_MAX_DELAY_MS = 10_000;

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().default(''),
  DATABASE_PATH: z.string().default('./data/service-notification.sqlite'),
  TZ: z.string().default('Asia/Hong_Kong'),
  HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  FAILURE_ALERT_THRESHOLD: z.coerce.number().int().positive().default(3),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CODEX_RADAR_URL: z
    .string()
    .url()
    .default('https://codexradar.com/current.json'),
  CODEX_RADAR_CRON: z.string().default('*/10 * * * *')
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const databasePath = resolve(parsed.DATABASE_PATH);

  mkdirSync(dirname(databasePath), { recursive: true });

  return {
    telegram: {
      botToken: parsed.TELEGRAM_BOT_TOKEN,
      allowedChatIds: parseAllowedChatIds(parsed.TELEGRAM_ALLOWED_CHAT_IDS)
    },
    database: {
      path: databasePath
    },
    scheduler: {
      timezone: parsed.TZ,
      failureAlertThreshold: parsed.FAILURE_ALERT_THRESHOLD,
      historyRetentionDays: parsed.HISTORY_RETENTION_DAYS
    },
    health: {
      port: parsed.PORT
    },
    logging: {
      level: parsed.LOG_LEVEL
    },
    jobs: {
      codexRadar: {
        url: parsed.CODEX_RADAR_URL,
        cron: parsed.CODEX_RADAR_CRON,
        openConfirmations: CODEX_RADAR_OPEN_CONFIRMATIONS,
        predictionConfirmations: CODEX_RADAR_PREDICTION_CONFIRMATIONS,
        suppressedWindowIds: new Set(CODEX_RADAR_SUPPRESSED_WINDOW_IDS),
        suppressedSources: new Set(CODEX_RADAR_SUPPRESSED_SOURCES)
      }
    },
    thirdPartyRequests: {
      userAgent: THIRD_PARTY_USER_AGENT,
      maxRetries: THIRD_PARTY_MAX_RETRIES,
      retryBaseDelayMs: THIRD_PARTY_RETRY_BASE_DELAY_MS,
      retryMaxDelayMs: THIRD_PARTY_RETRY_MAX_DELAY_MS
    }
  };
}

export function parseAllowedChatIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        const parsed = Number(value);

        if (!Number.isSafeInteger(parsed)) {
          throw new Error(`Invalid Telegram chat id: ${value}`);
        }

        return parsed;
      })
  );
}
