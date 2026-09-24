/**
 * Dependency graph over binding paths.
 *
 * Every bindable property becomes a node keyed `Entity.property`. Edges run from a
 * node to the nodes it reads. Evaluation walks a topological order so a property is
 * always computed after everything it depends on.
 *
 * The incremental path matters more than the full one: when a single property
 * changes, only its dependents are recomputed. Re-evaluating the whole tree on every
 * keystroke is what makes low-code editors crawl once a page passes ~100 widgets.
 */

export interface GraphNode {
  path: string;
  dependencies: string[];
}

export interface SortedGraph {
  /** Evaluation order. Nodes in a cycle are excluded. */
  order: string[];
  /** path -> paths that read it. */
  dependents: Map<string, string[]>;
  /** Paths participating in a dependency cycle. */
  cycles: string[][];
}

export function buildGraph(nodes: GraphNode[]): SortedGraph {
  const dependencies = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();

  for (const node of nodes) {
    dependencies.set(node.path, node.dependencies);
    if (!dependents.has(node.path)) dependents.set(node.path, []);
  }

  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      // A binding may read a path that is plain data rather than another binding
      // (a query result, say). Those are graph nodes too, just without dependencies.
      if (!dependents.has(dependency)) dependents.set(dependency, []);
      dependents.get(dependency)!.push(node.path);
    }
  }

  const { order, cycles } = topologicalSort(dependencies, dependents);
  return { order, dependents, cycles };
}

/**
 * Kahn's algorithm. Whatever remains unvisited when the queue empties is exactly the
 * set of nodes inside or downstream of a cycle; those are reported rather than
 * evaluated, so a self-referential binding produces an editor error instead of a
 * stack overflow.
 */
function topologicalSort(
  dependencies: Map<string, string[]>,
  dependents: Map<string, string[]>,
): { order: string[]; cycles: string[][] } {
  const inDegree = new Map<string, number>();
  for (const path of dependents.keys()) inDegree.set(path, 0);
  for (const [path, deps] of dependencies) {
    inDegree.set(path, deps.filter((d) => dependents.has(d)).length);
  }

  const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([p]) => p);
  const order: string[] = [];

  while (queue.length > 0) {
    const path = queue.shift()!;
    order.push(path);
    for (const dependent of dependents.get(path) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  const unresolved = [...inDegree.keys()].filter((path) => !order.includes(path));
  return { order, cycles: unresolved.length > 0 ? findCycles(unresolved, dependencies) : [] };
}

/** Groups the unresolved nodes into the individual cycles they form, for error text. */
function findCycles(unresolved: string[], dependencies: Map<string, string[]>): string[][] {
  const remaining = new Set(unresolved);
  const cycles: string[][] = [];

  while (remaining.size > 0) {
    const start = remaining.values().next().value as string;
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: string | undefined = start;

    while (current && remaining.has(current) && !onPath.has(current)) {
      path.push(current);
      onPath.add(current);
      current = (dependencies.get(current) ?? []).find((d) => remaining.has(d));
    }

    const closeIndex = current ? path.indexOf(current) : -1;
    cycles.push(closeIndex >= 0 ? path.slice(closeIndex) : path);
    for (const node of path) remaining.delete(node);
  }

  return cycles;
}

/**
 * Everything that must be recomputed when `changed` changes: the paths themselves
 * plus their transitive dependents, returned in evaluation order.
 */
export function affectedSubgraph(graph: SortedGraph, changed: string[]): string[] {
  const affected = new Set<string>(changed);
  const queue = [...changed];

  while (queue.length > 0) {
    const path = queue.shift()!;
    for (const dependent of graph.dependents.get(path) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return graph.order.filter((path) => affected.has(path));
}
