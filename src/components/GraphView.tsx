import { useId, useMemo, useRef } from 'react';
import { Graph, Point, VIEW_H, VIEW_W } from '../lib/graph';
import { Step } from '../lib/wfs';

export interface Feedback {
  guess: number;
  actual: number;
}

interface Props {
  graph: Graph;
  pos: Point[];
  step: Step;
  accent: string;
  start: number;
  showDist?: boolean;
  feedback?: Feedback | null;
  clickable?: boolean;
  onNodeClick?: (v: number) => void;
  onNodeMove?: (v: number, p: Point) => void;
}

const R = 17;

export default function GraphView({ graph, pos, step, accent, start, showDist, feedback, clickable, onNodeClick, onNodeMove }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ v: number; sx: number; sy: number; moved: boolean } | null>(null);
  const uid = useId().replace(/:/g, '');

  const toSvg = (e: React.PointerEvent): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.max(R, Math.min(VIEW_W - R, p.x)), y: Math.max(R, Math.min(VIEW_H - R, p.y)) };
  };

  const onDown = (v: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const p = toSvg(e);
    drag.current = { v, sx: p.x, sy: p.y, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toSvg(e);
    if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) < 5) return;
    d.moved = true;
    onNodeMove?.(d.v, p);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onNodeClick?.(d.v);
  };

  const tree = useMemo(() => new Set(step.parentEdge.filter((e): e is number => e !== null)), [step]);
  const inBag = useMemo(() => {
    const s = new Set<number>();
    for (const it of step.bag) if (step.markOrder[it.v] < 0) s.add(it.v);
    return s;
  }, [step]);
  const bagEdges = useMemo(() => new Set(step.bag.map((it) => it.edge).filter((e): e is number => e !== null)), [step]);

  const item = step.item;
  const focusEdge = item?.edge ?? null;
  const focusNode = item && (step.kind === 'take' || step.kind === 'mark' || step.kind === 'skip') ? item.v : null;
  const putTarget = item && step.kind === 'put' ? item.v : null;

  return (
    <svg
      ref={svgRef}
      className={`graph ${clickable ? 'clickable' : ''}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      style={{ ['--accent' as string]: accent }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <defs>
        <marker id={`a-${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--edge)" />
        </marker>
        <marker id={`aa-${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={accent} />
        </marker>
        <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* edges */}
      {graph.edges.map((e) => {
        const a = pos[e.u];
        const b = pos[e.v];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const trim = graph.directed ? R + 3 : 0;
        const x1 = a.x;
        const y1 = a.y;
        const x2 = b.x - ux * trim;
        const y2 = b.y - uy * trim;
        const isTree = tree.has(e.id);
        const isFocus = focusEdge === e.id;
        let cls = 'edge';
        if (isTree) cls += ' tree';
        else if (bagEdges.has(e.id)) cls += ' pending';
        if (isFocus && step.kind === 'put') cls += ' putting';
        if (isFocus && step.kind === 'skip') cls += ' skipping';
        if (isFocus && (step.kind === 'take' || step.kind === 'mark')) cls += ' taking';
        const marker = graph.directed ? `url(#${isTree ? 'aa' : 'a'}-${uid})` : undefined;
        return (
          <g key={e.id}>
            <line className={cls} x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={marker} />
            {graph.weighted && (
              <g className={`weight ${isTree ? 'tree' : ''}`} transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`}>
                <rect x={-10} y={-10} width={20} height={20} rx={6} />
                <text dy="0.35em">{e.w}</text>
              </g>
            )}
          </g>
        );
      })}

      {/* nodes */}
      {pos.map((p, v) => {
        const order = step.markOrder[v];
        const marked = order >= 0;
        let cls = 'node';
        if (marked) cls += ' marked';
        else if (inBag.has(v)) cls += ' inbag';
        if (focusNode === v) cls += ` focus ${step.kind}`;
        if (putTarget === v) cls += ' put-target';
        const fb = feedback && (feedback.guess === v || feedback.actual === v);
        return (
          <g key={v} className={cls} transform={`translate(${p.x} ${p.y})`} onPointerDown={onDown(v)}>
            {focusNode === v && <circle className="halo" r={R + 10} filter={`url(#glow-${uid})`} />}
            {v === start && <circle className="start-ring" r={R + 6} />}
            {fb && (
              <circle
                className={`fb ${feedback!.actual === v ? 'right' : 'wrong'}`}
                r={R + 9}
              />
            )}
            <circle className="body" r={R} />
            <text className="label" dy="0.35em">
              {graph.labels[v]}
            </text>
            {marked && (
              <g className="badge" transform={`translate(${R - 2} ${-R + 2})`}>
                <circle r={9} />
                <text dy="0.35em">{order + 1}</text>
              </g>
            )}
            {showDist && marked && (
              <text className="dist" y={R + 15}>
                d={step.dist[v]}
              </text>
            )}
            {v === start && !showDist && (
              <text className="start-label" y={-R - 12}>
                start
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
