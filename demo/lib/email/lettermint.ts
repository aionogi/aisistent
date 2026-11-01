/** Lettermint's send API, the only code that knows the email provider. Off until LETTERMINT_API_TOKEN and EMAIL_FROM are set. */

const DEFAULT_API_URL = "https://api.lettermint.co";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TIMEOUT_MS = 5_000;

export type EmailConfig = { token: string; from: string; sendUrl: string };
export type EmailMessage = { to: string; subject: string; text: string; html: string };
export type EmailFailure = "credentials_rejected" | "message_rejected" | "rate_limited" | "provider_error" | "unreachable";

/** Carries only a fixed code: it reaches logs and error reporting, so never the address, the message or the provider's reply. */
export class EmailDeliveryError extends Error {
  readonly code: EmailFailure;
  constructor(code: EmailFailure) {
    super(code);
    this.name = "EmailDeliveryError";
    this.code = code;
  }
}

function sendUrl(base: string | undefined): string | null {
  try {
    const url = new URL(base?.trim() || DEFAULT_API_URL);
    if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) return new URL("/v1/send", url).href;
  } catch {
    // A malformed address leaves email off.
  }
  return null;
}

export function emailConfig(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  const token = env.LETTERMINT_API_TOKEN?.trim();
  const from = env.EMAIL_FROM?.trim();
  const url = sendUrl(env.LETTERMINT_API_URL);
  if (!token || !from?.includes("@") || /[\r\n]/.test(from) || !url) return null;
  return { token, from, sendUrl: url };
}

function failureFor(status: number): EmailFailure {
  if (status === 401 || status === 403) return "credentials_rejected";
  if (status === 429) return "rate_limited";
  return status >= 400 && status < 500 ? "message_rejected" : "provider_error";
}

export async function sendEmail(config: EmailConfig, message: EmailMessage): Promise<void> {
  let response: Response;
  try {
    response = await fetch(config.sendUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lettermint-token": config.token },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        // Click tracking would send a one-time link through the provider's tracking host.
        settings: { track_opens: false, track_clicks: false },
      }),
      // A redirect would carry the token to another address.
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new EmailDeliveryError("unreachable");
  }
  await response.body?.cancel();
  if (!response.ok) throw new EmailDeliveryError(failureFor(response.status));
}
