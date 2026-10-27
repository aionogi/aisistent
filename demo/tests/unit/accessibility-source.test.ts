import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function tsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(target) : Promise.resolve(entry.name.endsWith(".tsx") ? [target] : []);
  }));
  return nested.flat();
}

// lucide-react 0.468 renders a bare <svg>; screen readers may announce it as an unlabeled image.
test("every lucide icon is hidden from assistive technology or has its own label", async () => {
  const files = [...await tsxFiles(path.join(projectDir, "app")), ...await tsxFiles(path.join(projectDir, "components"))];
  const offenders: string[] = [];
  let checked = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const icons = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"lucide-react"/g)].flatMap(([, names]) =>
      names.split(",").map((part) => part.trim()).filter((part) => part && !part.startsWith("type ")).map((part) => part.split(/\s+as\s+/).pop()!.trim()));
    if (!icons.length) continue;
    for (const [element] of source.matchAll(new RegExp(`<(?:${icons.join("|")})(?:\\s[^<>]*?)?/>`, "g"))) {
      checked++;
      if (!/aria-hidden|aria-label/.test(element)) offenders.push(`${path.relative(projectDir, file)}: ${element}`);
    }
  }
  assert.ok(checked > 100, `the icon pattern still finds icons (${checked})`);
  assert.deepEqual(offenders, []);
});
