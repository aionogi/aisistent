// Loaded after the page, so reporting does not slow it down, and only when a DSN is set.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) void import("./lib/observability/sentry-client.ts").catch(() => undefined);

export {};
