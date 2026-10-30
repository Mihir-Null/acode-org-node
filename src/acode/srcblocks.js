// Highlighting the code inside #+begin_src blocks with the languages Acode
// already has.
//
// Acode highlights a file with a "language mode": its own built-in ones and
// any a plugin registers.  Each mode can load a CodeMirror language, and a
// CodeMirror language carries a parser.  So for a block such as
//
//   #+begin_src nix
//   { pkgs, ... }: { }
//   #+end_src
//
// this module finds the mode for "nix", parses the block's text with its
// parser, and paints the result as decorations (coloured spans) over the
// block, in the colours of the active theme.  Org itself does the same
// (org-src-fontify-natively): it borrows each language's major mode.
//
// Only the blocks on screen are parsed, and each parse is cached by text,
// so long files with many blocks stay cheap.

const HEADING = /^\*+[ \t]/;
const BEGIN_SRC = /^[ \t]*#\+begin_src[ \t]+([^\s]+)/i;
const END_SRC = /^[ \t]*#\+end_src\b/i;

/**
 * Org's names for languages (org-babel's) that differ from Acode's mode
 * names, as file extensions Acode recognises.
 */
export const ORG_LANGUAGE_EXTENSIONS = {
  "emacs-lisp": "el",
  elisp: "el",
  lisp: "lisp",
  scheme: "scm",
  sh: "sh",
  shell: "sh",
  bash: "sh",
  zsh: "sh",
  fish: "fish",
  python: "py",
  "jupyter-python": "py",
  ipython: "py",
  js: "js",
  javascript: "js",
  ts: "ts",
  typescript: "ts",
  nix: "nix",
  rust: "rs",
  c: "c",
  "c++": "cpp",
  cpp: "cpp",
  haskell: "hs",
  latex: "tex",
  tex: "tex",
  yaml: "yaml",
  json: "json",
  toml: "toml",
  lua: "lua",
  go: "go",
  java: "java",
  ruby: "rb",
  css: "css",
  html: "html",
  sql: "sql",
  sqlite: "sql",
  r: "r",
  julia: "jl",
  dot: "dot",
  makefile: "mk",
  dockerfile: "dockerfile",
  powershell: "ps1",
  markdown: "md",
};

/**
 * The closed src blocks of a document whose lines LINE(i) returns (0-based):
 * [{lang, first, last}] with FIRST..LAST the lines of code between the
 * #+begin_src and #+end_src lines.  A heading ends an unclosed block, which
 * Org then does not treat as a block, so it is left out.
 */
export function findSrcBlocks(line, lineCount) {
  const blocks = [];
  for (let i = 0; i < lineCount; i++) {
    const begin = BEGIN_SRC.exec(line(i));
    if (!begin) continue;
    for (let j = i + 1; j < lineCount; j++) {
      const text = line(j);
      if (HEADING.test(text)) {
        i = j - 1;
        break;
      }
      if (END_SRC.test(text)) {
        if (j > i + 1) blocks.push({ lang: begin[1].toLowerCase(), first: i + 1, last: j - 1 });
        i = j;
        break;
      }
    }
  }
  return blocks;
}

/** The names to try for an Org language name, in order. */
export function languageCandidates(lang) {
  const name = lang.toLowerCase();
  const ext = ORG_LANGUAGE_EXTENSIONS[name];
  return { names: [name], paths: [ext && `file.${ext}`, `file.${name}`].filter(Boolean) };
}

/** Find a CodeMirror Language (it has a .parser) inside a loaded extension. */
export function languageIn(extension, depth = 0) {
  if (!extension || typeof extension !== "object" || depth > 4) return null;
  if (extension.parser && typeof extension.parser.parse === "function") return extension;
  if (extension.language?.parser) return extension.language;
  if (Array.isArray(extension)) {
    for (const item of extension) {
      const found = languageIn(item, depth + 1);
      if (found) return found;
    }
  }
  if (extension.extension) return languageIn(extension.extension, depth + 1);
  return null;
}

/**
 * Resolves Org language names to CodeMirror languages through Acode's
 * editorLanguages registry.  Every name is looked up once; the answer, a
 * Language or null, is remembered.
 */
export class LanguageResolver {
  constructor(editorLanguages, { exclude = [] } = {}) {
    this.editorLanguages = editorLanguages;
    this.exclude = new Set(exclude);
    this.known = new Map(); // name -> Language | null
    this.loading = new Map(); // name -> Promise
  }

  #modeFor(lang) {
    const { names, paths } = languageCandidates(lang);
    for (const name of names) {
      const mode = this.editorLanguages.get?.(name);
      if (mode?.languageExtension) return mode;
    }
    for (const path of paths) {
      const mode = this.editorLanguages.getForPath?.(path);
      if (mode?.languageExtension) return mode;
    }
    return null;
  }

  /** The language for LANG if already loaded; undefined while unknown. */
  peek(lang) {
    return this.known.get(lang);
  }

  /** Load the language for LANG; resolves to a Language or null. */
  load(lang) {
    if (this.known.has(lang)) return Promise.resolve(this.known.get(lang));
    if (this.loading.has(lang)) return this.loading.get(lang);
    const promise = (async () => {
      let language = null;
      try {
        const mode = this.#modeFor(lang);
        if (mode && !this.exclude.has(mode.name)) language = languageIn(await mode.languageExtension());
      } catch (error) {
        console.warn("[org-node] cannot load the language for", lang, error);
      }
      this.known.set(lang, language);
      this.loading.delete(lang);
      return language;
    })();
    this.loading.set(lang, promise);
    return promise;
  }
}

/**
 * The CodeMirror view plugin that paints src blocks.
 *
 * @param {object} cm Acode's CodeMirror modules (view, state, language, lezer)
 * @param {LanguageResolver} resolver
 */
export function srcBlockHighlighting(cm, resolver) {
  const { ViewPlugin, Decoration } = cm.view;
  const { StateEffect } = cm.state;
  const { highlightingFor } = cm.language;
  const highlightTree = cm.lezer.highlightTree ?? cm.lezer.highlight?.highlightTree;
  const languagesLoaded = StateEffect.define();
  const MAX_CACHED = 64;

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.trees = new Map(); // `${lang}\n${text}` -> Tree
        this.blocks = null;
        this.blocksDoc = null;
        this.decorations = this.build(view);
      }

      update(update) {
        const reload = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(languagesLoaded)));
        if (update.docChanged || update.viewportChanged || reload) this.decorations = this.build(update.view);
      }

      #blocks(doc) {
        if (this.blocksDoc !== doc) {
          this.blocks = findSrcBlocks((i) => doc.line(i + 1).text, doc.lines);
          this.blocksDoc = doc;
        }
        return this.blocks;
      }

      #tree(language, lang, text) {
        const key = `${lang}\n${text}`;
        let tree = this.trees.get(key);
        if (!tree) {
          tree = language.parser.parse(text);
          if (this.trees.size >= MAX_CACHED) this.trees.delete(this.trees.keys().next().value);
          this.trees.set(key, tree);
        }
        return tree;
      }

      build(view) {
        const { state } = view;
        const { doc } = state;
        const ranges = [];
        const highlighter = { style: (tags) => highlightingFor(state, tags) };
        for (const block of this.#blocks(doc)) {
          const from = doc.line(block.first + 1).from;
          const to = doc.line(block.last + 1).to;
          if (!view.visibleRanges.some((range) => range.from <= to && range.to >= from)) continue;
          const language = resolver.peek(block.lang);
          if (language === undefined) {
            // Not looked up yet: load it, then repaint once it arrives.
            resolver.load(block.lang).then((loaded) => {
              if (loaded) view.dispatch({ effects: languagesLoaded.of(null) });
            });
            continue;
          }
          if (!language) continue;
          const tree = this.#tree(language, block.lang, doc.sliceString(from, to));
          highlightTree(tree, highlighter, (start, end, classes) => {
            if (classes && end > start) ranges.push(Decoration.mark({ class: classes }).range(from + start, from + end));
          });
        }
        return Decoration.set(ranges, true);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
