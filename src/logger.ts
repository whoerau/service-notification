import pino from 'pino';
import type { AppConfig } from './config.js';

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logging.level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime
  });
}
