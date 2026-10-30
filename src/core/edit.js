// Org's structure editing, on any Org file.
//
// Each command takes the document as lines and the cursor's line, and returns
// the new lines and where the cursor goes, or null when it does not apply
// here (no heading above the cursor, no checkbox on the line, no sibling to
// swap with).  They never touch an editor: lineChange() turns the result into
// the one small text change an editor applies, so undo and the rest of the
// document are left alone.
//
// The commands and their Org names:
//   cycleTodo        org-todo (S-<right>, S-<left>)
//   toggleCheckbox   org-toggle-checkbox (C-c C-c on an item)
//   shiftHeading     org-promote / org-demote, and their -subtree forms
//   moveSubtree      org-move-subtree-up / -down
//   insertHeading    org-insert-heading-respect-content (C-<return>)
// Statistics cookies ([1/3], [33%]) are updated the way Org updates them.

import { todoKeywords } from "./render.js";

const HEADING_RE = /^(\*+)([ \t]+)(.*)$/;
const CHECKBOX_RE = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[([ Xx-])\]/;

const levelOf = (line) => {
  const match = HEADING_RE.exec(line);
  return match ? match[1].length : 0;
};

/** The heading whose section holds LINE: its index, or -1 before any. */
export function headingAt(lines, line) {
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) if (levelOf(lines[i])) return i;
  return -1;
}

/** Where the subtree of the heading at H ends (exclusive). */
export function subtreeEnd(lines, h) {
  const level = levelOf(lines[h]);
  for (let i = h + 1; i < lines.length; i++) {
    const other = levelOf(lines[i]);
    if (other && other <= level) return i;
  }
  return lines.length;
}

/** The heading H's parent heading, or -1. */
function parentOf(lines, h) {
  const level = levelOf(lines[h]);
  for (let i = h - 1; i >= 0; i--) {
    const other = levelOf(lines[i]);
    if (other && other < level) return i;
  }
  return -1;
}

/**
 * The keyword sequences a file cycles through: each #+todo: line is one
 * sequence; without any, kittymacs' TODO NEXT WAITING | DONE CANCELED.
 */
function todoSequences(lines) {
  const sequences = [];
  for (const line of lines) {
    const match = /^[ \t]*#\+(?:seq_|typ_)?todo:[ \t]*(.*)$/i.exec(line);
    if (!match) continue;
    const words = match[1]
      .split(/\s+/)
      .filter((w) => w && w !== "|")
      .map((w) => w.replace(/\(.*\)$/, ""));
    if (words.length) sequences.push(words);
  }
  return sequences.length ? sequences : [["TODO", "NEXT", "WAITING", "DONE", "CANCELED"]];
}

/**
 * Rewrite the statistics cookies of the heading at H: [n/m] or [p%].
 * A section with checkboxes counts its checked boxes; otherwise it counts
 * its child headings that have a TODO keyword, and how many are done.
 */
export function updateCookies(lines, h) {
  if (h < 0 || !/\[\d*(?:\/\d*|%)\]/.test(lines[h])) return lines;
  const level = levelOf(lines[h]);
  const end = subtreeEnd(lines, h);
  let checked = 0;
  let boxes = 0;
  for (let i = h + 1; i < end && !levelOf(lines[i]); i++) {
    const box = CHECKBOX_RE.exec(lines[i]);
    if (box) {
      boxes++;
      if (box[2] === "X" || box[2] === "x") checked++;
    }
  }
  let done = checked;
  let total = boxes;
  if (!boxes) {
    const { all, done: doneWords } = todoKeywords(lines);
    done = 0;
    total = 0;
    for (let i = h + 1; i < end; i++) {
      if (levelOf(lines[i]) !== level + 1) continue;
      const word = /^\*+[ \t]+(\S+)/.exec(lines[i])?.[1];
      if (!word || !all.includes(word)) continue;
      total++;
      if (doneWords.includes(word)) done++;
    }
  }
  const out = [...lines];
  out[h] = lines[h]
    .replace(/\[\d*\/\d*\]/g, `[${done}/${total}]`)
    .replace(/\[\d*%\]/g, `[${total ? Math.round((100 * done) / total) : 0}%]`);
  return out;
}

/**
 * Cycle the TODO keyword of the heading of LINE's section: forward
 * (DIRECTION 1) none → TODO → … → CANCELED → none, or backward (-1).
 * The parent's cookies follow.
 */
export function cycleTodo(lines, line, direction = 1) {
  const h = headingAt(lines, line);
  if (h < 0) return null;
  const [, stars, , rest] = HEADING_RE.exec(lines[h]);
  const sequences = todoSequences(lines);
  const word = /^(\S+)(?:[ \t]+|$)/.exec(rest);
  const sequence = (word && sequences.find((s) => s.includes(word[1]))) ?? sequences[0];
  const current = word && sequence.includes(word[1]) ? word[1] : null;
  const title = current ? rest.slice(word[0].length) : rest;
  // Positions in the sequence, with -1 for "no keyword".
  const index = current ? sequence.indexOf(current) : -1;
  let next = index + direction;
  if (next >= sequence.length) next = -1;
  if (next < -1) next = sequence.length - 1;
  const keyword = next === -1 ? "" : `${sequence[next]} `;
  let out = [...lines];
  out[h] = `${stars} ${keyword}${title}`.replace(/[ \t]+$/, (m) => (title ? "" : m));
  out = updateCookies(out, parentOf(out, h));
  const cursorCol = line === h ? Math.min(lines[line].length, out[h].length) : null;
  return { lines: out, line, col: cursorCol };
}

/** Check or uncheck the checkbox on LINE ([-] becomes checked). */
export function toggleCheckbox(lines, line) {
  const box = CHECKBOX_RE.exec(lines[line] ?? "");
  if (!box) return null;
  let out = [...lines];
  const mark = box[2] === "X" || box[2] === "x" ? " " : "X";
  out[line] = `${box[1]}[${mark}]${lines[line].slice(box[0].length)}`;
  out = updateCookies(out, headingAt(out, line));
  return { lines: out, line, col: null };
}

/**
 * Promote (DELTA -1) or demote (+1) the heading of LINE's section, with its
 * subtree when SUBTREE.  A level-1 heading cannot be promoted.
 */
export function shiftHeading(lines, line, delta, { subtree = false } = {}) {
  const h = headingAt(lines, line);
  if (h < 0) return null;
  const end = subtree ? subtreeEnd(lines, h) : h + 1;
  const out = [...lines];
  for (let i = h; i < end; i++) {
    const level = levelOf(lines[i]);
    if (!level) continue;
    if (level + delta < 1) return null;
    out[i] = "*".repeat(level + delta) + lines[i].slice(level);
  }
  return { lines: out, line, col: null };
}

/**
 * Swap the subtree of LINE's section with the sibling subtree above
 * (DIRECTION -1) or below (+1).  The cursor moves with the subtree.
 */
export function moveSubtree(lines, line, direction) {
  const h = headingAt(lines, line);
  if (h < 0) return null;
  const level = levelOf(lines[h]);
  const end = subtreeEnd(lines, h);
  let first;
  let second;
  if (direction < 0) {
    let sibling = -1;
    for (let i = h - 1; i >= 0; i--) {
      const other = levelOf(lines[i]);
      if (!other) continue;
      if (other < level) break;
      if (other === level) {
        sibling = i;
        break;
      }
    }
    if (sibling < 0) return null;
    first = [sibling, h];
    second = [h, end];
  } else {
    if (end >= lines.length || levelOf(lines[end]) !== level) return null;
    first = [h, end];
    second = [end, subtreeEnd(lines, end)];
  }
  const a = lines.slice(...first);
  const b = lines.slice(...second);
  const out = [...lines.slice(0, first[0]), ...b, ...a, ...lines.slice(second[1])];
  const offset = direction < 0 ? -(first[1] - first[0]) : second[1] - second[0];
  return { lines: out, line: line + offset, col: null };
}

/**
 * A new heading at the level of LINE's section, after its subtree (before
 * the blank lines that end it); level 1 before the first heading.  The
 * cursor goes after the stars.
 */
export function insertHeading(lines, line) {
  const h = headingAt(lines, line);
  const level = h < 0 ? 1 : levelOf(lines[h]);
  let at = h < 0 ? line + 1 : subtreeEnd(lines, h);
  while (at > Math.max(h + 1, 0) && /^[ \t]*$/.test(lines[at - 1])) at--;
  const heading = `${"*".repeat(level)} `;
  const out = [...lines.slice(0, at), heading, ...lines.slice(at)];
  return { lines: out, line: at, col: heading.length };
}

/**
 * The smallest single change turning OLD into NEW (both arrays of lines),
 * as character offsets into the old text: {from, to, insert}, or null when
 * they are equal.
 */
export function lineChange(oldLines, newLines) {
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  if (start === oldLines.length && start === newLines.length) return null;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const offset = (i) => {
    let pos = 0;
    for (let k = 0; k < i; k++) pos += oldLines[k].length + 1;
    return pos;
  };
  const inserted = newLines.slice(start, newEnd).join("\n");
  if (oldEnd === start) {
    // Lines inserted before old line START.
    if (start < oldLines.length) return { from: offset(start), to: offset(start), insert: `${inserted}\n` };
    return { from: offset(start) - 1, to: offset(start) - 1, insert: `\n${inserted}` };
  }
  if (newEnd === start) {
    // Lines START..OLDEND removed, with one line break.
    if (oldEnd < oldLines.length) return { from: offset(start), to: offset(oldEnd), insert: "" };
    return { from: Math.max(offset(start) - 1, 0), to: offset(oldEnd) - 1, insert: "" };
  }
  return { from: offset(start), to: offset(oldEnd) - 1, insert: inserted };
}

/** The character offset of LINE, COL in LINES (COL clamped; null: line start). */
export function offsetOf(lines, line, col) {
  let pos = 0;
  for (let k = 0; k < line && k < lines.length; k++) pos += lines[k].length + 1;
  return pos + (col == null ? 0 : Math.min(col, lines[line]?.length ?? 0));
}
