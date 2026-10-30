# Changelog

## 0.3.1

- The preview opens again: it showed an empty tab and the error "Cannot read properties of undefined (reading 'on')".
  Opening a note that was not already open in a tab failed the same way. Both used the tab that
  `acode.newEditorFile` makes, which Acode does not return; the plugin now makes its tabs with Acode's `EditorFile`.
- A link in a heading is a link in the preview, not plain text.

## 0.3.0

- **Any Org file** can be previewed: *Org: Preview* (`Alt-Shift-P`, or the Org button) renders it in a tab, unsaved
  edits included; tap a heading to go to it, or a link to follow it.
- **Org's structure editing** on any Org file: cycle TODO (`Shift-→`/`Shift-←` on a heading), toggle checkboxes,
  new heading (`Ctrl-Enter`), promote, demote and move headings and subtrees (`Alt` + arrows on a heading), with
  statistics cookies kept up to date; an **Org** button opens all of them as a menu.
- **Open git repositories join the graph** by themselves, with no notes folder or `.dir-locals.el` needed, and new
  notes go into the repository of the file you are in.
- The **Notes folder** setting opens Acode's folder browser instead of asking for a URL, and is optional.

## 0.2.0

- The links panel shows forward links too: the notes this one links to, from the editor's unsaved text, with links
  to missing IDs marked.
- Code in src blocks is coloured in its own language, by the language modes Acode already has.
- A **Link** button on the editor's edge in Org files inserts a link in one tap (setting: *Link button in Org files*).
- Ready for the plugin store: named *Org-node: Org mode notes & backlinks* so that searching "org mode" finds it,
  search keywords, screenshots, a source link, and a release workflow that publishes to acode.app.
- Opening a note no longer takes the keyboard back from a search opened while the note was still loading, which
  could type the search into the note.
- The plugin id is `mihirnull.org_node`: acode.app accepts only letters, digits, dots and underscores. A copy
  installed from an earlier zip (id `mihirnull.org-node`) is a different plugin to Acode: uninstall it first.

## 0.1.0

First version.

- Find, create and link notes in kittymacs' org-node graph, with Orderless-style search (`#tag`, `!word`).
- The graph: your notes folder, plus every open folder whose `.dir-locals.el` sets `kittymacs-org-node-project`.
- Backlinks in a sidebar panel that follows the cursor.
- Find by tag, and a tag index.
- Org highlighting and folding.
- An index cached by modification time, refreshed after saves and when Acode returns to the foreground.
