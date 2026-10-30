import assert from "node:assert/strict";
import { test } from "node:test";

import { interpretDirLocals, listToArray, readAll, Sym } from "../src/core/elisp.js";
import { Graph } from "../src/core/graph.js";
import { compileQuery, matchesQuery, rankNodes, titleFromInput } from "../src/core/match.js";
import { inactiveTimestamp, makeIdLink, newId, newNoteText, slugifyForWeb, titleToFileName } from "../src/core/notes.js";
import { findIdLinks, idAtLine, parseHeadingText, parseOrg, splitAliases } from "../src/core/org.js";
import { isExcluded, isNoteFile, relativePath, urlPath } from "../src/core/paths.js";

const PAGE = `:PROPERTIES:
:ID: file-id
:ROAM_ALIASES: "The loop" loop
:END:

#+TITLE: The [[id:x][edit]] loop
#+FILETAGS: :concept:nix:

Intro links to [[id:other][the other page]] and id:bare-id here.
# A comment with [[id:ignored]] is skipped.

* TODO [#A] [1/2] Heading one [50%] :decision:
SCHEDULED: <2026-10-30 Fri>
:PROPERTIES:
:ID: h1
:END:
See [[id:other::*Section][with a search option]].
#+begin_src emacs-lisp
(insert "[[id:in-src]]")
#+end_src
** Child without an ID :deep:
A link from the child: [[id:file-id]].
** Child with ID
:PROPERTIES:
:ID:       h2
:END:
* Second top heading
Links to [[id:h2]] from a heading with no ID.
`;

test("file node: drawer, title with link, file tags, aliases", () => {
  const parsed = parseOrg(PAGE, { fileName: "loop.org" });
  assert.equal(parsed.fileId, "file-id");
  const file = parsed.nodes[0];
  assert.equal(file.title, "The edit loop");
  assert.deepEqual(file.tags, ["concept", "nix"]);
  assert.deepEqual(file.aliases, ["The loop", "loop"]);
  assert.equal(file.level, 0);
});

test("heading nodes: TODO, priority, cookies, tags, inheritance, planning line", () => {
  const parsed = parseOrg(PAGE, { fileName: "loop.org" });
  const h1 = parsed.nodes.find((n) => n.id === "h1");
  assert.equal(h1.title, "Heading one");
  assert.equal(h1.todo, "TODO");
  assert.deepEqual(h1.ownTags, ["decision"]);
  assert.deepEqual(h1.tags, ["concept", "nix", "decision"]);
  const h2 = parsed.nodes.find((n) => n.id === "h2");
  assert.deepEqual(h2.olp, ["Heading one"]);
  assert.deepEqual(h2.tags, ["concept", "nix", "decision"]);
  assert.equal(parsed.nodes.length, 3);
  assert.equal(parsed.headings.length, 4);
});

test("links: bracketed, bare, search option, origins; comments and src skipped", () => {
  const parsed = parseOrg(PAGE, { fileName: "loop.org" });
  const targets = parsed.links.map((l) => [l.target, l.origin]);
  assert.deepEqual(targets, [
    ["x", "file-id"], // org-mem scans keyword lines too: #+TITLE:'s link counts
    ["other", "file-id"],
    ["bare-id", "file-id"],
    ["other", "h1"],
    ["file-id", "h1"], // the child has no ID, so its nearest ancestor's
    ["h2", "file-id"], // "Second top heading" has no ID: the file's
  ]);
  assert.equal(parsed.links[1].context, "Intro links to the other page and id:bare-id here.");
});

test("no #+title: falls back to the file name; no drawer, no file node", () => {
  const parsed = parseOrg("* A\n:PROPERTIES:\n:ID: a\n:END:\n", { fileName: "notes.org" });
  assert.equal(parsed.title, "notes.org");
  assert.equal(parsed.fileId, null);
  assert.equal(parsed.nodes.length, 1);
});

test("#+todo: adds keywords; unknown words stay in the title", () => {
  const text = "#+todo: IDEA(i) | DROPPED\n* IDEA Thing\n:PROPERTIES:\n:ID: t\n:END:\n* MAYBE Other\n";
  const parsed = parseOrg(text);
  assert.equal(parsed.nodes[0].todo, "IDEA");
  assert.equal(parsed.nodes[0].title, "Thing");
  assert.equal(parseHeadingText("MAYBE Other", ["TODO"]).title, "MAYBE Other");
});

test("an unclosed drawer is not a drawer", () => {
  const parsed = parseOrg(":PROPERTIES:\n:ID: x\n* Heading\n");
  assert.equal(parsed.fileId, null);
});

test("heading text edge cases", () => {
  assert.deepEqual(parseHeadingText(":only:tags:", []), { todo: null, title: "", tags: ["only", "tags"] });
  assert.equal(parseHeadingText("Ratio 1:2 is not a tag", []).title, "Ratio 1:2 is not a tag");
  assert.equal(parseHeadingText("[2/10] Foo [5/10] Bar [1/10] [20%]", []).title, "Foo [5/10] Bar");
});

test("idAtLine finds the nearest ancestor with an ID", () => {
  const parsed = parseOrg(PAGE, { fileName: "loop.org" });
  const line = (needle) => PAGE.split("\n").findIndex((l) => l.includes(needle));
  assert.equal(idAtLine(parsed, line("Intro links")), "file-id");
  assert.equal(idAtLine(parsed, line("A link from the child")), "h1");
  assert.equal(idAtLine(parsed, line("** Child with ID") + 1), "h2");
  assert.equal(idAtLine(parsed, line("Links to [[id:h2]]")), "file-id");
});

test("findIdLinks reports columns for the link under the cursor", () => {
  const line = "x [[id:a][A]] y id:b z [[https://e.org][web]]";
  const links = findIdLinks(line);
  assert.deepEqual(
    links.map((l) => [l.id, l.desc, l.col, l.end]),
    [
      ["a", "A", 2, 13],
      ["b", null, 16, 20],
    ],
  );
});

test("aliases with quotes", () => {
  assert.deepEqual(splitAliases('"a b" c "d \\"e\\""'), ["a b", "c", 'd "e"']);
});

test("the elisp reader reads kittymacs' .dir-locals.el", () => {
  const text = `;;; Directory Local Variables -*- no-byte-compile: t -*-
;; comment ; with ( parens
((nil . ((kittymacs-org-node-project . t)
         (kittymacs-org-node-excluded-directories . ("secrets" "tools" "web")))))`;
  assert.deepEqual(interpretDirLocals(text), { project: true, excluded: ["secrets", "tools", "web"] });
  const [form] = readAll("(a . (b c))");
  assert.deepEqual(
    listToArray(form).map((s) => s.name),
    ["a", "b", "c"],
  );
  assert.ok(readAll("foo")[0] instanceof Sym);
  assert.deepEqual(interpretDirLocals("((nil . ((fill-column . 80))))"), { project: false, excluded: [] });
  assert.deepEqual(
    interpretDirLocals('((nil . ((kittymacs-org-node-project . t))) ("sub/" . ((nil . ((kittymacs-org-node-project . nil))))))'),
    { project: true, excluded: [] },
  );
  assert.throws(() => readAll("((nil . "));
});

test("paths: SAF and file URLs, exclusions", () => {
  const tree = "content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome%2FEmptyNet";
  const file = `${tree}::/data/data/com.termux/files/home/EmptyNet/wiki/loop.org`;
  assert.equal(urlPath(tree), "/data/data/com.termux/files/home/EmptyNet");
  assert.equal(relativePath(tree, file), "wiki/loop.org");
  assert.equal(relativePath("file:///sdcard/notes/", "file:///sdcard/notes/a/b.org"), "a/b.org");
  assert.equal(relativePath("file:///sdcard/notes", "file:///sdcard/other/b.org"), null);
  const primary = "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2Fnotes";
  assert.equal(relativePath(primary, `${primary}::primary:Documents/notes/x.org`), "x.org");

  assert.ok(isNoteFile("wiki/loop.org"));
  assert.ok(isNoteFile("old.org_archive"));
  assert.ok(!isNoteFile("wiki/loop.md"));
  assert.ok(isExcluded(".git/x.org"));
  assert.ok(isExcluded("a/_archive/x.org"));
  assert.ok(isExcluded("node_modules/x.org"));
  assert.ok(isExcluded("backups-2024/x.org"));
  assert.ok(isExcluded("secrets/x.org", ["secrets"]));
  assert.ok(isExcluded("docs/old/x.org", ["docs/old/"]));
  assert.ok(!isExcluded("secretsauce/x.org", ["secrets"]));
});

test("slugs match org-node-slugify-for-web's own examples", () => {
  assert.equal(slugifyForWeb("A/B testing"), "a-b-testing");
  assert.equal(slugifyForWeb("\"But there's still a chance, right?\""), "but-theres-still-a-chance-right");
  assert.equal(slugifyForWeb("Löb's Theorem"), "lobs-theorem");
  assert.equal(slugifyForWeb("Mañana Çedilla"), "manana-cedilla");
  assert.equal(slugifyForWeb("How to convince me that 2 + 2 = 3"), "how-to-convince-me-that-2-2-3");
  assert.equal(slugifyForWeb("The build cache"), "the-build-cache");
  assert.equal(titleToFileName("!!!"), "untitled.org");
});

test("new notes look like org-node's", () => {
  const date = new Date(2026, 9, 30, 9, 5);
  assert.equal(inactiveTimestamp(date), "[2026-10-30 Fri 09:05]");
  assert.equal(
    newNoteText("The build cache", "abc", date),
    ":PROPERTIES:\n:ID:       abc\n:CREATED:  [2026-10-30 Fri 09:05]\n:END:\n#+title: The build cache\n",
  );
  const parsed = parseOrg(newNoteText("T", "abc", date));
  assert.equal(parsed.fileId, "abc");
  assert.equal(parsed.title, "T");
  assert.match(newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const fallback = newId({ getRandomValues: (a) => a.fill(255) });
  assert.match(fallback, /^ffffffff-ffff-4fff-bfff-ffffffffffff$/);
});

test("links are made safe", () => {
  assert.equal(makeIdLink("x", "A [b]"), "[[id:x][A [b}]]");
  assert.equal(makeIdLink("x", ""), "[[id:x]]");
  assert.equal(makeIdLink("x", "two\n lines"), "[[id:x][two lines]]");
});

test("matching: words, tags, negation, ranking, new titles", () => {
  const nodes = [
    { title: "The loop", tags: ["concept"] },
    { title: "Loop invariants", tags: ["decision", "nix"] },
    { title: "Flakes", tags: ["nix", "machine"] },
  ];
  const titles = (input) => rankNodes(nodes, input).map((n) => n.title);
  assert.deepEqual(titles("loop"), ["Loop invariants", "The loop"]);
  assert.deepEqual(titles("#nix"), ["Flakes", "Loop invariants"]);
  assert.deepEqual(titles("#nix !#machine"), ["Loop invariants"]);
  assert.deepEqual(titles(""), ["Flakes", "Loop invariants", "The loop"]);
  assert.ok(matchesQuery(compileQuery("LOOP the"), "the loop"));
  assert.equal(titleFromInput("Build cache #nix !old"), "Build cache");
  assert.equal(titleFromInput("#nix"), null);
});

test("graph: backlinks across files, duplicates, tags, tag index", () => {
  const graph = new Graph();
  graph.setFile("file:///n/a.org", { root: "file:///n", rel: "a.org", parsed: parseOrg(PAGE, { fileName: "a.org" }) });
  graph.setFile("file:///n/b.org", {
    root: "file:///n",
    rel: "b.org",
    parsed: parseOrg(":PROPERTIES:\n:ID: other\n:END:\n#+title: Other\n#+filetags: :nix:\nBack to [[id:h1][one]].\n* Dup\n:PROPERTIES:\n:ID: h2\n:END:\n", { fileName: "b.org" }),
  });
  assert.equal(graph.get("other").title, "Other");
  const back = graph.backlinks("other");
  assert.equal(back.length, 2);
  assert.deepEqual(back.map((g) => g.from.id).sort(), ["file-id", "h1"]);
  assert.equal(graph.backlinks("h1")[0].from.title, "Other");
  assert.equal(graph.duplicates.length, 1);
  assert.equal(graph.get("h2").url, "file:///n/a.org");
  assert.deepEqual(graph.tagCounts().find(([t]) => t === "nix"), ["nix", 4]);
  const index = new Map(graph.taggedNotes());
  // A heading inheriting the file's tag is not listed again under it.
  assert.deepEqual(index.get("nix").map((n) => n.id), ["file-id", "other"]);
  assert.deepEqual(index.get("decision").map((n) => n.id), ["h1", "h2"]);
  assert.equal(graph.idAt("file:///n/a.org", 25), "h2");
  graph.removeRoot("file:///n");
  assert.equal(graph.nodes.length, 0);
});
