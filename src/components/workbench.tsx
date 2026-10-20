import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IMPLS,
  POLICIES,
  connectNodes,
  currentNode,
  cutIncoming,
  loadState,
  moveNode,
  portsMatch,
  resizeNode,
  saveState,
  setStatus,
  startRun,
  stepRun,
  swapImpl,
  type NodeDef,
  type Persisted,
  type Run,
} from "@/lib/engine";
import { NodeCanvas } from "@/components/node-canvas";
import { SkinGallery } from "@/components/skin-gallery";
import { applyLook, loadLook, saveLook, type Look } from "@/lib/skins";

const PACE_MS = 700;

export function Workbench() {
  const [state, setState] = useState<Persisted | null>(null);
  const [viewId, setViewId] = useState("workbench");
  const [selectedId, setSelectedId] = useState<string | null>("child");
  const [pace, setPace] = useState(true);
  const [notice, setNotice] = useState("");
  const [insideId, setInsideId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ graphId: string; nodeId: string } | null>(null);
  const [panels, setPanels] = useState({
    explorer: true,
    editor: true,
    objective: false,
    inspector: true,
    log: true,
    skins: false,
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ w: 1280, h: 760 });
  const [frames, setFrames] = useState(DEFAULT_FRAMES);
  const [front, setFront] = useState<PanelId>("editor");
  const [look, setLook] = useState<Look | null>(null);
  const [nav, setNav] = useState<"workflow" | "integrations">("workflow");

  useEffect(() => {
    setState(loadState());
    const next = loadLook();
    setLook(next);
    applyLook(next);
  }, []);

  useEffect(() => {
    if (state) saveState(state);
  }, [state]);

  useEffect(() => {
    const raw = window.localStorage.getItem(FRAME_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as typeof DEFAULT_FRAMES;
      if (parsed.editor && parsed.inspector) setFrames({ ...DEFAULT_FRAMES, ...parsed });
    } catch {
      /* keep defaults */
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FRAME_KEY, JSON.stringify(frames));
  }, [frames]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const watch = new ResizeObserver(() => {
      setBounds({ w: el.clientWidth, h: el.clientHeight });
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [state]);

  const run = state?.runs.find((item) => item.id === state.activeRunId) ?? null;
  const live = run?.status === "running";

  useEffect(() => {
    if (!pace || !live) return;
    const timer = window.setTimeout(() => {
      setState((prev) => (prev ? stepRun(prev) : prev));
    }, PACE_MS);
    return () => window.clearTimeout(timer);
  }, [pace, live, run?.log.length, run?.status]);

  if (!state) {
    return <main className="min-h-dvh bg-ink p-6 font-mono text-sm text-mute">Loading workbench…</main>;
  }

  const graph = state.graphs.find((item) => item.id === viewId) ?? state.graphs[0];
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const insideNode = graph.nodes.find((node) => node.id === insideId && node.childGraphId) ?? null;
  const insideGraph = insideNode?.childGraphId
    ? state.graphs.find((item) => item.id === insideNode.childGraphId) ?? null
    : null;
  const detailGraph = state.graphs.find((item) => item.id === (detail?.graphId ?? graph.id)) ?? graph;
  const detailNode =
    detailGraph.nodes.find((node) => node.id === (detail?.nodeId ?? selected?.id)) ?? selected;
  const cursor = currentNode(state);
  const parentGraph = state.graphs.find((item) => item.nodes.some((node) => node.childGraphId === graph.id));

  const model = state;

  function commit(next: Persisted, note = "") {
    setState(next);
    if (note) setNotice(note);
  }

  function onRun() {
    commit(startRun(model, viewId));
    setNotice("");
  }

  function onStep() {
    const base =
      run && run.status !== "done" && run.status !== "failed" ? model : startRun(model, viewId);
    const stepped = stepRun(base);
    const current = stepped.runs.find((item) => item.id === stepped.activeRunId);
    commit(current?.status === "running" ? setStatus(stepped, "paused") : stepped);
  }

  function toggle(key: keyof typeof panels) {
    setPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="reaper-ui relative min-h-dvh bg-ink text-bone">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Mark />
          <h1 className="font-mono text-sm tracking-[0.14em] text-paper">REAPER</h1>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["explorer", "Integrations"],
              ["editor", "Workflow"],
              ["objective", "Objective"],
              ["inspector", "Inspector"],
              ["log", "Log"],
              ["skins", "Skins"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className={`min-h-11 border px-3 font-mono text-xs ${
                panels[key] ? "border-line bg-well text-paper" : "border-transparent text-mute"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-11 items-center gap-2 border border-line px-3 font-mono text-xs text-bone">
            <span className={`size-1.5 rounded-full ${live ? "bg-ember" : "bg-mute"}`} />
            {live ? "Running" : run?.status === "paused" ? "Paused" : run?.status === "failed" ? "Failed" : run?.status === "done" ? "Done" : "Idle"}
          </span>
          <Ctrl label="Run" primary onClick={onRun} disabled={live} />
          <Ctrl label="Step" onClick={onStep} disabled={live} />
          <Ctrl label="Pause" onClick={() => commit(setStatus(state, "paused"))} disabled={!live} />
          <Ctrl label="Resume" onClick={() => commit(setStatus(state, "running"))} disabled={run?.status !== "paused"} />
        </div>
      </header>

      <div ref={stageRef} className="relative h-[calc(100dvh-4.25rem)]">
        {panels.explorer ? (
          <Panel id="explorer" title="Integrations" onClose={() => toggle("explorer")} frames={frames} bounds={bounds} front={front === "explorer"} onFront={() => setFront("explorer")} onFrame={(frame) => setFrames((prev) => ({ ...prev, explorer: frame }))}>
            <ul className="space-y-1">
              <ExplorerButton label="Workflow" onClick={() => { setNav("workflow"); setViewId("workbench"); }} />
              <ExplorerButton label="Integrations" onClick={() => setNav("integrations")} />
            </ul>
            {nav === "integrations" ? (
              <ul className="mt-4 space-y-1">
                {graph.nodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className="w-full text-left font-mono text-sm text-bone hover:text-ember"
                      onClick={() => {
                        setSelectedId(node.id);
                        setDetail({ graphId: graph.id, nodeId: node.id });
                      }}
                    >
                      {node.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-4 space-y-1">
                {state.runs.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full text-left font-mono text-xs text-mute hover:text-paper"
                      onClick={() => commit({ ...state, activeRunId: item.id })}
                    >
                      {item.id} · {item.status}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : (
          <div />
        )}

        <div className="space-y-3">
          {panels.editor ? (
            <Panel
              id="editor"
              title="Workflow"
              onClose={() => toggle("editor")}
              frames={frames}
              bounds={bounds}
              front={front === "editor"}
              onFront={() => setFront("editor")}
              onFrame={(frame) => setFrames((prev) => ({ ...prev, editor: frame }))}
              extra={
                parentGraph ? (
                  <button type="button" className="font-mono text-xs text-ember" onClick={() => setViewId(parentGraph.id)}>
                    Up
                  </button>
                ) : null
              }
            >
              <NodeCanvas
                graph={graph}
                selectedId={selectedId}
                hotId={cursor && run?.stack.at(-1)?.graphId === graph.id ? cursor.id : null}
                onSelect={(id) => {
                  setSelectedId(id);
                  setDetail({ graphId: graph.id, nodeId: id });
                }}
                onOpen={(node) => {
                  if (!node.childGraphId) return;
                  setInsideId((current) => (current === node.id ? null : node.id));
                  setSelectedId(node.id);
                  setDetail({ graphId: graph.id, nodeId: node.id });
                }}
                onMove={(id, x, y) => setState(moveNode(model, graph.id, id, x, y))}
                onResize={(id, w, h) => setState(resizeNode(model, graph.id, id, w, h))}
                onConnect={(fromId, toId) => {
                  const result = connectNodes(model, graph.id, fromId, toId);
                  commit(result.state, result.error ?? "");
                }}
              />
              {notice ? <p className="mt-2 font-mono text-xs text-ember">{notice}</p> : null}
              {insideGraph ? (
                <div className="mt-3 border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-sm text-paper">Inside {insideNode?.name}</p>
                    <button type="button" className="font-mono text-xs text-mute" onClick={() => setInsideId(null)}>
                      Collapse
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {insideGraph.nodes.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => setDetail({ graphId: insideGraph.id, nodeId: node.id })}
                        className="w-44 border border-line bg-ink p-3 text-left"
                      >
                        <span className="block font-mono text-sm text-paper">{node.name}</span>
                        <span className="mt-1 block font-mono text-xs text-ember">{node.kind}</span>
                        <span className="mt-2 block font-mono text-xs text-mute">
                          {node.inputs[0]} → {node.outputs[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </Panel>
          ) : null}
          {panels.log ? (
            <Panel id="log" title="Log" onClose={() => toggle("log")} frames={frames} bounds={bounds} front={front === "log"} onFront={() => setFront("log")} onFrame={(frame) => setFrames((prev) => ({ ...prev, log: frame }))}>
              <pre className="max-h-full overflow-auto font-mono text-xs text-mute">
                {(run?.log ?? [{ t: "--", level: "system", text: "Waiting for a run." }])
                  .slice(-6)
                  .map((entry) => `[${entry.t}] ${entry.level.toUpperCase()} ${entry.text}`)
                  .join("\n")}
              </pre>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-3">
          {panels.objective ? (
            <Panel id="objective" title="Objective" onClose={() => toggle("objective")} frames={frames} bounds={bounds} front={front === "objective"} onFront={() => setFront("objective")} onFrame={(frame) => setFrames((prev) => ({ ...prev, objective: frame }))}>
              <Field
                label="Goal"
                value={state.objective.goal}
                onChange={(goal) => commit({ ...state, objective: { ...state.objective, goal } })}
              />
              <Field
                label="Constraints"
                value={state.objective.constraints}
                onChange={(constraints) => commit({ ...state, objective: { ...state.objective, constraints } })}
              />
              <Field
                label="Done when"
                value={state.objective.doneWhen}
                onChange={(doneWhen) => commit({ ...state, objective: { ...state.objective, doneWhen } })}
              />
            </Panel>
          ) : null}
          {panels.inspector ? (
            <Panel id="inspector" title="Inspector" onClose={() => toggle("inspector")} frames={frames} bounds={bounds} front={front === "inspector"} onFront={() => setFront("inspector")} onFrame={(frame) => setFrames((prev) => ({ ...prev, inspector: frame }))}>
              {detailNode ? (
                <InspectorBody
                  node={detailNode}
                  graphName={detailGraph?.name ?? graph.name}
                  nested={detailGraph?.id !== graph.id}
                  childCount={detailNode.childGraphId ? (childOf(state, detailNode)?.nodes.length ?? 0) : 0}
                  onUse={(implId) => {
                    const result = swapImpl(state, detailGraph.id, detailNode.id, implId);
                    commit(result.state, result.error ?? `Using ${implId}.`);
                  }}
                  onEnter={() => {
                    if (detailNode.childGraphId) setViewId(detailNode.childGraphId);
                  }}
                  onCut={() => commit(cutIncoming(model, graph.id, detailNode.id))}
                />
              ) : (
                <p className="font-mono text-sm text-mute">Select a module.</p>
              )}
              <Latest run={run} />
            </Panel>
          ) : null}
        </div>
        {panels.skins && look ? (
          <Panel
            id="skins"
            title="Skins"
            onClose={() => toggle("skins")}
            frames={frames}
            bounds={bounds}
            front={front === "skins"}
            onFront={() => setFront("skins")}
            onFrame={(frame) => setFrames((prev) => ({ ...prev, skins: frame }))}
          >
            <SkinGallery
              look={look}
              onClose={() => toggle("skins")}
              onChange={(next) => {
                setLook(next);
                applyLook(next);
                saveLook(next);
              }}
            />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function childOf(state: Persisted, node: NodeDef) {
  return state.graphs.find((item) => item.id === node.childGraphId) ?? null;
}

function InspectorBody({
  node,
  graphName,
  nested,
  childCount,
  onUse,
  onEnter,
  onCut,
}: {
  node: NodeDef;
  graphName: string;
  nested: boolean;
  childCount: number;
  onUse: (implId: string) => void;
  onEnter: () => void;
  onCut: () => void;
}) {
  const choices = IMPLS.filter((impl) => impl.kind === node.kind);
  return (
    <div className="space-y-4">
      <section>
        <h3 className="font-mono text-xs text-mute">Contract</h3>
        <p className="mt-2 font-mono text-sm text-paper">
          {graphName} / {node.name}
          {nested ? " · inside" : ""}
        </p>
        <dl className="mt-2 space-y-1 font-mono text-sm">
          <Row k="Kind" v={node.kind} />
          <Row k="In" v={node.inputs.join(", ") || "none"} />
          <Row k="Out" v={node.outputs.join(", ")} />
        </dl>
      </section>
      <section>
        <h3 className="font-mono text-xs text-mute">Implementation</h3>
        <p className="mt-2 font-mono text-sm text-paper">{node.implId}</p>
        <p className="mt-1 font-mono text-sm text-mute">{purpose(node.implId)}</p>
        {choices.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {choices.map((impl) => {
              const fits = portsMatch(node, impl);
              const current = impl.id === node.implId;
              return (
                <li key={impl.id}>
                  <button
                    type="button"
                    disabled={!fits || current}
                    onClick={() => onUse(impl.id)}
                    className="w-full border border-line px-2 py-2 text-left font-mono text-sm disabled:opacity-60"
                  >
                    <span className="text-paper">{impl.label}</span>
                    <span className="mt-1 block text-xs text-mute">{fits ? impl.does : "Ports do not match."}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 font-mono text-sm text-mute">No other implementation shares this contract.</p>
        )}
      </section>
      {node.childGraphId ? (
        <section>
          <h3 className="font-mono text-xs text-mute">Inside</h3>
          <p className="mt-2 font-mono text-sm text-mute">{childCount} modules.</p>
          <button type="button" onClick={onEnter} className="mt-2 font-mono text-sm text-ember">
            Open
          </button>
        </section>
      ) : null}
      <section>
        <h3 className="font-mono text-xs text-mute">Policy</h3>
        <ul className="mt-2 space-y-1">
          {POLICIES.map((policy) => (
            <li key={policy} className="font-mono text-xs text-mute">
              {policy}
            </li>
          ))}
        </ul>
        <button type="button" onClick={onCut} className="mt-3 font-mono text-sm text-mute">
          Cut incoming
        </button>
      </section>
    </div>
  );
}

function purpose(implId: string) {
  return (
    IMPLS.find((impl) => impl.id === implId)?.does ??
    {
      "human.objective": "Hold the goal, the constraints, and the done-when.",
      "tool.research": "Collect sources for the objective. Missing facts stay missing.",
      "agent.results": "Bind a report to the record. Withhold it if the record is absent.",
      "stage.research": "Accept parent sources.",
      "stage.evidence": "Separate what is supported from what is only plausible.",
      "stage.analysis": "Interpret the evidence. Label it as a hypothesis.",
      "stage.prioritization": "Rank one primary move and kill the rest.",
      "stage.execution": "Recommend the move. Do not post it.",
      "stage.recordkeeping": "Write the decision, the evidence, and the next source.",
    }[implId] ??
    "Produce the declared output from the declared inputs."
  );
}

const FRAME_KEY = "reaper-frames-v4";
const SNAP = 14;

type PanelId = "explorer" | "editor" | "objective" | "inspector" | "log" | "skins";
type Frame = { x: number; y: number; w: number; h: number };

const DEFAULT_FRAMES: Record<PanelId, Frame> = {
  explorer: { x: 12, y: 12, w: 220, h: 760 },
  editor: { x: 244, y: 12, w: 880, h: 520 },
  log: { x: 244, y: 544, w: 880, h: 228 },
  objective: { x: 244, y: 12, w: 420, h: 280 },
  inspector: { x: 1136, y: 12, w: 280, h: 760 },
  skins: { x: 360, y: 72, w: 640, h: 520 },
};

function peersOf(frames: Record<PanelId, Frame>, id: PanelId) {
  return (Object.keys(frames) as PanelId[]).filter((key) => key !== id).map((key) => frames[key]);
}

function snapFrame(frame: Frame, peers: Frame[], bounds: { w: number; h: number }, mode: "move" | "resize") {
  let { x, y, w, h } = frame;
  const vx = [0, bounds.w, ...peers.flatMap((peer) => [peer.x, peer.x + peer.w])];
  const vy = [0, bounds.h, ...peers.flatMap((peer) => [peer.y, peer.y + peer.h])];
  if (mode === "move") {
    for (const line of vx) {
      if (Math.abs(x - line) <= SNAP) x = line;
      else if (Math.abs(x + w - line) <= SNAP) x = line - w;
    }
    for (const line of vy) {
      if (Math.abs(y - line) <= SNAP) y = line;
      else if (Math.abs(y + h - line) <= SNAP) y = line - h;
    }
  } else {
    for (const line of vx) {
      if (Math.abs(x + w - line) <= SNAP) w = Math.max(180, line - x);
    }
    for (const line of vy) {
      if (Math.abs(y + h - line) <= SNAP) h = Math.max(120, line - y);
    }
  }
  return { x: Math.max(0, x), y: Math.max(0, y), w: Math.max(180, w), h: Math.max(120, h) };
}

function Panel({
  id,
  title,
  onClose,
  extra,
  frames,
  bounds,
  front,
  onFront,
  onFrame,
  children,
}: {
  id: PanelId;
  title: string;
  onClose: () => void;
  extra?: ReactNode;
  frames: Record<PanelId, Frame>;
  bounds: { w: number; h: number };
  front: boolean;
  onFront: () => void;
  onFrame: (frame: Frame) => void;
  children: ReactNode;
}) {
  const frame = frames[id];
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const resize = useRef<{ w: number; h: number; px: number; py: number } | null>(null);
  const peers = peersOf(frames, id);

  return (
    <section
      className="frame absolute flex flex-col overflow-hidden bg-panel"
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, zIndex: front ? 3 : 1 }}
      onPointerDown={onFront}
    >
      <header
        className="flex shrink-0 cursor-grab items-center justify-between gap-2 border-b border-line px-3 py-2 active:cursor-grabbing"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          drag.current = { x: frame.x, y: frame.y, px: event.clientX, py: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const next = snapFrame(
            {
              ...frame,
              x: drag.current.x + event.clientX - drag.current.px,
              y: drag.current.y + event.clientY - drag.current.py,
            },
            peers,
            bounds,
            "move",
          );
          onFrame(next);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <h2 className="font-mono text-xs tracking-wide text-mute">{title}</h2>
        <span className="flex items-center gap-3">
          {extra}
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="min-h-11 min-w-11 font-mono text-sm text-mute">
            ×
          </button>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      <span
        className="absolute right-0 bottom-0 size-4 cursor-nwse-resize border-r border-b border-ember"
        onPointerDown={(event) => {
          event.stopPropagation();
          resize.current = { w: frame.w, h: frame.h, px: event.clientX, py: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!resize.current) return;
          onFrame(
            snapFrame(
              {
                ...frame,
                w: resize.current.w + event.clientX - resize.current.px,
                h: resize.current.h + event.clientY - resize.current.py,
              },
              peers,
              bounds,
              "resize",
            ),
          );
        }}
        onPointerUp={() => {
          resize.current = null;
        }}
      />
    </section>
  );
}

function Mark() {
  return (
    <svg className="reaper-mark text-ember" width="36" height="36" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 L27 9.5 V20.5 L16 29 L5 20.5 V9.5 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M16 8 V22" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 15 L23 21" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 7 V3 H7 M25 3 H29 V7 M3 25 V29 H7 M25 29 H29 V25" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function Ctrl({
  label,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 border px-3 font-mono text-xs disabled:opacity-40 ${
        primary ? "border-ember bg-ember text-ink" : "border-line bg-transparent text-bone"
      }`}
    >
      {label}
    </button>
  );
}

function ExplorerButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex min-h-11 w-full items-center px-2 text-left font-mono text-sm text-bone hover:bg-well">
        {label}
      </button>
    </li>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-2 block">
      <span className="font-mono text-xs text-mute">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="well mt-1 w-full px-2 py-2 font-mono text-sm text-paper outline-none focus:border-ember"
      />
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-mute">{k}</dt>
      <dd className="text-paper">{v}</dd>
    </div>
  );
}

function Latest({ run }: { run: Run | null }) {
  const last = run?.artifacts.at(-1);
  if (!last) return null;
  return (
    <div className="mt-4">
      <p className="font-mono text-xs text-ember">LAST ARTIFACT</p>
      <p className="mt-1 font-mono text-xs text-mute">
        {last.id} · {last.port} · {last.status}
      </p>
      <pre className="mt-1 font-mono text-xs whitespace-pre-wrap text-bone">{last.body}</pre>
    </div>
  );
}
