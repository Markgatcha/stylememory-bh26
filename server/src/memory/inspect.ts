/**
 * Memory inspector (M4) — read-only views over everything in the store.
 *
 * Three views:
 *   inspectAll()          — every active memory, tagged and grouped
 *   inspectHistory(id)    — version chain for a superseded record, walked
 *                           via `temporal_precedes` edges
 *   inspectGraph()        — nodes + edges, for the relationship view
 */
import { getMemOS, NAMESPACE } from "./memos.js";

export interface InspectedMemory {
  id: string;
  memosNodeId: string;
  kind: string;
  content: string;
  summary: string;
  tags: string[];
  importance: number;
  trustScore: number;
  source: string;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  /** True when this version has been superseded by a newer one. */
  superseded: boolean;
}

/** Everything currently active in the store, newest first. */
export async function inspectAll(): Promise<InspectedMemory[]> {
  const memos = await getMemOS();
  const results = await memos.search({
    namespace: NAMESPACE,
    limit: 200,
    sortBy: "updatedAt",
    sortOrder: "desc",
  });

  return results.map((sm) => ({
    id: (sm.node.metadata.appId as string) ?? sm.node.id,
    memosNodeId: sm.node.id,
    kind: (sm.node.metadata.kind as string) ?? inferKind(sm.node.tags),
    content: sm.node.content,
    summary: sm.node.summary,
    tags: sm.node.tags,
    importance: sm.node.importance,
    trustScore: sm.node.trustScore,
    source: sm.node.source,
    createdAt: sm.node.createdAt,
    updatedAt: sm.node.updatedAt,
    accessCount: sm.node.accessCount,
    superseded: sm.node.validTo !== null,
  }));
}

/**
 * Full version chain for a record, oldest → newest.
 *
 * `supersede()` sets `validTo` on the old node and links old→new with a
 * `temporal_precedes` edge. To rebuild the chain we pull historical
 * (superseded) nodes sharing the record's appId and sort by creation time.
 */
export async function inspectHistory(appId: string): Promise<InspectedMemory[]> {
  const memos = await getMemOS();

  // includeHistorical: true is required — superseded nodes are excluded from
  // the default search, so a normal search would only ever return version 1.
  const all = await memos.search({
    namespace: NAMESPACE,
    limit: 500,
    includeHistorical: true,
    sortBy: "createdAt",
    sortOrder: "asc",
  });

  // Match on appId metadata; fall back to the name tag so records created
  // before appId tracking still resolve.
  const chain = all.filter((sm) => {
    const metaId = sm.node.metadata.appId as string | undefined;
    if (metaId) return metaId === appId;
    const nameTag = sm.node.tags.find((t) => t.startsWith("character:") || t.startsWith("style:"));
    return nameTag !== undefined && nameTag.includes(appId.toLowerCase());
  });

  return chain.map((sm) => ({
    id: (sm.node.metadata.appId as string) ?? sm.node.id,
    memosNodeId: sm.node.id,
    kind: (sm.node.metadata.kind as string) ?? inferKind(sm.node.tags),
    content: sm.node.content,
    summary: sm.node.summary,
    tags: sm.node.tags,
    importance: sm.node.importance,
    trustScore: sm.node.trustScore,
    source: sm.node.source,
    createdAt: sm.node.createdAt,
    updatedAt: sm.node.updatedAt,
    accessCount: sm.node.accessCount,
    superseded: sm.node.validTo !== null,
  }));
}

export interface GraphView {
  nodes: Array<{ id: string; label: string; kind: string }>;
  edges: Array<{ source: string; target: string; relation: string }>;
}

/** Nodes and edges for the relationship view. */
export async function inspectGraph(): Promise<GraphView> {
  const memos = await getMemOS();
  const snapshot = await memos.getGraph();

  const nodes = snapshot.nodes.map((n) => ({
    id: n.id,
    label: (n.metadata.name as string) ?? n.content.slice(0, 40),
    kind: (n.metadata.kind as string) ?? inferKind(n.tags),
  }));

  const edges = snapshot.edges.map((e) => ({
    source: e.sourceId,
    target: e.targetId,
    relation: e.relation,
  }));

  return { nodes, edges };
}

function inferKind(tags: string[]): string {
  if (tags.includes("character")) return "character";
  if (tags.includes("style")) return "style";
  if (tags.includes("avoid")) return "avoid";
  if (tags.includes("prefer")) return "prefer";
  return "unknown";
}
