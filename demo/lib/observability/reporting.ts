import type { BrowserOptions, ErrorEvent, Exception, StackFrame } from "@sentry/browser";

/**
 * What may leave the app for error reporting (Sentry), with no provider code,
 * so the rules are testable and apply to browser and server alike. Events pass
 * through an allowlist: a field the SDK adds later stays out until added here.
 * People's data never leaves: no request, user, cookies, breadcrumbs or
 * variables; messages lose quoted text, addresses, numbers and tokens.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_TEXT = 500;
const MAX_FRAMES = 50;
const MAX_EXCEPTIONS = 5;
const THROTTLE_MS = 60_000;
const MAX_THROTTLE_KEYS = 100;
const REPORTED_TAGS = ["event", "operation"];

/** SDK options shared by browser and server: errors only. The SDK collects all of this unless told not to. */
export const PRIVATE_OPTIONS: Pick<BrowserOptions, "dataCollection" | "maxBreadcrumbs" | "sendClientReports" | "beforeBreadcrumb"> = {
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0 },
  maxBreadcrumbs: 0,
  sendClientReports: false,
  beforeBreadcrumb: () => null,
};

/** The configured DSN when usable: HTTPS, or HTTP on this computer for tests. */
export function reportingDsn(value: string | undefined): string | null {
  const dsn = value?.trim();
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
    return secure && url.username && url.pathname.length > 1 ? dsn : null;
  } catch {
    return null;
  }
}

/** The origin the browser may send reports to, for the CSP's connect-src. */
export function reportingOrigin(value: string | undefined): string | null {
  const dsn = reportingDsn(value);
  return dsn ? new URL(dsn).origin : null;
}

/** Removes what could identify a person. Capped first: the patterns are linear only on short input. */
export function scrubText(text: string): string {
  return text
    .slice(0, MAX_TEXT)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "[url]")
    .replace(/[^\s@"'`]+@[^\s@"'`]+/g, "[email]")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "[text]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    .replace(/[A-Za-z0-9_-]{20,}/g, "[id]")
    .replace(/\+?\d[\d\s()/-]{5,}\d/g, "[number]")
    .slice(0, MAX_TEXT);
}

/**
 * Keeps the app's own bundles and code paths, without the computer's folders.
 * A page's address can hold a token, so it never leaves.
 */
function safeFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const path = filename.split(/[?#]/)[0];
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    const start = path.indexOf("/_next/");
    return start === -1 ? "[page]" : path.slice(start, start + MAX_TEXT);
  }
  const start = path.search(/(?:\.next|node_modules)[\\/]/);
  return (start === -1 ? path : path.slice(start)).slice(0, MAX_TEXT);
}

/** In the browser only the app's own scripts count, not extensions or scripts others inject. */
export function fromOwnScripts(event: ErrorEvent): boolean {
  return Boolean(event.exception?.values?.some((exception) => exception.stacktrace?.frames?.some((frame) => frame.filename?.includes("/_next/static/"))));
}

function safeFrame(frame: StackFrame): StackFrame {
  return { filename: safeFilename(frame.filename), function: frame.function?.slice(0, 200), lineno: frame.lineno, colno: frame.colno, in_app: frame.in_app };
}

function safeException(exception: Exception): Exception {
  const frames = exception.stacktrace?.frames?.slice(-MAX_FRAMES).map(safeFrame);
  return {
    type: exception.type?.slice(0, 200),
    value: exception.value === undefined ? undefined : scrubText(exception.value),
    mechanism: exception.mechanism && { type: exception.mechanism.type, handled: exception.mechanism.handled },
    ...(frames ? { stacktrace: { frames } } : {}),
  };
}

export function minimalEvent<T extends ErrorEvent>(event: T): T {
  const exceptions = event.exception?.values?.slice(-MAX_EXCEPTIONS).map(safeException);
  const tags = Object.entries(event.tags ?? {}).filter(([name]) => REPORTED_TAGS.includes(name));
  const safe: ErrorEvent = {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    environment: event.environment,
    release: event.release,
    // Tells Sentry not to store the sender's IP address.
    sdk: { name: event.sdk?.name, version: event.sdk?.version, settings: { infer_ip: "never" } },
    ...(event.transaction ? { transaction: scrubText(event.transaction) } : {}),
    ...(event.message ? { message: scrubText(event.message) } : {}),
    ...(tags.length ? { tags: Object.fromEntries(tags) } : {}),
    ...(exceptions ? { exception: { values: exceptions } } : {}),
  };
  return safe as T;
}

/**
 * The SDK's beforeSend: strips the event, then sends the same failure at most
 * once a minute per server or page, so an outage or a loop cannot use up the
 * reporting quota, and neither can someone repeating a failing request.
 */
export function createBeforeSend(now: () => number = Date.now) {
  const lastSent = new Map<string, number>();
  return <T extends ErrorEvent>(event: T): T | null => {
    const safe = minimalEvent(event);
    const first = safe.exception?.values?.at(-1);
    const key = [safe.tags?.event, safe.tags?.operation, first?.type, first?.value ?? safe.message].map(String).join("|");
    const previous = lastSent.get(key);
    if (previous !== undefined && now() - previous < THROTTLE_MS) return null;
    if (lastSent.size >= MAX_THROTTLE_KEYS) lastSent.clear();
    lastSent.set(key, now());
    return safe;
  };
}
