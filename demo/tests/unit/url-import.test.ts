import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { gzipSync } from "node:zlib";
import { isPublicAddress, parseImportUrl } from "../../lib/import/destination.ts";
import { decodePage, fetchPublicPage, MAX_PAGE_BYTES, type FetchPolicy } from "../../lib/import/fetch-page.ts";

test("only public unicast addresses are allowed", () => {
  for (const address of ["93.184.216.34", "8.8.8.8", "172.15.255.255", "172.32.0.1", "100.128.0.1", "2a00:1450:4001:82a::200e", "2606:4700::1111"]) {
    assert.ok(isPublicAddress(address), address);
  }
  for (const address of [
    "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.1", "203.0.113.7",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "64:ff9b::7f00:1", "fe80::1", "fe80::1%eth0", "fc00::1", "fd00:ec2::254",
    "ff02::1", "2001:db8::1", "2002:7f00:1::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "3fff::1", "not-an-address", "",
  ]) {
    assert.ok(!isPublicAddress(address), address);
  }
});

test("typed addresses become https URLs; other schemes, credentials, ports and internal hosts are refused", () => {
  const ok = (input: string) => {
    const result = parseImportUrl(input);
    assert.ok(result.ok, input);
    return result.url.toString();
  };
  const error = (input: string) => {
    const result = parseImportUrl(input);
    assert.ok(!result.ok, input);
    return result.error;
  };
  assert.equal(ok("vasafirma.rs/cesta-pitanja"), "https://vasafirma.rs/cesta-pitanja");
  assert.equal(ok("  https://vasafirma.rs/faq?jezik=sr#cene "), "https://vasafirma.rs/faq?jezik=sr");
  assert.equal(ok("https://vasafirma.rs:443/"), "https://vasafirma.rs/");
  assert.equal(ok("http://93.184.216.34/"), "http://93.184.216.34/");

  for (const input of ["ftp://vasafirma.rs/", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,zdravo", "mailto:info@vasafirma.rs"]) {
    assert.equal(error(input), "unsupported_scheme", input);
  }
  assert.equal(error("https://korisnik:lozinka@vasafirma.rs/"), "credentials");
  assert.equal(error("https://vasafirma.rs:8443/"), "port");
  assert.equal(error("http://vasafirma.rs:443/"), "port");
  for (const input of [
    "http://localhost/", "http://LOCALHOST./admin", "http://intranet/", "http://printer.local/", "http://metadata.google.internal/",
    "http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://127.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/", "http://[fd00:ec2::254]/", "http://10.0.0.1/", "http://0/",
  ]) {
    assert.equal(error(input), "blocked_destination", input);
  }
  for (const input of ["", "   ", "https://", "https://vasa firma.rs/", `https://vasafirma.rs/${"a".repeat(2100)}`]) {
    assert.equal(error(input), "invalid_url", JSON.stringify(input.slice(0, 40)));
  }
});

test("page text uses the declared charset, then a meta charset, then UTF-8 or Windows-1250", () => {
  const serbian1250 = Buffer.from([0xc8, 0xe6, 0x9a, 0xf0, 0x9e]);
  assert.equal(decodePage(serbian1250, "windows-1250"), "Čćšđž");
  assert.equal(decodePage(Buffer.concat([Buffer.from('<meta charset="windows-1250"><p>'), serbian1250])), '<meta charset="windows-1250"><p>Čćšđž');
  assert.equal(decodePage(Buffer.from("Čćšđž")), "Čćšđž");
  assert.equal(decodePage(serbian1250), "Čćšđž", "invalid UTF-8 falls back to Windows-1250");
  assert.equal(decodePage(Buffer.from("Čćšđž"), "no-such-charset"), "Čćšđž");
});

// A local server stands in for websites. Tests allow 127.0.0.1 explicitly;
// production code never does.
let server: Server;
let port = 0;
const requests: Array<{ url: string; method: string; headers: IncomingHttpHeaders }> = [];
const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20));

before(async () => {
  server = createServer((request, response) => {
    requests.push({ url: request.url ?? "", method: request.method ?? "", headers: request.headers });
    const html = (body: string | Buffer, type = "text/html; charset=utf-8", extra: Record<string, string> = {}) => {
      response.writeHead(200, { "content-type": type, ...extra });
      response.end(body);
    };
    const redirect = (location: string, status = 302) => {
      response.writeHead(status, { location });
      response.end();
    };
    switch (request.url) {
      case "/page": return html("<p>Zdravo, čitaoče</p>");
      case "/text": return html("Pitanje?\nOdgovor.", "text/plain");
      case "/cp1250": return html(Buffer.from([0x3c, 0x70, 0x3e, 0xc8, 0xe6, 0x9a, 0xf0, 0x9e]), "text/html; charset=windows-1250");
      case "/gzip": return html(gzipSync("<p>Komprimovano</p>"), "text/html", { "content-encoding": "gzip" });
      case "/bomb": return html(bomb, "text/html", { "content-encoding": "gzip" });
      case "/unknown-encoding": return html("x", "text/html", { "content-encoding": "compress" });
      case "/declared-large": return html(Buffer.alloc(MAX_PAGE_BYTES + 1, 0x20), "text/html");
      case "/endless": {
        response.writeHead(200, { "content-type": "text/html" });
        const chunk = Buffer.alloc(64 * 1024, 0x20);
        const write = () => { while (!response.destroyed && response.write(chunk)); };
        response.on("drain", write);
        return write();
      }
      case "/image": return html(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png");
      case "/no-type": { response.writeHead(200); return response.end("<p>x</p>"); }
      case "/missing": { response.writeHead(404, { "content-type": "text/html" }); return response.end("Nema"); }
      case "/hang": return;
      case "/redirect-ok": return redirect("/page", 301);
      case "/redirect-private": return redirect("http://169.254.169.254/latest/meta-data/");
      case "/redirect-loop": return redirect("/redirect-loop");
      case "/redirect-file": return redirect("file:///etc/passwd");
      case "/redirect-credentials": return redirect(`http://korisnik:lozinka@site.test:${port}/page`);
      case "/redirect-internal-name": return redirect(`http://internal.test:${port}/page`, 307);
      default: { response.writeHead(500); return response.end(); }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

let resolutions: string[] = [];
const local = (extra: Partial<FetchPolicy> = {}): Partial<FetchPolicy> => ({
  isAllowedAddress: (address) => address === "127.0.0.1",
  allowPort: () => true,
  resolve: async (hostname) => {
    resolutions.push(hostname);
    if (hostname === "site.test") return [{ address: "127.0.0.1", family: 4 }];
    if (hostname === "internal.test") return [{ address: "10.0.0.5", family: 4 }];
    return [];
  },
  ...extra,
});
const site = (path: string) => `http://site.test:${port}${path}`;

test("a public page is fetched once, without cookies or credentials, through the checked address", async () => {
  requests.length = 0;
  resolutions = [];
  const result = await fetchPublicPage(site("/page"), local());
  assert.deepEqual(result, { ok: true, page: { url: site("/page"), kind: "html", text: "<p>Zdravo, čitaoče</p>" } });
  assert.deepEqual(resolutions, ["site.test"], "one resolution per connection: the connection uses the checked address");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].headers.cookie, undefined);
  assert.equal(requests[0].headers.authorization, undefined);
  assert.match(requests[0].headers["user-agent"] ?? "", /^aisistent-knowledge-import\//);

  assert.deepEqual(await fetchPublicPage(site("/text"), local()), { ok: true, page: { url: site("/text"), kind: "text", text: "Pitanje?\nOdgovor." } });
  const windows1250 = await fetchPublicPage(site("/cp1250"), local());
  assert.ok(windows1250.ok && windows1250.page.text === "<p>Čćšđž");
  const gzip = await fetchPublicPage(site("/gzip"), local());
  assert.ok(gzip.ok && gzip.page.text === "<p>Komprimovano</p>");
  const redirected = await fetchPublicPage(site("/redirect-ok"), local());
  assert.ok(redirected.ok && redirected.page.url === site("/page"));
});

test("names that resolve to an internal address are refused before any request is sent", async () => {
  requests.length = 0;
  const publicPolicy = (addresses: string[]) => ({
    allowPort: () => true,
    resolve: async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  });
  // The real address check (not the test allowance) sees 127.0.0.1 here.
  assert.deepEqual(await fetchPublicPage(site("/page"), publicPolicy(["127.0.0.1"])), { ok: false, error: "blocked_destination" });
  assert.deepEqual(await fetchPublicPage(site("/page"), publicPolicy(["93.184.216.34", "127.0.0.1"])), { ok: false, error: "blocked_destination" }, "a mixed answer is refused as a whole");
  assert.deepEqual(await fetchPublicPage(site("/page"), publicPolicy(["::ffff:127.0.0.1"])), { ok: false, error: "blocked_destination" });
  assert.equal(requests.length, 0);
  assert.deepEqual(await fetchPublicPage(`http://unknown.test:${port}/`, local()), { ok: false, error: "host_not_found" });
});

test("redirects are checked like the first address and limited in number", async () => {
  requests.length = 0;
  assert.deepEqual(await fetchPublicPage(site("/redirect-private"), local()), { ok: false, error: "blocked_destination" });
  assert.deepEqual(await fetchPublicPage(site("/redirect-internal-name"), local()), { ok: false, error: "blocked_destination" });
  assert.deepEqual(await fetchPublicPage(site("/redirect-file"), local()), { ok: false, error: "unsupported_scheme" });
  assert.deepEqual(await fetchPublicPage(site("/redirect-credentials"), local()), { ok: false, error: "credentials" });
  assert.deepEqual(requests.map(({ url }) => url), ["/redirect-private", "/redirect-internal-name", "/redirect-file", "/redirect-credentials"], "no refused target was requested");
  requests.length = 0;
  assert.deepEqual(await fetchPublicPage(site("/redirect-loop"), local()), { ok: false, error: "too_many_redirects" });
  assert.equal(requests.length, 6, "the first request and five redirects");
});

test("status, type, size, compression and time limits", async () => {
  assert.deepEqual(await fetchPublicPage(site("/missing"), local()), { ok: false, error: "http_status", status: 404 });
  assert.deepEqual(await fetchPublicPage(site("/image"), local()), { ok: false, error: "unsupported_type" });
  assert.deepEqual(await fetchPublicPage(site("/no-type"), local()), { ok: false, error: "unsupported_type" });
  assert.deepEqual(await fetchPublicPage(site("/unknown-encoding"), local()), { ok: false, error: "unsupported_type" });
  assert.deepEqual(await fetchPublicPage(site("/declared-large"), local()), { ok: false, error: "too_large" });
  assert.deepEqual(await fetchPublicPage(site("/endless"), local()), { ok: false, error: "too_large" });
  assert.ok(bomb.length < MAX_PAGE_BYTES);
  assert.deepEqual(await fetchPublicPage(site("/bomb"), local()), { ok: false, error: "too_large" }, "a small compressed body stops at the decompressed limit");
  assert.deepEqual(await fetchPublicPage(site("/hang"), local({ timeoutMs: 300 })), { ok: false, error: "timeout" });

  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const closedPort = (closed.address() as AddressInfo).port;
  await new Promise((resolve) => closed.close(resolve));
  assert.deepEqual(await fetchPublicPage(`http://site.test:${closedPort}/`, local()), { ok: false, error: "unreachable" });
});
