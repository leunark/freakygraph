import { exampleGraph, type GraphDataset } from '../data/exampleGraph'

export const DEFAULT_DEPTH_CONTROL_MAX = 12

export interface GraphStoreSnapshot {
  expanded: ReadonlySet<string>
  maxDepth: number
}

export type GraphResetExpansion = 'collapsed' | 'roots' | 'all'

type GraphStoreListener = (snapshot: GraphStoreSnapshot) => void

export function getDepthControlMax(graph: GraphDataset) {
  return Math.max(DEFAULT_DEPTH_CONTROL_MAX, graph.maxDepth)
}

function getExpandableNodeIds(graph: GraphDataset) {
  return Object.values(graph.nodes)
    .filter((node) => node.children.length > 0)
    .map((node) => node.id)
}

export class GraphStore {
  graph: GraphDataset

  private expanded = new Set<string>()
  private listeners = new Set<GraphStoreListener>()
  private maxDepth: number

  constructor(graph: GraphDataset = exampleGraph) {
    this.graph = graph
    this.maxDepth = graph.maxDepth
  }

  getSnapshot(): GraphStoreSnapshot {
    return {
      expanded: new Set(this.expanded),
      maxDepth: this.maxDepth,
    }
  }

  subscribe(listener: GraphStoreListener) {
    this.listeners.add(listener)
    listener(this.getSnapshot())

    return () => {
      this.listeners.delete(listener)
    }
  }

  toggle(nodeId: string) {
    const node = this.graph.nodes[nodeId]

    if (!node || node.children.length === 0) {
      return
    }

    if (this.expanded.has(nodeId)) {
      this.expanded.delete(nodeId)
    } else {
      this.expanded.add(nodeId)
    }

    this.emit()
  }

  expandAll() {
    this.expanded = new Set(getExpandableNodeIds(this.graph))
    this.maxDepth = getDepthControlMax(this.graph)
    this.emit()
  }

  collapseAll() {
    this.expanded.clear()
    this.emit()
  }

  setGraph(graph: GraphDataset, expansion: GraphResetExpansion = 'collapsed') {
    if (graph === this.graph) {
      return
    }

    this.graph = graph
    this.expanded.clear()

    if (expansion === 'all') {
      this.expanded = new Set(getExpandableNodeIds(this.graph))
    } else if (expansion === 'roots') {
      this.expanded = new Set(
        this.graph.roots.filter((rootId) => {
          const node = this.graph.nodes[rootId]
          return Boolean(node && node.children.length > 0)
        }),
      )
    }

    this.maxDepth = graph.maxDepth
    this.emit()
  }

  setMaxDepth(nextDepth: number) {
    const clamped = Math.min(
      getDepthControlMax(this.graph),
      Math.max(1, Math.round(nextDepth)),
    )

    if (clamped === this.maxDepth) {
      return
    }

    this.maxDepth = clamped
    this.emit()
  }

  isExpanded(nodeId: string) {
    return this.expanded.has(nodeId)
  }

  private emit() {
    const snapshot = this.getSnapshot()
    this.listeners.forEach((listener) => listener(snapshot))
  }
}

export function createGraphStore(graph: GraphDataset = exampleGraph) {
  return new GraphStore(graph)
}
