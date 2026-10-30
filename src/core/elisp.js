// A small Emacs Lisp reader, enough for .dir-locals.el.
//
// kittymacs decides which repositories join the notes graph from each
// repository's .dir-locals.el:
//
//   ((nil . ((kittymacs-org-node-project . t)
//            (kittymacs-org-node-excluded-directories . ("secrets" "tools")))))
//
// Emacs never evaluates that file; it only *reads* it as data, and so does
// this module.  It turns Lisp text into cons cells (car/cdr pairs), the data
// structure Lisp lists are built from, and then walks the alists the same way
// Emacs' dir-locals code does.

export class Cons {
  constructor(car, cdr) {
    this.car = car;
    this.cdr = cdr;
  }
}

export class Sym {
  constructor(name) {
    this.name = name;
  }
}

const DELIMITERS = new Set(["(", ")", "'", '"', ";", " ", "\t", "\n", "\r", "\f"]);

/**
 * Read every form in TEXT.  nil reads as null, t as true, a string as a JS
 * string, a number as a number and any other symbol as a Sym.
 * Throws on unbalanced parentheses or an unterminated string.
 */
export function readAll(text) {
  let pos = 0;

  const skipSpaceAndComments = () => {
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === ";") {
        while (pos < text.length && text[pos] !== "\n") pos++;
      } else if (/\s/.test(ch)) {
        pos++;
      } else {
        break;
      }
    }
  };

  const readString = () => {
    pos++; // opening quote
    let out = "";
    while (pos < text.length) {
      const ch = text[pos++];
      if (ch === '"') return out;
      if (ch === "\\") {
        const next = text[pos++];
        if (next === "n") out += "\n";
        else if (next === "t") out += "\t";
        else if (next === "\n") out += ""; // escaped newline: continuation
        else out += next;
      } else {
        out += ch;
      }
    }
    throw new SyntaxError("Unterminated string in Lisp data");
  };

  const readAtom = () => {
    let start = pos;
    while (pos < text.length && !DELIMITERS.has(text[pos])) {
      if (text[pos] === "\\") pos++;
      pos++;
    }
    const name = text.slice(start, pos).replace(/\\(.)/g, "$1");
    if (name === "nil") return null;
    if (name === "t") return true;
    if (/^[+-]?\d+(\.\d+)?$/.test(name)) return Number(name);
    return new Sym(name);
  };

  const readList = () => {
    pos++; // "("
    const items = [];
    let tail = null;
    for (;;) {
      skipSpaceAndComments();
      if (pos >= text.length) throw new SyntaxError("Unbalanced parenthesis in Lisp data");
      if (text[pos] === ")") {
        pos++;
        break;
      }
      // A lone "." makes a dotted pair: (a . b).
      if (text[pos] === "." && (pos + 1 >= text.length || DELIMITERS.has(text[pos + 1]))) {
        pos++;
        tail = readForm();
        skipSpaceAndComments();
        if (text[pos] !== ")") throw new SyntaxError("Expected ) after dotted tail");
        pos++;
        break;
      }
      items.push(readForm());
    }
    let list = tail;
    for (let i = items.length - 1; i >= 0; i--) list = new Cons(items[i], list);
    return list;
  };

  const readForm = () => {
    skipSpaceAndComments();
    const ch = text[pos];
    if (ch === "(") return readList();
    if (ch === ")") throw new SyntaxError("Unexpected ) in Lisp data");
    if (ch === '"') return readString();
    if (ch === "'") {
      pos++;
      return new Cons(new Sym("quote"), new Cons(readForm(), null));
    }
    return readAtom();
  };

  const forms = [];
  for (;;) {
    skipSpaceAndComments();
    if (pos >= text.length) return forms;
    forms.push(readForm());
  }
}

/** A proper list as a JS array (a dotted tail is dropped). */
export function listToArray(list) {
  const out = [];
  while (list instanceof Cons) {
    out.push(list.car);
    list = list.cdr;
  }
  return out;
}

const symName = (value) => (value instanceof Sym ? value.name : value === null ? "nil" : null);

/**
 * What a .dir-locals.el says about the notes graph.
 *
 * Emacs applies the entries for `nil' (every mode) and for the modes an Org
 * buffer derives from (org-mode, text-mode), so those are the ones read
 * here; the later entry wins, as in `dir-locals-collect-variables'.
 * Subdirectory entries (string keys) apply to other folders and are skipped.
 *
 * @returns {{project: boolean, excluded: string[]}}
 */
export function interpretDirLocals(text) {
  const result = { project: false, excluded: [] };
  const [alist] = readAll(text);
  for (const entry of listToArray(alist)) {
    if (!(entry instanceof Cons)) continue;
    const mode = symName(entry.car);
    if (!["nil", "org-mode", "text-mode"].includes(mode)) continue;
    for (const binding of listToArray(entry.cdr)) {
      if (!(binding instanceof Cons)) continue;
      const variable = symName(binding.car);
      if (variable === "kittymacs-org-node-project") {
        result.project = binding.cdr !== null;
      } else if (variable === "kittymacs-org-node-excluded-directories") {
        result.excluded = listToArray(binding.cdr).filter((item) => typeof item === "string");
      }
    }
  }
  return result;
}
