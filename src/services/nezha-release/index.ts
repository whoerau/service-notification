import type { AppConfig } from '../../config.js';
import type { JobDefinition } from '../../types.js';
import { createNezhaReleaseJob } from './job.js';

export function createNezhaReleaseJobs(config: AppConfig): JobDefinition[] {
  if (!config.services.nezhaRelease.enabled) {
    return [];
  }

  return [createNezhaReleaseJob(config)];
}
