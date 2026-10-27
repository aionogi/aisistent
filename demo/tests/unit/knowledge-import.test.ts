import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeImportFile, MAX_IMPORT_BYTES, parseKnowledgeImport, questionKey } from "../../lib/workspace/knowledge-import.ts";
import { MAX_KNOWLEDGE_ENTRIES } from "../../lib/workspace/persistence.ts";
import { LIMITS } from "../../lib/workspace/validation.ts";

const parse = (text: string, fileName = "pitanja.csv", existingQuestions: string[] = [], capacity?: number) =>
  parseKnowledgeImport(text, { fileName, existingQuestions, capacity });
const pairs = (result: ReturnType<typeof parse>) => result.entries.map(({ question, answer }) => [question, answer]);

test("CSV with a header, comma or semicolon, quotes, and line breaks inside quotes", () => {
  const comma = parse('Pitanje,Odgovor\n"Da li radite nedeljom?","Ne, nedeljom ne radimo."\nImate li parking?,Da\n');
  assert.equal(comma.format, "csv");
  assert.deepEqual(pairs(comma), [["Da li radite nedeljom?", "Ne, nedeljom ne radimo."], ["Imate li parking?", "Da"]]);

  const semicolon = parse('pitanje;odgovor\r\nKoliko traje šišanje?;"Oko 45 minuta; feniranje je uključeno."\r\n"Recite ""zdravo""";"Odgovor u\ndva reda"\r\n');
  assert.deepEqual(pairs(semicolon), [["Koliko traje šišanje?", "Oko 45 minuta; feniranje je uključeno."], ['Recite "zdravo"', "Odgovor u dva reda"]]);
  assert.deepEqual(semicolon.skipped, []);
});

test("CSV without a header keeps the first row, ignores blank rows and extra columns, and numbers skipped rows", () => {
  const result = parse("Prvo pitanje,Prvi odgovor,beleška\n\n,Odgovor bez pitanja\nPitanje bez odgovora\n");
  assert.deepEqual(pairs(result), [["Prvo pitanje", "Prvi odgovor"]]);
  assert.deepEqual(result.skipped.map(({ line, reason }) => [line, reason]), [[3, "missing_question"], [4, "missing_answer"]]);
});

test("tab-separated text files are read as tables; other text files as question/answer blocks", () => {
  assert.deepEqual(pairs(parse("Pitanje\tOdgovor\nRadno vreme?\tOd 9 do 20 h.\n", "izvoz.txt")), [["Radno vreme?", "Od 9 do 20 h."]]);

  const blocks = parse("P: Da li primate kartice?\nO: Da, sve kartice.\n\n1. Gde se nalazite?\nCvetna 12,\nNovi Sad.\n\n\nPitanje bez odgovora\n", "faq.txt");
  assert.equal(blocks.format, "text");
  assert.deepEqual(pairs(blocks), [["Da li primate kartice?", "Da, sve kartice."], ["Gde se nalazite?", "Cvetna 12, Novi Sad."]]);
  assert.deepEqual(blocks.skipped.map(({ line, reason }) => [line, reason]), [[9, "missing_answer"]]);
});

test("too long values are skipped, not shortened", () => {
  const longQuestion = "P".repeat(LIMITS.question + 1);
  const longAnswer = "O".repeat(LIMITS.answer + 1);
  const result = parse(`${longQuestion},kratko\nKratko pitanje,${longAnswer}\n${"P".repeat(LIMITS.question)},${"O".repeat(LIMITS.answer)}\n`);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.skipped.map(({ reason }) => reason), ["question_too_long", "answer_too_long"]);
});

test("questions already in the base or repeated in the file are skipped regardless of case, spacing and final punctuation", () => {
  const result = parse("Da li radite NEDELJOM,Ne.\nImate li parking?,Da.\n  imate   li parking ,Ponovo.\n", "a.csv", ["Da li radite nedeljom?"]);
  assert.deepEqual(pairs(result), [["Imate li parking?", "Da."]]);
  assert.deepEqual(result.skipped.map(({ line, reason }) => [line, reason]), [[1, "duplicate"], [3, "duplicate"]]);
  assert.equal(questionKey("Šta radite?  "), questionKey("šta radite"));
});

test("the overall limit is enforced against what the base already holds", () => {
  const rows = Array.from({ length: 5 }, (_, index) => `Pitanje ${index + 1},Odgovor ${index + 1}`).join("\n");
  const result = parse(rows, "a.csv", [], 3);
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.skipped.map(({ line, reason }) => [line, reason]), [[4, "over_limit"], [5, "over_limit"]]);
  assert.equal(parse(rows).entries.length, 5, `the default capacity is ${MAX_KNOWLEDGE_ENTRIES}`);
  assert.equal(parse(rows, "a.csv", [], -2).entries.length, 0);
});

test("control characters are removed and whitespace is collapsed", () => {
  assert.deepEqual(pairs(parse("Pita\u0007nje\u0000?,  Odgovor \t sa   razmacima \n")), [["Pitanje?", "Odgovor sa razmacima"]]);
});

test("decoding accepts UTF-8 (with or without BOM), UTF-16 with BOM, and Windows-1250", () => {
  const utf8 = decodeImportFile(new TextEncoder().encode("﻿čćžšđ,ČĆŽŠĐ"));
  assert.deepEqual(utf8, { ok: true, text: "čćžšđ,ČĆŽŠĐ", encoding: "utf-8" });

  const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from("šta\tda", (char) => [char.charCodeAt(0) & 0xff, char.charCodeAt(0) >> 8]).flat()]);
  assert.deepEqual(decodeImportFile(utf16), { ok: true, text: "šta\tda", encoding: "utf-16" });

  // "čćžšđ" in Windows-1250, as Excel saves Serbian Latin CSV files.
  assert.deepEqual(decodeImportFile(new Uint8Array([0xe8, 0xe6, 0x9e, 0x9a, 0xf0])), { ok: true, text: "čćžšđ", encoding: "windows-1250" });
});

test("empty, oversized and binary files are refused before parsing", () => {
  assert.deepEqual(decodeImportFile(new Uint8Array()), { ok: false, error: "empty" });
  assert.deepEqual(decodeImportFile(new TextEncoder().encode(" \n\t ")), { ok: false, error: "empty" });
  assert.deepEqual(decodeImportFile(new Uint8Array(MAX_IMPORT_BYTES + 1).fill(0x41)), { ok: false, error: "too_large" });
  // An .xlsx file is a ZIP archive and contains NUL bytes.
  assert.deepEqual(decodeImportFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])), { ok: false, error: "binary" });
});
