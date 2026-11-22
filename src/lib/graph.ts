// Graph types + generators. Positions live separately from topology so that
// dragging a node never forces the search trace to be recomputed.

export interface Edge {
  id: number;
  u: number;
  v: number;
  w: number;
}

export interface Graph {
  n: number;
  labels: string[];
  edges: Edge[];
  directed: boolean;
  weighted: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export type Preset = 'random' | 'grid' | 'maze' | 'tree';

export interface GenOptions {
  preset: Preset;
  nodes: number;
  edges: number;
  directed: boolean;
  weighted: boolean;
  seed: number;
}

export interface Generated {
  graph: Graph;
  pos: Point[];
}

export const VIEW_W = 1000;
export const VIEW_H = 640;
const MARGIN = 56;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLabels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (n <= 26 ? String.fromCharCode(65 + i) : String(i)));
}

const randInt = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class DSU {
  p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.p[ra] = rb;
    return true;
  }
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function pointSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Max edges the random (non-crossing) generator can comfortably place. */
export function maxRandomEdges(n: number): number {
  if (n < 3) return n - 1;
  return Math.floor(2.4 * n - 4);
}

function randomPoints(n: number, rng: () => number): Point[] {
  const pts: Point[] = [];
  let minD = Math.sqrt(((VIEW_W - 2 * MARGIN) * (VIEW_H - 2 * MARGIN)) / n) * 0.75;
  let attempts = 0;
  while (pts.length < n) {
    const p = { x: MARGIN + rng() * (VIEW_W - 2 * MARGIN), y: MARGIN + rng() * (VIEW_H - 2 * MARGIN) };
    if (pts.every((q) => dist(p, q) >= minD)) pts.push(p);
    if (++attempts > 400) {
      minD *= 0.92;
      attempts = 0;
    }
  }
  // Sort roughly left-to-right / top-to-bottom so labels A, B, C... read naturally.
  pts.sort((a, b) => a.x + a.y * 0.35 - (b.x + b.y * 0.35));
  return pts;
}

function genRandom(o: GenOptions, rng: () => number): Generated {
  const n = o.nodes;
  const pos = randomPoints(n, rng);
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j, dist(pos[i], pos[j])]);
  pairs.sort((a, b) => a[2] - b[2]);

  const chosen: [number, number][] = [];
  const used = new Set<string>();
  const ok = (i: number, j: number) => {
    for (const [a, b] of chosen) {
      if (a === i || a === j || b === i || b === j) continue;
      if (segmentsCross(pos[i], pos[j], pos[a], pos[b])) return false;
    }
    for (let k = 0; k < n; k++) {
      if (k === i || k === j) continue;
      if (pointSegDist(pos[k], pos[i], pos[j]) < 30) return false;
    }
    return true;
  };

  // 1) Euclidean spanning tree (Kruskal) keeps the graph connected and tidy.
  const dsu = new DSU(n);
  for (const [i, j] of pairs) {
    if (dsu.find(i) !== dsu.find(j) && ok(i, j)) {
      dsu.union(i, j);
      chosen.push([i, j]);
      used.add(`${i},${j}`);
    }
  }
  // Fallback (rare): connect anything still disconnected, ignoring crossings.
  for (const [i, j] of pairs) if (dsu.union(i, j)) { chosen.push([i, j]); used.add(`${i},${j}`); }

  // 2) Extra edges, preferring short ones but with some randomness.
  const target = Math.max(n - 1, Math.min(o.edges, maxRandomEdges(n)));
  const rest = pairs.filter(([i, j]) => !used.has(`${i},${j}`));
  let guard = 0;
  while (chosen.length < target && rest.length && guard++ < 5000) {
    const window = Math.min(rest.length, 6 + (target - chosen.length) * 3);
    const idx = Math.floor(rng() * rng() * window);
    const [i, j] = rest.splice(idx, 1)[0];
    if (ok(i, j)) chosen.push([i, j]);
  }

  // Weights loosely follow on-screen length so "far" looks "expensive".
  const lens = chosen.map(([i, j]) => dist(pos[i], pos[j]));
  const avg = lens.reduce((s, x) => s + x, 0) / Math.max(1, lens.length);
  const edges: Edge[] = chosen.map(([i, j], id) => {
    const raw = (lens[id] / avg) * 4.5 + (rng() - 0.5) * 3;
    return { id, u: i, v: j, w: o.weighted ? Math.max(1, Math.min(9, Math.round(raw))) : 1 };
  });

  if (o.directed) orientFromRoot(n, edges, 0, rng);
  return { graph: { n, labels: makeLabels(n), edges, directed: o.directed, weighted: o.weighted }, pos };
}

/** Orient a spanning structure away from `root` (so everything is reachable), extras randomly. */
function orientFromRoot(n: number, edges: Edge[], root: number, rng: () => number) {
  const adj: { to: number; e: Edge }[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    adj[e.u].push({ to: e.v, e });
    adj[e.v].push({ to: e.u, e });
  }
  const seen = new Array(n).fill(false);
  const treeEdge = new Set<number>();
  const q = [root];
  seen[root] = true;
  while (q.length) {
    const x = q.shift()!;
    for (const { to, e } of shuffle(adj[x].slice(), rng)) {
      if (seen[to]) continue;
      seen[to] = true;
      treeEdge.add(e.id);
      if (e.u !== x) [e.u, e.v] = [e.v, e.u];
      q.push(to);
    }
  }
  for (const e of edges) if (!treeEdge.has(e.id) && rng() < 0.5) [e.u, e.v] = [e.v, e.u];
}

function gridDims(n: number): [number, number] {
  const rows = Math.max(2, Math.round(Math.sqrt((n * (VIEW_H - 2 * MARGIN)) / (VIEW_W - 2 * MARGIN))));
  const cols = Math.max(2, Math.round(n / rows));
  return [rows, cols];
}

export function gridSize(n: number): { rows: number; cols: number; total: number } {
  const [rows, cols] = gridDims(n);
  return { rows, cols, total: rows * cols };
}

function genGrid(o: GenOptions, rng: () => number, maze: boolean): Generated {
  const [rows, cols] = gridDims(o.nodes);
  const n = rows * cols;
  const pos: Point[] = [];
  const sx = cols > 1 ? (VIEW_W - 2 * MARGIN) / (cols - 1) : 0;
  const sy = rows > 1 ? (VIEW_H - 2 * MARGIN) / (rows - 1) : 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pos.push({ x: MARGIN + c * sx, y: MARGIN + r * sy });

  let pairs: [number, number][] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c + 1 < cols) pairs.push([i, i + 1]);
      if (r + 1 < rows) pairs.push([i, i + cols]);
    }

  if (maze) {
    const dsu = new DSU(n);
    const tree: [number, number][] = [];
    const extras: [number, number][] = [];
    for (const p of shuffle(pairs.slice(), rng)) (dsu.union(p[0], p[1]) ? tree : extras).push(p);
    const loops = Math.round(n * 0.08);
    pairs = tree.concat(extras.slice(0, loops)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  const edges: Edge[] = pairs.map(([u, v], id) => ({ id, u, v, w: o.weighted ? randInt(rng, 1, 9) : 1 }));
  return { graph: { n, labels: makeLabels(n), edges, directed: o.directed, weighted: o.weighted }, pos };
}

function genTree(o: GenOptions, rng: () => number): Generated {
  const n = o.nodes;
  const children: number[][] = Array.from({ length: n }, () => []);
  const depth = new Array(n).fill(0);
  // Grow breadth-first; each node gets 1–3 children.
  const frontier = [0];
  let next = 1;
  while (next < n && frontier.length) {
    const p = frontier.shift()!;
    const k = depth[p] === 0 ? 3 : randInt(rng, 1, 3);
    for (let c = 0; c < k && next < n; c++) {
      children[p].push(next);
      depth[next] = depth[p] + 1;
      frontier.push(next);
      next++;
    }
  }
  const maxDepth = Math.max(...depth);
  // Tidy layout: each leaf gets its own column.
  const x = new Array(n).fill(0);
  let leaf = 0;
  const place = (v: number) => {
    if (!children[v].length) x[v] = leaf++;
    else {
      children[v].forEach(place);
      x[v] = (x[children[v][0]] + x[children[v][children[v].length - 1]]) / 2;
    }
  };
  place(0);
  const sx = leaf > 1 ? (VIEW_W - 2 * MARGIN) / (leaf - 1) : 0;
  const sy = maxDepth > 0 ? (VIEW_H - 2 * MARGIN) / maxDepth : 0;
  const pos = x.map((xi, i) => ({ x: leaf > 1 ? MARGIN + xi * sx : VIEW_W / 2, y: MARGIN + depth[i] * sy }));

  const edges: Edge[] = [];
  children.forEach((cs, p) => cs.forEach((c) => edges.push({ id: edges.length, u: p, v: c, w: o.weighted ? randInt(rng, 1, 9) : 1 })));
  return { graph: { n, labels: makeLabels(n), edges, directed: o.directed, weighted: o.weighted }, pos };
}

export function generate(o: GenOptions): Generated {
  const rng = mulberry32(o.seed);
  switch (o.preset) {
    case 'grid':
      return genGrid(o, rng, false);
    case 'maze':
      return genGrid(o, rng, true);
    case 'tree':
      return genTree(o, rng);
    default:
      return genRandom(o, rng);
  }
}

export interface Adj {
  to: number;
  edge: number;
  w: number;
}

/** Adjacency lists, neighbors sorted by node index so runs are deterministic. */
export function adjacency(g: Graph): Adj[][] {
  const adj: Adj[][] = Array.from({ length: g.n }, () => []);
  for (const e of g.edges) {
    adj[e.u].push({ to: e.v, edge: e.id, w: e.w });
    if (!g.directed) adj[e.v].push({ to: e.u, edge: e.id, w: e.w });
  }
  adj.forEach((l) => l.sort((a, b) => a.to - b.to));
  return adj;
}
