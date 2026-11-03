/**
 * Errors raised while talking to cinema websites. Each one fails the current refresh of its
 * source; the source's previous data is kept (FR-015). None of them is ever retried within a
 * cycle.
 */

/** The cinema signalled that we are not welcome: HTTP 401/403/429 or a CAPTCHA page. */
export class SourceBlockedError extends Error {
  override readonly name = 'SourceBlockedError';
  readonly url: string;

  constructor(url: string, reason: string) {
    super(`Blocked by ${new URL(url).host}: ${reason}`);
    this.url = url;
  }
}

/**
 * Whether a source's stored error says the cinema refused us, which is never retried the same day.
 * Only the message is stored (`sources.last_error`), so it goes by how the two errors here start.
 */
export function isRefusal(message: string): boolean {
  return message.startsWith('Blocked by ') || message.startsWith('robots.txt disallows ');
}

/** The URL is disallowed by the host's robots.txt and the source has no owner override. */
export class RobotsDisallowedError extends Error {
  override readonly name = 'RobotsDisallowedError';
  readonly url: string;

  constructor(url: string) {
    super(`robots.txt disallows ${url}`);
    this.url = url;
  }
}

/** The request could not be completed: network failure, timeout or an unexpected status. */
export class SourceRequestError extends Error {
  override readonly name = 'SourceRequestError';
  readonly url: string;
  /** The HTTP status when the server answered, e.g. 404 for a removed page; else null. */
  readonly status: number | null;

  constructor(url: string, reason: string, options?: ErrorOptions & { status?: number }) {
    super(`Request to ${url} failed: ${reason}`, options);
    this.url = url;
    this.status = options?.status ?? null;
  }
}

/** The response arrived but its content is not what the adapter expects. */
export class SourceResponseError extends Error {
  override readonly name = 'SourceResponseError';
  readonly url: string;

  constructor(url: string, reason: string, options?: ErrorOptions) {
    super(`Unexpected response from ${url}: ${reason}`, options);
    this.url = url;
  }
}
