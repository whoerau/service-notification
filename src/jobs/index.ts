import type { AppConfig } from '../config.js';
import type { JobDefinition } from '../types.js';
import { createCodexRadarJob } from './codex-radar-job.js';

export function createJobs(config: AppConfig): JobDefinition[] {
  return [createCodexRadarJob(config)];
}
