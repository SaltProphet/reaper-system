import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { removeEdge } from "./canvas-edges.ts";
import type { Persisted } from "./engine.ts";

function stateWith(edges: { id: string; from: string; to: string }[]): Persisted {
  return { graphs: [{ id: "g", nodes: [], edges }] } as unknown as Persisted;
}

describe("removeEdge", () => {
  it("removes only the named wire", () => {
    const next = removeEdge(stateWith([{ id: "a>b", from: "a", to: "b" }, { id: "b>c", from: "b", to: "c" }]), "g", "a>b");
    assert.deepEqual(next.graphs[0].edges?.map((e) => e.id), ["b>c"]);
  });
  it("leaves state unchanged for an unknown wire", () => {
    const state = stateWith([{ id: "a>b", from: "a", to: "b" }]);
    assert.equal(removeEdge(state, "g", "nope"), state);
  });
});
