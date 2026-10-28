import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createUnzip } from "node:zlib";
import { bareHostname, parseImportUrl, PUBLIC_DESTINATIONS, type DestinationPolicy, type UrlError } from "./destination.ts";

/**
 * Fetches one public web page for a knowledge import (OWASP SSRF guidance):
 * GET only, no cookies or credentials, http(s) on standard ports, at most
 * five redirects with each target checked again, a 10 s deadline for the
 * whole fetch, and 2 MB for both the transferred and the decompressed body.
 * The connection uses the address that passed the check (no second DNS
 * lookup), so DNS rebinding cannot redirect it to an internal service.
 */

export type FetchError = UrlError | "host_not_found" | "unreachable" | "tls" | "timeout" | "too_many_redirects" | "http_status" | "unsupported_type" | "too_large" | "unreadable";
export type PageKind = "html" | "text" | "csv";
export type FetchedPage = { url: string; kind: PageKind; text: string };
export type FetchResult = { ok: true; page: FetchedPage } | { ok: false; error: FetchError; status?: number };

type ResolvedAddress = { address: string; family: number };
export type FetchPolicy = DestinationPolicy & {
  resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
};

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "aisistent-knowledge-import/1.0";
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const KINDS: Record<string, PageKind> = {
  "text/html": "html", "application/xhtml+xml": "html", "text/plain": "text", "text/csv": "csv", "text/tab-separated-values": "csv",
};
const TLS_ERRORS = /^(?:CERT_|ERR_TLS_|ERR_SSL_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|HOSTNAME_MISMATCH)/;

const DEFAULT_POLICY: FetchPolicy = {
  ...PUBLIC_DESTINATIONS,
  resolve: (hostname) => dnsLookup(hostname, { all: true, order: "verbatim" }),
  timeoutMs: 10_000,
  maxBytes: MAX_PAGE_BYTES,
  maxRedirects: 5,
};

class FetchFailure extends Error {
  readonly code: FetchError;
  readonly status?: number;
  constructor(code: FetchError, status?: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const notFound = () => Object.assign(new Error("not found"), { code: "ENOTFOUND" });

function checkAddresses(addresses: ResolvedAddress[], policy: FetchPolicy, requestedFamily: unknown): ResolvedAddress[] | Error {
  if (!addresses.length) return notFound();
  // One internal address is enough to refuse: the socket might otherwise fall back to it.
  if (addresses.some(({ address }) => !policy.isAllowedAddress(address))) return new FetchFailure("blocked_destination");
  const usable = requestedFamily === 4 || requestedFamily === 6 ? addresses.filter((entry) => entry.family === requestedFamily) : addresses;
  return usable.length ? usable : notFound();
}

/** Resolves once per connection and refuses it if any address is not allowed. */
function checkedLookup(policy: FetchPolicy): LookupFunction {
  return (hostname, options, callback) => {
    policy.resolve(hostname)
      .then((addresses) => checkAddresses(addresses, policy, options.family), (error: Error) => error)
      .then((result) => {
        if (result instanceof Error) callback(result, "", 0);
        else if (options.all) callback(null, result);
        else callback(null, result[0].address, result[0].family);
      });
  };
}

function mapError(error: unknown, signal: AbortSignal): FetchFailure {
  if (error instanceof FetchFailure) return error;
  if (signal.aborted) return new FetchFailure("timeout");
  const code = (error as NodeJS.ErrnoException)?.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") return new FetchFailure("host_not_found");
  if (TLS_ERRORS.test(code)) return new FetchFailure("tls");
  return new FetchFailure("unreachable");
}

type Response = { redirect: string } | { body: Buffer; kind: PageKind; charset?: string };

function decompressor(encoding: string) {
  if (encoding === "" || encoding === "identity") return null;
  if (encoding === "gzip" || encoding === "x-gzip") return createGunzip();
  if (encoding === "deflate") return createUnzip();
  if (encoding === "br") return createBrotliDecompress();
  throw new FetchFailure("unsupported_type");
}

function readBody(response: IncomingMessage, policy: FetchPolicy, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let inflate: ReturnType<typeof decompressor> = null;
    let transferred = 0;
    let size = 0;
    const chunks: Buffer[] = [];
    const fail = (error: unknown) => {
      // Stopping the decompressor too ends work on input that was already received.
      inflate?.destroy();
      response.destroy();
      reject(error instanceof FetchFailure ? error : mapError(error, signal));
    };
    try {
      inflate = decompressor(String(response.headers["content-encoding"] ?? "").trim().toLowerCase());
    } catch (error) {
      fail(error);
      return;
    }
    const stream: NodeJS.ReadableStream = inflate ? response.pipe(inflate) : response;
    inflate?.on("error", () => fail(new FetchFailure("unreadable")));
    response.on("data", (chunk: Buffer) => {
      transferred += chunk.length;
      if (transferred > policy.maxBytes) fail(new FetchFailure("too_large"));
    });
    response.on("error", fail);
    response.on("close", () => {
      if (!response.complete) fail(new FetchFailure(signal.aborted ? "timeout" : "unreachable"));
    });
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Counts the decompressed size too, so a small compressed bomb stops at the limit.
      if (size > policy.maxBytes) fail(new FetchFailure("too_large"));
      else chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function requestOnce(url: URL, policy: FetchPolicy, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request({
      protocol: url.protocol,
      hostname: bareHostname(url),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      agent: false,
      lookup: checkedLookup(policy),
      signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,text/csv;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "sr-Latn,sr;q=0.9,hr;q=0.6,en;q=0.5",
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (REDIRECTS.has(status) && location) {
        response.resume();
        resolve({ redirect: location });
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new FetchFailure("http_status", status));
        return;
      }
      const [mime, ...parameters] = String(response.headers["content-type"] ?? "").split(";").map((part) => part.trim());
      const kind = KINDS[mime.toLowerCase()];
      if (!kind) {
        response.destroy();
        reject(new FetchFailure("unsupported_type"));
        return;
      }
      if (Number(response.headers["content-length"]) > policy.maxBytes) {
        response.destroy();
        reject(new FetchFailure("too_large"));
        return;
      }
      const charset = parameters.find((parameter) => /^charset=/i.test(parameter))?.slice(8).replace(/^["']|["']$/g, "");
      readBody(response, policy, signal).then((body) => resolve({ body, kind, charset }), reject);
    });
    request.on("error", (error) => reject(mapError(error, signal)));
    request.end();
  });
}

/** Text in the declared charset, else a <meta> charset, else UTF-8 with a Windows-1250 fallback. */
export function decodePage(body: Buffer, declared?: string): string {
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return new TextDecoder("utf-8").decode(body);
  if ((body[0] === 0xff && body[1] === 0xfe) || (body[0] === 0xfe && body[1] === 0xff)) return new TextDecoder(body[0] === 0xff ? "utf-16le" : "utf-16be").decode(body);
  const head = body.subarray(0, 4096).toString("latin1");
  const label = declared || /<meta[^>]+charset\s*=\s*["']?([\w-]{1,40})/i.exec(head)?.[1];
  if (label) {
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // Unknown label: fall through to detection.
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1250").decode(body);
  }
}

/** Fetches one page. `overrides` exist for tests against a local server; production uses the defaults. */
export async function fetchPublicPage(input: string, overrides: Partial<FetchPolicy> = {}): Promise<FetchResult> {
  const policy = { ...DEFAULT_POLICY, ...overrides };
  const parsed = parseImportUrl(input, policy);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
  let url = parsed.url;
  try {
    for (let redirects = 0; ; redirects++) {
      const response = await requestOnce(url, policy, controller.signal);
      if ("body" in response) return { ok: true, page: { url: url.toString(), kind: response.kind, text: decodePage(response.body, response.charset) } };
      if (redirects >= policy.maxRedirects) return { ok: false, error: "too_many_redirects" };
      let target: string;
      try {
        target = new URL(response.redirect, url).toString();
      } catch {
        return { ok: false, error: "invalid_url" };
      }
      const next = parseImportUrl(target, policy);
      if (!next.ok) return { ok: false, error: next.error };
      url = next.url;
    }
  } catch (error) {
    const failure = mapError(error, controller.signal);
    return failure.status ? { ok: false, error: failure.code, status: failure.status } : { ok: false, error: failure.code };
  } finally {
    clearTimeout(timer);
  }
}
