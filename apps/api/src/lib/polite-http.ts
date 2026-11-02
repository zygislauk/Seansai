import robotsParserImport from 'robots-parser';
import type { z } from 'zod';
import {
  RobotsDisallowedError,
  SourceBlockedError,
  SourceRequestError,
  SourceResponseError,
} from './errors.ts';
import type { Logger } from './logger.ts';

/**
 * Good-citizen HTTP access to cinema websites (research.md §1b): an identifying User-Agent with a
 * contact address, sequential requests with a pause per host, a timeout, robots.txt checks and an
 * immediate stop on any sign of blocking. It deliberately never spoofs browser headers, rotates
 * IPs, retries a blocked request or solves CAPTCHAs.
 */
export interface HttpClient {
  getText(url: string): Promise<string>;
  getJson<T>(url: string, schema: z.ZodType<T>): Promise<T>;
  /** Marks the start of a refresh cycle (resets the once-per-cycle override warning). */
  beginCycle(): void;
}

const MIN_DELAY_PER_HOST_MS = 500;
const TIMEOUT_MS = 15_000;
const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1000;
const BLOCKING_STATUSES = new Set([401, 403, 429]);
/** Say who refused a request and why. Only these are logged, so cookies never reach the logs. */
const REFUSAL_HEADERS = [
  'server',
  'content-type',
  'retry-after',
  'via',
  'cf-ray',
  'cf-mitigated',
  'cf-cache-status',
];
const REFUSAL_BODY_CHARS = 1000;
const REFUSAL_BODY_WAIT_MS = 2000;

/**
 * Markers of challenge pages that block automated clients (Cloudflare, DataDome and generic
 * CAPTCHA walls). Kept specific so that ordinary pages that merely load reCAPTCHA for a form are
 * not mistaken for a block.
 */
const CAPTCHA_MARKERS = [
  /<title>\s*(just a moment|attention required)/i,
  /challenges\.cloudflare\.com|cf-chl-/i,
  /captcha-delivery\.com/i,
  /<title>[^<]*captcha[^<]*<\/title>/i,
];

type RobotsRules = { isAllowed(url: string, userAgent?: string): boolean | undefined };
// robots-parser is CommonJS but ships ES-style typings, which TypeScript cannot reconcile under
// NodeNext; at runtime Node's default import is the parser function itself.
const robotsParser = robotsParserImport as unknown as (
  url: string,
  contents: string,
) => RobotsRules;
/** The in-flight or settled lookup, so concurrent requests share one robots.txt fetch. */
type CachedRobots = { rules: Promise<RobotsRules | null>; fetchedAt: number };

export type PoliteHttpOptions = {
  sourceId: string;
  /** An email address or an https URL where cinemas can reach the project. */
  contact: string;
  /** Owner-approved exception to robots.txt (only `vue` and `cinamon`, research.md §1b). */
  robotsOverride: boolean;
  logger: Logger;
  fetch?: typeof globalThis.fetch;
};

type HttpReply = { ok: boolean; status: number; contentType: string; body: string };

export class PoliteHttpClient implements HttpClient {
  readonly #sourceId: string;
  readonly #userAgent: string;
  readonly #robotsOverride: boolean;
  readonly #logger: Logger;
  readonly #fetch: typeof globalThis.fetch;
  readonly #robotsByOrigin = new Map<string, CachedRobots>();
  /** Per host: the promise of the most recent request slot, so requests run one after another. */
  readonly #queueByHost = new Map<string, Promise<void>>();
  readonly #lastRequestAtByHost = new Map<string, number>();
  #overrideWarnedThisCycle = false;

  constructor(options: PoliteHttpOptions) {
    this.#sourceId = options.sourceId;
    const contact = options.contact.startsWith('https://')
      ? options.contact
      : `mailto:${options.contact}`;
    this.#userAgent = `Seansai/1.0 (+${contact})`;
    this.#robotsOverride = options.robotsOverride;
    this.#logger = options.logger;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  beginCycle(): void {
    this.#overrideWarnedThisCycle = false;
  }

  async getText(url: string): Promise<string> {
    await this.#checkRobots(url);
    const reply = await this.#request(url);
    if (BLOCKING_STATUSES.has(reply.status)) {
      throw new SourceBlockedError(url, `HTTP ${String(reply.status)}`);
    }
    if (!reply.ok) {
      throw new SourceRequestError(url, `HTTP ${String(reply.status)}`, { status: reply.status });
    }
    if (
      reply.contentType.includes('html') &&
      CAPTCHA_MARKERS.some((marker) => marker.test(reply.body))
    ) {
      throw new SourceBlockedError(url, 'CAPTCHA or challenge page');
    }
    return reply.body;
  }

  async getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    return parseJsonBody(url, await this.getText(url), schema);
  }

  async #checkRobots(url: string): Promise<void> {
    const rules = await this.#robotsFor(new URL(url).origin);
    if (!rules || rules.isAllowed(url, this.#userAgent) !== false) return;
    if (!this.#robotsOverride) throw new RobotsDisallowedError(url);
    if (!this.#overrideWarnedThisCycle) {
      this.#overrideWarnedThisCycle = true;
      this.#logger.warn(
        { source: this.#sourceId, url },
        'Fetching a URL disallowed by robots.txt override (owner decision, research.md §1b)',
      );
    }
  }

  /** Parsed robots.txt rules for an origin, or null when the host publishes none. */
  #robotsFor(origin: string): Promise<RobotsRules | null> {
    const cached = this.#robotsByOrigin.get(origin);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_MS) return cached.rules;

    const rules = this.#fetchRobots(origin);
    this.#robotsByOrigin.set(origin, { rules, fetchedAt: Date.now() });
    // A failed lookup must not be cached for a day; the next cycle tries again.
    rules.catch(() => this.#robotsByOrigin.delete(origin));
    return rules;
  }

  async #fetchRobots(origin: string): Promise<RobotsRules | null> {
    const robotsUrl = `${origin}/robots.txt`;
    const reply = await this.#request(robotsUrl);
    if (reply.ok) return robotsParser(robotsUrl, reply.body);

    // RFC 9309 §2.3.1.3: an unavailable robots.txt (4xx) means no restrictions.
    if (reply.status >= 400 && reply.status < 500) return null;
    // RFC 9309 §2.3.1.4: an unreachable robots.txt (5xx) means assume everything is disallowed.
    throw new SourceRequestError(
      robotsUrl,
      `robots.txt unreachable (HTTP ${String(reply.status)})`,
    );
  }

  /**
   * One request with its body read, all within the timeout: a server can send its headers and then
   * stall, and a stalled source would hold up every source storing after it.
   */
  async #request(url: string): Promise<HttpReply> {
    await this.#waitForTurn(new URL(url).host);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);
    try {
      const response = await this.#fetch(url, {
        // An explicit language replaces fetch's default "Accept-Language: *", which makes Forum's
        // API answer its missing robots.txt with HTTP 500 (read as "disallow") instead of 404.
        headers: { 'user-agent': this.#userAgent, 'accept-language': 'lt' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (BLOCKING_STATUSES.has(response.status)) await this.#logRefusal(url, response);
      else if (!response.ok) await response.body?.cancel();
      return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body: response.ok ? await response.text() : '',
      };
    } catch (error) {
      const reason = controller.signal.aborted
        ? `timed out after ${String(TIMEOUT_MS)} ms`
        : 'network error';
      throw new SourceRequestError(url, reason, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** A firewall usually names itself in a refusal, which tells a cinema what to look for. */
  async #logRefusal(url: string, response: Response): Promise<void> {
    const headers = Object.fromEntries(
      REFUSAL_HEADERS.flatMap((name) => {
        const value = response.headers.get(name);
        return value === null ? [] : [[name, value]];
      }),
    );
    this.#logger.warn(
      {
        source: this.#sourceId,
        url,
        status: response.status,
        headers,
        bodyStart: await startOfBody(response),
      },
      'Source refused the request',
    );
  }

  /** Resolves when this request may start: at least 500 ms after the previous one to the host. */
  #waitForTurn(host: string): Promise<void> {
    const previous = this.#queueByHost.get(host) ?? Promise.resolve();
    const turn = previous.then(async () => {
      const lastRequestAt = this.#lastRequestAtByHost.get(host);
      if (lastRequestAt !== undefined) {
        const wait = lastRequestAt + MIN_DELAY_PER_HOST_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.#lastRequestAtByHost.set(host, Date.now());
    });
    this.#queueByHost.set(host, turn);
    return turn;
  }
}

/**
 * The first bytes of a refusal, without waiting long or failing: the refusal is already known, and
 * its body can stall or break off.
 */
async function startOfBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([
    reader.read().catch(() => undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        resolve(undefined);
      }, REFUSAL_BODY_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  void reader.cancel().catch(() => undefined);
  const bytes = first?.value as Uint8Array | undefined;
  return new TextDecoder().decode(bytes).replace(/\s+/g, ' ').slice(0, REFUSAL_BODY_CHARS);
}

/** Parses a JSON body and validates it; shared by the live and the fixture clients. */
export function parseJsonBody<T>(url: string, body: string, schema: z.ZodType<T>): T {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new SourceResponseError(url, 'body is not valid JSON', { cause: error });
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join('.') ?? '';
    throw new SourceResponseError(url, `${where} ${issue?.message ?? 'invalid shape'}`.trim(), {
      cause: result.error,
    });
  }
  return result.data;
}
