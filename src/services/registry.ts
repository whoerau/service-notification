import type { AppConfig } from '../config.js';
import type { JobDefinition } from '../types.js';
import { createCodexRadarJobs } from './codex-radar/index.js';
import { createNezhaReleaseJobs } from './nezha-release/index.js';

export function createJobs(config: AppConfig): JobDefinition[] {
  return [...createCodexRadarJobs(config), ...createNezhaReleaseJobs(config)];
}
