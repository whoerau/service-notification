import { describe, expect, it } from 'vitest';
import { parseAllowedChatIds } from '../src/config.js';

describe('parseAllowedChatIds', () => {
  it('parses multiple comma separated chat ids', () => {
    expect(parseAllowedChatIds('123,-100456, 789')).toEqual(
      new Set([123, -100456, 789])
    );
  });

  it('rejects invalid chat ids', () => {
    expect(() => parseAllowedChatIds('123,abc')).toThrow(
      'Invalid Telegram chat id'
    );
  });
});
