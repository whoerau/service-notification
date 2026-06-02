import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpFetchService } from '../src/fetch/fetch-service.js';

describe('HttpFetchService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds browser-compatible default headers to third-party requests', async () => {
    const calls: RequestInit[] = [];

    vi.stubGlobal(
      'fetch',
      async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push(init ?? {});

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    );

    const fetcher = new HttpFetchService({
      userAgent: 'custom-agent',
      maxRetries: 0
    });

    await fetcher.json('https://codexradar.com/current.json', {
      headers: {
        'User-Agent': 'override-agent'
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toMatchObject({
      Accept:
        'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://codexradar.com/',
      'User-Agent': 'override-agent'
    });
  });

  it('retries temporary third-party failures with Retry-After support', async () => {
    let callCount = 0;

    vi.stubGlobal('fetch', async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response('rate limited', {
          status: 429,
          statusText: 'Too Many Requests',
          headers: {
            'Retry-After': '0'
          }
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });

    const fetcher = new HttpFetchService({
      maxRetries: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0
    });
    const result = await fetcher.json<{ ok: boolean }>(
      'https://codexradar.com/current.json'
    );

    expect(result.data).toEqual({ ok: true });
    expect(callCount).toBe(2);
  });
});
