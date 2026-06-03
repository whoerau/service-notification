import { describe, expect, it } from 'vitest';
import {
  formatDisplayTime,
  isAllowedChat
} from '../src/telegram/telegram-service.js';

describe('isAllowedChat', () => {
  it('allows only configured chat ids', () => {
    const allowed = new Set([123, -100456]);

    expect(isAllowedChat({ chat: { id: 123 } } as never, allowed)).toBe(true);
    expect(isAllowedChat({ chat: { id: -100456 } } as never, allowed)).toBe(
      true
    );
    expect(isAllowedChat({ chat: { id: 999 } } as never, allowed)).toBe(false);
    expect(isAllowedChat({} as never, allowed)).toBe(false);
  });
});

describe('formatDisplayTime', () => {
  it('formats stored UTC timestamps in the configured timezone', () => {
    expect(
      formatDisplayTime('2026-06-03T00:00:00.000Z', 'Asia/Hong_Kong')
    ).toBe('2026-06-03 08:00:00 Asia/Hong_Kong');
  });

  it('keeps invalid timestamps unchanged', () => {
    expect(formatDisplayTime('not-a-date', 'Asia/Hong_Kong')).toBe(
      'not-a-date'
    );
  });
});
