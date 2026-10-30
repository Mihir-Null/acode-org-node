import assert from "node:assert/strict";
import { test } from "node:test";
import { StringStream } from "@codemirror/language";

import { foldLinesAt, orgStreamParser } from "../src/acode/orgmode.js";

/** Tokenize TEXT the way CodeMirror would: [[text, style], ...] per line. */
function tokens(text) {
  const state = orgStreamParser.startState();
  return text.split("\n").map((line) => {
    const stream = new StringStream(line, 4, 2);
    const out = [];
    while (!stream.eol()) {
      const style = orgStreamParser.token(stream, state);
      const piece = stream.current();
      if (out.length && out[out.length - 1][1] === style) out[out.length - 1][0] += piece;
      else out.push([piece, style]);
      stream.start = stream.pos;
    }
    return out;
  });
}

test("headings: level, TODO keyword, priority, tags, links", () => {
  const [line] = tokens("** TODO [#A] Read [[id:x][the loop]] :nix:decision:");
  assert.deepEqual(line, [
    ["**", "heading2 processingInstruction"],
    [" ", "heading2"],
    ["TODO", "heading2 keyword"],
    [" ", "heading2"],
    ["[#A]", "heading2 atom"],
    [" Read ", "heading2"],
    ["[[id:x][the loop]]", "link"],
    [" ", "heading2"],
    [":nix:decision:", "tagName"],
  ]);
});

test("keywords, drawers, comments, planning, lists", () => {
  const lines = tokens(
    "#+title: The loop\n#+filetags: :concept:\n:PROPERTIES:\n:ID: abc\n:END:\n# a comment\nSCHEDULED: <2026-10-30 Fri>\n- [X] done",
  );
  assert.deepEqual(lines[0], [["#+title:", "meta"], [" ", null], ["The loop", "heading"]]);
  assert.deepEqual(lines[1], [["#+filetags:", "meta"], [" ", null], [":concept:", "string"]]);
  assert.deepEqual(lines[2], [[":PROPERTIES:", "propertyName"]]);
  assert.deepEqual(lines[3], [[":ID:", "propertyName"], [" ", null], ["abc", "string"]]);
  assert.deepEqual(lines[5], [["# a comment", "comment"]]);
  assert.deepEqual(lines[6], [["SCHEDULED:", "keyword"], [" ", null], ["<2026-10-30 Fri>", "atom"]]);
  assert.deepEqual(lines[7], [["- [X]", "list"], [" done", null]]);
});

test("blocks are one style until their end line", () => {
  const lines = tokens("#+begin_src\n,* escaped star\n{ x = 1; }\n#+end_src\n* Heading");
  assert.deepEqual(lines[0], [["#+begin_src", "meta"]]);
  assert.deepEqual(lines[1], [[",* escaped star", "monospace"]]);
  assert.deepEqual(lines[2], [["{ x = 1; }", "monospace"]]);
  assert.deepEqual(lines[3], [["#+end_src", "meta"]]);
  assert.equal(lines[4][0][1], "heading1 processingInstruction");
});

test("a src block naming its language is left to that language", () => {
  const lines = tokens("#+begin_src nix :tangle x.nix\n{ x = 1; }\n#+end_src\n#+begin_example\nplain\n#+end_example");
  assert.deepEqual(lines[0], [["#+begin_src nix :tangle x.nix", "meta"]]);
  assert.deepEqual(lines[1], [["{ x = 1; }", null]]);
  assert.deepEqual(lines[4], [["plain", "monospace"]]);
});

test("a heading ends an unclosed block, as in Org", () => {
  const lines = tokens("#+begin_src sh\n* Heading\nplain");
  assert.equal(lines[1][0][1], "heading1 processingInstruction");
  assert.deepEqual(lines[2], [["plain", null]]);
});

test("emphasis needs whitespace or punctuation around it", () => {
  const [line] = tokens("a *bold* /it/ =verb= ~code~ +gone+ not*this*");
  const styled = line.filter(([, style]) => style).map(([text, style]) => [text, style]);
  assert.deepEqual(styled, [
    ["*bold*", "strong"],
    ["/it/", "emphasis"],
    ["=verb=", "monospace"],
    ["~code~", "monospace"],
    ["+gone+", "strikethrough"],
  ]);
});

test("#+todo: keywords highlight in headings", () => {
  const lines = tokens("#+todo: IDEA | DROPPED\n* IDEA Thing");
  assert.deepEqual(lines[1][2], ["IDEA", "heading1 keyword"]);
});

test("folding: subtrees, drawers, blocks", () => {
  const doc = ["* A", ":PROPERTIES:", ":ID: a", ":END:", "text", "** B", "more", "", "* C", "#+begin_src sh", "ls", "#+end_src"];
  const line = (i) => doc[i];
  assert.deepEqual(foldLinesAt(line, doc.length, 0), [1, 6]); // trailing blank stays visible
  assert.deepEqual(foldLinesAt(line, doc.length, 1), [2, 3]);
  assert.deepEqual(foldLinesAt(line, doc.length, 5), [6, 6]);
  assert.deepEqual(foldLinesAt(line, doc.length, 9), [10, 11]);
  assert.equal(foldLinesAt(line, doc.length, 4), null);
  assert.equal(foldLinesAt(line, doc.length, 11), null);
});
