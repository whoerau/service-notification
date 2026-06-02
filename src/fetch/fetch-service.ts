import * as cheerio from 'cheerio';

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

export interface HttpFetchServiceOptions {
  userAgent?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  defaultHeaders?: Record<string, string>;
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

const defaultBrowserUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export class HttpFetchService implements FetchService {
  private readonly userAgent: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: HttpFetchServiceOptions = {}) {
    this.userAgent = options.userAgent ?? defaultBrowserUserAgent;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 750;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 10_000;
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

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
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxRetries = options.maxRetries ?? this.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let timedOut = false;
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const signals = [controller.signal, options.signal].filter(
        Boolean
      ) as AbortSignal[];

      try {
        const response = await fetch(url, {
          headers: this.headersFor(url, options.headers),
          signal: combineSignals(signals)
        });

        if (response.ok) {
          return response;
        }

        const error = new HttpFetchError(
          url,
          response.status,
          response.statusText
        );

        if (!shouldRetryStatus(response.status) || attempt >= maxRetries) {
          throw error;
        }

        await discardResponseBody(response);
        await sleep(
          retryDelayMs(
            response,
            attempt,
            options.retryBaseDelayMs ?? this.retryBaseDelayMs,
            options.retryMaxDelayMs ?? this.retryMaxDelayMs
          ),
          options.signal
        );
      } catch (error) {
        if (
          options.signal?.aborted ||
          (!timedOut && isAbortError(error)) ||
          error instanceof HttpFetchError ||
          attempt >= maxRetries
        ) {
          throw error;
        }

        await sleep(
          backoffDelayMs(
            attempt,
            options.retryBaseDelayMs ?? this.retryBaseDelayMs,
            options.retryMaxDelayMs ?? this.retryMaxDelayMs
          ),
          options.signal
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`Failed to fetch ${url}`);
  }

  private headersFor(
    url: string,
    headers: Record<string, string> = {}
  ): Record<string, string> {
    return {
      Accept:
        'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: originReferer(url),
      'User-Agent': this.userAgent,
      ...this.defaultHeaders,
      ...headers
    };
  }
}

export class HttpFetchError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly statusText: string
  ) {
    super(`HTTP ${status} ${statusText} for ${url}`);
    this.name = 'HttpFetchError';
  }
}

function originReferer(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}/`;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(
  response: Response,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const retryAfter = retryAfterMs(response.headers.get('Retry-After'));

  if (retryAfter !== null) {
    return retryAfter;
  }

  return backoffDelayMs(attempt, baseDelayMs, maxDelayMs);
}

function retryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(value);

  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function backoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * Math.max(1, baseDelayMs));
  return Math.min(maxDelayMs, exponentialDelay + jitter);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function discardResponseBody(response: Response): Promise<void> {
  await response.body?.cancel();
}

function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
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
