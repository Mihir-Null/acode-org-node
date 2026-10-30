// End-to-end: the built plugin (build/main.js) in Chromium, against the mock
// Acode of test/smoke/harness.js and the fixture folders.  Run `npm run
// build` first; `npm test` does.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  // Playwright is optional; without it the smoke test is skipped.
}

const PLUGIN_ID = JSON.parse(readFileSync("plugin.json", "utf8")).id;
const NOTES = "file:///sd/notes";
const PROJECT = "file:///sd/EmptyNet";

function filesUnder(dir, urlRoot) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[`${urlRoot}/${relative(dir, full)}`] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

let browser;
const harnessJs = esbuild.buildSync({ entryPoints: ["test/smoke/harness.js"], bundle: true, write: false, format: "iife" }).outputFiles[0].text;
const pluginJs = readFileSync("build/main.js", "utf8");

before(async () => {
  if (chromium) browser = await chromium.launch();
});
after(async () => browser?.close());

async function start({ useFileIndex }) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error));
  // A real origin, so the page has localStorage as Acode's WebView does.
  await page.route("http://acode.test/", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("http://acode.test/");
  await page.addScriptTag({ content: harnessJs });
  await page.evaluate(
    (setup) => window.setupAcode(setup),
    {
      files: { ...filesUnder("test/fixtures/notes", NOTES), ...filesUnder("test/fixtures/project", PROJECT) },
      folders: [{ url: PROJECT, title: "EmptyNet" }],
      settings: { [PLUGIN_ID]: { notesFolder: NOTES } },
      useFileIndex,
    },
  );
  await page.addScriptTag({ content: pluginJs });
  await page.evaluate(() => window.harness.init());
  return { page, errors };
}

const nodeCount = (page) => page.evaluate(() => window.__orgNodePlugin.graph.nodes.length);

for (const useFileIndex of [false, true]) {
  test(`the plugin in a mock Acode (${useFileIndex ? "file index" : "walking folders"})`, { skip: !chromium && "playwright not installed" }, async () => {
    const { page, errors } = await start({ useFileIndex });
    const h = (fn, ...args) => page.evaluate(fn, ...args);

    // Commands, the selection menu, the sidebar and the Org mode exist.
    const commands = await h(() => [...window.harness.commands.keys()]);
    assert.ok(commands.includes("org-node.find") && commands.includes("org-node.insert-link"));
    assert.deepEqual(await h(() => window.harness.selectionItems.map((item) => item.id)), ["org-node-link", "org-node-open"]);
    assert.ok(await h(() => window.harness.languages.has("org")));

    // Indexing: notes folder + project from .dir-locals.el, secrets/ skipped.
    await h(() => window.__orgNodePlugin.reindex());
    assert.equal(await nodeCount(page), 4);
    assert.ok(!(await h(() => window.__orgNodePlugin.graph.get("99999999-9999-4999-8999-999999999999"))));
    assert.match((await h(() => window.harness.log.toasts)).join("\n"), /Notes graph includes EmptyNet/);
    // The project is open in the sidebar, so Acode indexes it already; the
    // notes folder is not, so the plugin asks for one scan of it.
    if (useFileIndex) assert.deepEqual(await h(() => window.harness.log.scans), [NOTES]);

    // A note still loading must not take the keyboard back from a picker
    // opened meanwhile: typing goes to the picker, not into the note.
    await h(() => (window.harness.loadDelay = 500));
    h(() => window.harness.run("org-node.find"));
    await page.fill(".org-node-picker-input", "inbox");
    await page.waitForFunction(() => document.querySelector(".org-node-picker-row.active")?.textContent.includes("Inbox"));
    await page.press(".org-node-picker-input", "Enter");
    h(() => window.harness.run("org-node.find"));
    await page.fill(".org-node-picker-input", "tan");
    await page.waitForFunction(() => window.harness.activeUri()?.endsWith("inbox.org"));
    await page.waitForTimeout(300); // openAt finishes after the load
    await page.keyboard.type("gl"); // still typing in the picker
    assert.equal(await page.inputValue(".org-node-picker-input"), "tangl");
    assert.equal(
      await h(() => window.harness.editor.state.doc.toString()),
      await h(() => window.harness.fsData.get("file:///sd/notes/inbox.org")),
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".org-node-picker").count(), 0);
    await h(() => (window.harness.loadDelay = 0));

    // Find: "#nix" narrows to Flakes; Enter opens it at its line.
    h(() => window.harness.run("org-node.find"));
    await page.fill(".org-node-picker-input", "#nix");
    await page.waitForFunction(() => document.querySelectorAll(".org-node-picker-row").length === 1);
    assert.match(await page.textContent(".org-node-picker-row"), /Flakes/);
    assert.match(await page.textContent(".org-node-picker-row .where"), /EmptyNet\/wiki\/flakes\.org/);
    await page.press(".org-node-picker-input", "Enter");
    await page.waitForFunction(() => window.harness.activeUri()?.endsWith("flakes.org"));

    // A heading note opens at its heading.
    h(() => window.harness.run("org-node.find"));
    await page.fill(".org-node-picker-input", "tangl");
    await page.waitForFunction(() => document.querySelector(".org-node-picker-row.active")?.textContent.includes("Tangling"));
    await page.press(".org-node-picker-input", "Enter");
    await page.waitForFunction(() => window.harness.activeUri()?.endsWith("loop.org"));
    await page.waitForFunction(() => window.harness.cursorLine() === 9);

    // The panel follows the cursor: on "Tangling", Flakes links here, and
    // Tangling links to Flakes.
    await h(() => window.harness.sidebar.get("org-node").onSelected());
    await page.waitForFunction(() => document.querySelector("[data-app=org-node] h3")?.textContent === "Tangling");
    const panel = async () => (await page.textContent("[data-app=org-node]")).replace(/\s+/g, " ");
    assert.match(await panel(), /Links to here 1 Flakes wiki\/flakes\.org .*tangling step.* Links from here 1 Flakes wiki\/flakes\.org Org blocks become Nix files; see flakes\./);
    // Tapping the forward link's title opens Flakes; on its file note, it
    // links to two notes, and a link typed but not saved counts at once.
    await page.click("[data-app=org-node] section:last-of-type h4");
    await page.waitForFunction(() => window.harness.activeUri()?.endsWith("flakes.org"));
    await page.waitForFunction(() => document.querySelector("[data-app=org-node] h3")?.textContent === "Flakes");
    assert.match(await panel(), /Links from here 2 The loop .* Tangling /);
    await h(() => {
      const { editor } = window.harness;
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: "\nSee [[id:44444444-4444-4444-8444-444444444444][my inbox]] and [[id:no-such-id][a ghost]].\n" } });
    });
    await page.waitForFunction(() => document.querySelector("[data-app=org-node]").textContent.includes("No note has the ID no-such-id"));
    assert.match(await panel(), /Links from here 4 .*Inbox .*my inbox/);

    // Code in a src block is coloured by Acode's JavaScript mode.
    await page.waitForFunction(() => {
      const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent.startsWith("const answer"));
      const keyword = line && [...line.querySelectorAll("span")].find((span) => span.textContent === "const");
      const comment = line && [...line.querySelectorAll("span")].find((span) => span.textContent === "// the answer");
      return keyword?.className && comment?.className && keyword.className !== comment.className;
    });

    // The Link and Org buttons show in Org files only; Link opens the picker.
    const shown = () => h(() => window.harness.sideButtons.map((b) => `${b.text}:${b.shown}`).join(" "));
    assert.equal(await shown(), "Link:true Org:true");
    await h(() => window.harness.open("file:///sd/EmptyNet/notes.txt"));
    assert.equal(await shown(), "Link:false Org:false");
    await h(() => window.harness.open("file:///sd/EmptyNet/wiki/flakes.org"));
    assert.equal(await shown(), "Link:true Org:true");
    h(() => window.harness.sideButtons[0].onclick());
    await page.waitForSelector(".org-node-picker-input");
    assert.equal(await page.getAttribute(".org-node-picker-input", "placeholder"), "Link to note");
    await page.keyboard.press("Escape");

    // Insert link: the selection becomes the link's words.
    await h(() => window.harness.open(`${"file:///sd/notes"}/inbox.org`));
    await h(() => {
      const { editor } = window.harness;
      const text = editor.state.doc.toString();
      const from = text.indexOf("the loop");
      editor.dispatch({ selection: { anchor: from, head: from + "the loop".length } });
    });
    h(() => window.harness.run("org-node.insert-link"));
    await page.waitForSelector(".org-node-picker-input");
    assert.equal(await page.inputValue(".org-node-picker-input"), "the loop");
    await page.press(".org-node-picker-input", "Enter");
    await page.waitForFunction(() => window.harness.editor.state.doc.toString().includes("[[id:11111111-1111-4111-8111-111111111111][the loop]]"));

    // Saving re-indexes the file: The loop gains a backlink from Inbox.
    await h(async () => {
      const { editor, editorManager, fsData } = window.harness;
      fsData.set(editorManager.activeFile.uri, editor.state.doc.toString());
      editorManager.emit("save-file", editorManager.activeFile);
    });
    await page.waitForFunction(() =>
      window.__orgNodePlugin.graph.backlinks("11111111-1111-4111-8111-111111111111").some((g) => g.from?.title === "Inbox"),
    );

    // Follow the link under the cursor (Ctrl-click and the menu use this).
    await h(() => {
      const { editor } = window.harness;
      const at = editor.state.doc.toString().indexOf("[[id:1111") + 4;
      editor.dispatch({ selection: { anchor: at } });
    });
    await h(() => window.harness.run("org-node.follow-link"));
    await page.waitForFunction(() => window.harness.activeUri()?.endsWith("loop.org") && window.harness.cursorLine() === 0);

    // Enter takes the best match even when no title equals the input; the
    // Create row comes last then.
    h(() => window.harness.run("org-node.find"));
    await page.fill(".org-node-picker-input", "loop");
    await page.waitForFunction(() => document.querySelector(".org-node-picker-row.active")?.textContent.includes("The loop"));
    assert.match(await page.textContent(".org-node-picker-row:last-child"), /Create “loop”/);
    await page.keyboard.press("Escape");

    // Create a note by typing a new title; it lands in the graph folder of
    // the file you are in (EmptyNet, for loop.org).
    h(() => window.harness.run("org-node.find"));
    await page.fill(".org-node-picker-input", "Löb's Theorem #math");
    await page.waitForSelector(".org-node-picker-row.create.active");
    await page.press(".org-node-picker-input", "Enter");
    await page.waitForFunction(() => window.harness.activeUri() === "file:///sd/EmptyNet/lobs-theorem.org");
    const created = await h(() => window.harness.fsData.get("file:///sd/EmptyNet/lobs-theorem.org"));
    assert.match(created, /^:PROPERTIES:\n:ID: {7}[0-9a-f-]{36}\n:CREATED: {2}\[\d{4}-\d\d-\d\d \w{3} \d\d:\d\d\]\n:END:\n#\+title: Löb's Theorem\n$/);
    assert.equal(await nodeCount(page), 5);

    // From a file in no graph folder, a new note goes to the notes folder.
    await h(() => window.acode.newEditorFile("scratch.txt", { text: "", render: true }));
    h(() => window.harness.run("org-node.find"));
    await page.fill(".org-node-picker-input", "Loose end");
    await page.press(".org-node-picker-input", "Enter");
    await page.waitForFunction(() => window.harness.activeUri() === "file:///sd/notes/loose-end.org");

    // Tags: choose #concept, then a note carrying it.
    await h(() => window.harness.answers.select.push("concept"));
    h(() => window.harness.run("org-node.find-by-tag"));
    await page.waitForFunction(() => document.querySelectorAll(".org-node-picker-row").length === 3);
    await page.keyboard.press("Escape");

    // The tag index lists a page once under its file tag.
    await h(() => window.harness.run("org-node.tag-index"));
    await page.waitForFunction(() => window.harness.editorManager.activeFile?.filename === "org-node-tags.org");
    const index = await h(() => window.harness.editor.state.doc.toString());
    // Tangling inherits concept from its file, so it is listed only under decision.
    assert.match(index, /\* concept \(2\)\n- \[\[id:3333[^\n]*\]\[Flakes\]\] · EmptyNet\/wiki\/flakes\.org\n- \[\[id:1111[^\n]*\]\[The loop\]\] · EmptyNet\/wiki\/loop\.org\n\* decision \(1\)\n- \[\[id:2222[^\n]*\]\[Tangling\]\]/);
    assert.match(index, /\* nix \(1\)\n- \[\[id:3333/);

    // Org mode: a heading folds to the end of its subtree.
    await h(() => window.harness.open("file:///sd/EmptyNet/wiki/loop.org"));
    const fold = await h(() => {
      const { editor } = window.harness;
      const { foldable } = window.acode.require("codemirror").language;
      const line = editor.state.doc.line(10); // "* Tangling :decision:"
      const range = foldable(editor.state, line.from, line.to);
      return range && editor.state.doc.lineAt(range.to).number;
    });
    assert.equal(fold, 14); // up to the line before "* Rebuilding"

    // The cache is written, and restores the graph in a new session.
    await page.waitForFunction(() => window.harness.fsData.has("file:///cache/org-node.json"), null, { timeout: 5000 });

    // Org's keys on a heading: Shift-Right cycles TODO, Alt-Down moves the
    // subtree; off a heading, Alt-Down is left to the editor.
    await h(() => window.harness.open("file:///sd/EmptyNet/wiki/loop.org"));
    const loopLine = (n) => h((i) => window.harness.editor.state.doc.line(i).text, n);
    await h(() => {
      const { editor } = window.harness;
      editor.dispatch({ selection: { anchor: editor.state.doc.line(10).from + 3 } });
      editor.focus();
    });
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await loopLine(10), "* TODO Tangling :decision:");
    await page.keyboard.press("Alt+ArrowDown");
    assert.equal(await loopLine(10), "* Rebuilding");
    assert.equal(await h(() => window.harness.cursorLine()), 12); // moved with its subtree
    assert.equal(await loopLine(13), "* TODO Tangling :decision:");
    await page.keyboard.press("Control+z"); // one undoable change each
    assert.equal(await loopLine(10), "* TODO Tangling :decision:");

    // The Org button's menu: demote, then the preview.
    await h(() => window.harness.answers.select.push("demote"));
    await h(() => window.harness.sideButtons.find((b) => b.text === "Org").onclick());
    await page.waitForFunction(() => window.harness.editor.state.doc.line(10).text === "** TODO Tangling :decision:");
    await h(() => window.harness.answers.select.push("preview"));
    await h(() => window.harness.sideButtons.find((b) => b.text === "Org").onclick());
    await page.waitForFunction(() => window.harness.editorManager.activeFile?.filename === "loop.org · preview");
    // Unsaved edits show; the link has the note's title; src blocks go to codeHighlight.
    const preview = page.locator(".custom-tab .org-preview");
    await preview.locator("h3.org-heading", { hasText: "Tangling" }).waitFor();
    assert.match(await preview.locator("h1").textContent(), /The loop/);
    assert.equal(await preview.locator(".org-todo").textContent(), "TODO");
    assert.equal(await preview.locator("a.org-id").first().textContent(), "flakes");
    assert.equal(await shown(), "Link:false Org:false");
    // Tapping a heading opens the source there; tapping a link opens the note.
    await preview.locator("h3.org-heading").click();
    await page.waitForFunction(() => window.harness.activeUri()?.endsWith("loop.org") && window.harness.cursorLine() === 9);
    await h(() => window.harness.run("org.preview"));
    await page.locator(".custom-tab a.org-id").first().click();
    await page.waitForFunction(() => window.harness.activeUri()?.endsWith("flakes.org"));
    // Flakes has a src block: its preview hands it to Acode's highlighter.
    await h(() => window.harness.run("org.preview"));
    await page.waitForFunction(() => window.harness.editorManager.activeFile?.filename === "flakes.org · preview");
    assert.equal(await page.locator(".custom-tab .tok-test").last().getAttribute("data-lang"), "js");
    assert.equal(await h(() => window.harness.editorManager.files.filter((f) => f.type === "custom").length), 2);

    // Unmounting removes what the plugin added.
    await h(() => window.harness.unmount());
    assert.equal(await h(() => window.harness.commands.size), 0);
    assert.equal(await h(() => window.harness.sidebar.size), 0);
    assert.equal(await shown(), "Link:false Org:false");
    assert.ok(!(await h(() => window.harness.languages.has("org"))));
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test("an open git repository joins the graph by itself", { skip: !chromium && "playwright not installed" }, async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.route("http://acode.test/", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("http://acode.test/");
  await page.addScriptTag({ content: harnessJs });
  const REPO = "file:///sd/scratch";
  await page.evaluate(
    (setup) => window.setupAcode(setup),
    {
      files: {
        [`${REPO}/.git/HEAD`]: "ref: refs/heads/main\n",
        [`${REPO}/ideas.org`]: ":PROPERTIES:\n:ID: 55555555-5555-4555-8555-555555555555\n:END:\n#+title: Ideas\n",
        [`${REPO}/README.org`]: "#+title: No ID, so not a note\n* TODO A task [/]\n** TODO one\n",
        "file:///sd/plain/other.org": ":PROPERTIES:\n:ID: 66666666-6666-4666-8666-666666666666\n:END:\n#+title: Not in a repository\n",
      },
      folders: [
        { url: REPO, title: "scratch" },
        { url: "file:///sd/plain", title: "plain" },
      ],
      settings: {},
      useFileIndex: false,
    },
  );
  await page.addScriptTag({ content: pluginJs });
  await page.evaluate(() => window.harness.init());
  const h = (fn, ...args) => page.evaluate(fn, ...args);

  await h(() => window.__orgNodePlugin.reindex());
  // The repository is in the graph; the plain folder, with no .git and no
  // .dir-locals.el, is not; and nothing asked for a notes folder.
  assert.deepEqual(await h(() => window.__orgNodePlugin.graph.nodes.map((n) => n.title)), ["Ideas"]);
  assert.match((await h(() => window.harness.log.toasts)).join("\n"), /Notes graph includes scratch/);
  assert.doesNotMatch((await h(() => window.harness.log.toasts)).join("\n"), /No notes yet/);

  // A new note goes into the repository of the file you are in.
  await h(() => window.harness.open("file:///sd/scratch/README.org"));
  h(() => window.harness.run("org-node.find"));
  await page.fill(".org-node-picker-input", "Fresh thought");
  await page.press(".org-node-picker-input", "Enter");
  await page.waitForFunction(() => window.harness.activeUri() === "file:///sd/scratch/fresh-thought.org");

  // Org editing works in any Org file, note or not: the TODO cookie follows.
  await h(() => window.harness.open("file:///sd/scratch/README.org"));
  await h(() => {
    const { editor } = window.harness;
    editor.dispatch({ selection: { anchor: editor.state.doc.line(3).from } });
  });
  await h(() => window.harness.run("org.todo-next")); // one: TODO -> NEXT
  await h(() => window.harness.run("org.todo-next")); // NEXT -> WAITING
  await h(() => window.harness.run("org.todo-next")); // WAITING -> DONE
  assert.equal(await h(() => window.harness.editor.state.doc.line(2).text), "* TODO A task [1/1]");

  // Settings: the notes folder is chosen with Acode's folder browser, not typed.
  const notesSetting = await h(() => window.harness.settingsPage.list.find((item) => item.key === "notesFolder"));
  assert.equal(notesSetting.folder, true);
  assert.equal(notesSetting.prompt, undefined);
  assert.deepEqual(errors, []);
  await page.close();
});
