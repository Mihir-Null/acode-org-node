import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cycleTodo,
  insertHeading,
  lineChange,
  moveSubtree,
  offsetOf,
  shiftHeading,
  toggleCheckbox,
  updateCookies,
} from "../src/core/edit.js";

const L = (text) => text.split("\n");
const apply = (oldLines, change) => {
  const text = oldLines.join("\n");
  return L(text.slice(0, change.from) + change.insert + text.slice(change.to));
};

test("cycleTodo walks kittymacs' keywords, or the file's own", () => {
  let lines = L("* Write the loop\nbody");
  const seen = [];
  for (let i = 0; i < 6; i++) {
    lines = cycleTodo(lines, 1).lines;
    seen.push(lines[0]);
  }
  assert.deepEqual(seen, [
    "* TODO Write the loop",
    "* NEXT Write the loop",
    "* WAITING Write the loop",
    "* DONE Write the loop",
    "* CANCELED Write the loop",
    "* Write the loop",
  ]);
  assert.equal(cycleTodo(L("* TODO x"), 0, -1).lines[0], "* x");
  assert.equal(cycleTodo(L("* x"), 0, -1).lines[0], "* CANCELED x");
  assert.equal(cycleTodo(L("#+todo: IDEA | DROPPED\n* IDEA x"), 1).lines[1], "* DROPPED x");
  assert.equal(cycleTodo(L("no heading"), 0), null);
});

test("cookies count checkboxes, or child TODO headings", () => {
  let lines = L("* Groceries [0/2] [0%]\n- [ ] milk\n- [ ] eggs\n** Not counted\n- [X] other");
  lines = toggleCheckbox(lines, 1).lines;
  assert.equal(lines[0], "* Groceries [1/2] [50%]");
  assert.equal(lines[1], "- [X] milk");
  lines = toggleCheckbox(lines, 1).lines;
  assert.equal(lines[0], "* Groceries [0/2] [0%]");
  assert.equal(toggleCheckbox(L("- [-] partly"), 0).lines[0], "- [X] partly");
  assert.equal(toggleCheckbox(L("- no box"), 0), null);

  lines = L("* Project [/]\n** TODO a\n** TODO b\n*** TODO deeper, not counted");
  lines = cycleTodo(lines, 1).lines; // a: TODO -> NEXT
  assert.equal(lines[0], "* Project [0/2]");
  lines = cycleTodo(cycleTodo(lines, 2, -1).lines, 2, -1).lines; // b: TODO -> none -> CANCELED
  assert.equal(lines[0], "* Project [1/2]");
  assert.deepEqual(updateCookies(L("* No cookie\n- [X] a"), 0), L("* No cookie\n- [X] a"));
});

test("promote and demote, one heading or the subtree", () => {
  const lines = L("* A\n** B\n*** C\n** D");
  assert.deepEqual(shiftHeading(lines, 1, 1).lines, L("* A\n*** B\n*** C\n** D"));
  assert.deepEqual(shiftHeading(lines, 2, -1, { subtree: false }).lines, L("* A\n** B\n** C\n** D"));
  assert.deepEqual(shiftHeading(lines, 1, -1, { subtree: true }).lines, L("* A\n* B\n** C\n** D"));
  assert.equal(shiftHeading(lines, 0, -1), null); // a level-1 heading stays
  assert.equal(shiftHeading(L("text"), 0, 1), null);
});

test("move a subtree past its sibling, cursor along", () => {
  const lines = L("* A\na\n* B\nb1\nb2\n** B.1\n* C");
  const up = moveSubtree(lines, 3, -1);
  assert.deepEqual(up.lines, L("* B\nb1\nb2\n** B.1\n* A\na\n* C"));
  assert.equal(up.line, 1); // still on "b1"
  const down = moveSubtree(lines, 0, 1);
  assert.deepEqual(down.lines, L("* B\nb1\nb2\n** B.1\n* A\na\n* C"));
  assert.equal(down.line, 4);
  assert.equal(moveSubtree(lines, 6, 1), null); // last sibling
  assert.equal(moveSubtree(lines, 5, -1), null); // B.1 has no sibling above
});

test("insert a heading after the subtree, before its trailing blank lines", () => {
  const result = insertHeading(L("* A\n** A.1\ntext\n\n* B"), 1);
  assert.deepEqual(result.lines, L("* A\n** A.1\ntext\n** \n\n* B"));
  assert.deepEqual([result.line, result.col], [3, 3]);
  assert.deepEqual(insertHeading(L("intro"), 0).lines, L("intro\n* "));
});

test("lineChange is the smallest change, and applies back exactly", () => {
  const cases = [
    ["a\nb\nc", "a\nB\nc"],
    ["a\nb\nc", "a\nx\ny\nb\nc"],
    ["a\nb\nc", "a\nc"],
    ["a\nb", "a\nb\nc"],
    ["a\nb\nc", "a\nb"],
    ["a", "x\na"],
    ["a\nb\nc\nd", "c\nd\na\nb"],
    ["only", "only"],
  ];
  for (const [before, after] of cases) {
    const change = lineChange(L(before), L(after));
    if (before === after) assert.equal(change, null);
    else assert.deepEqual(apply(L(before), change), L(after), `${before} -> ${after}`);
  }
  assert.deepEqual(lineChange(L("a\nb\nc"), L("a\nB\nc")), { from: 2, to: 3, insert: "B" });
  assert.equal(offsetOf(L("ab\ncd"), 1, 1), 4);
  assert.equal(offsetOf(L("ab\ncd"), 1, 99), 5);
});
