import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { LogoutToken, SessionData, SessionDataStore } from "@auth0/nextjs-auth0/types";

/** Session lifetimes in seconds; shared with the Auth0 client configuration. */
export const SESSION_DURATIONS = {
  /** Sessions end this long after sign-in, however active they are. */
  absolute: 60 * 60 * 24 * 3,
  /** Sessions end after this much inactivity. */
  inactivity: 60 * 60 * 12,
} as const;

const PAYLOAD_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Auth0 SDK session store backed by PostgreSQL (migration 0002).
 *
 * The SDK keeps only an encrypted session id in the cookie. This store adds:
 * - the id is stored as a SHA-256 hash, never as the value the cookie carries;
 * - the payload is encrypted with AES-256-GCM under a key derived from
 *   AUTH0_SECRET, authenticated together with the id hash so rows cannot be
 *   swapped between sessions;
 * - server-side expiry, deletion on logout, and back-channel logout.
 */
export class PostgresSessionStore implements SessionDataStore {
  private readonly pool: Pool;
  private readonly key: Buffer;

  constructor(pool: Pool, secret: string) {
    if (secret.length < 32) throw new Error("The session secret must be at least 32 characters.");
    this.pool = pool;
    this.key = Buffer.from(hkdfSync("sha256", secret, "aisistent-session-store", "payload-v1", 32));
  }

  async get(id: string): Promise<SessionData | null> {
    const hash = hashId(id);
    const { rows } = await this.pool.query<{ payload: Buffer | null }>("SELECT app.auth_session_get($1) AS payload", [hash]);
    const payload = rows[0]?.payload;
    if (!payload) return null;
    return this.decrypt(payload, hash);
  }

  async set(id: string, session: SessionData): Promise<void> {
    const hash = hashId(id);
    await this.pool.query("SELECT app.auth_session_put($1, $2, $3, $4, $5)", [
      hash,
      session.user.sub,
      typeof session.internal.sid === "string" ? session.internal.sid : null,
      this.encrypt(session, hash),
      expiresAt(session),
    ]);
  }

  async update(id: string, session: SessionData): Promise<boolean> {
    const hash = hashId(id);
    const { rows } = await this.pool.query<{ updated: boolean }>("SELECT app.auth_session_update($1, $2, $3) AS updated", [hash, this.encrypt(session, hash), expiresAt(session)]);
    return rows[0]?.updated === true;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("SELECT app.auth_session_delete($1)", [hashId(id)]);
  }

  async deleteByLogoutToken(token: LogoutToken): Promise<void> {
    await this.pool.query("SELECT app.auth_session_delete_for_logout($1, $2)", [token.sub ?? null, token.sid ?? null]);
  }

  private encrypt(session: SessionData, aad: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([PAYLOAD_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  }

  /** Returns null for unreadable payloads (wrong key, tampering, old format) so the user signs in again. */
  private decrypt(payload: Buffer, aad: Buffer): SessionData | null {
    if (payload.length <= 1 + IV_BYTES + TAG_BYTES || payload[0] !== PAYLOAD_VERSION) return null;
    try {
      const iv = payload.subarray(1, 1 + IV_BYTES);
      const tag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(payload.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
      return JSON.parse(plaintext.toString("utf8")) as SessionData;
    } catch {
      return null;
    }
  }
}

function hashId(id: string): Buffer {
  return createHash("sha256").update(id, "utf8").digest();
}

function expiresAt(session: SessionData): Date {
  const now = Math.floor(Date.now() / 1000);
  const createdAt = typeof session.internal.createdAt === "number" ? session.internal.createdAt : now;
  let expires = Math.min(now + SESSION_DURATIONS.inactivity, createdAt + SESSION_DURATIONS.absolute);
  if (typeof session.internal.sessionExpiresAt === "number") expires = Math.min(expires, session.internal.sessionExpiresAt);
  return new Date(expires * 1000);
}
