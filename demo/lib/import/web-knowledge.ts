import { cleanField, questionKey, readRecords, type RawRecord } from "../workspace/knowledge-import.ts";
import { LIMITS } from "../workspace/validation.ts";
import type { FetchedPage } from "./fetch-page.ts";

/**
 * Suggests knowledge entries from one fetched page. Nothing on the page is
 * executed or followed: scripts and styles are skipped (JSON-LD is parsed as
 * data), and the tolerant parser below only builds enough of a tree to find
 * questions and the text that follows them. Element count and nesting depth
 * are capped, so hostile markup costs bounded time and memory.
 *
 * Sources, in order: schema.org FAQPage data, <details>/<summary>, <dl>
 * lists, two-column tables, and headings or "…?" lines followed by text.
 */

export const MAX_WEB_RECORDS = 300;
const MAX_ELEMENTS = 100_000;
const MAX_DEPTH = 200;

type Element = { tag: string; attrs: Record<string, string>; children: Node[] };
type Node = Element | string;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"]);
// Never page text; skipped up to the matching end tag.
const RAW = ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "template", "svg", "math", "object"];
const RAW_END = new Map(RAW.map((tag) => [tag, new RegExp(`</${tag}[\\s/>]`, "gi")]));
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "menu", "nav", "ol", "p", "pre", "section", "summary", "table", "ul"]);
const P_SCOPE = new Set(["button", "table", "td", "th", "caption", "object", "template"]);
const LIST_SCOPE = new Set(["ul", "ol", "menu", "dl", "table", "td", "th", "caption", "button", "object", "template", "section", "article", "nav", "aside", "main", "header", "footer", "form", "details", "blockquote", "figure", "fieldset"]);
const BLOCK = new Set([...CLOSES_P, "br", "caption", "tbody", "td", "tfoot", "th", "thead", "tr"]);
const ALWAYS_SKIPPED = new Set(["nav", "aside", "form", "dialog", "select", "option", "optgroup", "datalist", "input", "img", "picture", "video", "audio", "canvas", "map"]);
const SKIPPED_ROLES = new Set(["navigation", "banner", "contentinfo", "search", "dialog", "alertdialog", "menu", "menubar", "complementary"]);
const SECTIONING = new Set(["main", "article", "section"]);
const KEPT_ATTRIBUTES = new Set(["type", "role"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "", zwnj: "", zwj: "",
  ndash: "–", mdash: "—", minus: "−", hellip: "…", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  ldquo: "“", rdquo: "”", bdquo: "„", lsquo: "‘", rsquo: "’", sbquo: "‚", prime: "′", Prime: "″",
  euro: "€", cent: "¢", pound: "£", copy: "©", reg: "®", trade: "™", deg: "°", middot: "·", bull: "•",
  times: "×", divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾", sect: "§", para: "¶", num: "#", percnt: "%",
  ccaron: "č", Ccaron: "Č", cacute: "ć", Cacute: "Ć", dstrok: "đ", Dstrok: "Đ", scaron: "š", Scaron: "Š", zcaron: "ž", Zcaron: "Ž",
  aacute: "á", Aacute: "Á", eacute: "é", Eacute: "É", iacute: "í", oacute: "ó", uacute: "ú", agrave: "à", egrave: "è",
  auml: "ä", Auml: "Ä", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", szlig: "ß", ntilde: "ñ", ccedil: "ç",
};
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));?/g;

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (match, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED_ENTITIES[name] ?? match;
    const code = parseInt(decimal ?? hex!, decimal ? 10 : 16);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : "�";
  });
}

const isSpace = (char: string | undefined) => char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
const TAG_NAME = /[a-zA-Z][^\s/>]*/y;
const ATTRIBUTE_NAME = /[^\s"'>/=]+/y;
const UNQUOTED_VALUE = /[^\s>]*/y;

/** Attributes up to the end of a start tag. An unclosed quote runs to the end, as in browsers. */
function readAttributes(html: string, start: number): { attrs: Record<string, string>; end: number } {
  const attrs: Record<string, string> = {};
  let position = start;
  while (position < html.length) {
    const char = html[position];
    if (char === ">") return { attrs, end: position + 1 };
    if (char === "/" || isSpace(char)) { position++; continue; }
    ATTRIBUTE_NAME.lastIndex = position;
    const name = ATTRIBUTE_NAME.exec(html)?.[0];
    if (!name) { position++; continue; }
    position += name.length;
    while (isSpace(html[position])) position++;
    let value = "";
    if (html[position] === "=") {
      position++;
      while (isSpace(html[position])) position++;
      const quote = html[position];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, position + 1);
        value = html.slice(position + 1, close === -1 ? html.length : close);
        position = close === -1 ? html.length : close + 1;
      } else {
        UNQUOTED_VALUE.lastIndex = position;
        value = UNQUOTED_VALUE.exec(html)?.[0] ?? "";
        position += value.length;
      }
    }
    const key = name.toLowerCase();
    if (KEPT_ATTRIBUTES.has(key) && !Object.hasOwn(attrs, key)) attrs[key] = decodeEntities(value).trim().toLowerCase();
  }
  return { attrs, end: html.length };
}

type Document = { root: Element; title: string; jsonLd: string[] };

/** A tolerant HTML tree builder covering the implied end tags that matter for text. */
export function parseHtml(html: string): Document {
  const root: Element = { tag: "#root", attrs: {}, children: [] };
  const stack: Element[] = [root];
  const jsonLd: string[] = [];
  let title = "";
  let elements = 0;
  const top = () => stack[stack.length - 1];
  const addText = (text: string) => { if (text) top().children.push(decodeEntities(text)); };

  /** Closes the nearest open element among `tags`, unless an element of `scope` comes first. */
  const closeOpen = (tags: string[], scope: Set<string>) => {
    for (let index = stack.length - 1; index > 0; index--) {
      const tag = stack[index].tag;
      if (tags.includes(tag)) { stack.length = index; return; }
      if (scope.has(tag)) return;
    }
  };

  const open = (tag: string, attrs: Record<string, string>) => {
    if (tag === "html" || tag === "head" || tag === "body") return;
    if (CLOSES_P.has(tag)) closeOpen(["p"], P_SCOPE);
    if (tag === "li") closeOpen(["li"], LIST_SCOPE);
    if (tag === "dt" || tag === "dd") closeOpen(["dt", "dd"], LIST_SCOPE);
    if (tag === "tr") closeOpen(["tr", "td", "th"], new Set(["table", "thead", "tbody", "tfoot"]));
    if (tag === "td" || tag === "th") closeOpen(["td", "th"], new Set(["tr", "table"]));
    if (tag === "thead" || tag === "tbody" || tag === "tfoot") closeOpen(["thead", "tbody", "tfoot", "tr", "td", "th"], new Set(["table"]));
    if (HEADINGS.has(tag) && HEADINGS.has(top().tag)) stack.pop();
    if (elements >= MAX_ELEMENTS) return;
    const element: Element = { tag, attrs, children: [] };
    top().children.push(element);
    elements++;
    if (!VOID.has(tag) && stack.length < MAX_DEPTH) stack.push(element);
  };

  const close = (tag: string) => {
    if (tag === "html" || tag === "head" || tag === "body") return;
    if (tag === "br") return open("br", {});
    for (let index = stack.length - 1; index > 0; index--) {
      if (stack[index].tag === tag || (HEADINGS.has(tag) && HEADINGS.has(stack[index].tag))) {
        stack.length = index;
        return;
      }
    }
  };

  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt === -1) { addText(html.slice(index)); break; }
    if (lt > index) addText(html.slice(index, lt));
    index = lt;
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    const next = html[index + 1];
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", index);
      index = end === -1 ? html.length : end + 1;
      continue;
    }
    if (next === "/") {
      TAG_NAME.lastIndex = index + 2;
      const name = TAG_NAME.exec(html)?.[0];
      const end = html.indexOf(">", index);
      index = end === -1 ? html.length : end + 1;
      if (name) close(name.toLowerCase());
      continue;
    }
    TAG_NAME.lastIndex = index + 1;
    const name = TAG_NAME.exec(html)?.[0];
    if (!name) {
      addText("<");
      index++;
      continue;
    }
    const tag = name.toLowerCase();
    const { attrs, end } = readAttributes(html, index + 1 + name.length);
    index = end;
    const rawEnd = RAW_END.get(tag);
    if (rawEnd) {
      rawEnd.lastIndex = index;
      const found = rawEnd.exec(html);
      const content = html.slice(index, found ? found.index : html.length);
      if (tag === "script" && attrs.type?.includes("ld+json")) jsonLd.push(content);
      if (tag === "title" && !title) title = decodeEntities(content);
      index = found ? (html.indexOf(">", found.index) + 1 || html.length) : html.length;
      continue;
    }
    open(tag, attrs);
  }
  return { root, title, jsonLd };
}

const isElement = (node: Node): node is Element => typeof node !== "string";

/** The element's text with block boundaries as spaces. Buttons count only in question text. */
function textOf(node: Node | undefined, keepButtons = false): string {
  if (!node) return "";
  const parts: string[] = [];
  const visit = (current: Node) => {
    if (!isElement(current)) { parts.push(current); return; }
    if (ALWAYS_SKIPPED.has(current.tag) || (current.tag === "button" && !keepButtons)) return;
    const block = BLOCK.has(current.tag);
    if (block) parts.push(" ");
    current.children.forEach(visit);
    if (block) parts.push(" ");
  };
  visit(node);
  return cleanField(parts.join("").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));
}

type Pair = { question: string; answer: string };
type Block =
  | { kind: "text"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "pairs"; pairs: Pair[]; summary: string }
  | { kind: "break" };

function findMain(element: Element): Element | null {
  for (const child of element.children) {
    if (!isElement(child)) continue;
    if (child.tag === "main" || child.attrs.role === "main") return child;
    const found = findMain(child);
    if (found) return found;
  }
  return null;
}

function definitionPairs(list: Element): Pair[] {
  const pairs: Pair[] = [];
  let question: string[] = [];
  let answer: string[] = [];
  const emit = () => {
    if (question.length && answer.length) pairs.push({ question: question.join(" "), answer: answer.join(" ") });
    question = [];
    answer = [];
  };
  const items = list.children.filter(isElement).flatMap((child) => child.tag === "div" ? child.children.filter(isElement) : [child]);
  for (const item of items) {
    if (item.tag === "dt") {
      if (answer.length) emit();
      question.push(textOf(item, true));
    } else if (item.tag === "dd") {
      answer.push(textOf(item));
    }
  }
  emit();
  return pairs;
}

const LAYOUT_CONTENT = new Set(["table", "p", "div", "ul", "ol", "dl", "details", "section", "article", "form", "h1", "h2", "h3", "h4", "h5", "h6"]);

function containsLayout(element: Element): boolean {
  return element.children.some((child) => isElement(child) && (LAYOUT_CONTENT.has(child.tag) || containsLayout(child)));
}

function tableRows(table: Element): Element[][] {
  const rows: Element[][] = [];
  const visit = (element: Element) => {
    for (const child of element.children) {
      if (!isElement(child) || child.tag === "table") continue;
      if (child.tag === "tr") rows.push(child.children.filter((cell): cell is Element => isElement(cell) && (cell.tag === "td" || cell.tag === "th")));
      else visit(child);
    }
  };
  visit(table);
  return rows;
}

/** Rows of a data table: the first cell asks, the rest answers, labeled by a header row when there are 3+ columns. */
function tablePairs(table: Element): Pair[] {
  const rows = tableRows(table);
  const header = rows.find((cells) => cells.length && cells.every((cell) => cell.tag === "th"))?.map((cell) => textOf(cell, true));
  const pairs: Pair[] = [];
  for (const cells of rows) {
    if (cells.length < 2 || cells.length > 6 || cells.every((cell) => cell.tag === "th")) continue;
    const [first, ...rest] = cells.map((cell, index) => textOf(cell, index === 0));
    const values = rest.map((value, index) => (cells.length > 2 && header?.[index + 1] && value ? `${header[index + 1]}: ${value}` : value)).filter(Boolean);
    if (first && values.length) pairs.push({ question: first, answer: values.join(", ") });
  }
  return pairs;
}

/** Page content in reading order as text, headings, ready pairs, and boundaries. */
function contentBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = cleanField(buffer.join(""));
    if (text) blocks.push({ kind: "text", text });
    buffer = [];
  };
  const pushPairs = (pairs: Pair[]) => {
    if (pairs.length) blocks.push({ kind: "pairs", pairs, summary: pairs.map(({ question, answer }) => `${question}: ${answer}`).join("; ") });
    else blocks.push({ kind: "break" });
  };

  const visit = (node: Node, sectioned: boolean) => {
    if (!isElement(node)) { buffer.push(node); return; }
    const { tag } = node;
    const chrome = (tag === "header" || tag === "footer") && !sectioned;
    if (ALWAYS_SKIPPED.has(tag) || chrome || SKIPPED_ROLES.has(node.attrs.role ?? "")) {
      if (BLOCK.has(tag) || chrome) flush();
      return;
    }
    if (HEADINGS.has(tag)) {
      flush();
      const text = textOf(node, true);
      blocks.push(text ? { kind: "heading", text } : { kind: "break" });
      return;
    }
    if (tag === "button") {
      // A question written as an accordion button; other buttons are controls, not content.
      const text = textOf(node, true);
      if (text.endsWith("?")) { flush(); blocks.push({ kind: "text", text }); }
      return;
    }
    if (tag === "details") {
      flush();
      const summary = node.children.find((child): child is Element => isElement(child) && child.tag === "summary");
      const answer = textOf({ ...node, children: node.children.filter((child) => child !== summary) });
      const question = textOf(summary, true);
      pushPairs(question && answer ? [{ question, answer }] : []);
      return;
    }
    if (tag === "dl") {
      flush();
      pushPairs(definitionPairs(node));
      return;
    }
    if (tag === "table" && !containsLayout(node)) {
      flush();
      pushPairs(tablePairs(node));
      return;
    }
    const block = BLOCK.has(tag);
    if (block) flush();
    const inside = sectioned || SECTIONING.has(tag);
    for (const child of node.children) visit(child, inside);
    if (block) flush();
  };

  for (const child of root.children) visit(child, root.tag === "main" || root.attrs.role === "main");
  flush();
  return blocks;
}

const ENDS_SENTENCE = /[.!?:;,…]$/;

/** Joins answer parts; a part without closing punctuation (a list item, a line) gets a comma. */
function joinAnswer(parts: string[]): string {
  return parts.map((part, index) => (index < parts.length - 1 && !ENDS_SENTENCE.test(part) ? `${part},` : part)).join(" ");
}

function questionsFromJsonLd(sources: string[], add: (question: string, answer: string) => void): void {
  const htmlText = (value: string) => textOf(parseHtml(value).root);
  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.slice(0, 500).forEach((item) => visit(item, depth + 1));
      return;
    }
    const item = value as Record<string, unknown>;
    if ([item["@type"]].flat().includes("Question") && typeof item.name === "string") {
      const answer = [item.acceptedAnswer, item.suggestedAnswer].flat().find((candidate): candidate is { text: string } => typeof (candidate as { text?: unknown } | undefined)?.text === "string");
      if (answer) add(htmlText(item.name), htmlText(answer.text));
    }
    for (const key of ["@graph", "mainEntity", "hasPart", "itemListElement"]) visit(item[key], depth + 1);
  };
  for (const source of sources) {
    try {
      visit(JSON.parse(source.trim()), 0);
    } catch {
      // Invalid structured data is ignored; the visible page is still read.
    }
  }
}

export type WebKnowledge = { title: string | null; records: RawRecord[] };

/** Candidate entries from an HTML page, deduplicated, with fields capped one character past the limits. */
export function extractWebKnowledge(html: string): WebKnowledge {
  const document = parseHtml(html);
  const records: RawRecord[] = [];
  const seen = new Set<string>();
  const add = (rawQuestion: string, rawAnswer: string) => {
    const question = cleanField(rawQuestion).slice(0, LIMITS.question + 1);
    const answer = cleanField(rawAnswer).slice(0, LIMITS.answer + 1);
    if (!question || !answer || answer === question || records.length >= MAX_WEB_RECORDS) return;
    const key = questionKey(question);
    if (!key || seen.has(key)) return;
    seen.add(key);
    records.push({ line: records.length + 1, question, answer });
  };

  questionsFromJsonLd(document.jsonLd, add);

  let current: { question: string; parts: string[]; length: number } | null = null;
  const finish = () => {
    if (current?.parts.length) add(current.question, joinAnswer(current.parts));
    current = null;
  };
  const isQuestionLine = (text: string) => text.endsWith("?") && text.length <= LIMITS.question;
  for (const block of contentBlocks(findMain(document.root) ?? document.root)) {
    if (block.kind === "break") finish();
    else if (block.kind === "pairs") {
      // A short table or list right under a heading answers that heading; otherwise each row is an entry.
      if (current && !current.parts.length && block.summary.length <= LIMITS.answer) {
        current.parts.push(block.summary);
        finish();
      } else {
        finish();
        for (const pair of block.pairs) add(pair.question, pair.answer);
      }
    } else if (block.kind === "heading" || isQuestionLine(block.text)) {
      finish();
      current = { question: block.text, parts: [], length: 0 };
    } else if (current && current.length <= LIMITS.answer) {
      current.parts.push(block.text);
      current.length += block.text.length + 1;
    }
  }
  finish();
  const title = cleanField(document.title).slice(0, LIMITS.question) || null;
  return { title, records };
}

/** Candidate entries from any fetched page; text and CSV pages use the file import's formats. */
export function knowledgeFromPage(page: FetchedPage): WebKnowledge {
  if (page.kind === "html") return extractWebKnowledge(page.text);
  const name = new URL(page.url).pathname.split("/").pop() || "stranica.txt";
  const { records } = readRecords(page.text, page.kind === "csv" ? "stranica.csv" : name);
  return {
    title: null,
    records: records.slice(0, MAX_WEB_RECORDS).map(({ line, question, answer }) => ({
      line,
      question: cleanField(question).slice(0, LIMITS.question + 1),
      answer: cleanField(answer).slice(0, LIMITS.answer + 1),
    })),
  };
}
