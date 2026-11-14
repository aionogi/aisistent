import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

/**
 * Stands in for Anthropic's Messages API in tests and in `npm run
 * dev:local-auth`, so the assistant can be developed without an account or a
 * key. Its replies say plainly that no AI wrote them.
 */

export type MockRequest = { headers: IncomingHttpHeaders; body: { model: string; max_tokens: number; system?: string; messages: Array<{ role: string; content: string }>; [key: string]: unknown } };
export type MockReply = { status?: number; text?: string; stopReason?: string; inputTokens?: number; outputTokens?: number };
export type MockAnthropic = {
  url: string;
  requests: MockRequest[];
  /** Replaces the answer for the following requests; null restores the default echo. */
  respond: (handler: ((request: MockRequest) => MockReply) | null) => void;
  stop: () => Promise<void>;
};

const defaultReply = (request: MockRequest): MockReply => {
  const last = request.body.messages.at(-1)?.content ?? "";
  return { text: `Lokalni probni odgovor, bez AI-ja: primio sam poruku „${String(last).slice(0, 120)}“.`, inputTokens: 1200, outputTokens: 40 };
};

export async function startMockAnthropic(port: number): Promise<MockAnthropic> {
  const requests: MockRequest[] = [];
  let handler: (request: MockRequest) => MockReply = defaultReply;
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method !== "POST" || !request.url?.startsWith("/v1/messages")) {
        response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "Not found" } }));
        return;
      }
      let body: MockRequest["body"];
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as MockRequest["body"];
      } catch {
        response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON" } }));
        return;
      }
      const recorded = { headers: request.headers, body };
      requests.push(recorded);
      const reply = handler(recorded);
      const status = reply.status ?? 200;
      if (status !== 200) {
        const type = status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : status === 529 ? "overloaded_error" : status >= 500 ? "api_error" : "invalid_request_error";
        response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type, message: "Mock failure" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        id: `msg_mock_${requests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: reply.text === undefined ? [] : [{ type: "text", text: reply.text }],
        stop_reason: reply.stopReason ?? "end_turn",
        stop_sequence: null,
        usage: { input_tokens: reply.inputTokens ?? 1000, output_tokens: reply.outputTokens ?? 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respond: (next) => { handler = next ?? defaultReply; },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
