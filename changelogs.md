# Changelog

## 0.2.0

- The links panel shows forward links too: the notes this one links to, from the editor's unsaved text, with links
  to missing IDs marked.
- Code in src blocks is coloured in its own language, by the language modes Acode already has.
- A **Link** button on the editor's edge in Org files inserts a link in one tap (setting: *Link button in Org files*).
- Ready for the plugin store: named *Org-node: Org mode notes & backlinks* so that searching "org mode" finds it,
  search keywords, screenshots, a source link, and a release workflow that publishes to acode.app.
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
