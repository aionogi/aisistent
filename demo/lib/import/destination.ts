import { BlockList, isIP } from "node:net";

/**
 * Which destinations the server may fetch for a URL import. Only public
 * unicast addresses on the standard ports are allowed; the address check runs
 * again on every resolved address when the connection is made (fetch-page.ts),
 * so a name that later resolves elsewhere cannot reach an internal service.
 */

// IANA special-purpose IPv4 ranges that are not globally reachable, plus multicast and reserved space.
const DENIED_IPV4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
// Global unicast is 2000::/3. Inside it: IETF protocol assignments (Teredo and others),
// documentation prefixes, and 6to4, which can tunnel to any IPv4 address.
const DENIED_IPV6: Array<[string, number]> = [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]];

const deniedV4 = new BlockList();
for (const [network, prefix] of DENIED_IPV4) deniedV4.addSubnet(network, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const deniedV6 = new BlockList();
for (const [network, prefix] of DENIED_IPV6) deniedV6.addSubnet(network, prefix, "ipv6");

/** IPv6 outside 2000::/3 is refused, which covers loopback, link-local, ULA, IPv4-mapped and NAT64 forms. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !deniedV4.check(address, "ipv4");
  if (family === 6) return !address.includes("%") && globalV6.check(address, "ipv6") && !deniedV6.check(address, "ipv6");
  return false;
}

export const MAX_URL_LENGTH = 2048;

export type UrlError = "invalid_url" | "unsupported_scheme" | "credentials" | "port" | "blocked_destination";
export type DestinationPolicy = { isAllowedAddress: (address: string) => boolean; allowPort: (port: string) => boolean };
export const PUBLIC_DESTINATIONS: DestinationPolicy = { isAllowedAddress: isPublicAddress, allowPort: (port) => port === "" };

// Names that only resolve inside a private network; their addresses are checked anyway.
const INTERNAL_SUFFIXES = ["localhost", "local", "internal", "intranet", "lan", "home", "corp", "home.arpa", "localdomain"];
const NON_HTTP_SCHEME = /^(?:javascript|data|file|mailto|ftp|ws|wss|blob|about|vbscript|gopher|tel):/i;

/** The bare host name or address, without IPv6 brackets. */
export const bareHostname = (url: URL) => url.hostname.replace(/^\[(.*)\]$/, "$1");

/**
 * Parses what a person typed, or a redirect target, into an absolute http(s)
 * URL without credentials, fragment, or a non-standard port. A missing scheme
 * means https. IP literals are checked here; host names when connecting.
 */
export function parseImportUrl(input: string, policy: DestinationPolicy = PUBLIC_DESTINATIONS): { ok: true; url: URL } | { ok: false; error: UrlError } {
  const value = input.trim();
  if (!value || value.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f\s]/.test(value)) return { ok: false, error: "invalid_url" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && NON_HTTP_SCHEME.test(value)) return { ok: false, error: "unsupported_scheme" };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "unsupported_scheme" };
  if (url.username || url.password) return { ok: false, error: "credentials" };
  if (!policy.allowPort(url.port)) return { ok: false, error: "port" };
  url.hash = "";

  const host = bareHostname(url);
  if (isIP(host)) return policy.isAllowedAddress(host) ? { ok: true, url } : { ok: false, error: "blocked_destination" };
  const name = host.toLowerCase().replace(/\.$/, "");
  if (!name || name.length > 253) return { ok: false, error: "invalid_url" };
  if (!name.includes(".") || INTERNAL_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))) return { ok: false, error: "blocked_destination" };
  return { ok: true, url };
}
