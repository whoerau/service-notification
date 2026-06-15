import type { AppConfig } from '../../config.js';
import type { JobDefinition } from '../../types.js';
import { createCodexRadarJob } from './job.js';

export function createCodexRadarJobs(config: AppConfig): JobDefinition[] {
  if (!config.services.codexRadar.enabled) {
    return [];
  }

  return [createCodexRadarJob(config)];
}
