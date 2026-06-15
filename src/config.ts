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
  TELEGRAM_BOT_TOKEN: requiredEnvString('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_ALLOWED_CHAT_IDS: requiredEnvString('TELEGRAM_ALLOWED_CHAT_IDS'),
  DATABASE_PATH: envString('./data/service-notification.sqlite'),
  TZ: envString('Asia/Hong_Kong'),
  HISTORY_RETENTION_DAYS: envPositiveInteger(30),
  FAILURE_ALERT_THRESHOLD: envPositiveInteger(3),
  PORT: envPositiveInteger(3000),
  LOG_LEVEL: envEnum(
    ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
    'info'
  ),
  CODEX_RADAR_ENABLED: envBoolean(false),
  CODEX_RADAR_URL: envUrl('https://codexradar.com/current.json'),
  CODEX_RADAR_CRON: envString('*/10 * * * *')
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
    services: {
      codexRadar: {
        enabled: parsed.CODEX_RADAR_ENABLED,
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

function requiredEnvString(name: string) {
  return z.preprocess(
    emptyEnvToUndefined,
    z.string({ error: `${name} is required` }).min(1, `${name} is required`)
  );
}

function envString(defaultValue: string) {
  return z.preprocess(
    emptyEnvToUndefined,
    z.string().min(1).default(defaultValue)
  );
}

function envUrl(defaultValue: string) {
  return z.preprocess(
    emptyEnvToUndefined,
    z.string().url().default(defaultValue)
  );
}

function envPositiveInteger(defaultValue: number) {
  return z.preprocess(
    emptyEnvToUndefined,
    z.coerce.number().int().positive().default(defaultValue)
  );
}

function envEnum<T extends readonly [string, ...string[]]>(
  values: T,
  defaultValue: T[number]
) {
  return z.preprocess(
    emptyEnvToUndefined,
    z.enum(values).default(defaultValue)
  );
}

function envBoolean(defaultValue: boolean) {
  return z.preprocess((value) => {
    const normalized = emptyEnvToUndefined(value);

    if (typeof normalized !== 'string') {
      return normalized;
    }

    switch (normalized.trim().toLowerCase()) {
      case 'true':
      case '1':
      case 'yes':
      case 'on':
        return true;
      case 'false':
      case '0':
      case 'no':
      case 'off':
        return false;
      default:
        return normalized;
    }
  }, z.boolean().default(defaultValue));
}

function emptyEnvToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed || /^\$\{[^}]+}$/.test(trimmed)) {
    return undefined;
  }

  return value;
}
