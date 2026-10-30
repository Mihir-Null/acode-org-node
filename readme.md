# Org-node for Acode

Work with your [kittymacs](https://github.com/Mihir-Null/kittymacs) notes graph on Android: find, create and link
[org-node](https://github.com/meedstrom/org-node) notes, see what links to them and what they link to, and edit Org
files with highlighting, folding and coloured src blocks, inside the [Acode](https://acode.app) editor.

It reads and writes exactly what kittymacs does, so a repository such as EmptyNet can go from your desktop to your phone
and back with `git` and nothing to convert:

- a **note** is a file or heading with an `:ID:` property, linked to with `[[id:…][words]]`;
- the **graph** is your notes folder plus every repository whose `.dir-locals.el` sets `kittymacs-org-node-project`;
- a **new note** is `the-note-title.org`, starting with `:ID:`, `:CREATED:` and `#+title:`, as `SPC n f` makes it.

## Contents

- [Install](#install)
- [Set up the phone](#set-up-the-phone)
- [Use it](#use-it)
- [How the graph is found](#how-the-graph-is-found)
- [Differences from kittymacs](#differences-from-kittymacs)
- [Develop](#develop)

## Install

Org-node needs a current Acode, with the CodeMirror editor and the native file index: versionCode 1002 or newer
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
3. Org-node reads the repository's `.dir-locals.el`, sees the project flag, and adds it to the graph: a message says
   *Notes graph includes EmptyNet*. It is remembered from then on, as kittymacs remembers projects.
4. Optionally, open your own notes folder the same way and run **Org-node: Set notes folder**. New notes go there.

After a `git pull` in Termux, switch back to Acode: the graph re-reads the files that changed.

## Use it

Everything is in Acode's command palette as **Org-node: …**. The same letters as kittymacs' `SPC n` keys are bound to
`Alt-Shift-<letter>` for a hardware keyboard. On a touch screen, three more ways in:

- the **Link** button on the editor's right edge, shown while an Org file is open: tap it to insert a link (select
  some words first to make them the link's text);
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

- Your **notes folder** (the setting, or **Org-node: Set notes folder**), with the folders listed in *Folders to skip*.
- Every **project**: a folder you open in Acode whose `.dir-locals.el` says, as EmptyNet's does,

  ```elisp
  ((nil . ((kittymacs-org-node-project . t)
           (kittymacs-org-node-excluded-directories . ("secrets" "tools" "web")))))
  ```

  The file is read as data, never run. Projects are remembered, so they stay in the graph after the folder is closed;
  **Org-node: Forget project** removes one.
- Inside each folder, files ending in `.org` or `.org_archive` are read, except under a folder or file whose name
  starts with `.` or `_`, the folders the project excludes, and upstream's `org-mem-exclude` paths
  (`node_modules`, `backup…`, sync conflicts).

The index is cached with each file's modification time, so opening Acode shows the graph at once and re-reading touches
only the files that changed. **Rescan** reads everything again.

## Differences from kittymacs

- The `.`/`_` rule applies only *inside* a graph folder; org-mem applies it to the whole path, which would hide
  anything under Termux's `/data/data/…`.
- Only folders open in Acode are checked for a `.dir-locals.el`; kittymacs notices a project when you open any file in it.
- New notes are file notes in the folder's root, as `SPC n f` makes them; there are no capture templates, refiling or
  extraction.
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

[docs/how-it-works.md](docs/how-it-works.md) walks through the design: the parser, the `.dir-locals.el` reader, Android
storage URLs, the index and its cache, and how the tests are split.

## Licence

GPL-3.0-or-later, like kittymacs.
