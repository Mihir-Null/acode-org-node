// Screenshots for the readme: the built plugin in the test harness, on a
// kittymacs checkout (public, so its notes may appear in a public readme),
// with CodeMirror's One Dark theme and a Lisp mode standing in for Acode's.
//
//   npm install --no-save @codemirror/theme-one-dark @codemirror/legacy-modes playwright
//   npm run build
//   node test/smoke/screenshots.mjs ../kittymacs docs/screenshots

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import * as esbuild from "esbuild";

const [kittymacs, out] = process.argv.slice(2).map((p) => resolve(p));
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = "file:///sdcard/kittymacs";
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "var") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(org|el)$/.test(name)) files[`${ROOT}/${relative(kittymacs, full)}`] = readFileSync(full, "utf8");
  }
};
walk(kittymacs);

const harness = esbuild.buildSync({
  stdin: {
    resolveDir: "test/smoke",
    contents: `
      import { oneDark } from "@codemirror/theme-one-dark";
      import { StreamLanguage } from "@codemirror/language";
      import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp";
      import "./harness.js";
      window.__editorTheme = [oneDark];
      window.addLispMode = (languages) =>
        languages.set("commonlisp", { name: "commonlisp", extensions: ["el", "lisp"], caption: "Lisp",
          languageExtension: () => StreamLanguage.define(commonLisp) });`,
  },
  bundle: true,
  write: false,
  format: "iife",
}).outputFiles[0].text;

const page_ = `<!doctype html><html><head><style>
  :root { --popup-background-color:#2c313a; --popup-text-color:#dcdfe4; --border-color:#3e4451;
          --active-color:#2f7d6d; --primary-text-color:#fff; --button-background-color:#353b45;
          --secondary-color:#262a31; --error-text-color:#e06c75; }
  html, body { margin:0; background:#21252b; color:#dcdfe4; font-family: Roboto, "Noto Sans", sans-serif; }
  #editor { height: 50vh; overflow: hidden; border-bottom: 1px solid #3e4451; }
  #editor .cm-editor { height: 100%; font-size: 13px; }
  [data-app] { height: 50vh; overflow: hidden; background:#21252b; }
</style></head><body></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error(e));
await page.route("http://acode.test/", (route) => route.fulfill({ contentType: "text/html", body: page_ }));
await page.goto("http://acode.test/");
await page.addScriptTag({ content: harness });
await page.evaluate((setup) => window.setupAcode(setup), {
  files,
  folders: [{ url: ROOT, title: "kittymacs" }],
  settings: {},
  useFileIndex: true,
});
await page.evaluate(() => window.addLispMode(window.harness.languages));
await page.addScriptTag({ content: readFileSync("build/main.js", "utf8") });
await page.evaluate(() => window.harness.init());
await page.evaluate(() => window.__orgNodePlugin.reindex({ quiet: true }));

// A note with links both ways and an emacs-lisp block just below it.
const target = await page.evaluate(() => {
  const plugin = window.__orgNodePlugin;
  const { graph } = plugin;
  for (const node of graph.nodes) {
    if (node.level === 0 || graph.backlinks(node.id).length === 0) continue;
    const parsed = graph.files.get(node.url).parsed;
    if (!parsed.links.some((link) => link.origin === node.id)) continue;
    const text = window.harness.fsData.get(node.url).split("\n");
    const near = text.slice(node.line, node.line + 14);
    const block = near.findIndex((line) => /^#\+begin_src emacs-lisp/.test(line));
    // The cursor goes on the block, which is still inside this note.
    if (block !== -1 && plugin.graph.idAt(node.url, node.line + block) === node.id)
      return { url: node.url, line: node.line + block, title: node.title };
  }
  return null;
});
console.log("links shot on", target?.title);
await page.evaluate(async ({ url, line }) => {
  await window.__orgNodePlugin.openAt(url, line);
  const { editor } = window.harness;
  const { EditorView } = window.acode.require("codemirror").view;
  const pos = editor.state.doc.line(line + 1).from;
  editor.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  window.harness.sidebar.get("org-node").onSelected();
}, target);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/links.png` });

// The picker, narrowed by a tag.
page.evaluate(() => window.harness.run("org-node.find"));
await page.fill(".org-node-picker-input", "#decision");
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/find.png` });
await page.keyboard.press("Escape");

await browser.close();
