// Whatever-first search, recorded step by step so the UI can scrub forwards and backwards.
//
//   WhateverFirstSearch(s):
//     put (∅, s) in bag
//     while the bag is not empty:
//       take (p, v) from the bag
//       if v is unmarked:
//         mark v
//         parent(v) ← p
//         for each edge v→w:
//           put (v, w) in the bag

import { adjacency, Graph, mulberry32 } from './graph';

export type BagKind = 'stack' | 'queue' | 'random' | 'minEdge' | 'maxEdge' | 'dist';

export interface BagInfo {
  kind: BagKind;
  name: string;
  short: string;
  accent: string;
  takeRule: string;
  builds: string;
  insight: string;
  priority?: string;
  needsWeights?: boolean;
}

export const BAGS: BagInfo[] = [
  {
    kind: 'stack',
    name: 'Stack',
    short: 'DFS',
    accent: '#a78bfa',
    takeRule: 'remove the pair that was added most recently (last in, first out).',
    builds: 'Depth-first search tree',
    insight:
      'The newest neighbor is always taken next, so the search dives as deep as it can and only backs up when every pair on top of the stack leads somewhere already marked.',
  },
  {
    kind: 'queue',
    name: 'Queue',
    short: 'BFS',
    accent: '#2dd4bf',
    takeRule: 'remove the pair that has waited the longest (first in, first out).',
    builds: 'Breadth-first search tree',
    insight:
      'Everything one edge away is queued before anything two edges away, so the search spreads out in rings. Every tree path uses the fewest possible edges.',
  },
  {
    kind: 'random',
    name: 'Random bag',
    short: 'Random',
    accent: '#fbbf24',
    takeRule: 'remove any pair at all, chosen uniformly at random.',
    builds: 'Some spanning tree of everything reachable',
    insight:
      'Even with no strategy at all, every reachable node still gets marked exactly once. The bag only controls the order, and therefore the shape of the tree.',
  },
  {
    kind: 'minEdge',
    name: 'Min-PQ by edge weight',
    short: 'Prim',
    accent: '#f472b6',
    takeRule: 'remove the pair whose edge v→w is lightest.',
    builds: "Prim's algorithm: minimum spanning tree",
    insight:
      'Always growing the tree along the cheapest edge leaving it produces a spanning tree of minimum total weight (on undirected graphs).',
    priority: 'w(p,v)',
    needsWeights: true,
  },
  {
    kind: 'maxEdge',
    name: 'Max-PQ by edge weight',
    short: 'Max-Prim',
    accent: '#fb923c',
    takeRule: 'remove the pair whose edge v→w is heaviest.',
    builds: 'Maximum spanning tree',
    insight:
      "Flip Prim's preference and you get the heaviest possible spanning tree. Same algorithm, opposite bag.",
    priority: 'w(p,v)',
    needsWeights: true,
  },
  {
    kind: 'dist',
    name: 'Min-PQ by distance',
    short: 'Dijkstra',
    accent: '#38bdf8',
    takeRule: 'remove the pair with the smallest dist(p) + w(p,v).',
    builds: "Dijkstra's algorithm: shortest-path tree",
    insight:
      'Nodes are marked in order of their true distance from the start, so each tree path is a shortest path. With all weights equal to 1, this behaves exactly like BFS.',
    priority: 'dist(p)+w',
    needsWeights: true,
  },
];

export const bagInfo = (k: BagKind) => BAGS.find((b) => b.kind === k)!;

export interface Item {
  p: number | null;
  v: number;
  pr: number;
  seq: number;
  edge: number | null;
}

export type StepKind = 'init' | 'take' | 'skip' | 'mark' | 'put' | 'done';

export interface Step {
  kind: StepKind;
  lines: number[];
  bag: Item[];
  markOrder: number[]; // -1 when unmarked
  parentEdge: (number | null)[];
  parentNode: (number | null)[];
  dist: number[];
  depth: number[];
  item: Item | null;
  msg: string;
  marked: number;
}

export interface Trace {
  steps: Step[];
  kind: BagKind;
  start: number;
}

export const PSEUDOCODE = [
  'WhateverFirstSearch(s):',
  '  put (∅, s) in the bag',
  '  while the bag is not empty:',
  '    take (p, v) from the bag',
  '    if v is unmarked:',
  '      mark v',
  '      parent(v) ← p',
  '      for each edge v→w:',
  '        put (v, w) in the bag',
];

/** Index of the item that `take` removes. Ties are broken by insertion order. */
function chooseIndex(bag: Item[], kind: BagKind, rng: () => number): number {
  switch (kind) {
    case 'stack':
      return bag.length - 1;
    case 'queue':
      return 0;
    case 'random':
      return Math.floor(rng() * bag.length);
    case 'maxEdge': {
      let best = 0;
      for (let i = 1; i < bag.length; i++) if (bag[i].pr > bag[best].pr) best = i;
      return best;
    }
    default: {
      let best = 0;
      for (let i = 1; i < bag.length; i++) if (bag[i].pr < bag[best].pr) best = i;
      return best;
    }
  }
}

/** Bag contents ordered "next out first" (random bags keep insertion order). */
export function displayOrder(bag: Item[], kind: BagKind): Item[] {
  switch (kind) {
    case 'stack':
      return bag.slice().reverse();
    case 'minEdge':
    case 'dist':
      return bag.slice().sort((a, b) => a.pr - b.pr || a.seq - b.seq);
    case 'maxEdge':
      return bag.slice().sort((a, b) => b.pr - a.pr || a.seq - b.seq);
    default:
      return bag.slice();
  }
}

export function buildTrace(g: Graph, start: number, kind: BagKind, seed: number): Trace {
  const rng = mulberry32(seed);
  const adj = adjacency(g);
  const L = (v: number | null) => (v === null ? '∅' : g.labels[v]);
  const n = g.n;

  let bag: Item[] = [];
  let seq = 0;
  let marked = 0;
  const markOrder = new Array(n).fill(-1);
  const parentEdge: (number | null)[] = new Array(n).fill(null);
  const parentNode: (number | null)[] = new Array(n).fill(null);
  const dist = new Array(n).fill(Infinity);
  const depth = new Array(n).fill(Infinity);
  const steps: Step[] = [];

  const snap = (k: StepKind, lines: number[], item: Item | null, msg: string) =>
    steps.push({
      kind: k,
      lines,
      bag: bag.slice(),
      markOrder: markOrder.slice(),
      parentEdge: parentEdge.slice(),
      parentNode: parentNode.slice(),
      dist: dist.slice(),
      depth: depth.slice(),
      item,
      msg,
      marked,
    });

  snap('init', [0], null, `Ready to search from ${L(start)}. Press play or step forward.`);
  const first: Item = { p: null, v: start, pr: 0, seq: seq++, edge: null };
  bag.push(first);
  snap('put', [1], first, `Put (∅, ${L(start)}) in the bag to get things started.`);

  while (bag.length) {
    const idx = chooseIndex(bag, kind, rng);
    const it = bag.splice(idx, 1)[0];
    snap('take', [2, 3], it, `Take (${L(it.p)}, ${L(it.v)}) out of the bag.`);

    if (markOrder[it.v] >= 0) {
      snap('skip', [4], it, `${L(it.v)} is already marked, so this pair is thrown away.`);
      continue;
    }
    markOrder[it.v] = marked++;
    parentEdge[it.v] = it.edge;
    parentNode[it.v] = it.p;
    const w = it.edge === null ? 0 : g.edges[it.edge].w;
    dist[it.v] = it.p === null ? 0 : dist[it.p] + w;
    depth[it.v] = it.p === null ? 0 : depth[it.p] + 1;
    snap(
      'mark',
      [4, 5, 6],
      it,
      it.p === null
        ? `Mark ${L(it.v)}. It is the root of the search tree.`
        : `Mark ${L(it.v)} (#${marked}) and record parent(${L(it.v)}) = ${L(it.p)}.`,
    );

    const nbrs = adj[it.v];
    if (!nbrs.length) snap('put', [7], null, `${L(it.v)} has no outgoing edges, so nothing new goes in the bag.`);
    for (const a of nbrs) {
      const pr = kind === 'dist' ? dist[it.v] + a.w : a.w;
      const ni: Item = { p: it.v, v: a.to, pr, seq: seq++, edge: a.edge };
      bag.push(ni);
      const note = markOrder[a.to] >= 0 ? ` (${L(a.to)} is already marked, but it goes in anyway)` : '';
      snap('put', [7, 8], ni, `Put (${L(it.v)}, ${L(a.to)}) in the bag${note}.`);
    }
  }
  snap('done', [2], null, `The bag is empty, so the search is done. ${marked} of ${n} nodes were reached.`);
  return { steps, kind, start };
}

export interface Stats {
  marked: number;
  treeWeight: number;
  maxDepth: number;
  maxDist: number;
}

export function stepStats(g: Graph, s: Step): Stats {
  let treeWeight = 0;
  let maxDepth = 0;
  let maxDist = 0;
  for (let v = 0; v < g.n; v++) {
    if (s.markOrder[v] < 0) continue;
    const e = s.parentEdge[v];
    if (e !== null) treeWeight += g.edges[e].w;
    maxDepth = Math.max(maxDepth, s.depth[v]);
    maxDist = Math.max(maxDist, s.dist[v]);
  }
  return { marked: s.marked, treeWeight, maxDepth, maxDist };
}
