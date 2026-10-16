#!/usr/bin/env node
// I AM CONSUL のビルドスクリプト。
// src/content.js（デッキと語彙）を検証してから src/app.html に埋め込み、単体で開ける HTML を生成する。
// 文面を JS モジュールに分けているのは、コメント付きで書けて、かつビルド時に型と必須項目を検証できるため。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const { DECKS, VOCAB, LINES, MISSIONS } = await import(pathToFileURL(join(ROOT, "src", "content.js")).href);

// スライドの型ごとの必須フィールド。アプリ側のテンプレートが前提にしている形をここで保証する
const SCHEMA = {
  cover: ["title", "sub"],
  exec: ["head", "points"],
  asis: ["head", "asis", "tobe"],
  matrix: ["head", "x", "y", "q", "dots"],
  tree: ["head", "root", "branches"],
  message: ["big"],
  gantt: ["head", "cols", "rows"],
  chart: ["head", "bars", "unit"],
  org: ["head", "levels"],
  cost: ["head", "rows", "total"],
  steps: ["head", "items"],
  grid: ["head", "cells"],
  pyramid: ["head", "layers"],
  appendix: [],
};
const PLACEHOLDER_KEYS = new Set(["client", "buzz", "n", "pick", "fy"]);

const errors = [];
// 文字列中の {key:arg} がアプリの resolve() で解決できる形かを確かめる。typo はブラウザでは素通しで表示されてしまうため
function checkStrings(value, where) {
  if (typeof value === "string") {
    for (const [, key, arg] of value.matchAll(/\{(\w+)(?::([^}]*))?\}/g)) {
      if (!PLACEHOLDER_KEYS.has(key)) errors.push(`${where}: 未知のプレースホルダ {${key}}`);
      if (key === "n" && !/^\d+-\d+(?:#\w+)?$/.test(arg || "")) errors.push(`${where}: {n:a-b} の形式ではありません: ${value}`);
      if (key === "fy" && !/^[+-]?\d+$/.test(arg || "")) errors.push(`${where}: {fy:+k} の形式ではありません: ${value}`);
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => checkStrings(v, `${where}[${i}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => checkStrings(v, `${where}.${k}`));
}

const ids = new Set();
for (const d of DECKS) {
  if (ids.has(d.id)) errors.push(`デッキ id が重複しています: ${d.id}`);
  ids.add(d.id);
  for (const k of ["id", "theme", "title", "next", "slides"]) if (!d[k]) errors.push(`${d.id}: ${k} がありません`);
  if (d.slides[0]?.t !== "cover") errors.push(`${d.id}: 1 枚目は cover にしてください`);
  d.slides.forEach((s, i) => {
    const where = `${d.id}.slides[${i}]`;
    const req = SCHEMA[s.t];
    if (!req) { errors.push(`${where}: 未知のスライド型 ${s.t}`); return; }
    for (const k of req) if (s[k] == null) errors.push(`${where} (${s.t}): ${k} がありません`);
    if (s.t === "matrix" && s.q.length !== 4) errors.push(`${where}: q は 4 象限ぶん必要です`);
    if (s.t === "exec" && s.points.length !== 3) errors.push(`${where}: points は 3 点にしてください（結論は 3 つと決まっている）`);
  });
  checkStrings(d, d.id);
  if (!LINES.theme[d.id]) errors.push(`${d.id}: LINES.theme にデッキ固有のセリフがありません`);
}
checkStrings({ VOCAB, LINES, MISSIONS }, "content");
if (errors.length) {
  console.error(errors.map((e) => "✗ " + e).join("\n"));
  process.exit(1);
}

// JSON を <script> 内に置くので、"</script>" などで HTML パーサが脱出しないよう "<" をエスケープする
const json = JSON.stringify({ DECKS, VOCAB, LINES, MISSIONS }).replace(/</g, "\\u003c");
const app = await readFile(join(ROOT, "src", "app.html"), "utf8");
if (!app.includes("__CONTENT__")) throw new Error("src/app.html に __CONTENT__ プレースホルダがありません");
const fragment = app.replace("__CONTENT__", () => json);

const full = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${fragment}
</body>
</html>
`;

await mkdir(DIST, { recursive: true });
await writeFile(join(DIST, "index.html"), full);
await writeFile(join(DIST, "fragment.html"), fragment);
for (const d of DECKS) console.log(`✓ ${d.theme.padEnd(8)} ${d.title}（${d.slides.length} 枚）`);
console.log(`\ndist/index.html ${(full.length / 1024).toFixed(0)} KB`);
