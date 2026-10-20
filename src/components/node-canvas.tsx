import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Graph, NodeDef } from "@/lib/engine";

type View = { x: number; y: number; k: number };
type Box = { w: number; h: number };

export function NodeCanvas({
  graph,
  selectedId,
  hotId,
  onSelect,
  onOpen,
  onMove,
  onResize,
  onConnect,
}: {
  graph: Graph;
  selectedId: string | null;
  hotId: string | null;
  onSelect: (id: string) => void;
  onOpen: (node: NodeDef) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onConnect: (fromId: string, toId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ x: 40, y: 48, k: 1 });
  const drag = useRef<{ id: string; ox: number; oy: number; px: number; py: number } | null>(null);
  const resize = useRef<{ id: string; w: number; h: number; px: number; py: number } | null>(null);
  const pan = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const nodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const fitted = useRef<string | null>(null);
  const [view, setView] = useState<View>(viewRef.current);
  const [draft, setDraft] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const [measured, setMeasured] = useState<Record<string, Box>>({});

  function sizeOf(id: string): Box {
    return measured[id] ?? { w: 160, h: 76 };
  }

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
      const bounds = node.getBoundingClientRect();
      const nextK = Math.min(1.6, Math.max(0.55, current.k * (event.deltaY > 0 ? 0.92 : 1.08)));
      const px = event.clientX - bounds.left;
      const py = event.clientY - bounds.top;
      const gx = (px - current.x) / current.k;
      const gy = (py - current.y) / current.k;
      setViewBoth({ k: nextK, x: px - gx * nextK, y: py - gy * nextK });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const measureKey = graph.nodes.map((node) => `${node.id}:${measured[node.id]?.w ?? 0}`).join();

  useEffect(() => {
    const el = scroller.current;
    if (!el || graph.nodes.length === 0) return;
    fitted.current = null;
    const fit = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 80) return false;
      const minX = Math.min(...graph.nodes.map((node) => node.x ?? 0));
      const minY = Math.min(...graph.nodes.map((node) => node.y ?? 0));
      const maxX = Math.max(...graph.nodes.map((node) => (node.x ?? 0) + sizeOf(node.id).w));
      const maxY = Math.max(...graph.nodes.map((node) => (node.y ?? 0) + sizeOf(node.id).h));
      const boundsW = Math.max(1, maxX - minX);
      const boundsH = Math.max(1, maxY - minY);
      const roomX = (rect.width - boundsW) / 2;
      const roomY = (rect.height - boundsH) / 2;
      setViewBoth({
        k: 1,
        x: (roomX > 16 ? roomX : 20) - minX,
        y: (roomY > 16 ? roomY : 20) - minY,
      });
      return true;
    };
    if (fit()) fitted.current = graph.id;
    const observer = new ResizeObserver(() => {
      if (fitted.current === graph.id) return;
      if (fit()) fitted.current = graph.id;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [graph.id, measureKey]);

  useLayoutEffect(() => {
    const next: Record<string, Box> = {};
    for (const node of graph.nodes) {
      const el = nodeRefs.current[node.id];
      if (!el) continue;
      next[node.id] = { w: el.offsetWidth, h: el.offsetHeight };
    }
    setMeasured((prev) => {
      const same = graph.nodes.every(
        (node) => prev[node.id]?.w === next[node.id]?.w && prev[node.id]?.h === next[node.id]?.h,
      );
      return same ? prev : next;
    });
  }, [graph]);

  const width = Math.max(720, ...graph.nodes.map((node) => (node.x ?? 0) + sizeOf(node.id).w + 80));
  const height = Math.max(320, ...graph.nodes.map((node) => (node.y ?? 0) + sizeOf(node.id).h + 72));

  return (
    <div
      ref={scroller}
      className="canvas-grid relative h-full min-h-64 overflow-auto"
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
            const x1 = (from.x ?? 0) + sizeOf(from.id).w;
            const y1 = (from.y ?? 0) + sizeOf(from.id).h / 2;
            const x2 = to.x ?? 0;
            const y2 = (to.y ?? 0) + sizeOf(to.id).h / 2;
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
                <text x={midX} y={midY - 8} fill="var(--color-mute)" fontSize="13" fontFamily="IBM Plex Mono, monospace">
                  {from.outputs[0]}
                </text>
              </g>
            );
          })}
          {draft ? (
            <path
              d={draftPath(graph, draft, sizeOf)}
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
            ref={(el) => {
              nodeRefs.current[node.id] = el;
            }}
            className={`node-face absolute max-w-md border px-4 py-3 select-none ${
              node.w ? "overflow-auto" : "w-max"
            } ${hotId === node.id ? "border-ember" : "border-line"} ${
              selectedId === node.id ? "outline outline-1 outline-ember" : ""
            }`}
            style={{ left: node.x ?? 0, top: node.y ?? 0, width: node.w, height: node.h }}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).dataset.port) return;
              if ((event.target as HTMLElement).dataset.resize) return;
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
              const scale = viewRef.current.k || 1;
              const sizing = resize.current;
              if (sizing && sizing.id === node.id) {
                onResize(node.id, sizing.w + (event.clientX - sizing.px) / scale, sizing.h + (event.clientY - sizing.py) / scale);
                return;
              }
              const active = drag.current;
              if (!active || active.id !== node.id) return;
              const rawX = active.ox + (event.clientX - active.px) / scale;
              const rawY = active.oy + (event.clientY - active.py) / scale;
              const snapped = snapNode(rawX, rawY, node.id, graph.nodes, sizeOf);
              onMove(node.id, snapped.x, snapped.y);
            }}
            onPointerUp={() => {
              drag.current = null;
              resize.current = null;
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
            <p className="font-mono text-base text-paper">{node.name}</p>
            <p className="mt-1 font-mono text-sm text-ember">{node.kind}</p>
            <p className="mt-3 font-mono text-sm text-mute">
              {node.inputs[0] ?? "start"} → {node.outputs[0]}
            </p>
            {node.childGraphId ? (
              <p className="mt-2 font-mono text-sm text-bone">Nested agent</p>
            ) : null}
            <span
              data-resize="true"
              className="absolute right-0 bottom-0 size-4 cursor-nwse-resize border-r border-b border-ember"
              onPointerDown={(event) => {
                event.stopPropagation();
                const box = sizeOf(node.id);
                resize.current = { id: node.id, w: box.w, h: box.h, px: event.clientX, py: event.clientY };
                event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
              }}
            />
          </article>
        ))}
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 font-mono text-xs text-mute">
        Drag empty space to pan. Scroll to zoom. Ember dot wires a module.
      </p>
    </div>
  );
}

function snapNode(
  x: number,
  y: number,
  id: string,
  nodes: NodeDef[],
  sizeOf: (nodeId: string) => Box,
) {
  const SNAP = 12;
  const self = sizeOf(id);
  let nextX = x;
  let nextY = y;
  for (const other of nodes) {
    if (other.id === id) continue;
    const box = sizeOf(other.id);
    const ox = other.x ?? 0;
    const oy = other.y ?? 0;
    for (const line of [ox, ox + box.w, ox + box.w - self.w, ox - self.w]) {
      if (Math.abs(nextX - line) <= SNAP) nextX = line;
    }
    for (const line of [oy, oy + box.h, oy + box.h - self.h, oy - self.h]) {
      if (Math.abs(nextY - line) <= SNAP) nextY = line;
    }
  }
  return { x: Math.max(0, nextX), y: Math.max(0, nextY) };
}

function draftPath(
  graph: Graph,
  draft: { fromId: string; x: number; y: number },
  sizeOf: (id: string) => Box,
) {
  const from = graph.nodes.find((node) => node.id === draft.fromId);
  if (!from) return "";
  const x1 = (from.x ?? 0) + sizeOf(from.id).w;
  const y1 = (from.y ?? 0) + sizeOf(from.id).h / 2;
  return `M ${x1} ${y1} C ${x1 + 64} ${y1}, ${draft.x - 64} ${draft.y}, ${draft.x} ${draft.y}`;
}
