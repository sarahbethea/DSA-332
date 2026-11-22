import { useCallback, useEffect, useMemo, useState } from 'react';
import GraphView, { Feedback } from './components/GraphView';
import { BagPanel, Pseudocode } from './components/Panels';
import { generate, Generated, GenOptions, gridSize, maxRandomEdges, Point, Preset } from './lib/graph';
import { BagKind, BAGS, bagInfo, buildTrace, Step, stepStats, Trace } from './lib/wfs';

const SPEEDS = [1500, 1050, 760, 560, 410, 290, 200, 130, 80, 40];
const PRESETS: { id: Preset; name: string }[] = [
  { id: 'random', name: 'Random' },
  { id: 'grid', name: 'Grid' },
  { id: 'maze', name: 'Maze' },
  { id: 'tree', name: 'Tree' },
];
const KIND_LABEL: Record<Step['kind'], string> = {
  init: 'ready',
  put: 'put',
  take: 'take',
  skip: 'discard',
  mark: 'mark',
  done: 'done',
};

type Mode = 'explore' | 'compare';

const clampEdges = (n: number, m: number) => Math.max(n - 1, Math.min(maxRandomEdges(n), m));

export default function App() {
  const [opts, setOpts] = useState<GenOptions>({ preset: 'random', nodes: 12, edges: 17, directed: false, weighted: true, seed: 20261123 });
  const [gen, setGen] = useState<Generated>(() => generate(opts));
  const [start, setStart] = useState(0);
  const [mode, setMode] = useState<Mode>('explore');
  const [bagA, setBagA] = useState<BagKind>('stack');
  const [bagB, setBagB] = useState<BagKind>('queue');
  const [bagSeed, setBagSeed] = useState(1);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [runTo, setRunTo] = useState<number | null>(null);

  const [predict, setPredict] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0, streak: 0 });

  const graph = gen.graph;
  const pos = gen.pos;

  const updateOpts = (patch: Partial<GenOptions>) => {
    const next = { ...opts, ...patch };
    next.edges = clampEdges(next.nodes, next.edges);
    setOpts(next);
    const g = generate(next);
    setGen(g);
    setStart((s) => (s < g.graph.n ? s : 0));
  };

  const traceA: Trace = useMemo(() => buildTrace(graph, start, bagA, bagSeed), [graph, start, bagA, bagSeed]);
  const traceB: Trace = useMemo(() => buildTrace(graph, start, bagB, bagSeed + 999), [graph, start, bagB, bagSeed]);
  const compare = mode === 'compare';
  const maxStep = compare ? Math.max(traceA.steps.length, traceB.steps.length) - 1 : traceA.steps.length - 1;

  // Any change to the run (graph, start, bag) rewinds to the beginning.
  useEffect(() => {
    setStep(0);
    setPlaying(false);
    setRunTo(null);
    setFeedback(null);
  }, [traceA, traceB, mode]);

  useEffect(() => {
    setScore({ right: 0, total: 0, streak: 0 });
    setFeedback(null);
  }, [predict, traceA]);

  // Playback clock.
  useEffect(() => {
    if (!playing && runTo === null) return;
    if (runTo !== null && step >= runTo) {
      setRunTo(null);
      return;
    }
    if (step >= maxStep) {
      setPlaying(false);
      setRunTo(null);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, maxStep)), runTo !== null ? 75 : SPEEDS[speed - 1]);
    return () => clearTimeout(t);
  }, [playing, runTo, step, maxStep, speed]);

  const stepOf = (t: Trace) => t.steps[Math.min(step, t.steps.length - 1)];
  const sA = stepOf(traceA);
  const sB = stepOf(traceB);
  const infoA = bagInfo(bagA);
  const infoB = bagInfo(bagB);

  const nextMarkIndex = useCallback(
    (from: number) => {
      for (let i = from + 1; i < traceA.steps.length; i++) if (traceA.steps[i].kind === 'mark') return i;
      return -1;
    },
    [traceA],
  );

  const jumpToNextMark = () => {
    setPlaying(false);
    const i = nextMarkIndex(step);
    setStep(i === -1 ? maxStep : i);
  };

  const onNodeClick = (v: number) => {
    if (runTo !== null) return;
    if (predict && !compare) {
      if (sA.markOrder[v] >= 0) {
        setFeedback(null);
        return;
      }
      const i = nextMarkIndex(step);
      if (i === -1) return;
      const actual = traceA.steps[i].item!.v;
      const right = actual === v;
      setFeedback({ guess: v, actual });
      setScore((s) => ({ right: s.right + (right ? 1 : 0), total: s.total + 1, streak: right ? s.streak + 1 : 0 }));
      setPlaying(false);
      setRunTo(i);
      return;
    }
    setStart(v);
  };

  const onNodeMove = (v: number, p: Point) => setGen((g) => ({ ...g, pos: g.pos.map((q, i) => (i === v ? p : q)) }));

  // Keyboard: space = play/pause, arrows = step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!(predict && !compare)) setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') {
        setPlaying(false);
        setStep((s) => Math.min(s + 1, maxStep));
      } else if (e.key === 'ArrowLeft') {
        setPlaying(false);
        setStep((s) => Math.max(s - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maxStep, predict, compare]);

  const predicting = predict && !compare;
  const finished = step >= maxStep;
  const lastPredictionResolved = feedback && runTo === null;
  const anyNeedsWeights = (compare ? [infoA, infoB] : [infoA]).some((b) => b.needsWeights);

  let narration = sA.msg;
  if (predicting && runTo === null && !finished) {
    narration = lastPredictionResolved
      ? feedback!.guess === feedback!.actual
        ? `Correct! ${graph.labels[feedback!.actual]} was marked next. Which node comes after it?`
        : `Not quite. ${graph.labels[feedback!.actual]} was marked, not ${graph.labels[feedback!.guess]}. Look at the bag: what comes out next?`
      : 'Which node will be marked next? Click it on the graph.';
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="kicker">CSCI 332 · Final Project</div>
          <h1>Whatever-First Search</h1>
          <p className="tagline">
            One algorithm, six bags. The search never changes, only <em>which pair comes out of the bag next</em>, and that one choice
            decides where the search goes.
          </p>
        </div>
        <div className="mode-tabs" role="tablist">
          <button className={mode === 'explore' ? 'on' : ''} onClick={() => setMode('explore')}>
            Explore
          </button>
          <button className={mode === 'compare' ? 'on' : ''} onClick={() => setMode('compare')}>
            Compare two bags
          </button>
        </div>
      </header>

      <main className={`layout ${compare ? 'is-compare' : ''}`}>
        {/* ───────────── left: controls ───────────── */}
        <aside className="panel side">
          <section>
            <h3>Graph</h3>
            <div className="seg">
              {PRESETS.map((p) => (
                <button key={p.id} className={opts.preset === p.id ? 'on' : ''} onClick={() => updateOpts({ preset: p.id })}>
                  {p.name}
                </button>
              ))}
            </div>

            <label className="slider">
              <span>
                Nodes{' '}
                <b>
                  {opts.preset === 'grid' || opts.preset === 'maze'
                    ? `${gridSize(opts.nodes).rows}×${gridSize(opts.nodes).cols} = ${graph.n}`
                    : graph.n}
                </b>
              </span>
              <input
                type="range"
                min={4}
                max={opts.preset === 'grid' || opts.preset === 'maze' ? 70 : 40}
                value={opts.nodes}
                onChange={(e) => updateOpts({ nodes: +e.target.value })}
              />
            </label>

            {opts.preset === 'random' ? (
              <label className="slider">
                <span>
                  Edges <b>{graph.edges.length}</b>
                </span>
                <input
                  type="range"
                  min={opts.nodes - 1}
                  max={maxRandomEdges(opts.nodes)}
                  value={opts.edges}
                  onChange={(e) => updateOpts({ edges: +e.target.value })}
                />
              </label>
            ) : (
              <div className="slider static">
                <span>
                  Edges <b>{graph.edges.length}</b>
                </span>
                <small className="muted">set by the {opts.preset} shape</small>
              </div>
            )}

            <div className="toggles">
              <label className="toggle">
                <input type="checkbox" checked={opts.directed} onChange={(e) => updateOpts({ directed: e.target.checked })} />
                <span className="track" />
                Directed
              </label>
              <label className="toggle">
                <input type="checkbox" checked={opts.weighted} onChange={(e) => updateOpts({ weighted: e.target.checked })} />
                <span className="track" />
                Weighted
              </label>
            </div>

            <button className="btn wide" onClick={() => updateOpts({ seed: (opts.seed * 7919 + 13) % 2147483647 })}>
              ⟳ New random graph
            </button>
            <p className="hint">
              <b>Click</b> a node to start the search there. <b>Drag</b> nodes to rearrange.
            </p>
          </section>

          <section>
            <h3>{compare ? 'Bags to compare' : 'Choose a bag'}</h3>
            {compare ? (
              <div className="compare-picks">
                {[
                  { label: 'Left', val: bagA, set: setBagA },
                  { label: 'Right', val: bagB, set: setBagB },
                ].map((s) => (
                  <label key={s.label} className="select">
                    <span>{s.label}</span>
                    <select value={s.val} onChange={(e) => s.set(e.target.value as BagKind)} style={{ borderColor: bagInfo(s.val).accent }}>
                      {BAGS.map((b) => (
                        <option key={b.kind} value={b.kind}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : (
              <div className="bag-list">
                {BAGS.map((b) => (
                  <button
                    key={b.kind}
                    className={`bag-card ${bagA === b.kind ? 'on' : ''}`}
                    style={{ ['--accent' as string]: b.accent }}
                    onClick={() => setBagA(b.kind)}
                  >
                    <i className="dot" />
                    <span className="bag-name">{b.name}</span>
                    <span className="tag">{b.short}</span>
                  </button>
                ))}
              </div>
            )}
            {(bagA === 'random' || (compare && bagB === 'random')) && (
              <button className="btn wide ghost" onClick={() => setBagSeed((s) => s + 1)}>
                🎲 Reshuffle the random bag
              </button>
            )}
            {anyNeedsWeights && !opts.weighted && (
              <div className="warn">
                Every edge weighs 1 right now, so the priority bags have nothing to prefer.{' '}
                <button className="link" onClick={() => updateOpts({ weighted: true })}>
                  Turn on weights
                </button>
              </div>
            )}
          </section>

          {!compare && (
            <section className="insight" style={{ ['--accent' as string]: infoA.accent }}>
              <h3>What this bag builds</h3>
              <div className="builds">{infoA.builds}</div>
              <p>{infoA.insight}</p>
            </section>
          )}
        </aside>

        {/* ───────────── center: stage ───────────── */}
        <section className="stage">
          <div className={`narration k-${sA.kind} ${predicting ? 'predicting' : ''}`}>
            <span className="kind">{predicting && runTo === null && !finished ? 'predict' : KIND_LABEL[sA.kind]}</span>
            <span className="msg">{compare ? compareNarration(sA, sB, infoA.short, infoB.short) : narration}</span>
            {!compare && (
              <label className="toggle predict-toggle" title="Guess which node gets marked next, then watch whether you were right">
                <input type="checkbox" checked={predict} onChange={(e) => { setPredict(e.target.checked); setPlaying(false); }} />
                <span className="track" />
                Predict mode
              </label>
            )}
          </div>

          {compare ? (
            <div className="duo">
              {[
                { t: traceA, s: sA, info: infoA },
                { t: traceB, s: sB, info: infoB },
              ].map(({ s, info }, i) => {
                const st = stepStats(graph, s);
                return (
                  <div key={i} className="panel duo-col" style={{ ['--accent' as string]: info.accent }}>
                    <div className="duo-head">
                      <i className="dot" />
                      <b>{info.name}</b>
                      <span className="tag">{info.short}</span>
                    </div>
                    <div className="graph-wrap">
                      <GraphView
                        graph={graph}
                        pos={pos}
                        step={s}
                        accent={info.accent}
                        start={start}
                        showDist={info.kind === 'dist'}
                        clickable
                        onNodeClick={onNodeClick}
                        onNodeMove={onNodeMove}
                      />
                    </div>
                    <StatsRow st={st} n={graph.n} weighted={opts.weighted} />
                    <BagPanel graph={graph} step={s} bag={info} compact />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel graph-wrap main-graph">
              <GraphView
                graph={graph}
                pos={pos}
                step={sA}
                accent={infoA.accent}
                start={start}
                showDist={bagA === 'dist'}
                feedback={runTo === null ? feedback : null}
                clickable
                onNodeClick={onNodeClick}
                onNodeMove={onNodeMove}
              />
            </div>
          )}

          <div className="panel playback">
            <div className="pb-buttons">
              <button className="icon" title="Restart" onClick={() => { setPlaying(false); setStep(0); }}>
                ⏮
              </button>
              <button className="icon" title="Step back (←)" onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }}>
                ◀
              </button>
              <button
                className="icon play"
                title={predicting ? 'Turn off predict mode to autoplay' : 'Play / pause (space)'}
                disabled={predicting}
                onClick={() => {
                  if (finished) setStep(0);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <button className="icon" title="Step forward (→)" onClick={() => { setPlaying(false); setStep((s) => Math.min(maxStep, s + 1)); }}>
                ▶︎|
              </button>
              {!compare && (
                <button className="btn small" title="Skip ahead to the next time a node gets marked" onClick={jumpToNextMark} disabled={predicting}>
                  Next mark ⇥
                </button>
              )}
            </div>
            <input
              className="scrub"
              type="range"
              min={0}
              max={maxStep}
              value={Math.min(step, maxStep)}
              onChange={(e) => {
                setPlaying(false);
                setStep(+e.target.value);
              }}
            />
            <span className="counter">
              {Math.min(step, maxStep)} / {maxStep}
            </span>
            <label className="speed">
              <span>Speed</span>
              <input type="range" min={1} max={10} value={speed} onChange={(e) => setSpeed(+e.target.value)} />
            </label>
          </div>
        </section>

        {/* ───────────── right: bag + code ───────────── */}
        {!compare && (
          <aside className="side right">
            {predicting && (
              <div className="panel score">
                <div>
                  <div className="score-big">
                    {score.right}
                    <span>/{score.total}</span>
                  </div>
                  <div className="muted">predictions correct</div>
                </div>
                <div className="streak">{score.streak >= 2 ? `🔥 ${score.streak} in a row` : 'Tip: read the bag, not the picture'}</div>
              </div>
            )}
            <div className="panel">
              <BagPanel graph={graph} step={sA} bag={infoA} />
            </div>
            <div className="panel">
              <Pseudocode step={sA} bag={infoA} />
            </div>
            <div className="panel">
              <StatsRow st={stepStats(graph, sA)} n={graph.n} weighted={opts.weighted} />
            </div>
          </aside>
        )}
      </main>

      <footer className="foot">
        Every bag marks exactly the nodes reachable from the start, each exactly once. The bag only changes the <b>order</b>, and the
        order decides the <b>tree</b>.
      </footer>
    </div>
  );
}

function compareNarration(a: Step, b: Step, na: string, nb: string) {
  if (a.kind === 'init') return 'Same graph, same start, same algorithm. Only the bag differs. Press play.';
  if (a.kind === 'done' && b.kind === 'done') return 'Both searches reached the same nodes, but look how different the two trees are.';
  return `${na}: ${a.msg}   ·   ${nb}: ${b.msg}`;
}

function StatsRow({ st, n, weighted }: { st: ReturnType<typeof stepStats>; n: number; weighted: boolean }) {
  return (
    <div className="stats">
      <div>
        <b>
          {st.marked}
          <span>/{n}</span>
        </b>
        <small>marked</small>
      </div>
      <div title="Number of edges on the longest root-to-node path in the search tree">
        <b>{st.maxDepth}</b>
        <small>deepest (edges)</small>
      </div>
      {weighted && (
        <>
          <div title="Sum of weights of all tree edges. Prim makes this as small as possible.">
            <b>{st.treeWeight}</b>
            <small>tree weight</small>
          </div>
          <div title="Largest tree-path distance from the start. Dijkstra makes every tree path as short as possible.">
            <b>{st.maxDist}</b>
            <small>farthest (dist)</small>
          </div>
        </>
      )}
    </div>
  );
}
