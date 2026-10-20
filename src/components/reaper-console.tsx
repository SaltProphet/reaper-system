import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_OBJECTIVE,
  OBJECTS,
  STAGES,
  buildCycle,
  objectIndexForStage,
  type StageName,
  type StageStatus,
} from "@/lib/reaper";

const STEP_MS = 1600;

const BOOT = [
  "[SYSTEM] Decision deck online",
  "[SYSTEM] Personal-brand configuration loaded",
  "[SYSTEM] Waiting for a cycle",
];

function statusLabel(status: StageStatus) {
  if (status === "running") return "LIVE";
  if (status === "complete") return "DONE";
  return "IDLE";
}

export function ReaperConsole() {
  const [objective, setObjective] = useState(DEFAULT_OBJECTIVE);
  const [statuses, setStatuses] = useState<StageStatus[]>(() => STAGES.map(() => "idle"));
  const [playing, setPlaying] = useState(false);
  const [log, setLog] = useState<string[]>(BOOT);
  const timer = useRef<number | null>(null);
  const step = useRef(0);
  const logRef = useRef<HTMLPreElement>(null);

  const cycle = useMemo(() => buildCycle(objective), [objective]);
  const doneCount = statuses.filter((s) => s === "complete").length;
  const activeObject =
    doneCount === 0 && !playing ? 0 : objectIndexForStage(Math.max(doneCount - 1, 0));
  const objectLit = playing || doneCount > 0 ? activeObject : 0;
  const ready = !playing && doneCount === STAGES.length;

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function reset() {
    clearTimer();
    step.current = 0;
    setPlaying(false);
    setStatuses(STAGES.map(() => "idle"));
    setLog(BOOT);
  }

  function advance() {
    const i = step.current;
    if (i >= STAGES.length) {
      setPlaying(false);
      return;
    }
    const name = STAGES[i];
    setStatuses((prev) => prev.map((s, idx) => (idx === i ? "running" : s)));
    setLog((prev) => [...prev, `[${name.toUpperCase()}] start`]);
    timer.current = window.setTimeout(() => {
      setStatuses((prev) => prev.map((s, idx) => (idx === i ? "complete" : s)));
      const note = cycle[name].title;
      setLog((prev) => [...prev, `[${name.toUpperCase()}] ${note}`]);
      step.current = i + 1;
      if (i + 1 >= STAGES.length) {
        setLog((prev) => [...prev, "[SYSTEM] Cycle closed. One primary action."]);
        setPlaying(false);
        return;
      }
      advance();
    }, STEP_MS);
  }

  function run() {
    clearTimer();
    step.current = 0;
    setStatuses(STAGES.map(() => "idle"));
    setLog([
      "[SYSTEM] Cycle armed",
      "[SYSTEM] Objective locked",
      "[SYSTEM] Stepping Research → Recordkeeping",
    ]);
    setPlaying(true);
    window.setTimeout(() => advance(), 40);
  }

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log]);

  return (
    <div className="min-h-dvh bg-ink text-bone">
      <div className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
        <header className="frame bg-panel px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-mono text-sm tracking-wide text-paper sm:text-base">
                REAPER // DECISION DECK
              </h1>
              <p className="mt-2 max-w-xl font-mono text-xs text-paper">
                A parent should never know how complicated her child is.
              </p>
              <p className="mt-1 font-mono text-xs text-mute">
                Complexity inside. Compatibility outside.
              </p>
            </div>
            <p className="font-mono text-xs text-ember">
              {playing ? "● CYCLE LIVE" : ready ? "● CYCLE CLOSED" : "● SYSTEM READY"}
            </p>
          </div>
          <nav className="mt-3 flex gap-4 overflow-x-auto border-t border-ember/40 pt-2">
            {STAGES.map((name, i) => (
              <span
                key={name}
                className={`shrink-0 font-mono text-xs tracking-wide uppercase ${
                  statuses[i] === "idle" ? "text-mute" : "phase-on"
                }`}
              >
                {String(i + 1).padStart(2, "0")} {name}
              </span>
            ))}
          </nav>
        </header>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.7fr)]">
          <div className="space-y-4">
            <section className="frame bg-panel p-3">
              <h2 className="font-mono text-xs tracking-wide text-ember">1.1 OBJECTIVE</h2>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                disabled={playing}
                rows={3}
                suppressHydrationWarning
                className="well mt-2 w-full resize-y px-3 py-2 font-mono text-xs text-paper outline-none focus:border-ember disabled:opacity-70"
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={run}
                  disabled={playing}
                  className="min-h-11 flex-1 bg-ember font-mono text-xs tracking-wide text-ink disabled:opacity-50"
                >
                  {playing ? "STEPPING…" : "RUN CYCLE"}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="min-h-11 border border-line bg-raised px-4 font-mono text-xs text-bone"
                >
                  RESET
                </button>
              </div>
            </section>

            <section className="frame bg-panel p-3">
              <h2 className="font-mono text-xs tracking-wide text-ember">1.2 OBJECT FLOW</h2>
              <ol className="mt-3 space-y-1">
                {OBJECTS.map((name, i) => {
                  const on = i <= objectLit && (playing || doneCount > 0 || i === 0);
                  return (
                    <li key={name} className="flex items-center gap-3 font-mono text-xs">
                      <span className={`h-1.5 w-8 ${on ? "bar-live" : "bg-raised"}`} />
                      <span className={on ? "text-paper" : "text-mute"}>{name}</span>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="frame bg-panel p-3">
              <h2 className="font-mono text-xs tracking-wide text-ember">1.3 STAGES</h2>
              <ul className="mt-3 space-y-2">
                {STAGES.map((name, i) => (
                  <StageRow
                    key={name}
                    name={name}
                    index={i}
                    status={statuses[i]}
                    payload={statuses[i] === "idle" ? null : cycle[name]}
                  />
                ))}
              </ul>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="frame bg-panel p-3">
              <h2 className="font-mono text-xs tracking-wide text-ember">SYSTEM CONSOLE</h2>
              <pre
                ref={logRef}
                className="well mt-2 h-72 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-bone"
              >
                {log.map((line) => `${line}\n`).join("")}
              </pre>
            </section>
            <section className="well p-3">
              <h2 className="font-mono text-xs text-mute">PLATE</h2>
              <img
                src="/reaper-deck.jpg"
                alt="Still of the REAPER decision deck"
                className="mt-2 w-full border border-line"
              />
            </section>
            <section className="well p-3">
              <h2 className="font-mono text-xs text-mute">HARD RULES</h2>
              <p className="mt-2 font-mono text-xs text-mute">No evidence, no factual claim.</p>
              <p className="font-mono text-xs text-mute">No decision without prioritization.</p>
              <p className="font-mono text-xs text-ember">No cycle without recordkeeping.</p>
            </section>
          </aside>
        </div>

        <footer className="mt-6 border-t border-line pt-3 font-mono text-xs text-mute">
          REAPER · complexity inside, compatibility outside
        </footer>
      </div>
    </div>
  );
}

function StageRow({
  name,
  index,
  status,
  payload,
}: {
  name: StageName;
  index: number;
  status: StageStatus;
  payload: { title: string; body: string } | null;
}) {
  return (
    <li className={`well p-3 ${status === "running" ? "border-ember" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-paper">
          {String(index + 1).padStart(2, "0")} {name.toUpperCase()}
        </p>
        <p className={`font-mono text-xs ${status === "idle" ? "text-mute" : "text-ember"}`}>
          {statusLabel(status)}
        </p>
      </div>
      {payload ? (
        <pre className="mt-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-mute">
          {payload.body}
        </pre>
      ) : (
        <p className="mt-2 font-mono text-xs text-mute">
          {index === 0 ? "Armed. Run the cycle." : "Waiting."}
        </p>
      )}
    </li>
  );
}
