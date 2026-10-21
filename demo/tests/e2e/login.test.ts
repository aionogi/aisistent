import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startLocalAuthStack, type LocalAuthStack } from "../support/local-auth-stack.ts";

// Full sign-in round trip through the real Auth0 SDK, proxy, session store,
// and database, with a mock OpenID Connect provider standing in for Auth0.

let stack: LocalAuthStack;
before(async () => { stack = await startLocalAuthStack({ appPort: 4391, issuerPort: 4491, quiet: true }); }, { timeout: 180_000 });
after(async () => { await stack?.stop(); });

/** Minimal browser: keeps cookies for the app origin and follows redirects across the app and the mock provider. */
class Browser {
  readonly cookies = new Map<string, string>();
  readonly setCookieHeaders: string[] = [];

  async get(url: string): Promise<{ response: Response; url: string; body: string }> {
    let current = new URL(url, stack.appUrl);
    for (let hop = 0; hop < 12; hop++) {
      const isApp = current.origin === new URL(stack.appUrl).origin;
      const headers: Record<string, string> = {};
      if (isApp && this.cookies.size) headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await fetch(current, { headers, redirect: "manual" });
      if (isApp) this.store(response);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current);
        continue;
      }
      return { response, url: current.toString(), body: await response.text() };
    }
    throw new Error("Too many redirects");
  }

  private store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      this.setCookieHeaders.push(header);
      const [pair, ...attributes] = header.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute) || /^\s*expires=thu, 01 jan 1970/i.test(attribute));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

const sessionCount = async () => Number((await stack.db.admin.query("SELECT count(*) FROM app.auth_sessions")).rows[0].count);

test("signed-out visitors see the sign-in page, not account data", async () => {
  const browser = new Browser();
  const { response, body } = await browser.get("/account/");
  assert.equal(response.status, 200);
  assert.match(body, /Prijavite se/);
  assert.doesNotMatch(body, /Vaš nalog/);
});

test("sign-in creates the user, an encrypted server-side session, and an HttpOnly cookie", async () => {
  const browser = new Browser();
  const { url, body, response } = await browser.get("/auth/login?returnTo=/account/");
  assert.equal(response.status, 200);
  assert.equal(new URL(url).pathname, "/account/");
  assert.match(body, /Vaš nalog/);
  assert.match(body, /Ana Test/);
  assert.match(body, /Email potvrđen/);
  assert.match(body, /Dvofaktorska prijava/);

  const sessionHeader = browser.setCookieHeaders.find((header) => header.startsWith("__session="));
  assert.ok(sessionHeader, "session cookie set");
  assert.match(sessionHeader, /HttpOnly/i);
  assert.match(sessionHeader, /SameSite=Lax/i);

  const users = await stack.db.admin.query("SELECT email, display_name FROM app.users WHERE auth_subject = 'mock|ana'");
  assert.deepEqual(users.rows, [{ email: "ana@example.test", display_name: "Ana Test" }]);
  assert.equal(await sessionCount(), 1);

  const cookieValue = browser.cookies.get("__session")!;
  const payloads = await stack.db.admin.query("SELECT encode(payload, 'escape') AS raw, encode(id_hash, 'hex') AS id FROM app.auth_sessions");
  assert.ok(!payloads.rows[0].raw.includes("ana@example.test"), "session payload is encrypted");
  assert.ok(!payloads.rows[0].raw.includes(cookieValue) && !cookieValue.includes(payloads.rows[0].id), "neither the cookie nor the id appears in the table");

  // A second visit reuses the same server-side session.
  const again = await browser.get("/account/");
  assert.match(again.body, /Vaš nalog/);
  assert.equal(await sessionCount(), 1);
});

test("a forged or altered session cookie is treated as signed out", async () => {
  const browser = new Browser();
  await browser.get("/auth/login?returnTo=/account/");
  const real = browser.cookies.get("__session")!;
  browser.cookies.set("__session", `${real.slice(0, -4)}AAAA`);
  const { body } = await browser.get("/account/");
  assert.match(body, /Prijavite se/);
});

test("logout deletes the server-side session", async () => {
  const before = await sessionCount();
  const browser = new Browser();
  await browser.get("/auth/login?returnTo=/account/");
  assert.equal(await sessionCount(), before + 1);
  const cookie = browser.cookies.get("__session")!;

  await browser.get("/auth/logout");
  assert.equal(await sessionCount(), before);
  assert.equal(browser.cookies.get("__session"), undefined);

  // Replaying the old cookie no longer works: the session is gone on the server.
  browser.cookies.set("__session", cookie);
  const { body } = await browser.get("/account/");
  assert.match(body, /Prijavite se/);
});

test("without MFA the account page asks for a step-up before creating organizations", async () => {
  stack.user.mfa = false;
  try {
    const browser = new Browser();
    const { body } = await browser.get("/auth/login?returnTo=/account/");
    assert.match(body, /Bez dvofaktorske prijave/);
    assert.match(body, /potrebna je prijava sa dvofaktorskom potvrdom/);
    assert.match(body, /acr_values=http%3A%2F%2Fschemas\.openid\.net%2Fpape%2Fpolicies%2F2007%2F06%2Fmulti-factor/);
  } finally {
    stack.user.mfa = true;
  }
});

test("returnTo cannot send the user to another site", async () => {
  const browser = new Browser();
  const { url } = await browser.get("/auth/login?returnTo=https://evil.example/steal");
  assert.equal(new URL(url).origin, new URL(stack.appUrl).origin);
});

test("the client-side access token endpoint is disabled", async () => {
  const browser = new Browser();
  await browser.get("/auth/login?returnTo=/account/");
  const { response } = await browser.get("/auth/access-token");
  assert.notEqual(response.status, 200);
});
