# Org-node: Org mode notes & backlinks

Org mode on Android, inside the [Acode](https://acode.app) editor:

- **any Org file**: highlighting, folding, src blocks coloured in their own language, a rendered **preview**, and
  Org's structure editing (cycle TODO, toggle checkboxes, promote, demote and move subtrees, new headings);
- **linked notes**: find, create and link notes, and see what links to each one and what it links to.

It reads the notes [org-roam](https://www.orgroam.com) (v2) and [org-node](https://github.com/meedstrom/org-node)
write in Emacs, files and headings with an `:ID:` linked by `[[id:…]]`, with no database to sync: open a git
repository in Acode and its notes are in the graph. It is made for
[kittymacs](https://github.com/Mihir-Null/kittymacs), whose repositories join the graph by themselves, and writes
new notes the way kittymacs does, so a repository can go from your desktop to your phone and back with `git` and
nothing to convert:

- a **note** is a file or heading with an `:ID:` property, linked to with `[[id:…][words]]`;
- the **graph** is every git repository open in Acode, every repository whose `.dir-locals.el` sets
  `kittymacs-org-node-project`, and a notes folder if you choose one;
- a **new note** is `the-note-title.org`, starting with `:ID:`, `:CREATED:` and `#+title:`, as `SPC n f` makes it.

| Find a note, narrowed by a tag | A note's links, and its Emacs Lisp coloured as Lisp | The preview |
|---|---|---|
| ![The note picker, filtered to notes tagged #decision](https://raw.githubusercontent.com/Mihir-Null/acode-org-node/main/docs/screenshots/find.png) | ![An Org note with a coloured emacs-lisp block above the links panel, listing two notes that link here and one it links to](https://raw.githubusercontent.com/Mihir-Null/acode-org-node/main/docs/screenshots/links.png) | ![A kittymacs chapter rendered: title, headings with tags, a list, links and a coloured code block](https://raw.githubusercontent.com/Mihir-Null/acode-org-node/main/docs/screenshots/preview.png) |

*Rendered from kittymacs' own chapters in the plugin's test harness, with the One Dark theme; in Acode the panel is
the sidebar and the colours are your theme's.*

## Contents

- [Install](#install)
- [Set up the phone](#set-up-the-phone)
- [Use it](#use-it)
- [How the graph is found](#how-the-graph-is-found)
- [Differences from kittymacs](#differences-from-kittymacs)
- [Develop](#develop)

## Install

**From the plugin store:** in Acode, open **Settings → Plugins**, search for **Org-node** (or "org mode"), and
install it.

**From source**, for a version not yet in the store: Org-node needs a current Acode, with the CodeMirror editor and the native file index: versionCode 1002 or newer
(Acode's **About** page shows it; 1.13.5 is 1011).

1. Build the plugin, on a computer or in Termux (`pkg install nodejs git`):

   ```sh
   git clone https://github.com/Mihir-Null/acode-org-node.git
   cd acode-org-node
   npm ci
   npm run build        # writes dist/plugin.zip
   ```

2. In Acode: **Settings → Plugins → + (top right) → Local**, and choose `dist/plugin.zip`.
   From Termux, copy it somewhere Acode can see first: `cp dist/plugin.zip ~/storage/downloads/`.
   **Remote** installs from a URL instead, such as a release's `plugin.zip`.

## Set up the phone

1. Clone your repositories in Termux, as on any machine:

   ```sh
   termux-setup-storage          # once: lets Termux and Acode share ~/storage
   git clone https://github.com/Mihir-Null/EmptyNet.git
   ```

2. In Acode, **open the folder**: the sidebar's folder button, then pick **Termux** in Android's file picker (Termux
   offers its home folder there) and choose the repository. A clone under `~/storage/shared` works too.
3. A git repository joins the graph by itself while it is open: a message says *Notes graph includes EmptyNet*. A
   repository whose `.dir-locals.el` sets the kittymacs project flag is also remembered after you close it, as
   kittymacs remembers projects.
4. Nothing else to set up. New notes go into the repository of the file you are in. If you want notes that belong to
   no repository, choose a **Notes folder** in Org-node's settings (tap it to browse for a folder); new notes go
   there when the file you are in is in no repository.

After a `git pull` in Termux, switch back to Acode: the graph re-reads the files that changed.

## Use it

Everything is in Acode's command palette: **Org-node: …** for the notes graph, **Org: …** for editing and previewing
any Org file. The same letters as kittymacs' `SPC n` keys are bound to `Alt-Shift-<letter>` for a hardware keyboard.
On a touch screen, more ways in:

- two buttons on the editor's right edge while an Org file is open: **Link** inserts a link (select some words first
  to make them the link's text), and **Org** opens a menu of the editing commands and the preview;
- the **Org-node** sidebar app (the three-dot graph icon) shows the links of the note you are in, with **Find**,
  **New**, **Tags** and **Rescan** buttons at the top;
- **long-press** in an Org file: the selection menu has **Link note** and **Open link**.

| Command                                | kittymacs | Keyboard      | Does                                                                |
|----------------------------------------|-----------|---------------|---------------------------------------------------------------------|
| Org-node: Find or create note          | `SPC n f` | `Alt-Shift-F` | find a note; typing a title no note has creates one                 |
| Org-node: Insert link to note          | `SPC n i` | `Alt-Shift-I` | insert `[[id:…][…]]`; selected text becomes the link's words        |
| Org-node: Open link at cursor          | `RET`     | `Alt-Shift-O` | open the note an `id:` link points to (also `Ctrl`-click)           |
| Org-node: New note in folder…          | `SPC n c` | `Alt-Shift-C` | create a note in a graph folder you choose                          |
| Org-node: Show links                   | `SPC n b` | `Alt-Shift-B` | open the sidebar panel: links to and from this note                 |
| Org-node: Find note by tag             | `SPC n t` | `Alt-Shift-T` | choose a tag (with its note count), then a note                     |
| Org-node: List tags and their notes    | `SPC n T` |               | an Org buffer with each tag and links to its notes                  |
| Org-node: Rescan graph                 | `SPC n s` | `Alt-Shift-S` | read every file again and say what the graph holds                  |
| Org-node: Set notes folder             |           |               | choose your notes folder from the open folders, or browse           |
| Org-node: Forget project               |           |               | take a remembered project out of the graph                          |

**Any Org file**, note or not, can be edited the Org way and previewed. In an Org file the editor has Org's own keys;
the ones for headings act only with the cursor on a heading line, and leave the key to Acode elsewhere (Alt-Up still
moves a line of text):

| Command                       | Org                         | Keys in Org files          | Does                                                     |
|-------------------------------|-----------------------------|----------------------------|----------------------------------------------------------|
| Org: Preview                  |                             | `Alt-Shift-P`              | the file rendered in a tab beside it                     |
| Org: Cycle TODO forward / backward | `org-todo`             | `Shift-→` / `Shift-←`      | none → TODO → NEXT → WAITING → DONE → CANCELED → none     |
| Org: Toggle checkbox          | `C-c C-c`                   | `Ctrl-Shift-Enter`         | `[ ]` ↔ `[X]` on the line                                |
| Org: New heading              | `C-RET`                     | `Ctrl-Enter`               | a heading at this level, after this subtree              |
| Org: Promote / Demote heading | `M-←` / `M-→`               | `Alt-←` / `Alt-→`          | one level up or down                                     |
| Org: Promote / Demote subtree | `M-S-←` / `M-S-→`           | `Alt-Shift-←` / `Alt-Shift-→` | the heading and everything under it                   |
| Org: Move subtree up / down   | `M-↑` / `M-↓`               | `Alt-↑` / `Alt-↓`          | past the sibling above or below                          |
| Org: Menu of editing commands |                             |                            | all of the above, for a touch screen (the **Org** button) |

The cursor may be anywhere in a section: the command acts on the heading the section belongs to. Statistics cookies
follow, as in Org: `[1/3]` or `[33%]` on a heading counts the checkboxes under it, or its child headings that have a
TODO keyword and how many are done. Each command is one change, so one undo reverts it.

**The preview** renders the file as a reader sees it: the title, headings with their TODO keywords and tags,
paragraphs, lists with checkboxes, tables, quotes and code, with property drawers and settings left out. It shows
unsaved edits, and is drawn again each time you switch to it. Tap a heading to go to it in the file, an `id:` link to
open that note, a web link to open the browser, a `file:` link to open the file.

**Searching** works like kittymacs' Orderless prompt: every word must match the title, an alias (`ROAM_ALIASES`) or
a tag, in any order. Tags are written `#tag`, and a word starting with `!` must not match:

- `loop` finds every note with "loop" in its title;
- `#decision` lists the notes tagged `decision`;
- `#nixos !#machine` lists the `nixos` notes without `machine`.

**The links panel** follows the cursor. It is about the nearest heading with an ID above it, or the file's note, and
lists:

- **Links to here**: each note linking to it, with the line around each link; tap a line to open it there;
- **Links from here**: each note it links to, read from the editor's text, so a link you just typed counts before you
  save; tap a title to open that note, or a line to go to the link. A link to an ID no note has is shown in red.

**Org files** get highlighting (headings by level, TODO keywords, tags, links, timestamps, emphasis, blocks, drawers)
and folding: a heading folds its subtree, a drawer or a block folds to its end.

**Src blocks** are coloured in their own language, by whichever language modes your Acode has: its built-in ones and
any a language plugin adds. Org's names are mapped to Acode's (`emacs-lisp` → `.el`, `sh` → `.sh`, `python` → `.py`,
`nix`, `rust`, `haskell`, …). A block in a language Acode does not know stays plain. This is Org's own
`org-src-fontify-natively`, done with Acode's modes instead of Emacs' major modes.

## How the graph is found

- Every **git repository** open in Acode's sidebar (a folder with a `.git`), while it is open. Turn this off with the
  setting *Open repositories join the graph*.
- Your **notes folder**, if you choose one: tap the setting to browse for a folder (or run **Org-node: Set notes
  folder** to pick one of your open folders, or none). It skips the folders listed in *Folders to skip*.
- Every **project**: a folder you open in Acode whose `.dir-locals.el` says, as EmptyNet's does,

  ```elisp
  ((nil . ((kittymacs-org-node-project . t)
           (kittymacs-org-node-excluded-directories . ("secrets" "tools" "web")))))
  ```

  The file is read as data, never run. Projects are remembered, so they stay in the graph after the folder is closed;
  **Org-node: Forget project** removes one. A repository's `.dir-locals.el` can also list folders to skip without the
  project flag.
- Inside each folder, files ending in `.org` or `.org_archive` are read, except under a folder or file whose name
  starts with `.` or `_`, the folders the project excludes, and upstream's `org-mem-exclude` paths
  (`node_modules`, `backup…`, sync conflicts).

The index is cached with each file's modification time, so opening Acode shows the graph at once and re-reading touches
only the files that changed. **Rescan** reads everything again.

## Differences from kittymacs

- The `.`/`_` rule applies only *inside* a graph folder; org-mem applies it to the whole path, which would hide
  anything under Termux's `/data/data/…`.
- Any open git repository is in the graph, not only those with the project flag; and only folders open in Acode are
  checked, where kittymacs notices a project when you open any file in it.
- New notes are file notes in the root of the repository you are in (kittymacs puts `SPC n f`'s in the notes folder);
  there are no capture templates, refiling or extraction.
- Structure editing covers the common commands above; tables, lists and the agenda are edited as text.
- No `ROAM_REFS` lookups, unlinked references or org-roam database; the agenda and Org QL stay in Emacs.
- Language servers are not attached to src blocks; their code is coloured, not completed or checked.

## Develop

```sh
npm ci
npm test               # builds, then runs the unit tests and the browser smoke test
npm run watch          # rebuild build/main.js on every change
ORG_NODE_TEST_REPOS=~/src/kittymacs:~/src/EmptyNet npm test   # also index real repositories
```

The smoke test drives the built plugin in Chromium against a stand-in for Acode; it needs
[Playwright](https://playwright.dev) (`npm install --no-save playwright && npx playwright install chromium`) and is
skipped without it.

`test/smoke/screenshots.mjs` renders the screenshots above from a kittymacs checkout; its first lines say how to run
it.

[docs/how-it-works.md](docs/how-it-works.md) walks through the design: the parser, the `.dir-locals.el` reader, Android
storage URLs, the index and its cache, and how the tests are split.

## Release

1. Raise `version` in `plugin.json` (acode.app refuses a version that is not greater) and add a section to
   `changelogs.md`, which becomes the store's changelog.
2. Merge to `main`, then tag it and push the tag:

   ```sh
   git tag vX.Y.Z origin/main && git push origin vX.Y.Z
   ```

   The *Publish* workflow checks the tag against `plugin.json`, builds `dist/plugin.zip`, creates the GitHub release
   with that version's section of `changelogs.md` as its notes, uploads the zip to acode.app with the
   `ACODE_API_KEY` secret (an acode.app [API key](https://acode.app/api-keys) with the *Publish updates* permission
   for this plugin), and attaches it to the release. Publishing a release on GitHub with a `vX.Y.Z` tag works too;
   either way each version is uploaded once.

The very first version is submitted once by hand at acode.app, and an admin approves it before it is listed.

## Licence

GPL-3.0-or-later, like kittymacs.
