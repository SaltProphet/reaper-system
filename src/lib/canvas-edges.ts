import type { Persisted } from "./engine.ts";

// Remove one wire from one graph. Unknown graph or edge ids leave state unchanged.
export function removeEdge(state: Persisted, graphId: string, edgeId: string): Persisted {
  const graph = state.graphs.find((item) => item.id === graphId);
  if (!graph?.edges?.some((edge) => edge.id === edgeId)) return state;
  return {
    ...state,
    graphs: state.graphs.map((item) =>
      item.id === graphId ? { ...item, edges: (item.edges ?? []).filter((edge) => edge.id !== edgeId) } : item,
    ),
  };
}