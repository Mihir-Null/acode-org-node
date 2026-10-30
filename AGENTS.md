# Repository collaboration guidance

`docs/how-it-works.md` describes the design; update it in the same change that alters the design. The note format is
kittymacs' (`literate/71-org-node.org` there): when this plugin and kittymacs disagree about what a note, a tag or a
link is, kittymacs is right.

Code under `src/core/` stays free of Acode and the DOM, so it runs in plain Node. Before committing:

```sh
npm test                                              # build, unit tests, browser smoke test
ORG_NODE_TEST_REPOS=../kittymacs:../EmptyNet npm test # also index real repositories
```

## Commits and pull requests

Commits made with an AI agent end with the trailer `Assisted-by: AI tooling (Claude)`, and the pull request body ends
with "Prepared with AI assistance (Claude).". Add no `Co-Authored-By` trailer and no links to agent sessions, in
commits or pull requests. Commit messages explain why, in wrapped prose.
