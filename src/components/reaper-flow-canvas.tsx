import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  Handle,
  Position,
  BackgroundVariant,
  Panel,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Graph, NodeDef, Run } from "@/lib/engine";
import { IMPLS, orderedNodes } from "@/lib/engine";

type Status = "waiting" | "running" | "done" | "failed";

type ReaperNodeData = {
  label: string;
  kind: string;
  summary: string;
  status: Status;
  icon: string;
};

const STATUS_COLORS: Record<Status, string> = {
  waiting: "#6b6b6b",
  running: "#e8a02a",
  done: "#3d9e6a",
  failed: "#d94a4a",
};

const ICONS: Record<string, string> = {
  objective: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z",
  research: "M10 10a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zm4.5 4.5L19 19",
  analysis: "M5 13h2.5v6H5zm5.75-4h2.5v10h-2.5zm5.75-4h2.5v14h-2.5",
  condition: "M5.5 12 10 16.5 18.5 6",
  record: "M7 3h8l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
};

function ReaperNode({ data, selected }: { data: ReaperNodeData; selected: boolean }) {
  return (
    <div
      className={`reaper-node ${selected ? "selected" : ""} ${data.status}`}
      style={{
        width: 168,
        minHeight: 112,
        background: "#0c0c0c",
        border: selected ? "2px solid #e85d2a" : "1.5px solid #2a2a2a",
        borderRadius: 6,
        padding: "10px 12px 10px 16px",
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        color: "#e8e4dc",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 5,
          borderRadius: "6px 0 0 6px",
          background: STATUS_COLORS[data.status],
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          fontSize: 9,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#8a8680",
        }}
      >
        {data.status}
      </div>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        style={{ stroke: "#e85d2a", fill: "none", strokeWidth: 1.6, marginBottom: 4 }}
      >
        <path d={ICONS[data.icon] || ICONS.objective} />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{data.label}</div>
      <div style={{ fontSize: 11, color: "#8a8680", maxWidth: 130, lineHeight: 1.3 }}>
        {data.summary}
      </div>
      <Handle type="target" position={Position.Left} style={{ background: "#e8e4dc", border: "2px solid #0c0c0c" }} />
      <Handle type="source" position={Position.Right} style={{ background: "#e8e4dc", border: "2px solid #0c0c0c" }} />
    </div>
  );
}

const nodeTypes = { reaper: ReaperNode };

type ReaperEdgeData = { hot: boolean; onDelete: (id: string) => void };

// Dim wire by default; ember when hovered or touching the running node.
// Hovering shows a small x at the wire's midpoint that deletes it.
function ReaperEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<ReaperEdgeData>>) {
  const [hover, setHover] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const enter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHover(true);
  };
  // Small delay so moving from the wire onto the x doesn't hide the x.
  const leave = () => {
    leaveTimer.current = setTimeout(() => setHover(false), 120);
  };
  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);
  const lit = hover || !!data?.hot;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: lit ? "#e85d2a" : "#5a5650", strokeWidth: 1.8 }} />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        onMouseEnter={enter}
        onMouseLeave={leave}
      />
      {hover ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan reaper-edge-x"
            aria-label="Delete wire"
            onMouseEnter={enter}
            onMouseLeave={leave}
            onClick={(event) => {
              event.stopPropagation();
              data?.onDelete(id);
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              width: 18,
              height: 18,
              lineHeight: "16px",
              padding: 0,
              borderRadius: 9,
              border: "1px solid #e85d2a",
              background: "#0c0c0c",
              color: "#e85d2a",
              fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = { reaper: ReaperEdge };

// Status of one node in this graph, read from the active run.
// running: the run's stack currently points at this node (including a parent
//          node whose child graph is executing).
// failed:  the run failed while pointing at this node.
// done:    the run produced an artifact for this node in this graph.
// waiting: everything else, including no run at all.
function statusOf(node: NodeDef, graph: Graph, order: NodeDef[] | null, run: Run | null | undefined): Status {
  if (!run) return "waiting";
  const isCurrent =
    !!order && run.stack.some((frame) => frame.graphId === graph.id && order[frame.index]?.id === node.id);
  if (isCurrent) {
    if (run.status === "failed") return "failed";
    if (run.status === "running" || run.status === "paused") return "running";
  }
  const produced = run.artifacts.some((a) => a.graphId === graph.id && a.nodeId === node.id);
  if (produced) return "done";
  return "waiting";
}

function summaryOf(node: NodeDef): string {
  const impl = IMPLS.find((i) => i.id === node.implId);
  return impl?.does?.split(".")[0] || node.name;
}

export function ReaperFlowCanvas({
  graph,
  selectedId,
  hotId,
  run,
  onSelect,
  onMove,
  onConnect,
  onDeleteEdge,
}: {
  graph: Graph;
  selectedId: string | null;
  hotId: string | null;
  run?: Run | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (fromId: string, toId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}) {
  const order = useMemo(() => orderedNodes(graph), [graph]);

  const initialNodes: Node<ReaperNodeData>[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "reaper",
        position: { x: n.x ?? 0, y: n.y ?? 0 },
        data: {
          label: n.name,
          kind: n.kind,
          summary: summaryOf(n),
          status: statusOf(n, graph, order, run),
          icon: n.implId.split(".").pop() || "objective",
        },
        selected: n.id === selectedId,
      })),
    [graph, order, run, selectedId],
  );

  const initialEdges: Edge<ReaperEdgeData>[] = useMemo(
    () =>
      (graph.edges ?? []).map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: "reaper",
        data: { hot: !!hotId && (e.from === hotId || e.to === hotId), onDelete: onDeleteEdge },
        animated: e.to === hotId,
      })),
    [graph.edges, hotId, onDeleteEdge],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  useEffect(() => setEdges(initialEdges), [initialEdges, setEdges]);

  const onConnectCb = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      if (params.source === params.target) return;
      // The graph is the only source of edges: the parent adds the edge to the
      // graph, and the new edge arrives back here through graph.edges.
      onConnect(params.source, params.target);
    },
    [onConnect],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => onMove(node.id, node.position.x, node.position.y),
    [onMove],
  );

  return (
    <div style={{ width: "100%", height: "100%", background: "#050505" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectCb}
        onNodeClick={(_, n) => onSelect(n.id)}
        onNodeDragStop={onNodeDragStop}
        onEdgesDelete={(eds) => eds.forEach((e) => onDeleteEdge(e.id))}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        style={{ background: "transparent" }}
      >
        <Background variant={BackgroundVariant.Lines} gap={40} color="#161616" />
        <Controls />
      </ReactFlow>
      <style>{`
        .reaper-node.selected { outline: none !important; }
        .react-flow__node { transition: none !important; }
        .react-flow__edge-path { stroke: #5a5650; }
        .react-flow__edge.selected .react-flow__edge-path,
        .react-flow__edge.animated .react-flow__edge-path { stroke: #e85d2a; }
        .react-flow__edge.animated { stroke-dasharray: 6 8; animation: pulse 2.4s linear infinite; }
        @keyframes pulse { to { stroke-dashoffset: -28; } }
      `}</style>
    </div>
  );
}