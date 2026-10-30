import assert from "node:assert/strict";
import { test } from "node:test";

import { renderInline, renderOrg, todoKeywords } from "../src/core/render.js";

const html = (text, ctx) => renderOrg(text, ctx).replace(/\n/g, "");

test("title, headings with TODO, priority and tags; drawers and settings hidden", () => {
  const out = html(`:PROPERTIES:
:ID: abc
:END:
#+title: The loop
#+filetags: :concept:
#+startup: overview
# a comment

* DONE [#A] Ship it :release:
SCHEDULED: <2026-10-30 Fri>
:LOGBOOK:
- State "DONE"
:END:
Body text.`);
  assert.equal(
    out,
    '<h1 class="org-title">The loop</h1>' +
      '<h2 class="org-heading level-1" data-line="8"><span class="org-todo done">DONE</span> <span class="org-priority">#A</span> Ship it <span class="org-tags"><span>release</span></span></h2>' +
      '<div class="org-planning">SCHEDULED: &lt;2026-10-30 Fri&gt;</div>' +
      "<p>Body text.</p>",
  );
});

test("a link in a heading stays a link", () => {
  assert.equal(
    html("** Keep it out ([[file:archive/04-portability.md][portability]]) :decision:"),
    '<h3 class="org-heading level-2" data-line="0">Keep it out (<a class="org-link org-file" data-file="archive/04-portability.md" data-search="">portability</a>) <span class="org-tags"><span>decision</span></span></h3>',
  );
});

test("inline: links of every kind, emphasis, code, timestamps, escaping", () => {
  const ctx = { resolveId: (id) => (id === "known" ? { title: "Known note" } : null) };
  assert.equal(
    renderInline("[[id:known]] and [[id:gone][old]] see [[https://orgmode.org][Org]]", ctx),
    '<a class="org-link org-id" data-id="known">Known note</a> and ' +
      '<a class="org-link org-id missing" data-id="gone">old</a> see ' +
      '<a class="org-link org-web" data-href="https://orgmode.org">Org</a>',
  );
  assert.equal(
    renderInline("[[file:../x.org::*Top][x]] [[./img.png]] [[*Heading]]"),
    '<a class="org-link org-file" data-file="../x.org" data-search="*Top">x</a> ' +
      '<a class="org-link org-file" data-file="./img.png" data-search="">./img.png</a> ' +
      '<a class="org-link org-heading-link" data-heading="Heading">Heading</a>',
  );
  assert.equal(
    renderInline("*bold* /it/ _u_ =v<b>= ~c~ +s+ not*this* <2026-10-30 Fri> https://e.org x\\\\"),
    "<strong>bold</strong> <em>it</em> <u>u</u> <code>v&lt;b&gt;</code> <code>c</code> <del>s</del> not*this* " +
      '<span class="org-timestamp active">&lt;2026-10-30 Fri&gt;</span> ' +
      '<a class="org-link org-web" data-href="https://e.org">https://e.org</a> x<br>',
  );
  assert.equal(renderInline("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(renderInline("[[id:x][*bold* words]]"), '<a class="org-link org-id missing" data-id="x"><strong>bold</strong> words</a>');
});

test("lists: nesting, ordered, checkboxes, descriptions, continuation lines", () => {
  assert.equal(
    html("- one\n  continued\n  - nested\n- [X] two\n- [ ] three\n\nafter"),
    "<ul><li>one continued<ul><li>nested</li></ul></li>" +
      '<li class="task"><span class="org-checkbox on" data-line="3">☑</span> two</li>' +
      '<li class="task"><span class="org-checkbox off" data-line="4">☐</span> three</li></ul><p>after</p>',
  );
  assert.equal(html("1. first\n2) second"), "<ol><li>first</li><li>second</li></ol>");
  assert.equal(html("- term :: meaning\n- other :: too"), "<dl><dt>term</dt><dd>meaning</dd><dt>other</dt><dd>too</dd></dl>");
  assert.equal(html("- a\n\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(html("  * starred item"), "<ul><li>starred item</li></ul>");
});

test("tables, blocks, fixed-width, rules", () => {
  assert.equal(
    html("| a | b |\n|---+---|\n| 1 | *2* |"),
    '<table class="org-table"><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table>',
  );
  assert.equal(
    html("#+begin_src emacs-lisp :tangle no\n(setq a \"<b>\")\n,* not a heading\n#+end_src"),
    '<figure class="org-src"><figcaption>emacs-lisp</figcaption><pre data-lang="emacs-lisp"><code>(setq a &quot;&lt;b&gt;&quot;)* not a heading</code></pre></figure>',
  );
  assert.equal(html("#+begin_quote\nWise *words*\n#+end_quote"), "<blockquote><p>Wise <strong>words</strong></p></blockquote>");
  assert.equal(html("#+begin_comment\nhidden\n#+end_comment\nshown"), "<p>shown</p>");
  assert.equal(html(": fixed\n: width"), '<pre class="org-fixed">fixedwidth</pre>');
  assert.equal(html("-----"), "<hr>");
  // An unclosed block is not a block, as in Org: its lines are a paragraph.
  assert.equal(html("#+begin_src sh\nls"), "<p>#+begin_src sh ls</p>");
});

test("todo keywords come from the file when it declares them", () => {
  assert.deepEqual(todoKeywords(["#+todo: IDEA(i) | DROPPED"]), { all: ["IDEA", "DROPPED"], done: ["DROPPED"] });
  assert.deepEqual(todoKeywords(["#+todo: A B"]), { all: ["A", "B"], done: ["B"] });
  assert.equal(todoKeywords([]).done.includes("CANCELED"), true);
});
