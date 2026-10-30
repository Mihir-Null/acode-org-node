import assert from "node:assert/strict";
import { test } from "node:test";

import { findSrcBlocks, languageCandidates, languageIn, LanguageResolver } from "../src/acode/srcblocks.js";

const blocksOf = (text) => {
  const lines = text.split("\n");
  return findSrcBlocks((i) => lines[i], lines.length);
};

test("src blocks: closed ones only, language lower-cased", () => {
  assert.deepEqual(blocksOf("#+begin_src Nix :tangle x.nix\n{ }\nx\n#+end_src\ntext\n#+BEGIN_SRC sh\nls\n#+END_SRC"), [
    { lang: "nix", first: 1, last: 2 },
    { lang: "sh", first: 6, last: 6 },
  ]);
  // Empty, unnamed, and ended by a heading: none of them is highlighted.
  assert.deepEqual(blocksOf("#+begin_src sh\n#+end_src\n#+begin_src\nx\n#+end_src\n#+begin_src py\nx\n* Heading\n#+end_src"), []);
});

test("Org language names map to Acode's", () => {
  assert.deepEqual(languageCandidates("emacs-lisp"), { names: ["emacs-lisp"], paths: ["file.el", "file.emacs-lisp"] });
  assert.deepEqual(languageCandidates("Nix"), { names: ["nix"], paths: ["file.nix", "file.nix"] });
  assert.deepEqual(languageCandidates("cobol"), { names: ["cobol"], paths: ["file.cobol"] });
});

test("languageIn finds the parser in what a mode loads", () => {
  const language = { parser: { parse() {} } };
  assert.equal(languageIn(language), language);
  assert.equal(languageIn({ language, support: [] }), language); // LanguageSupport
  assert.equal(languageIn([{}, [{ extension: [language] }]]), language);
  assert.equal(languageIn([{}, null]), null);
});

test("the resolver asks Acode by name, then by file name, once", async () => {
  const nix = { parser: { parse() {} } };
  const calls = [];
  const languages = {
    get: (name) => (calls.push(`get ${name}`), null),
    getForPath: (path) => {
      calls.push(`path ${path}`);
      return path === "file.nix" ? { name: "nix", languageExtension: async () => ({ language: nix }) } : { name: "text", languageExtension: null };
    },
  };
  const resolver = new LanguageResolver(languages, { exclude: ["org"] });
  assert.equal(resolver.peek("nix"), undefined);
  assert.equal(await resolver.load("nix"), nix);
  assert.equal(await resolver.load("nix"), nix);
  assert.equal(resolver.peek("nix"), nix);
  assert.deepEqual(calls, ["get nix", "path file.nix"]);
  assert.equal(await resolver.load("cobol"), null);

  const org = new LanguageResolver({ get: () => ({ name: "org", languageExtension: async () => nix }) }, { exclude: ["org"] });
  assert.equal(await org.load("org"), null);
});
