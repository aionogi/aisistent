import assert from "node:assert/strict";
import { test } from "node:test";
import { extractWebKnowledge, knowledgeFromPage, MAX_WEB_RECORDS } from "../../lib/import/web-knowledge.ts";
import { acceptRecords } from "../../lib/workspace/knowledge-import.ts";
import { LIMITS } from "../../lib/workspace/validation.ts";

const pairs = (html: string) => extractWebKnowledge(html).records.map(({ question, answer }) => [question, answer]);

test("schema.org FAQPage data, including @graph and HTML inside answers", () => {
  const html = `<html><head><title>Česta pitanja &ndash; Salon Ana</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"FAQ"},
      {"@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"Da li radite nedeljom?","acceptedAnswer":{"@type":"Answer","text":"<p>Ne, nedeljom <strong>ne</strong> radimo.</p>"}},
        {"@type":"Question","name":"Imate li parking?","acceptedAnswer":[{"@type":"Answer","text":"Da, ispred salona &amp; u dvorištu."}]},
        {"@type":"Question","name":"Bez odgovora?"}]}]}</script>
    <script type="application/ld+json">{ not json </script>
    <script>var faq = "<h2>Lažno pitanje?</h2><p>Iz skripte</p>";</script>
    </head><body><p>Dobrodošli.</p></body></html>`;
  const result = extractWebKnowledge(html);
  assert.equal(result.title, "Česta pitanja – Salon Ana");
  assert.deepEqual(result.records, [
    { line: 1, question: "Da li radite nedeljom?", answer: "Ne, nedeljom ne radimo." },
    { line: 2, question: "Imate li parking?", answer: "Da, ispred salona & u dvorištu." },
  ]);
});

test("details/summary, definition lists, and accordion buttons", () => {
  assert.deepEqual(pairs(`
    <details><summary>Da li primate kartice?</summary><p>Da, sve kartice.</p><p>I gotovinu.</p></details>
    <dl><dt>Gde se nalazite?</dt><dd>Cvetna 12, Novi Sad.</dd><div><dt>Radno vreme</dt><dd>9–20 h</dd></div></dl>
    <div class="accordion"><h2 class="accordion-header"><button type="button">Koliko traje šišanje?</button></h2>
      <div class="accordion-body"><p>Oko 45 minuta.</p><button>Zakaži</button></div></div>
    <div class="faq"><button class="q">Da li je potrebno zakazivanje?</button><div class="a">Preporučujemo, ali nije obavezno.</div></div>
    <input type="checkbox" id="q9"><label for="q9">Imate li poklon-vaučere?</label><div>Da, u salonu.</div>`), [
    ["Da li primate kartice?", "Da, sve kartice. I gotovinu."],
    ["Gde se nalazite?", "Cvetna 12, Novi Sad."],
    ["Radno vreme", "9–20 h"],
    ["Koliko traje šišanje?", "Oko 45 minuta."],
    ["Da li je potrebno zakazivanje?", "Preporučujemo, ali nije obavezno."],
    ["Imate li poklon-vaučere?", "Da, u salonu."],
  ]);
});

test("headings and question lines take the text that follows them", () => {
  assert.deepEqual(pairs(`
    <h1>Frizerski salon Ana</h1>
    <section><h2>Radno vreme</h2><p>Ponedeljak–petak 9–20<br>Subota 9–15</p></section>
    <h2>Usluge</h2><ul><li>Šišanje</li><li>Feniranje</li><li>Farbanje.</li></ul>
    <h2>Naš tim</h2><h3>Ana</h3><p>Vlasnica, 15 godina iskustva.</p>
    <p><strong>Mogu li da dođem sa detetom?</strong><br>Naravno, imamo kutak za decu.</p>
    <p><b>Da li imate klimu?</b></p><p>Da.</p>`), [
    ["Radno vreme", "Ponedeljak–petak 9–20, Subota 9–15"],
    ["Usluge", "Šišanje, Feniranje, Farbanje."],
    ["Ana", "Vlasnica, 15 godina iskustva."],
    ["Mogu li da dođem sa detetom?", "Naravno, imamo kutak za decu."],
    ["Da li imate klimu?", "Da."],
  ]);
});

test("data tables: short tables answer their heading, longer ones become one entry per row", () => {
  const prices = Array.from({ length: 12 }, (_, index) => `<tr><td>Usluga ${index + 1} sa dužim nazivom tretmana</td><td>${30 + index} min</td><td>${1000 + index * 100} din</td></tr>`).join("");
  const result = pairs(`
    <h2>Radno vreme</h2><table><tr><th>Dan</th><th>Vreme</th></tr><tr><td>Pon–Pet</td><td>9–20</td></tr><tr><td>Subota</td><td>9–15</td></tr></table>
    <h2>Cenovnik</h2><table><thead><tr><th>Usluga</th><th>Trajanje</th><th>Cena</th></tr></thead><tbody>${prices}</tbody></table>`);
  assert.deepEqual(result[0], ["Radno vreme", "Pon–Pet: 9–20; Subota: 9–15"]);
  assert.deepEqual(result[1], ["Usluga 1 sa dužim nazivom tretmana", "Trajanje: 30 min, Cena: 1000 din"]);
  assert.equal(result.length, 13);

  // A layout table is read as ordinary content.
  assert.deepEqual(pairs("<table><tr><td><h2>Kontakt</h2><p>011 123 456</p></td><td><p>Meni</p></td></tr></table>"), [["Kontakt", "011 123 456, Meni"]]);
});

test("site navigation, header, footer, forms, sidebars and scripts are not content; main is preferred", () => {
  const html = `<body><header><h2>Salon Ana</h2><p>Pozovite nas</p></header>
    <nav><h2>Meni</h2><a>Početna</a></nav>
    <div role="banner"><h2>Akcija?</h2><p>Popust</p></div>
    <main><article><header><h2>Da li radite praznicima?</h2></header><p>Samo 1. maja ne radimo.</p></article>
      <form><h3>Pišite nam?</h3><label>Ime</label><input name="ime"></form>
      <aside><h3>Vesti</h3><p>Novi termini</p></aside>
      <style>h2 { color: red }</style><noscript><h2>Uključite JavaScript?</h2><p>Molimo</p></noscript>
      <template><h2>Šablon?</h2><p>Ne</p></template></main>
    <footer><h2>Kontakt</h2><p>Cvetna 12</p></footer>
    <h2>Van glavnog dela?</h2><p>Ne čita se.</p></body>`;
  assert.deepEqual(pairs(html), [["Da li radite praznicima?", "Samo 1. maja ne radimo."]]);
});

test("entities, broken markup, duplicates and limits", () => {
  assert.deepEqual(pairs("<h2>Gde je &Scaron;abac&#x3f;</h2><p>&#268;ačak &amp; &#0; &#x110000; &unknown; &lt;b&gt;</p>"), [["Gde je Šabac?", "Čačak & � � &unknown; <b>"]]);
  // Unclosed tags, stray end tags, an unclosed comment and an attribute quote that never closes.
  assert.deepEqual(pairs("<div><h2>Prvo?</h3><p>Odgovor jedan</div></span><li>stavka<h2>Drugo?</h2><p>Odgovor dva<!-- kraj <p>skriveno"), [["Prvo?", "Odgovor jedan, stavka"], ["Drugo?", "Odgovor dva"]]);
  assert.deepEqual(pairs("<h2>Naslov?<p>u naslovu</p></h2><p>Odgovor</p>"), [["Naslov? u naslovu", "Odgovor"]], "as in browsers, <p> does not close an open heading");
  assert.deepEqual(pairs('<h2>Treće?</h2><p>Odgovor</p><a href="nije zatvoren><h2>Četvrto?</h2><p>Nestaje</p>'), [["Treće?", "Odgovor"]]);
  assert.deepEqual(pairs("<details><summary>Isto?</summary>Prvi</details><h2>isto</h2><p>Drugi</p>"), [["Isto?", "Prvi"]], "the first answer for a question wins");

  const long = extractWebKnowledge(`<h2>${"P".repeat(500)}?</h2><p>${"o ".repeat(2000)}</p><h2>Kratko?</h2><p>${"a".repeat(1000)}</p>`).records;
  assert.equal(long[0].question.length, LIMITS.question + 1);
  assert.equal(long[1].answer.length, LIMITS.answer + 1);
  const accepted = acceptRecords(long, { existingQuestions: [] });
  assert.deepEqual(accepted.skipped.map(({ reason }) => reason), ["question_too_long", "answer_too_long"], "capped fields are still reported as too long");

  const many = Array.from({ length: MAX_WEB_RECORDS + 50 }, (_, index) => `<h3>Pitanje ${index}?</h3><p>Odgovor ${index}.</p>`).join("");
  assert.equal(extractWebKnowledge(many).records.length, MAX_WEB_RECORDS);
});

test("hostile size and nesting stay bounded", () => {
  const deep = `${"<div>".repeat(50_000)}<h2>Duboko?</h2><p>Da.</p>${"</div>".repeat(50_000)}`;
  let started = Date.now();
  assert.deepEqual(pairs(deep), [["Duboko?", "Da."]]);
  assert.ok(Date.now() - started < 3000, "50 000 nested elements parse without overflowing the stack");

  started = Date.now();
  const attributes = `<div ${'a="x" '.repeat(100_000)}>tekst</div>`;
  const unclosedQuotes = "<p class='".repeat(20_000);
  const entities = "&amp;".repeat(200_000);
  // Punctuation runs once made the duplicate check quadratic (80 000 characters took 5 s).
  const punctuation = `<h2>${"?".repeat(500_000)}x</h2><p>a</p><h2>Pitanje${" ?".repeat(300_000)}</h2><p>b</p>`;
  for (const html of [attributes, unclosedQuotes, entities, punctuation, "<".repeat(500_000), "<a".repeat(300_000)]) extractWebKnowledge(html);
  assert.ok(Date.now() - started < 5000, "pathological inputs finish quickly");
});

test("text and CSV pages use the file import's formats", () => {
  assert.deepEqual(knowledgeFromPage({ url: "https://primer.rs/faq.txt", kind: "text", text: "Da li radite nedeljom?\nNe.\n\nParking?\nDa." }).records, [
    { line: 1, question: "Da li radite nedeljom?", answer: "Ne." },
    { line: 4, question: "Parking?", answer: "Da." },
  ]);
  assert.deepEqual(knowledgeFromPage({ url: "https://primer.rs/izvoz", kind: "csv", text: "Pitanje;Odgovor\nCena?;1000 din\n" }).records, [
    { line: 2, question: "Cena?", answer: "1000 din" },
  ]);
});
