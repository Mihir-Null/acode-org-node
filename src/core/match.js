// Matching notes against what you type, the way kittymacs' prompt does.
//
// kittymacs completes with Orderless: the input is split at spaces and every
// word must match somewhere; a word starting with "!" must *not* match.  Tags
// are part of the matched text, written "#tag" (literate/71-org-node.org,
// "Tags in the prompt"), so "#decision" narrows to tagged notes and
// "#nixos !#machine" keeps the nixos notes without machine.

/** The text a node is matched against: title, aliases, then #tags. */
export function haystackOf(node) {
  return [node.title, ...(node.aliases ?? []), ...node.tags.map((tag) => `#${tag}`)].join(" ").toLowerCase();
}

/** Split INPUT into the words to require and the words to forbid. */
export function compileQuery(input) {
  const require = [];
  const forbid = [];
  for (const word of input.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    if (word.startsWith("!")) {
      if (word.length > 1) forbid.push(word.slice(1));
    } else {
      require.push(word);
    }
  }
  return { require, forbid };
}

export function matchesQuery(query, haystack) {
  return query.require.every((word) => haystack.includes(word)) && !query.forbid.some((word) => haystack.includes(word));
}

/**
 * The nodes matching INPUT, best first: titles starting with the first word,
 * then titles containing it, then the rest; ties by shorter title, then
 * alphabetically.  With no input, all nodes alphabetically.
 */
export function rankNodes(nodes, input, { limit = Infinity } = {}) {
  const query = compileQuery(input);
  const first = query.require.find((word) => !word.startsWith("#")) ?? "";
  const scored = [];
  for (const node of nodes) {
    const haystack = node._haystack ?? haystackOf(node);
    if (!matchesQuery(query, haystack)) continue;
    const title = node.title.toLowerCase();
    let score = 2;
    if (first && title.startsWith(first)) score = 0;
    else if (first && title.includes(first)) score = 1;
    else if (!first) score = 0;
    scored.push({ node, score, title });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (first ? a.title.length - b.title.length : 0) ||
      a.title.localeCompare(b.title),
  );
  return scored.slice(0, limit).map((entry) => entry.node);
}

/**
 * The title a new note would get from INPUT: the input minus any #tag and
 * !word filters, or null when that leaves nothing.  Typing "Build cache #nix"
 * offers to create "Build cache".
 */
export function titleFromInput(input) {
  const title = input
    .split(/\s+/)
    .filter((word) => word && !word.startsWith("#") && !word.startsWith("!"))
    .join(" ")
    .trim();
  return title || null;
}
