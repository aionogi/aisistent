import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { invitationEmail, safeFirmName } from "../../lib/email/invitation.ts";
import { emailConfig, EmailDeliveryError, sendEmail, type EmailConfig } from "../../lib/email/lettermint.ts";
import { RATE_POLICIES } from "../../lib/operations/rate-limits.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LINK = "https://app.test/invite/tajni-token/";
const invitation = { to: "marko@example.test", organizationName: "Salon Lepote", role: "member" as const, link: LINK, validDays: 7 };
const MESSAGE = { to: "marko@example.test", subject: "Poziv", text: "Tekst poruke", html: "<p>Tekst</p>" };

test("the invitation names the firm, the role, the link and how long it is valid", () => {
  const email = invitationEmail(invitation);
  assert.equal(email.to, "marko@example.test");
  assert.equal(email.subject, "Poziv u firmu Salon Lepote na aisistent-u");
  for (const body of [email.text, email.html]) {
    assert.ok(body.includes("Salon Lepote"));
    assert.ok(body.includes("kao član"));
    assert.ok(body.includes(LINK));
    assert.ok(body.includes("7 dana"));
  }
  assert.ok(invitationEmail({ ...invitation, role: "admin" }).text.includes("kao administrator"));
  assert.ok(email.html.includes(`<a href="${LINK}"`));
});

test("a firm's name cannot add markup to the email", () => {
  const name = `Firma <script>alert("x")</script> & 'sinovi'`;
  const { html, text } = invitationEmail({ ...invitation, organizationName: name });
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("&#60;script&#62;"));
  assert.ok(html.includes("&#38;"));
  assert.ok(text.includes(name), "plain text keeps the name as written");
});

test("a firm's name that could read as a link is left out of the email", () => {
  for (const name of ["http://evil.example", "Posetite www.evil.example", "evil.example", "Kliknite evil.rs odmah", "pera@evil.example", "ftp://x"]) {
    assert.equal(safeFirmName(name), null, name);
    const { subject, text, html } = invitationEmail({ ...invitation, organizationName: name });
    assert.equal(subject, "Poziv u firmu na aisistent-u");
    assert.ok(text.includes("jednoj firmi"));
    for (const body of [subject, text, html]) assert.ok(!body.includes("evil"), `${name} must not appear`);
  }
  for (const name of ["Test d.o.o.", "A.D. Beograd", "Salon Lepote", "Pekara 21", "Škola „Sunce“", "Sp. z o.o."]) assert.equal(safeFirmName(name), name);
  assert.equal(safeFirmName("   "), null);
});

test("a firm's name is one short line", () => {
  assert.equal(safeFirmName("Salon\r\nBcc: svi‮\tLepote"), "Salon Bcc: svi Lepote");
  assert.equal(safeFirmName("x".repeat(200))?.length, 80);
  assert.ok(!invitationEmail({ ...invitation, organizationName: "Salon\r\nLepote" }).subject.includes("\n"));
});

test("email stays off until both the token and the sender are set", () => {
  const complete = { LETTERMINT_API_TOKEN: " lm_test ", EMAIL_FROM: " aisistent <pozivi@firma.test> " };
  assert.deepEqual(emailConfig(complete), { token: "lm_test", from: "aisistent <pozivi@firma.test>", sendUrl: "https://api.lettermint.co/v1/send" });
  for (const env of [{}, { LETTERMINT_API_TOKEN: "lm_test" }, { EMAIL_FROM: "a@b.test" }, { ...complete, LETTERMINT_API_TOKEN: "  " }, { ...complete, EMAIL_FROM: "bez-adrese" }, { ...complete, EMAIL_FROM: "a@b.test\r\nBcc: x@y.test" }]) {
    assert.equal(emailConfig(env), null, JSON.stringify(env));
  }
});

test("the API address must be HTTPS, or HTTP only on this computer", () => {
  const env = { LETTERMINT_API_TOKEN: "lm_test", EMAIL_FROM: "a@b.test" };
  assert.equal(emailConfig({ ...env, LETTERMINT_API_URL: "http://127.0.0.1:4592" })?.sendUrl, "http://127.0.0.1:4592/v1/send");
  assert.equal(emailConfig({ ...env, LETTERMINT_API_URL: "https://proxy.example/x" })?.sendUrl, "https://proxy.example/v1/send");
  for (const bad of ["http://api.lettermint.co", "ftp://127.0.0.1", "nije adresa"]) assert.equal(emailConfig({ ...env, LETTERMINT_API_URL: bad }), null, bad);
});

async function withServer(handler: RequestListener, run: (config: EmailConfig) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run({ token: "lm_test_token", from: "aisistent <pozivi@firma.test>", sendUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/send` });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("sending posts one message with the token in its header and tracking off", async () => {
  let received: { method?: string; url?: string; headers: IncomingHttpHeaders; body: Record<string, unknown> } | undefined;
  await withServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received = { method: request.method, url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> };
      response.writeHead(202, { "content-type": "application/json" }).end('{"message_id":"m1","status":"pending"}');
    });
  }, (config) => sendEmail(config, MESSAGE));
  assert.equal(received?.method, "POST");
  assert.equal(received?.url, "/v1/send");
  assert.equal(received?.headers["x-lettermint-token"], "lm_test_token");
  assert.equal(received?.headers.authorization, undefined);
  assert.deepEqual(received?.body, {
    from: "aisistent <pozivi@firma.test>", to: ["marko@example.test"], subject: "Poziv", text: "Tekst poruke", html: "<p>Tekst</p>",
    settings: { track_opens: false, track_clicks: false },
  });
});

test("a refused message becomes a fixed code, without the provider's reply, the address or the token", async () => {
  for (const [status, code] of [[401, "credentials_rejected"], [403, "credentials_rejected"], [422, "message_rejected"], [429, "rate_limited"], [500, "provider_error"]] as const) {
    await withServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" }).end('{"message":"marko@example.test tajni-odgovor"}');
    }, async (config) => {
      const error = await sendEmail(config, MESSAGE).then(() => null, (reason: unknown) => reason);
      assert.ok(error instanceof EmailDeliveryError, String(status));
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      for (const secret of ["marko@example.test", "tajni-odgovor", "lm_test_token"]) assert.ok(!JSON.stringify({ ...error, message: error.message, stack: error.stack }).includes(secret));
    });
  }
});

test("a redirect is not followed, so the token stays with the provider", async () => {
  let redirectedRequests = 0;
  const target = createServer((_request, response) => {
    redirectedRequests += 1;
    response.writeHead(202).end();
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  try {
    await withServer((_request, response) => {
      response.writeHead(307, { location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/steal` }).end();
    }, async (config) => {
      await assert.rejects(sendEmail(config, MESSAGE), (error: EmailDeliveryError) => error.code === "unreachable");
    });
  } finally {
    target.closeAllConnections();
    await new Promise((resolve) => target.close(resolve));
  }
  assert.equal(redirectedRequests, 0);
});

test("an unreachable provider is reported, not thrown as a network error", async () => {
  await assert.rejects(sendEmail({ token: "t", from: "a@b.test", sendUrl: "http://127.0.0.1:9/v1/send" }, MESSAGE), (error: EmailDeliveryError) => error instanceof EmailDeliveryError && error.code === "unreachable");
});

test("invitation emails have their own hourly budget", () => {
  assert.deepEqual(RATE_POLICIES["invitation.email"], { limit: 20, seconds: 3600 });
});

test("only the email folder knows the provider", async () => {
  const offenders: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(path.join(projectDir, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else if (/\.tsx?$/.test(entry.name) && /api\.lettermint|x-lettermint-token/i.test(await readFile(path.join(projectDir, relative), "utf8"))) offenders.push(relative.replaceAll("\\", "/"));
    }
  }
  for (const directory of ["app", "components", "lib", "scripts"]) await walk(directory);
  assert.deepEqual(offenders, ["lib/email/lettermint.ts"]);
});
