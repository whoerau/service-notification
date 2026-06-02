import * as cheerio from 'cheerio';

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface JsonFetchResult<T> {
  url: string;
  status: number;
  headers: Headers;
  data: T;
}

export interface HtmlFetchResult {
  url: string;
  status: number;
  headers: Headers;
  html: string;
  $: cheerio.CheerioAPI;
}

export interface FetchService {
  json<T>(url: string, options?: FetchOptions): Promise<JsonFetchResult<T>>;
  html(url: string, options?: FetchOptions): Promise<HtmlFetchResult>;
}

export class HttpFetchService implements FetchService {
  async json<T>(
    url: string,
    options: FetchOptions = {}
  ): Promise<JsonFetchResult<T>> {
    const response = await this.fetch(url, options);
    const data = (await response.json()) as T;

    return {
      url: response.url,
      status: response.status,
      headers: response.headers,
      data
    };
  }

  async html(
    url: string,
    options: FetchOptions = {}
  ): Promise<HtmlFetchResult> {
    const response = await this.fetch(url, options);
    const html = await response.text();

    return {
      url: response.url,
      status: response.status,
      headers: response.headers,
      html,
      $: cheerio.load(html)
    };
  }

  private async fetch(url: string, options: FetchOptions): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 30_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const signals = [controller.signal, options.signal].filter(
      Boolean
    ) as AbortSignal[];

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'service-notification/0.1 (+https://github.com/whoerau/service-notification)',
          ...options.headers
        },
        signal: combineSignals(signals)
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText} for ${url}`
        );
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) {
    return signals[0]!;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }

    signal.addEventListener('abort', abort, { once: true });
  }

  return controller.signal;
}
