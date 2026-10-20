import { i as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-D4B5pZ6q.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var STORE_KEY = "reaper-workbench-v1";
var POLICIES = [
	"No evidence, no factual claim.",
	"No decision without prioritization.",
	"No cycle without recordkeeping.",
	"No external post from the engine.",
	`Depth limit 4. Step budget 24.`
];
var IMPLS = [
	{
		id: "reaper.decision-deck",
		label: "Decision Deck",
		kind: "framework",
		inputs: ["sources"],
		outputs: ["record"],
		childGraphId: "decision-deck"
	},
	{
		id: "reaper.compact",
		label: "Compact pass",
		kind: "framework",
		inputs: ["sources"],
		outputs: ["record"]
	},
	{
		id: "reaper.bad-ports",
		label: "Bad ports",
		kind: "framework",
		inputs: ["sources", "budget"],
		outputs: ["record"]
	}
];
var same = (a, b) => a.join("|") === b.join("|");
function portsMatch(node, impl) {
	return node.kind === impl.kind && same(node.inputs, impl.inputs) && same(node.outputs, impl.outputs);
}
function nowStamp() {
	return (/* @__PURE__ */ new Date()).toISOString().slice(11, 19);
}
function rid(prefix) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
function defaultState() {
	return {
		objective: {
			goal: "Be known for reliable workflow rescue under the real name Justin Strange.",
			constraints: "Real name. Blunt, non-corporate voice. Low daily posting cost.",
			doneWhen: "One primary action is chosen and a record exists. Nothing is posted."
		},
		graphs: [{
			id: "workbench",
			name: "Workbench",
			nodes: [
				{
					id: "objective",
					name: "Objective",
					kind: "human",
					implId: "human.objective",
					inputs: [],
					outputs: ["objective"]
				},
				{
					id: "research",
					name: "Research",
					kind: "tool",
					implId: "tool.research",
					inputs: ["objective"],
					outputs: ["sources"]
				},
				{
					id: "child",
					name: "Child REAPER",
					kind: "framework",
					implId: "reaper.decision-deck",
					inputs: ["sources"],
					outputs: ["record"],
					childGraphId: "decision-deck"
				},
				{
					id: "results",
					name: "Results",
					kind: "agent",
					implId: "agent.results",
					inputs: ["record"],
					outputs: ["report"]
				}
			]
		}, {
			id: "decision-deck",
			name: "Decision Deck",
			nodes: [
				[
					"research",
					"Research",
					"tool"
				],
				[
					"evidence",
					"Evidence",
					"tool"
				],
				[
					"analysis",
					"Analysis",
					"agent"
				],
				[
					"prioritization",
					"Prioritization",
					"agent"
				],
				[
					"execution",
					"Execution",
					"human"
				],
				[
					"recordkeeping",
					"Recordkeeping",
					"tool"
				]
			].map(([id, name, kind]) => ({
				id,
				name,
				kind,
				implId: `stage.${id}`,
				inputs: ["packet"],
				outputs: ["packet"]
			}))
		}],
		runs: [],
		activeRunId: null
	};
}
function loadState() {
	if (typeof window === "undefined") return defaultState();
	try {
		const raw = window.localStorage.getItem(STORE_KEY);
		if (!raw) return defaultState();
		const parsed = JSON.parse(raw);
		if (!parsed.graphs?.length || !parsed.objective) return defaultState();
		return parsed;
	} catch {
		return defaultState();
	}
}
function saveState(state) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
}
function line(level, text) {
	return {
		t: nowStamp(),
		level,
		text
	};
}
function graphOf(state, id) {
	const graph = state.graphs.find((g) => g.id === id);
	if (!graph) throw new Error(`Missing graph ${id}`);
	return graph;
}
function swapImpl(state, graphId, nodeId, implId) {
	const impl = IMPLS.find((item) => item.id === implId);
	const graph = state.graphs.find((g) => g.id === graphId);
	const node = graph?.nodes.find((n) => n.id === nodeId);
	if (!impl || !graph || !node) return {
		state,
		error: "Module or implementation not found."
	};
	if (!portsMatch(node, impl)) return {
		state: appendLog(state, "error", `Swap rejected. ${impl.label} ports do not match ${node.name}.`),
		error: `${impl.label} is incompatible. Inputs [${impl.inputs.join(", ")}] vs [${node.inputs.join(", ")}].`
	};
	return { state: appendLog({
		...state,
		graphs: state.graphs.map((g) => g.id !== graphId ? g : {
			...g,
			nodes: g.nodes.map((n) => n.id !== nodeId ? n : {
				...n,
				implId: impl.id,
				childGraphId: impl.childGraphId
			})
		})
	}, "system", `Swapped ${node.name} to ${impl.label}. Parent edges unchanged.`) };
}
function appendLog(state, level, text) {
	const run = active(state);
	if (!run) {
		const idle = {
			id: "idle",
			rootGraphId: "workbench",
			status: "paused",
			budgetLeft: 24,
			stack: [],
			artifacts: [],
			log: [line(level, text)],
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		return {
			...state,
			runs: [idle, ...state.runs].slice(0, 8),
			activeRunId: "idle"
		};
	}
	return updateRun(state, {
		...run,
		log: [...run.log, line(level, text)]
	});
}
function active(state) {
	return state.runs.find((run) => run.id === state.activeRunId) ?? null;
}
function updateRun(state, run) {
	return {
		...state,
		activeRunId: run.id,
		runs: [run, ...state.runs.filter((item) => item.id !== run.id)].slice(0, 8)
	};
}
function startRun(state, rootGraphId) {
	const graph = graphOf(state, rootGraphId);
	return updateRun(state, {
		id: rid("run"),
		rootGraphId,
		status: "running",
		budgetLeft: 24,
		stack: [{
			graphId: rootGraphId,
			index: 0,
			depth: 1
		}],
		artifacts: [],
		log: [line("system", `Run armed on ${graph.name}.`), line("system", `${graph.nodes.length} modules. Budget 24. Depth cap 4.`)],
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
}
function setStatus(state, status) {
	const run = active(state);
	if (!run || run.status === "done" || run.status === "failed") return state;
	return updateRun(state, {
		...run,
		status,
		log: [...run.log, line("system", status === "paused" ? "Paused." : "Resumed.")],
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
}
function bodyFor(node, objective, prior) {
	if (node.implId === "human.objective") return {
		status: "present",
		body: `Goal: ${objective.goal}\nConstraints: ${objective.constraints}\nDone when: ${objective.doneWhen}`
	};
	if (node.implId === "tool.research") return {
		status: "present",
		body: "SRC-001 ownership gap in broken automations.\nSRC-002 real-name blunt posting is possible on X.\nSRC-003 audience size: missing."
	};
	if (node.implId === "reaper.compact") return {
		status: "present",
		body: "Compact implementation. Same ports as Decision Deck.\nPrimary: one diagnosis post. Nothing posted.\nParent graph was not edited."
	};
	if (node.implId === "agent.results") {
		const record = [...prior].reverse().find((item) => item.port === "record" || item.nodeId === "recordkeeping");
		return {
			status: record ? "present" : "missing",
			body: record ? `Report bound to ${record.id}.\n${record.body.split("\n")[0]}` : "No record artifact. Report withheld."
		};
	}
	if (node.implId === "stage.research") return {
		status: "present",
		body: "Sources accepted from parent. Pattern: ownership_gap."
	};
	if (node.implId === "stage.evidence") return {
		status: "present",
		body: "EV-001 present. EV-002 present. EV-003 audience size missing."
	};
	if (node.implId === "stage.analysis") return {
		status: "present",
		body: "Hypothesis only: workflow rescue is a credible known-for. Not a factual market claim."
	};
	if (node.implId === "stage.prioritization") return {
		status: "present",
		body: "Rank 1: one public diagnosis post.\nKilled: LinkedIn, daily cadence."
	};
	if (node.implId === "stage.execution") return {
		status: "present",
		body: "Recommendation only. Engine did not post."
	};
	if (node.implId === "stage.recordkeeping") return {
		status: "present",
		body: "Record written. Evidence used: EV-001, EV-002. Next cycle needs a post URL."
	};
	return {
		status: "missing",
		body: `No executor for ${node.implId}.`
	};
}
function stepRun(state) {
	const run = active(state);
	if (!run || run.status !== "running" && run.status !== "paused") return state;
	if (run.budgetLeft <= 0) return updateRun(state, {
		...run,
		status: "failed",
		error: "Step budget exhausted.",
		log: [...run.log, line("error", "Step budget exhausted. Run halted.")],
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
	const frame = run.stack[run.stack.length - 1];
	if (!frame) return updateRun(state, {
		...run,
		status: "done",
		log: [...run.log, line("system", "Run complete.")],
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
	const graph = graphOf(state, frame.graphId);
	if (frame.index >= graph.nodes.length) {
		const parent = run.stack[run.stack.length - 2];
		const log = [...run.log, line("child", `${graph.name} returned to its parent.`)];
		if (!parent) return updateRun(state, {
			...run,
			status: "done",
			stack: [],
			log: [...log, line("system", "Root graph complete.")],
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		const parentNode = graphOf(state, parent.graphId).nodes[parent.index];
		const last = run.artifacts.at(-1);
		const bubbled = parentNode ? {
			id: rid("art"),
			graphId: parent.graphId,
			nodeId: parentNode.id,
			port: parentNode.outputs[0] ?? "out",
			body: last?.body ?? "Child returned no artifact.",
			status: last?.status ?? "missing"
		} : null;
		return updateRun(state, {
			...run,
			artifacts: bubbled ? [...run.artifacts, bubbled] : run.artifacts,
			stack: [...run.stack.slice(0, -2), {
				...parent,
				index: parent.index + 1
			}],
			log: [...log, line("child", `${parentNode?.name ?? graph.name} emitted ${bubbled?.port ?? "out"} to the parent.`)],
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	const node = graph.nodes[frame.index];
	if (node.childGraphId) {
		const depth = frame.depth + 1;
		if (depth > 4) return updateRun(state, {
			...run,
			status: "failed",
			error: "Depth limit.",
			log: [...run.log, line("error", `${node.name} refused. Depth ${depth} exceeds 4.`)],
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		return updateRun(state, {
			...run,
			budgetLeft: run.budgetLeft - 1,
			stack: [...run.stack, {
				graphId: node.childGraphId,
				index: 0,
				depth
			}],
			log: [...run.log, line("child", `Delegating into ${node.name} (${node.implId}) at depth ${depth}.`)],
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	const produced = bodyFor(node, state.objective, run.artifacts);
	const artifact = {
		id: rid("art"),
		graphId: graph.id,
		nodeId: node.id,
		port: node.outputs[0] ?? "out",
		body: produced.body,
		status: produced.status
	};
	return updateRun(state, {
		...run,
		budgetLeft: run.budgetLeft - 1,
		artifacts: [...run.artifacts, artifact],
		stack: [...run.stack.slice(0, -1), {
			...frame,
			index: frame.index + 1
		}],
		log: [...run.log, line("module", `${graph.name} / ${node.name} → ${artifact.port} (${artifact.status}).`)],
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
}
function currentNode(state) {
	const run = active(state);
	const frame = run?.stack[run.stack.length - 1];
	if (!run || !frame) return null;
	return state.graphs.find((g) => g.id === frame.graphId)?.nodes[frame.index] ?? null;
}
var PACE_MS = 700;
function Workbench() {
	const [state, setState] = (0, import_react.useState)(null);
	const [viewId, setViewId] = (0, import_react.useState)("workbench");
	const [selectedId, setSelectedId] = (0, import_react.useState)("child");
	const [pace, setPace] = (0, import_react.useState)(true);
	const [notice, setNotice] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		setState(loadState());
	}, []);
	(0, import_react.useEffect)(() => {
		if (state) saveState(state);
	}, [state]);
	const run = state?.runs.find((item) => item.id === state.activeRunId) ?? null;
	const live = run?.status === "running";
	(0, import_react.useEffect)(() => {
		if (!pace || !live) return;
		const timer = window.setTimeout(() => {
			setState((prev) => prev ? stepRun(prev) : prev);
		}, PACE_MS);
		return () => window.clearTimeout(timer);
	}, [
		pace,
		live,
		run?.log.length,
		run?.status
	]);
	if (!state) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "min-h-dvh bg-ink p-6 font-mono text-sm text-mute",
		children: "Loading workbench…"
	});
	const graph = state.graphs.find((item) => item.id === viewId) ?? state.graphs[0];
	const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
	const cursor = currentNode(state);
	const parentGraph = state.graphs.find((item) => item.nodes.some((node) => node.childGraphId === graph.id));
	const model = state;
	function commit(next, note = "") {
		setState(next);
		if (note) setNotice(note);
	}
	function onRun() {
		commit(startRun(model, viewId));
		setNotice("");
	}
	function onStep() {
		const stepped = stepRun(run && run.status !== "done" && run.status !== "failed" ? model : startRun(model, viewId));
		commit(stepped.runs.find((item) => item.id === stepped.activeRunId)?.status === "running" ? setStatus(stepped, "paused") : stepped);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "min-h-dvh bg-ink text-bone",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mx-auto grid max-w-7xl gap-3 px-3 py-4 lg:grid-cols-[12rem_minmax(0,1fr)_16rem]",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
					className: "frame bg-panel px-4 py-3 lg:col-span-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-start justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
							className: "font-mono text-base text-paper",
							children: "REAPER // WORKBENCH"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-1 font-mono text-sm text-mute",
							children: [
								parentGraph ? `${parentGraph.name} / ${graph.name}` : graph.name,
								" · ",
								run ? run.status.toUpperCase() : "ENGINE READY"
							]
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-xs text-ember",
							children: live ? "● RUNNING" : run?.status === "failed" ? "● FAILED" : "● ENGINE READY"
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctrl, {
								label: "Run",
								onClick: onRun,
								disabled: live
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctrl, {
								label: "Step",
								onClick: onStep,
								disabled: live
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctrl, {
								label: "Pause",
								onClick: () => commit(setStatus(state, "paused")),
								disabled: !live
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctrl, {
								label: "Resume",
								onClick: () => commit(setStatus(state, "running")),
								disabled: run?.status !== "paused"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctrl, {
								label: "Inspect",
								onClick: () => {
									if (cursor) {
										setViewId(run?.stack.at(-1)?.graphId ?? viewId);
										setSelectedId(cursor.id);
									}
								}
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "ml-auto flex min-h-11 items-center gap-2 font-mono text-xs text-mute",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: pace,
									onChange: (e) => setPace(e.target.checked)
								}), "Demo pace"]
							})
						]
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "frame bg-panel p-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-xs text-ember",
							children: "EXPLORER"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
							className: "mt-3 space-y-1",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExplorerButton, {
									label: "Workspace",
									onClick: () => setViewId("workbench")
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExplorerButton, {
									label: "Objectives",
									onClick: () => setViewId("workbench")
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExplorerButton, {
									label: "Frameworks",
									onClick: () => setViewId("decision-deck")
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExplorerButton, {
									label: "Run history",
									onClick: () => setSelectedId(null)
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "mt-4 space-y-1",
							children: state.runs.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "w-full text-left font-mono text-xs text-mute hover:text-paper",
								onClick: () => commit({
									...state,
									activeRunId: item.id
								}),
								children: [
									item.id,
									" · ",
									item.status
								]
							}) }, item.id))
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
					className: "space-y-3",
					children: [
						viewId === "workbench" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
							className: "frame bg-panel p-3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
									className: "font-mono text-xs text-ember",
									children: "1.1 OBJECTIVE"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
									label: "Goal",
									value: state.objective.goal,
									onChange: (goal) => commit({
										...state,
										objective: {
											...state.objective,
											goal
										}
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
									label: "Constraints",
									value: state.objective.constraints,
									onChange: (constraints) => commit({
										...state,
										objective: {
											...state.objective,
											constraints
										}
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
									label: "Done when",
									value: state.objective.doneWhen,
									onChange: (doneWhen) => commit({
										...state,
										objective: {
											...state.objective,
											doneWhen
										}
									})
								})
							]
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
							className: "frame bg-panel p-3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex items-center justify-between gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
										className: "font-mono text-xs text-ember",
										children: ["WORKFLOW · ", graph.name.toUpperCase()]
									}), parentGraph ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "font-mono text-xs text-ember",
										onClick: () => setViewId(parentGraph.id),
										children: ["Up to ", parentGraph.name]
									}) : null]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
									className: "mt-3 space-y-2",
									children: graph.nodes.map((node, index) => {
										const hot = cursor?.id === node.id && run?.stack.at(-1)?.graphId === graph.id;
										return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [index > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
											className: "py-1 text-center font-mono text-xs text-mute",
											children: [
												graph.nodes[index - 1].outputs[0],
												" → ",
												node.inputs[0] ?? "—"
											]
										}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
											type: "button",
											onClick: () => setSelectedId(node.id),
											onDoubleClick: () => {
												if (node.childGraphId) setViewId(node.childGraphId);
											},
											className: `well w-full p-3 text-left ${hot ? "border-ember" : ""} ${selectedId === node.id ? "outline outline-1 outline-ember" : ""}`,
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												className: "flex items-center justify-between gap-2",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
													className: "font-mono text-sm text-paper",
													children: node.name
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
													className: "font-mono text-xs text-ember",
													children: node.kind
												})]
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												className: "mt-2 block font-mono text-xs text-mute",
												children: [
													"in [",
													node.inputs.join(", ") || "—",
													"] · out [",
													node.outputs.join(", "),
													"] · ",
													node.implId
												]
											})]
										})] }, node.id);
									})
								}),
								notice ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-3 font-mono text-xs text-ember",
									children: notice
								}) : null
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
							className: "well p-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-mono text-xs text-ember",
								children: "EXECUTION LOG"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
								className: "mt-2 max-h-48 overflow-auto font-mono text-xs leading-relaxed text-bone",
								children: (run?.log ?? [{
									t: "--",
									level: "system",
									text: "Waiting for a run."
								}]).map((entry) => `[${entry.t}] ${entry.level.toUpperCase()} ${entry.text}`).join("\n")
							})]
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "frame bg-panel p-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-xs text-ember",
							children: "INSPECTOR"
						}),
						selected ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
							className: "mt-3 space-y-2 font-mono text-xs",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									k: "Module",
									v: selected.name
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									k: "Type",
									v: selected.kind
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									k: "Impl",
									v: selected.implId
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									k: "Inputs",
									v: selected.inputs.join(", ") || "none"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									k: "Outputs",
									v: selected.outputs.join(", ")
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									k: "Children",
									v: selected.childGraphId ? "nested graph" : "0"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									k: "Policy",
									v: "Inherited"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									k: "Budget",
									v: run ? String(run.budgetLeft) : String(24)
								})
							]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-3 font-mono text-xs text-mute",
							children: "Select a module."
						}),
						selected?.kind === "framework" && viewId === "workbench" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-4 space-y-2",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctrl, {
									label: "Swap compatible",
									onClick: () => {
										const result = swapImpl(state, "workbench", selected.id, "reaper.compact");
										commit(result.state, result.error ?? "Compatible swap accepted.");
									}
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctrl, {
									label: "Try invalid swap",
									onClick: () => {
										const result = swapImpl(state, "workbench", selected.id, "reaper.bad-ports");
										commit(result.state, result.error ?? "Unexpected accept.");
									}
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctrl, {
									label: "Restore Decision Deck",
									onClick: () => {
										const result = swapImpl(state, "workbench", selected.id, "reaper.decision-deck");
										commit(result.state, result.error ?? "Decision Deck restored.");
									}
								})
							]
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-4",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-mono text-xs text-ember",
								children: "POLICY"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
								className: "mt-2 space-y-1",
								children: POLICIES.map((policy) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
									className: "font-mono text-xs text-mute",
									children: policy
								}, policy))
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Latest, { run })
					]
				})
			]
		})
	});
}
function Ctrl({ label, onClick, disabled }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		onClick,
		disabled,
		className: "min-h-11 border border-ember bg-ember-dim px-3 font-mono text-xs text-ember disabled:opacity-40",
		children: label
	});
}
function ExplorerButton({ label, onClick }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		onClick,
		className: "font-mono text-sm text-bone hover:text-ember",
		children: label
	}) });
}
function Field({ label, value, onChange }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "mt-2 block",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "font-mono text-xs text-mute",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
			value,
			onChange: (e) => onChange(e.target.value),
			rows: 2,
			className: "well mt-1 w-full px-2 py-2 font-mono text-sm text-paper outline-none focus:border-ember"
		})]
	});
}
function Row({ k, v }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
		className: "text-mute",
		children: k
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
		className: "text-paper",
		children: v
	})] });
}
function Latest({ run }) {
	const last = run?.artifacts.at(-1);
	if (!last) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "font-mono text-xs text-ember",
				children: "LAST ARTIFACT"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-1 font-mono text-xs text-mute",
				children: [
					last.id,
					" · ",
					last.port,
					" · ",
					last.status
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
				className: "mt-1 font-mono text-xs whitespace-pre-wrap text-bone",
				children: last.body
			})
		]
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Workbench, {});
}
//#endregion
export { Home as component };
