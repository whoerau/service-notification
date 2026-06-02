import { describe, expect, it } from 'vitest';
import { isAllowedChat } from '../src/telegram/telegram-service.js';

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
