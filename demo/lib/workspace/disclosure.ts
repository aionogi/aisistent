/**
 * People should know from the first words that they are talking to an AI.
 * The EU AI Act requires it for systems that interact with people (Article
 * 50), and the market includes EU countries (risk R20). A greeting that does
 * not say so gets a warning in the assistant settings, and the assistant then
 * says it in its first reply (lib/assistant/instructions.ts).
 */

const AI_MENTION = /(?<![\p{L}\p{N}])(?:AI|АИ)(?![\p{L}\p{N}])|ve[šs]ta[čc]k|вештачк/iu;
const CYRILLIC = /[Ѐ-ӿ]/;

/** True when the greeting tells the customer, in Latin or Cyrillic script, that an AI is answering. */
export function greetingDisclosesAi(greeting: string): boolean {
  return AI_MENTION.test(greeting);
}

/**
 * The greeting with a short disclosure appended in the greeting's own script,
 * or null when the result would exceed the length limit. Only applied when the
 * person asks for it.
 */
export function greetingWithAiDisclosure(greeting: string, assistantName: string, limit: number): string | null {
  const base = greeting.trim();
  const name = assistantName.trim();
  const cyrillic = CYRILLIC.test(base);
  const sentence = cyrillic
    ? (name ? `Ја сам ${name}, АИ асистент.` : "Ја сам АИ асистент.")
    : (name ? `Ja sam ${name}, AI asistent.` : "Ja sam AI asistent.");
  const joined = base ? `${base}${/[.!?…]$/.test(base) ? "" : "."} ${sentence}` : sentence;
  return joined.length <= limit ? joined : null;
}
