import { useEffect, useState } from "react";
import {
  POLICIES,
  connectNodes,
  currentNode,
  cutIncoming,
  loadState,
  moveNode,
  saveState,
  setStatus,
  startRun,
  stepRun,
  swapImpl,
  type Persisted,
  type Run,
} from "@/lib/engine";
import { NodeCanvas } from "@/components/node-canvas";

const PACE_MS = 700;

export function Workbench() {
  const [state, setState] = useState<Persisted | null>(null);
  const [viewId, setViewId] = useState("workbench");
  const [selectedId, setSelectedId] = useState<string | null>("child");
  const [pace, setPace] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setState(loadState());
  }, []);

  useEffect(() => {
    if (state) saveState(state);
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

  return (
    <div className="min-h-dvh bg-ink text-bone">
      <div className="mx-auto grid max-w-7xl gap-3 px-3 py-4 lg:grid-cols-[12rem_minmax(0,1fr)_16rem]">
        <header className="frame bg-panel px-4 py-3 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-mono text-base text-paper">REAPER // WORKBENCH</h1>
              <p className="mt-1 font-mono text-sm text-mute">
                {parentGraph ? `${parentGraph.name} / ${graph.name}` : graph.name}
                {" · "}
                {run ? run.status.toUpperCase() : "ENGINE READY"}
              </p>
            </div>
            <p className="font-mono text-xs text-ember">
              {live ? "● RUNNING" : run?.status === "failed" ? "● FAILED" : "● ENGINE READY"}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Ctrl label="Run" onClick={onRun} disabled={live} />
            <Ctrl label="Step" onClick={onStep} disabled={live} />
            <Ctrl label="Pause" onClick={() => commit(setStatus(state, "paused"))} disabled={!live} />
            <Ctrl
              label="Resume"
              onClick={() => commit(setStatus(state, "running"))}
              disabled={run?.status !== "paused"}
            />
            <Ctrl
              label="Inspect"
              onClick={() => {
                if (cursor) {
                  setViewId(run?.stack.at(-1)?.graphId ?? viewId);
                  setSelectedId(cursor.id);
                }
              }}
            />
            <label className="ml-auto flex min-h-11 items-center gap-2 font-mono text-xs text-mute">
              <input type="checkbox" checked={pace} onChange={(e) => setPace(e.target.checked)} />
              Demo pace
            </label>
          </div>
        </header>

        <aside className="frame bg-panel p-3">
          <p className="font-mono text-xs text-ember">EXPLORER</p>
          <ul className="mt-3 space-y-1">
            <ExplorerButton label="Workspace" onClick={() => setViewId("workbench")} />
            <ExplorerButton label="Objectives" onClick={() => setViewId("workbench")} />
            <ExplorerButton label="Frameworks" onClick={() => setViewId("decision-deck")} />
            <ExplorerButton label="Run history" onClick={() => setSelectedId(null)} />
          </ul>
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
        </aside>

        <main className="space-y-3">
          <section className="frame bg-panel p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-mono text-xs text-ember">EDITOR · {graph.name.toUpperCase()}</h2>
              {parentGraph ? (
                <button type="button" className="font-mono text-xs text-ember" onClick={() => setViewId(parentGraph.id)}>
                  Up to {parentGraph.name}
                </button>
              ) : null}
            </div>
            <NodeCanvas
              graph={graph}
              selectedId={selectedId}
              hotId={cursor && run?.stack.at(-1)?.graphId === graph.id ? cursor.id : null}
              onSelect={setSelectedId}
              onOpen={(node) => {
                if (node.childGraphId) setViewId(node.childGraphId);
              }}
              onMove={(id, x, y) => setState(moveNode(model, graph.id, id, x, y))}
              onConnect={(fromId, toId) => {
                const result = connectNodes(model, graph.id, fromId, toId);
                commit(result.state, result.error ?? "");
              }}
            />
            {notice ? <p className="mt-3 font-mono text-xs text-ember">{notice}</p> : null}
          </section>

          <section className="well p-3">
            <h2 className="font-mono text-xs text-ember">EXECUTION LOG</h2>
            <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs leading-relaxed text-bone">
              {(run?.log ?? [{ t: "--", level: "system", text: "Waiting for a run." }])
                .map((entry) => `[${entry.t}] ${entry.level.toUpperCase()} ${entry.text}`)
                .join("\n")}
            </pre>
          </section>
        </main>

        <aside className="frame bg-panel p-3">
          <p className="font-mono text-xs text-ember">INSPECTOR</p>
          <div className="mt-3 space-y-2">
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
          </div>
          {selected ? (
            <dl className="mt-3 space-y-2 font-mono text-xs">
              <Row k="Module" v={selected.name} />
              <Row k="Type" v={selected.kind} />
              <Row k="Impl" v={selected.implId} />
              <Row k="Inputs" v={selected.inputs.join(", ") || "none"} />
              <Row k="Outputs" v={selected.outputs.join(", ")} />
              <Row k="Children" v={selected.childGraphId ? "nested graph" : "0"} />
              <Row k="Policy" v="Inherited" />
              <Row k="Budget" v={run ? String(run.budgetLeft) : String(24)} />
            </dl>
          ) : (
            <p className="mt-3 font-mono text-xs text-mute">Select a module.</p>
          )}
          {selected?.kind === "framework" && viewId === "workbench" ? (
            <div className="mt-4 space-y-2">
              <Ctrl
                label="Swap compatible"
                onClick={() => {
                  const result = swapImpl(state, "workbench", selected.id, "reaper.compact");
                  commit(result.state, result.error ?? "Compatible swap accepted.");
                }}
              />
              <Ctrl
                label="Try invalid swap"
                onClick={() => {
                  const result = swapImpl(state, "workbench", selected.id, "reaper.bad-ports");
                  commit(result.state, result.error ?? "Unexpected accept.");
                }}
              />
              <Ctrl
                label="Restore Decision Deck"
                onClick={() => {
                  const result = swapImpl(state, "workbench", selected.id, "reaper.decision-deck");
                  commit(result.state, result.error ?? "Decision Deck restored.");
                }}
              />
            </div>
          ) : null}
          {selected ? (
            <div className="mt-3">
              <Ctrl label="Cut incoming" onClick={() => commit(cutIncoming(model, viewId, selected.id))} />
            </div>
          ) : null}
          <div className="mt-4">
            <p className="font-mono text-xs text-ember">POLICY</p>
            <ul className="mt-2 space-y-1">
              {POLICIES.map((policy) => (
                <li key={policy} className="font-mono text-xs text-mute">
                  {policy}
                </li>
              ))}
            </ul>
          </div>
          <Latest run={run} />
        </aside>
      </div>
    </div>
  );
}

function Ctrl({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 border border-ember bg-ember-dim px-3 font-mono text-xs text-ember disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function ExplorerButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="font-mono text-sm text-bone hover:text-ember">
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
