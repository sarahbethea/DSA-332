import { Graph } from '../lib/graph';
import { BagInfo, displayOrder, PSEUDOCODE, Step } from '../lib/wfs';

export function BagPanel({ graph, step, bag, compact }: { graph: Graph; step: Step; bag: BagInfo; compact?: boolean }) {
  const items = displayOrder(step.bag, bag.kind);
  const L = (v: number | null) => (v === null ? '∅' : graph.labels[v]);
  const limit = compact ? 18 : 48;
  const shown = items.slice(0, limit);
  const justPut = step.kind === 'put' ? step.item?.seq : undefined;
  const ordered = bag.kind !== 'random';

  return (
    <div className={`bag ${compact ? 'compact' : ''}`} style={{ ['--accent' as string]: bag.accent }}>
      <div className="bag-head">
        <span className="bag-title">
          The bag <span className="muted">({bag.name.toLowerCase()})</span>
        </span>
        <span className="pill">{items.length} pairs</span>
      </div>
      {!compact && (
        <div className="bag-sub">
          {ordered ? (
            <>
              Ordered <b>next out → last out</b>
              {bag.priority && (
                <>
                  , with priority <code>{bag.priority}</code>
                </>
              )}
            </>
          ) : (
            <>Any pair could come out next. That's the point!</>
          )}
        </div>
      )}
      <div className="bag-items">
        {items.length === 0 && <span className="muted empty">empty</span>}
        {shown.map((it, i) => {
          const stale = step.markOrder[it.v] >= 0;
          const next = ordered && i === 0;
          return (
            <span
              key={it.seq}
              className={`chip ${stale ? 'stale' : ''} ${next ? 'next' : ''} ${it.seq === justPut ? 'fresh' : ''}`}
              title={stale ? `${L(it.v)} is already marked; this pair will be discarded when taken` : undefined}
            >
              ({L(it.p)}, {L(it.v)})
              {bag.priority && <span className="prio">{it.pr}</span>}
            </span>
          );
        })}
        {items.length > limit && <span className="muted more">+{items.length - limit} more</span>}
      </div>
      {!compact && (
        <div className="legend">
          <span>
            <i className="chip-dot next" /> next out
          </span>
          <span>
            <i className="chip-dot stale" /> already marked (will be discarded)
          </span>
        </div>
      )}
    </div>
  );
}

export function Pseudocode({ step, bag }: { step: Step; bag: BagInfo }) {
  return (
    <div className="code" style={{ ['--accent' as string]: bag.accent }}>
      {PSEUDOCODE.map((line, i) => (
        <div key={i} className={`code-line ${step.lines.includes(i) ? 'hot' : ''}`}>
          <span className="ln">{i + 1}</span>
          <span>{line}</span>
        </div>
      ))}
      <div className="take-rule">
        <b>{bag.name}:</b> <i>take</i> means {bag.takeRule}
      </div>
    </div>
  );
}
