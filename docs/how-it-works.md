# How it works

This is a tour of the plugin for someone who wants to change it, or just to see how a small editor plugin is put
together. Read it with the source open; each section names the file it describes.

## The shape: a pure core and a thin adapter

```
src/
  core/            no Acode, no DOM: text in, plain objects out
    org.js         one Org file -> its notes, headings and id: links
    elisp.js       .dir-locals.el -> "is this a project, and what does it exclude"
    paths.js       which files of a folder are notes; Android URLs -> relative paths
    notes.js       slugs, UUIDs, timestamps, new-note text, id: link text
    match.js       Orderless-style matching and ranking
    graph.js       every parsed file -> notes by ID, backlinks, tags
  acode/           the parts that touch Acode or the screen
    files.js       listing and reading files; the index and its cache
    picker.js      the search overlay
    backlinks.js   the sidebar panel: links to and from the note at the cursor
    orgmode.js     CodeMirror highlighting and folding for Org
    srcblocks.js   src blocks coloured by Acode's own language modes
  main.js          lifecycle, settings, commands, events: the glue
```

The split exists for testing. Everything under `core/` runs in plain Node, so `test/core.test.js` can check the parser
against hand-written Org and `test/real-repos.test.js` against your real repositories, in milliseconds. The adapter is
checked end to end by `test/smoke.test.js`, which loads the *built* plugin into Chromium next to a stand-in for Acode.

## Reading Org like org-mem does (`core/org.js`)

kittymacs does not use org-roam's database; its graph comes from **org-mem**, which reads files with regular expressions
in background Emacs processes. The parser here is a port of org-mem's rules, so the phone and the desktop agree on what
a note is:

1. **The front matter.** Blank lines and `# comments` are skipped; if the next line is `:PROPERTIES:`, that drawer is the
   file's. Its `:ID:` makes the file a note. `#+title:` names it (links in the title show as their words), and
   `#+filetags:` tags it. A file with no title is named after its file, as `org-mem-entry-title` does.
2. **Headings.** A line of stars and a space. Its text is taken apart in the order Org requires: TODO keyword, priority
   cookie `[#A]`, statistics cookies `[1/3]`, title, then trailing tags `:a:b:`. The property drawer must come right
   after the heading, or after its `SCHEDULED:`/`DEADLINE:` line.
3. **Tag inheritance.** A heading's tags are its file's tags, then each ancestor's, then its own: what `org-get-tags`
   returns. A stack of open headings (`stack` in the code) gives the ancestors at every line.
4. **Links.** `[[id:…]]` and bare `id:…`, except in src, example and comment blocks, `# comment` lines and planning
   lines (org-mem's `org-mem-ignore-regions-regexps`). Each link records its **origin**: the nearest heading above it
   with an ID, or the file's. That is how a backlink knows which note it comes from.

One behaviour worth knowing: org-mem, and so this parser, also reads links inside `=verbatim=` text. kittymacs'
conventions pages show `=[[id:…][words]]=` as an example, and both tools see a link to `…`. The real-repos test only
requires UUID-shaped targets to resolve, for that reason.

## Reading `.dir-locals.el` (`core/elisp.js`)

Emacs never evaluates `.dir-locals.el`; it *reads* it as data. So does the plugin, with a reader of about a hundred
lines. It turns text into **cons cells**: pairs of `car` and `cdr`, from which Lisp builds every list.
`(a b c)` is `a . (b . (c . nil))`, and `(x . y)`, a *dotted pair*, is one cell whose `cdr` is not a list. An alist
like `((kittymacs-org-node-project . t))` is a list of such pairs.

`interpretDirLocals` then does what Emacs does with the result: keep the entries for `nil` (all modes) and the modes
an Org buffer derives from, and take the two kittymacs variables out of them. A regular expression would have worked
on today's file; a reader keeps working when the file gains comments, new variables or another layout.

## Android storage and its URLs (`core/paths.js`)

Acode names a file by URL. A folder you pick through Android's file picker uses the **Storage Access Framework**:

```
content://com.termux.documents/tree/%2Fdata%2F…%2FEmptyNet::/data/…/EmptyNet/wiki/loop.org
└─ provider ───────────────┘      └─ the folder you granted ─┘└─ this document's ID ───────┘
```

For Termux the document ID is the file's real path, so the path relative to the folder is "the ID minus the folder's
own path". `relativePath` does that for `content://`, `file://` and `primary:`-style IDs, and every rule after it
works on relative paths, so all three kinds of folder behave alike.

## Finding and reading files cheaply (`acode/files.js`)

Reading storage from a WebView is the slow part, so the index avoids it twice over:

- **Listing** uses Acode's `fileIndex`, a native SQLite index of open folders, when the build has it: one query for
  `.org` instead of a recursive walk through the Storage Access Framework. Otherwise it walks with `lsDir`, pruning
  excluded folders before descending into them.
- **Reading** is skipped for any file whose listing shows the same modification time and size as the cached parse. The
  cache is the plugin's cache file, written two seconds after the last change. At startup the graph is filled from the
  cache before anything is read, and refreshed 1.5 s later, so opening Acode is not slowed down.

`Indexer.indexRoots` serialises calls: a second call waits for the running one, then runs itself, so the last caller
always sees an index at least as new as its request.

## The graph (`core/graph.js`)

`Graph` holds the parsed files and builds three tables from them *lazily*: notes by ID, the list of all notes, and
links by target. Setting a file only marks the tables dirty; they are rebuilt on the next question. Indexing a hundred
files therefore costs one rebuild, not a hundred.

When an ID appears twice, the first file in path order wins and the second is reported in the status line, as org-mem
warns about duplicates.

## The picker (`acode/picker.js`, `core/match.js`)

Acode has a command palette, but it filters with its own matcher and cannot act on text that matches nothing, which
creating a note needs. So the plugin draws its own overlay: an input, the best 80 matches, and a **Create** row.

Matching follows kittymacs' Orderless setup: the input is split at spaces, every word must appear in "title, aliases,
#tags", and a word starting with `!` must not. Ranking puts titles starting with the first word ahead of titles
containing it, then shorter titles. As in Vertico, **Enter** takes the best match; **Create** comes first only when
nothing matches.

The overlay registers with Acode's `actionStack`, so Android's back button closes it like any Acode dialog.

## Org in the editor (`acode/orgmode.js`)

CodeMirror 6 can describe a language with a full incremental parser (Lezer) or with a **stream parser**: a function
called on each line that consumes a token and returns a style name. Org is line-oriented, so the stream parser is
enough. Its `state` carries what one line cannot know by itself: whether we are inside a `#+begin_…` block, and which
TODO keywords this file declares.

The style names are the names of `@lezer/highlight` tags (`heading1`, `keyword`, `link`, `monospace`, …), so Acode's
themes colour them with no CSS from the plugin.

Folding is a `foldService`: given a line, return the range to hide. A heading hides up to the next heading of the same
or higher level; a drawer up to `:END:`; a block up to its `#+end_`. A heading also ends an unclosed block, both in the
highlighter and the indexer, because it does in Org.

The plugin never bundles CodeMirror. Extensions only work with the *same* copy of CodeMirror the editor runs (its
facets and state fields are compared by identity), so `orgExtensions` receives Acode's own modules from
`acode.require("codemirror")`.

## Src blocks in their own language (`acode/srcblocks.js`)

Org colours a src block with the major mode of its language (`org-src-fontify-natively`). The plugin does the same
with Acode's **language modes**, which already cover dozens of languages and grow with every language plugin you
install:

1. **Find the blocks.** `findSrcBlocks` lists the closed `#+begin_src LANG … #+end_src` blocks of the document, once
   per version of the text.
2. **Find the language.** `LanguageResolver` asks Acode's `editorLanguages` for a mode called LANG, then for the mode
   of a file named `file.EXT`, using a table from Org's language names to file extensions (`emacs-lisp` → `el`).
   That is the order Acode's own code-snippet highlighter uses. A mode's loader returns a CodeMirror extension;
   somewhere inside it is a `Language`, which has a `parser`. Each name is looked up once.
3. **Parse and paint.** For each block on screen, the block's text is parsed with that parser, and
   `highlightTree` walks the result, asking `highlightingFor` (the active theme) for the class of each token. Each
   class becomes a *mark decoration*: a span CodeMirror draws over that range of the document. Parses are cached by
   text, so scrolling and typing elsewhere cost nothing.

Loading a language is asynchronous. The first paint skips a block whose language is not loaded yet; when it arrives,
the plugin dispatches a small state effect that makes the view plugin paint again.

The Org tokenizer returns no style for the lines of a src block that names its language, so the two layers of
colour never compete. A block without a language, or in one Acode does not know, keeps the plain code style.

Why not language servers? They provide completion, diagnostics and navigation for whole files; colouring in Acode
comes from language modes. Attaching a server to a block would mean opening the block as a file of its own, as
Emacs' `org-edit-special` (`C-c '`) does; that is a possible later feature.

## The glue (`main.js`)

- **Lifecycle.** `acode.setPluginInit` runs `init`; `setPluginUnmount` runs `destroy`, which removes every command,
  listener, sidebar app and language the plugin added. The one exception is Acode's selection menu, which has no
  removal API: its two items are added once per app session and call whichever plugin instance is current
  (`window.__orgNodePlugin`), so a disabled plugin answers with a message instead of failing.
- **Events.** `save-file` re-parses the saved file from the editor's text; `add-folder` checks the new folder for a
  project flag; `resume` (the app returning to the foreground) re-reads what changed, which is how a `git pull` in
  Termux reaches the graph.
- **The note at the cursor** is computed from the editor's live text, not the saved file. That gives the panel its
  forward links (the parsed links whose origin is this note) before you save; backlinks come from the index, since
  they live in other files.
- **The Link button** is one of Acode's side buttons (`acode.require("sideButton")`), the documented way for a
  plugin to put a button beside the editor. It is shown on `switch-file` when the new file is an Org file.

## The tests

| File                      | Runs in  | Checks                                                                      |
|---------------------------|----------|-----------------------------------------------------------------------------|
| `test/core.test.js`       | Node     | the parser, reader, paths, slugs, matcher and graph, on small inputs       |
| `test/real-repos.test.js` | Node     | real checkouts: every `:ID:` line is a note, every UUID link resolves      |
| `test/orgmode.test.js`    | Node     | the highlighter's tokens and the fold ranges                                |
| `test/srcblocks.test.js`  | Node     | finding src blocks, mapping Org language names, resolving Acode's modes    |
| `test/smoke.test.js`      | Chromium | the built plugin against a stand-in Acode: find, create, link, follow, both links sections, src-block colours, the Link button, tags, folding, unmount |

`test/smoke/harness.js` is that stand-in. It implements only the parts of Acode's API the plugin calls, over an
in-memory file system, with a real CodeMirror editor. It is a model of Acode, not Acode, so the first run on a phone
remains the real test; the harness's job is to catch mistakes in the glue before that.
