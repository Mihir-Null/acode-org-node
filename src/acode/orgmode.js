// Org syntax highlighting and folding for Acode's CodeMirror 6 editor.
//
// CodeMirror has two ways to describe a language: a Lezer grammar (a real
// incremental parser) or a *stream parser*, a tokenizer called line by line
// that returns a style name for each token.  Org is line-oriented, so a
// stream parser fits it well.  The style names returned below ("heading1",
// "keyword", "link", ...) are names of @lezer/highlight tags, which Acode's
// themes already colour.
//
// The tokenizer and the fold finder are plain functions of text, so the tests
// run them without an editor; orgExtensions() wraps them with the CodeMirror
// modules Acode hands to plugins, so the plugin never bundles its own copy.

import { srcBlockHighlighting } from "./srcblocks.js";

const HEADING_START = /^(\*+)(?=[ \t])/;
const TODO_WORDS = ["TODO", "NEXT", "WAITING", "DONE", "CANCELED"];

const BLOCK_STYLES = { src: "monospace", example: "monospace", export: "monospace", quote: "quote", verse: "quote", comment: "comment" };

const LINK_RE = /^\[\[[^\[\]]+\](?:\[.+?\])?\]/;
const TIMESTAMP_RE = /^[<\[]\d{4}-\d{2}-\d{2}(?: [^\]>\n]*)?[>\]](?:--[<\[]\d{4}-\d{2}-\d{2}(?: [^\]>\n]*)?[>\]])?/;
const URL_RE = /^(?:https?|ftp|file):\/\/[^\s\]>)]+/;
const EMPHASIS_RE = /^([*/=~+_])(\S(?:.*?\S)??)\1(?=$|[\s\-.,:!?;'")}\[\]])/;
const EMPHASIS_STYLE = { "*": "strong", "/": "emphasis", "_": "emphasis", "=": "monospace", "~": "monospace", "+": "strikethrough" };
const EMPHASIS_PRE = /[\s('"{\-]/;
// Characters that may start an inline token; text runs stop before them.
const INLINE_START = /[\[<*/_=~+hf:]/;

function inlineToken(stream, base) {
  if (stream.match(LINK_RE)) return "link";
  if (stream.match(TIMESTAMP_RE)) return "atom";
  if (stream.match(URL_RE)) return "url";
  const prev = stream.pos === 0 ? " " : stream.string[stream.pos - 1];
  if (EMPHASIS_PRE.test(prev)) {
    const emphasis = stream.match(EMPHASIS_RE, false);
    if (emphasis) {
      stream.pos += emphasis[0].length;
      return base ? `${base} ${EMPHASIS_STYLE[emphasis[1]]}` : EMPHASIS_STYLE[emphasis[1]];
    }
  }
  stream.next();
  while (!stream.eol() && !INLINE_START.test(stream.peek())) stream.next();
  return base;
}

/** The stream parser: CodeMirror calls token() until each line is used up. */
export const orgStreamParser = {
  name: "org",
  startState: () => ({ block: null, blockLang: null, heading: 0, lineKind: null, todo: TODO_WORDS }),
  copyState: (state) => ({ ...state }),
  languageData: { commentTokens: { line: "#" } },

  token(stream, state) {
    if (stream.sol()) {
      state.heading = 0;
      state.lineKind = null;

      // A heading ends any block, as in Org (which is why Org escapes a
      // "*" at the start of a code line as ",*"); the indexer agrees.
      if (state.block && HEADING_START.test(stream.string)) state.block = null;
      if (state.block) {
        if (stream.match(new RegExp(`^[ \\t]*#\\+end_${state.block}\\b`, "i"))) {
          stream.skipToEnd();
          state.block = null;
          return "meta";
        }
        stream.skipToEnd();
        // A src block that names its language is coloured by that language
        // (srcblocks.js), so the Org style stays out of its way.
        if (state.block === "src" && state.blockLang) return null;
        return BLOCK_STYLES[state.block] ?? null;
      }

      const heading = stream.match(HEADING_START);
      if (heading) {
        state.heading = Math.min(heading[1].length, 6);
        state.lineKind = "heading-start";
        return `heading${state.heading} processingInstruction`;
      }

      const begin = stream.match(/^[ \t]*#\+begin_(\w+)(?:[ \t]+(\S+))?/i);
      if (begin) {
        state.block = begin[1].toLowerCase();
        state.blockLang = begin[2] ?? null;
        stream.skipToEnd();
        return "meta";
      }
      const keyword = stream.match(/^[ \t]*#\+(\w+):/);
      if (keyword) {
        state.lineKind = keyword[1].toLowerCase() === "title" ? "title" : "keyword-value";
        if (/^(seq_|typ_)?todo$/i.test(keyword[1])) state.todo = [...TODO_WORDS, ...stream.string.slice(stream.pos).split(/\s+/).map((w) => w.replace(/\(.*\)$/, "")).filter((w) => w && w !== "|")];
        return "meta";
      }
      if (stream.match(/^[ \t]*#(?: |$)/)) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^[ \t]*:[\w+-]+:(?=\s|$)/)) {
        state.lineKind = "property-value";
        return "propertyName";
      }
      if (stream.match(/^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/)) return "keyword";
      if (stream.match(/^[ \t]*\|/)) {
        stream.skipToEnd();
        return "monospace";
      }
      const bullet = stream.match(/^[ \t]*(?:[-+]|[ \t]+\*|\d+[.)])(?=[ \t]|$)/);
      if (bullet) {
        stream.match(/^[ \t]+\[[ X-]\](?=[ \t]|$)/);
        return "list";
      }
    }

    if (stream.eatSpace()) return state.heading ? `heading${state.heading}` : null;

    if (state.heading) {
      const base = `heading${state.heading}`;
      if (state.lineKind === "heading-start") {
        state.lineKind = "heading";
        const word = stream.match(/^\S+/, false);
        if (word && state.todo.includes(word[0])) {
          stream.pos += word[0].length;
          return `${base} keyword`;
        }
      }
      if (stream.match(/^\[#[A-Z0-9]\]/)) return `${base} atom`;
      if (stream.match(/^:(?:[^\s:]+:)+[ \t]*$/)) return "tagName";
      return inlineToken(stream, base);
    }

    if (state.lineKind === "title") {
      stream.skipToEnd();
      return "heading";
    }
    if (state.lineKind === "keyword-value" || state.lineKind === "property-value") {
      if (stream.match(LINK_RE)) return "link";
      stream.skipToEnd();
      return "string";
    }
    return inlineToken(stream, null);
  },
};

/**
 * The lines a fold starting at line INDEX (0-based) would hide, as
 * [first, last], or null.  A heading folds its subtree, a drawer up to its
 * :END:, a block up to its #+end_ line.  LINE(i) returns line i's text.
 */
export function foldLinesAt(line, lineCount, index) {
  const text = line(index);
  const heading = HEADING_START.exec(text);
  if (heading) {
    const level = heading[1].length;
    let last = index;
    for (let i = index + 1; i < lineCount; i++) {
      const next = HEADING_START.exec(line(i));
      if (next && next[1].length <= level) break;
      last = i;
    }
    // Leave trailing blank lines visible, as Org does.
    while (last > index && /^[ \t]*$/.test(line(last))) last--;
    return last > index ? [index + 1, last] : null;
  }
  const begin = /^[ \t]*#\+begin_(\w+)/i.exec(text);
  const isDrawer = /^[ \t]*:[\w-]+:[ \t]*$/.test(text) && !/^[ \t]*:END:/i.test(text);
  if (!begin && !isDrawer) return null;
  const end = begin ? new RegExp(`^[ \\t]*#\\+end_${begin[1]}\\b`, "i") : /^[ \t]*:END:[ \t]*$/i;
  for (let i = index + 1; i < lineCount; i++) {
    if (HEADING_START.test(line(i))) return null;
    if (end.test(line(i))) return i > index ? [index + 1, i] : null;
  }
  return null;
}

/**
 * The CodeMirror extensions for Org files.
 *
 * @param {object} cm Acode's acode.require("codemirror") namespace
 * @param {object} hooks
 * @param {(view) => void} [hooks.onCursor] called (debounced) when the
 *   selection moves or the text changes, so the backlinks panel can follow
 * @param {(view, pos) => boolean} [hooks.onLinkClick] Ctrl/Cmd-click on a
 *   link; return true when handled
 * @param {import("./srcblocks.js").LanguageResolver} [hooks.resolver] when
 *   given, src blocks are highlighted in their own languages
 * @param {Array<{key: string, run: (view) => boolean}>} [hooks.keymap]
 *   CodeMirror key bindings for Org files
 */
export function orgExtensions(cm, hooks = {}) {
  const { StreamLanguage, foldService } = cm.language;
  const { EditorView } = cm.view;
  const extensions = [
    StreamLanguage.define(orgStreamParser),
    foldService.of((state, lineStart) => {
      const { doc } = state;
      const first = doc.lineAt(lineStart);
      const range = foldLinesAt((i) => doc.line(i + 1).text, doc.lines, first.number - 1);
      if (!range) return null;
      return { from: first.to, to: doc.line(range[1] + 1).to };
    }),
  ];
  if (hooks.resolver) extensions.push(srcBlockHighlighting(cm, hooks.resolver));
  // Org's structure-editing keys.  High precedence, so that on a heading
  // Alt-Up moves the subtree; a binding that returns false (not on a
  // heading) lets the key fall through to Acode's own, such as moving a line.
  if (hooks.keymap?.length) extensions.push(cm.state.Prec.high(cm.view.keymap.of(hooks.keymap)));
  if (hooks.onLinkClick) {
    extensions.push(
      EditorView.domEventHandlers({
        mousedown(event, view) {
          if (!(event.ctrlKey || event.metaKey)) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          if (!hooks.onLinkClick(view, pos)) return false;
          event.preventDefault();
          return true;
        },
      }),
    );
  }
  if (hooks.onCursor) {
    let timer = null;
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return;
        clearTimeout(timer);
        timer = setTimeout(() => hooks.onCursor(update.view), 300);
      }),
    );
  }
  return extensions;
}
