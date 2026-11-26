import { createHash, randomBytes } from "node:crypto";

/**
 * Visitor tokens of the website chat. The browser holds the token; the
 * database keeps only its SHA-256 hash (migration 0010). Server code only.
 */

const VISITOR_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** A new visitor token: 256 random bits. */
export function newVisitorToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores for a visitor token, or null for a value that is not one. */
export function visitorTokenHash(token: unknown): Buffer | null {
  return typeof token === "string" && VISITOR_TOKEN.test(token) ? createHash("sha256").update(token).digest() : null;
}
