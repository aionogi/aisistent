import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import nextConfig from "../../next.config.ts";
import { buildInstructions } from "../../lib/assistant/instructions.ts";
import { contentSecurityPolicy } from "../../lib/security/content-security-policy.ts";
import { embedCode, normalizeOrigin, OFF_TOPIC_LIMIT, OFF_TOPIC_MARKER, offTopicState, parseOrigins, readOffTopicMarker } from "../../lib/site-chat/policy.ts";
import { newVisitorToken, visitorTokenHash } from "../../lib/site-chat/token.ts";
import { chooseIndustry, createEmptyOrganizationDraft } from "../../lib/workspace/templates.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("a typed website becomes its https origin; anything else is refused", () => {
  assert.equal(normalizeOrigin("salon.rs"), "https://salon.rs");
  assert.equal(normalizeOrigin("  WWW.Salon.rs/kontakt?x=1 "), "https://www.salon.rs");
  assert.equal(normalizeOrigin("https://salon.rs/"), "https://salon.rs");
  assert.equal(normalizeOrigin("https://salon.rs."), "https://salon.rs");
  assert.equal(normalizeOrigin("čačak-salon.rs"), "https://xn--aak-salon-kfbb.rs");
  for (const refused of ["http://salon.rs", "https://salon.rs:8443", "https://user:pass@salon.rs", "localhost", "https://127.0.0.1", "10.0.0.1", "https://[::1]", "salon", "javascript:alert(1)", "ftp://salon.rs", "salon rs", "", "-salon.rs"]) {
    assert.equal(normalizeOrigin(refused), null, refused);
  }
});

test("the websites field takes lines or commas, removes duplicates, and names the first wrong entry", () => {
  assert.deepEqual(parseOrigins("salon.rs\nwww.salon.rs, salon.rs\n\n"), { origins: ["https://salon.rs", "https://www.salon.rs"] });
  assert.deepEqual(parseOrigins(""), { origins: [] });
  const wrong = parseOrigins("salon.rs\nhttp://stari.rs");
  assert.ok("error" in wrong && wrong.error.includes("http://stari.rs"));
  const many = parseOrigins(["a.rs", "b.rs", "c.rs", "d.rs", "e.rs", "f.rs"].join("\n"));
  assert.ok("error" in many && /Najviše 5/.test(many.error));
});

test("the off-topic marker is removed wherever it appears, and only a run of unrelated messages ends the chat", () => {
  assert.deepEqual(readOffTopicMarker(`${OFF_TOPIC_MARKER} Mogu da pomognem samo oko salona.`), { text: "Mogu da pomognem samo oko salona.", offTopic: true });
  assert.deepEqual(readOffTopicMarker(`Mogu da pomognem samo oko salona. ${OFF_TOPIC_MARKER}`), { text: "Mogu da pomognem samo oko salona.", offTopic: true });
  assert.deepEqual(readOffTopicMarker("Radimo subotom od 9 do 15 h."), { text: "Radimo subotom od 9 do 15 h.", offTopic: false });
  assert.deepEqual(readOffTopicMarker(OFF_TOPIC_MARKER), { text: "", offTopic: true });
  assert.deepEqual(offTopicState(0, true), { streak: 1, ended: false });
  assert.deepEqual(offTopicState(OFF_TOPIC_LIMIT - 1, true), { streak: OFF_TOPIC_LIMIT, ended: true });
  assert.deepEqual(offTopicState(2, false), { streak: 0, ended: false });
});

test("visitor tokens are long random values, and only a well-formed token has a hash", () => {
  const token = newVisitorToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, newVisitorToken());
  assert.equal(visitorTokenHash(token)?.length, 32);
  for (const bad of [null, undefined, 42, "", "short", `${token}x`, token.replace(/.$/, "!")]) assert.equal(visitorTokenHash(bad), null, String(bad));
});

test("the website instructions keep the assistant on the business and mark unrelated replies; the test chat stays as before", () => {
  const draft = chooseIndustry(createEmptyOrganizationDraft(), "salon", "Salon Ana");
  const site = buildInstructions(draft, new Date("2026-11-26T10:00:00Z"), "site");
  assert.ok(site.includes("in the chat on its website"));
  assert.ok(site.includes(`start that reply with ${OFF_TOPIC_MARKER}`));
  assert.ok(site.includes("homework, math, programming"));
  assert.ok(!site.includes("This conversation is a test"));
  const testChat = buildInstructions(draft, new Date("2026-11-26T10:00:00Z"));
  assert.ok(testChat.includes("This conversation is a test"));
  assert.ok(!testChat.includes(OFF_TOPIC_MARKER));
});

test("only the website chat may be framed, and only by the firm's own https origins", () => {
  const directive = (policy: string) => policy.split("; ").find((part) => part.startsWith("frame-ancestors"));
  assert.equal(directive(contentSecurityPolicy("bm9uY2U=", false)), "frame-ancestors 'none'");
  assert.equal(directive(contentSecurityPolicy("bm9uY2U=", false, null, [])), "frame-ancestors 'none'");
  assert.equal(directive(contentSecurityPolicy("bm9uY2U=", false, null, ["https://salon.rs", "https://www.salon.rs"])), "frame-ancestors 'self' https://salon.rs https://www.salon.rs");
  // Nothing else can reach the header, even if the database held it.
  assert.equal(directive(contentSecurityPolicy("bm9uY2U=", false, null, ["*", "https://salon.rs; script-src *", "http://salon.rs"])), "frame-ancestors 'none'");
});

test("X-Frame-Options stays on every page except the website chat", async () => {
  const rules = await nextConfig.headers!();
  const frameOptions = (source: string) => rules.find((rule) => rule.source === source)?.headers.find((header) => header.key === "X-Frame-Options")?.value;
  assert.equal(frameOptions("/:path((?!chat/).*)"), "DENY");
  assert.equal(frameOptions("/chat/:path*"), undefined);
  assert.equal(rules.length, 2);
  assert.ok(rules.every((rule) => rule.headers.some((header) => header.key === "X-Content-Type-Options")));
});

test("the embed script builds its elements without HTML strings, checks the widget id, and loads only from its own address", async () => {
  const source = await readFile(path.join(projectDir, "public/widget.js"), "utf8");
  for (const unsafe of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "document.cookie", "postMessage", "fetch("]) {
    assert.ok(!source.includes(unsafe), `widget.js must not use ${unsafe}`);
  }
  assert.ok(source.includes("/^[0-9a-f]{20}$/.test(id)"));
  assert.ok(source.includes("new URL(script.src).origin"));
  assert.ok(source.includes('origin + "/chat/" + id + "/"'));
  assert.equal(embedCode("https://aisistent.example", "0123456789abcdef0123"), '<script src="https://aisistent.example/widget.js" data-aisistent="0123456789abcdef0123" async></script>');
});
