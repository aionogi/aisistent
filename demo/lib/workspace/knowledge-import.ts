import { MAX_KNOWLEDGE_ENTRIES } from "./persistence.ts";
import { LIMITS } from "./validation.ts";

/**
 * Reads a knowledge file chosen in the browser: CSV (question, answer; comma,
 * semicolon or tab) or plain text (a question line followed by its answer,
 * blocks separated by a blank line). The file is never uploaded; accepted
 * entries join the draft and pass the same server validation as typed ones.
 */

export const MAX_IMPORT_BYTES = 256 * 1024;

export type ImportEncoding = "utf-8" | "utf-16" | "windows-1250";
export type DecodedFile =
  | { ok: true; text: string; encoding: ImportEncoding }
  | { ok: false; error: "empty" | "too_large" | "binary" };

export type ImportedEntry = { question: string; answer: string };
export type SkipReason = "missing_question" | "missing_answer" | "question_too_long" | "answer_too_long" | "duplicate" | "over_limit";
export type SkippedEntry = { line: number; question: string; reason: SkipReason };
export type ImportFormat = "csv" | "text";
export type ImportResult = { format: ImportFormat; entries: ImportedEntry[]; skipped: SkippedEntry[] };

/**
 * UTF-8 first; UTF-16 when the file starts with its byte order mark (Excel's
 * "Unicode text"); otherwise Windows-1250, the code page Excel uses for
 * Serbian Latin CSV files. Files with NUL bytes (xlsx, pdf, images) are binary.
 */
export function decodeImportFile(bytes: Uint8Array): DecodedFile {
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, error: "too_large" };
  let text: string;
  let encoding: ImportEncoding;
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    text = new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be").decode(bytes);
    encoding = "utf-16";
  } else {
    if (bytes.includes(0)) return { ok: false, error: "binary" };
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      encoding = "utf-8";
    } catch {
      text = new TextDecoder("windows-1250").decode(bytes);
      encoding = "windows-1250";
    }
  }
  if (text.includes("\u0000")) return { ok: false, error: "binary" };
  if (!text.trim()) return { ok: false, error: "empty" };
  return { ok: true, text, encoding };
}

// Line breaks become \n; other control characters are removed.
const normalizeText = (text: string) => text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
export const cleanField = (value: string) => value.replace(/\s+/g, " ").trim();

const TRAILING = /[\s?!.:;,]/u;

/**
 * Comparison key: case, spacing and trailing punctuation do not make a question new.
 * Trailing characters are trimmed in a loop: the equivalent `/[…]+$/` regex takes
 * quadratic time on long punctuation runs, which web pages could supply.
 */
export function questionKey(question: string): string {
  const key = cleanField(question).toLocaleLowerCase("sr-Latn");
  let end = key.length;
  while (end > 0 && TRAILING.test(key[end - 1])) end--;
  return key.slice(0, end);
}

/** One candidate before checks; `line` is the file line or, for a web page, the item's position. */
export type RawRecord = { line: number; question: string; answer: string };

function detectDelimiter(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim()) ?? "";
  const unquoted = firstLine.replace(/"[^"]*"/g, "");
  const counts = [";", ",", "\t"].map((delimiter) => ({ delimiter, count: unquoted.split(delimiter).length - 1 }));
  const best = counts.sort((a, b) => b.count - a.count)[0];
  return best.count > 0 ? best.delimiter : ",";
}

/** RFC 4180 records: quoted fields may contain the delimiter, line breaks and doubled quotes. */
function parseCsvRecords(text: string, delimiter: string): Array<{ line: number; fields: string[] }> {
  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else { if (char === "\n") line++; field += char; }
    } else if (char === '"' && field.trim() === "") {
      field = "";
      quoted = true;
    } else if (char === delimiter) {
      fields.push(field);
      field = "";
    } else if (char === "\n") {
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = "";
      line++;
      recordLine = line;
    } else {
      field += char;
    }
  }
  if (field !== "" || fields.length) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }
  return records;
}

const QUESTION_HEADERS = new Set(["pitanje", "pitanja", "question", "questions", "q", "p"]);
const ANSWER_HEADERS = new Set(["odgovor", "odgovori", "answer", "answers", "a", "o"]);

function csvRecords(text: string): RawRecord[] {
  const records = parseCsvRecords(text, detectDelimiter(text))
    .filter(({ fields }) => fields.some((value) => value.trim()));
  const [first] = records;
  if (first && QUESTION_HEADERS.has(questionKey(first.fields[0] ?? "")) && ANSWER_HEADERS.has(questionKey(first.fields[1] ?? ""))) records.shift();
  return records.map(({ line, fields }) => ({ line, question: fields[0] ?? "", answer: fields[1] ?? "" }));
}

const QUESTION_PREFIX = /^(?:\d{1,3}[.)]\s+|(?:p|pitanje|q|question)\s*[:)]\s*)/i;
const ANSWER_PREFIX = /^(?:o|odgovor|a|answer)\s*[:)]\s*/i;

function textRecords(text: string): RawRecord[] {
  const records: RawRecord[] = [];
  let block: string[] = [];
  let blockLine = 1;
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    const value = raw.trim();
    if (value) {
      if (!block.length) blockLine = index + 1;
      block.push(value);
    }
    if ((!value || index === lines.length - 1) && block.length) {
      const [question, ...answer] = block;
      records.push({ line: blockLine, question: question.replace(QUESTION_PREFIX, ""), answer: answer.join(" ").replace(ANSWER_PREFIX, "") });
      block = [];
    }
  });
  return records;
}

/** Plain text is CSV too when most lines carry a tab (Excel's "Text" and "Unicode text" exports). */
function chooseFormat(fileName: string, text: string): ImportFormat {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "csv" || extension === "tsv") return "csv";
  const lines = text.split("\n").filter((line) => line.trim());
  return lines.length > 0 && lines.filter((line) => line.includes("\t")).length * 2 > lines.length ? "csv" : "text";
}

/** The records of a CSV or text file, before any checks. */
export function readRecords(rawText: string, fileName: string): { format: ImportFormat; records: RawRecord[] } {
  const text = normalizeText(rawText);
  const format = chooseFormat(fileName, text);
  return { format, records: format === "csv" ? csvRecords(text) : textRecords(text) };
}

/**
 * Accepted entries in order, and every record that was left out with its
 * reason. `existingQuestions` and `capacity` come from the current draft, so
 * duplicates and the overall limit are reported here rather than at save time.
 */
export function acceptRecords(records: RawRecord[], options: { existingQuestions: string[]; capacity?: number }): Pick<ImportResult, "entries" | "skipped"> {
  const capacity = Math.max(0, options.capacity ?? MAX_KNOWLEDGE_ENTRIES);
  const seen = new Set(options.existingQuestions.map(questionKey));
  const entries: ImportedEntry[] = [];
  const skipped: SkippedEntry[] = [];

  for (const record of records) {
    const question = cleanField(record.question);
    const answer = cleanField(record.answer);
    const skip = (reason: SkipReason) => skipped.push({ line: record.line, question: question.slice(0, 80), reason });
    if (!question) skip("missing_question");
    else if (!answer) skip("missing_answer");
    else if (question.length > LIMITS.question) skip("question_too_long");
    else if (answer.length > LIMITS.answer) skip("answer_too_long");
    else if (seen.has(questionKey(question))) skip("duplicate");
    else if (entries.length >= capacity) skip("over_limit");
    else {
      seen.add(questionKey(question));
      entries.push({ question, answer });
    }
  }
  return { entries, skipped };
}

export function parseKnowledgeImport(rawText: string, options: { fileName: string; existingQuestions: string[]; capacity?: number }): ImportResult {
  const { format, records } = readRecords(rawText, options.fileName);
  return { format, ...acceptRecords(records, options) };
}

/**
 * What the server returns for a web page import. The records are only
 * suggestions: the person reviews them, and saving validates them again.
 */
export type UrlImportResult =
  | { status: "ok"; source: string; title: string | null; records: RawRecord[] }
  | { status: "invalid"; message: string }
  | { status: "forbidden" }
  | { status: "signed-out" }
  | { status: "error" };
