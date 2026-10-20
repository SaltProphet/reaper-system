import { useEffect, useRef, useState } from "react";
import type { Graph, NodeDef } from "@/lib/engine";

const NODE_W = 188;
const NODE_H = 88;

type View = { x: number; y: number; k: number };

export function NodeCanvas({
  graph,
  selectedId,
  hotId,
  onSelect,
  onOpen,
  onMove,
  onConnect,
}: {
  graph: Graph;
  selectedId: string | null;
  hotId: string | null;
  onSelect: (id: string) => void;
  onOpen: (node: NodeDef) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (fromId: string, toId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ x: 40, y: 48, k: 1 });
  const drag = useRef<{ id: string; ox: number; oy: number; px: number; py: number } | null>(null);
  const pan = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [view, setView] = useState<View>(viewRef.current);
  const [draft, setDraft] = useState<{ fromId: string; x: number; y: number } | null>(null);

  function setViewBoth(next: View) {
    viewRef.current = next;
    setView(next);
  }

  function localPoint(event: { clientX: number; clientY: number }) {
    const box = scroller.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    const current = viewRef.current;
    return {
      x: (event.clientX - box.left - current.x) / current.k,
      y: (event.clientY - box.top - current.y) / current.k,
    };
  }

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = viewRef.current;
      const box = node.getBoundingClientRect();
      const nextK = Math.min(1.6, Math.max(0.55, current.k * (event.deltaY > 0 ? 0.92 : 1.08)));
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;
      const gx = (px - current.x) / current.k;
      const gy = (py - current.y) / current.k;
      setViewBoth({ k: nextK, x: px - gx * nextK, y: py - gy * nextK });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const width = Math.max(1100, ...graph.nodes.map((node) => (node.x ?? 0) + NODE_W + 120));
  const height = Math.max(640, ...graph.nodes.map((node) => (node.y ?? 0) + NODE_H + 120));

  return (
    <div
      ref={scroller}
      className="canvas-grid relative mt-3 h-[calc(100dvh-13rem)] min-h-96 overflow-hidden border border-line"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("article")) return;
        pan.current = { px: event.clientX, py: event.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (pan.current) {
          setViewBoth({
            ...viewRef.current,
            x: pan.current.ox + event.clientX - pan.current.px,
            y: pan.current.oy + event.clientY - pan.current.py,
          });
        }
        if (draft) setDraft({ ...draft, ...localPoint(event) });
      }}
      onPointerUp={(event) => {
        pan.current = null;
        if ((event.target as HTMLElement).dataset.port === "in") return;
        setDraft(null);
      }}
    >
      <div
        className="absolute top-0 left-0"
        style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}
      >
        <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
          {(graph.edges ?? []).map((edge) => {
            const from = graph.nodes.find((node) => node.id === edge.from);
            const to = graph.nodes.find((node) => node.id === edge.to);
            if (!from || !to) return null;
            const x1 = (from.x ?? 0) + NODE_W;
            const y1 = (from.y ?? 0) + NODE_H / 2;
            const x2 = to.x ?? 0;
            const y2 = (to.y ?? 0) + NODE_H / 2;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            return (
              <g key={edge.id}>
                <path
                  d={`M ${x1} ${y1} C ${x1 + 64} ${y1}, ${x2 - 64} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--color-ember)"
                  strokeWidth="1.6"
                />
                <text x={midX} y={midY - 6} fill="var(--color-mute)" fontSize="11" fontFamily="IBM Plex Mono, monospace">
                  {from.outputs[0]}
                </text>
              </g>
            );
          })}
          {draft ? (
            <path
              d={draftPath(graph, draft)}
              fill="none"
              stroke="var(--color-bone)"
              strokeWidth="1.25"
              strokeDasharray="4 4"
            />
          ) : null}
        </svg>
        {graph.nodes.map((node) => (
          <article
            key={node.id}
            className={`absolute border bg-panel p-2 select-none ${
              hotId === node.id ? "border-ember" : "border-line"
            } ${selectedId === node.id ? "outline outline-1 outline-ember" : ""}`}
            style={{ left: node.x ?? 0, top: node.y ?? 0, width: NODE_W, height: NODE_H }}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).dataset.port) return;
              event.stopPropagation();
              onSelect(node.id);
              drag.current = {
                id: node.id,
                ox: node.x ?? 0,
                oy: node.y ?? 0,
                px: event.clientX,
                py: event.clientY,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = drag.current;
              if (!active || active.id !== node.id) return;
              const scale = viewRef.current.k || 1;
              onMove(
                node.id,
                active.ox + (event.clientX - active.px) / scale,
                active.oy + (event.clientY - active.py) / scale,
              );
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onDoubleClick={() => onOpen(node)}
          >
            {node.inputs.length > 0 ? (
              <span
                data-port="in"
                title={node.inputs[0]}
                className="absolute top-1/2 -left-2 size-3.5 -translate-y-1/2 rounded-full border border-ember bg-ink"
                onPointerUp={(event) => {
                  event.stopPropagation();
                  if (draft) onConnect(draft.fromId, node.id);
                  setDraft(null);
                }}
              />
            ) : null}
            <span
              data-port="out"
              title={node.outputs[0]}
              className="absolute top-1/2 -right-2 size-3.5 -translate-y-1/2 rounded-full bg-ember"
              onPointerDown={(event) => {
                event.stopPropagation();
                setDraft({ fromId: node.id, ...localPoint(event) });
              }}
            />
            <p className="font-mono text-sm text-paper">{node.name}</p>
            <p className="font-mono text-xs text-ember">{node.kind}</p>
            <p className="mt-2 truncate font-mono text-xs text-mute">
              {node.inputs[0] ?? "start"} → {node.outputs[0]}
            </p>
          </article>
        ))}
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 font-mono text-xs text-mute">
        Drag empty space to pan. Scroll to zoom. Ember dot wires a module.
      </p>
    </div>
  );
}

function draftPath(graph: Graph, draft: { fromId: string; x: number; y: number }) {
  const from = graph.nodes.find((node) => node.id === draft.fromId);
  if (!from) return "";
  const x1 = (from.x ?? 0) + NODE_W;
  const y1 = (from.y ?? 0) + NODE_H / 2;
  return `M ${x1} ${y1} C ${x1 + 64} ${y1}, ${draft.x - 64} ${draft.y}, ${draft.x} ${draft.y}`;
}
