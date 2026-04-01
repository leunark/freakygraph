import { EventType, adaptor, type InputNode, type Link } from 'webcola'
import { type GraphNodeRecord } from '../data/exampleGraph'
import { GraphStore, type GraphStoreSnapshot } from '../store/graphStore'

const NODE_RADIUS = 30
const COLLAPSED_RADIUS = NODE_RADIUS + 16
const COLLISION_PADDING = 14
const DEFAULT_EDGE_SETTINGS = {
  minLength: 20,
  parentOrbitFactor: 0.08,
  childFootprintFactor: 0.04,
  nodeBaseLength: 0,
} as const
const DEFAULT_LAYOUT_SETTINGS = {
  siblingGap: 0,
  branchPadding: 0,
  rootGap: 140,
  subtreeScale: 0.35,
} as const

type LayoutListener = (snapshot: LayoutSnapshot) => void
type FitListener = () => void

export type LayoutSolverMode = 'cola' | 'cola-lite' | 'seed'

interface VisibleNodeState {
  id: string
  node: GraphNodeRecord
  visibleChildren: string[]
  expanded: boolean
  orbitRadius: number
  boxRadius: number
  footprintRadius: number
  initialX: number
  initialY: number
  angle: number
}

interface ColaNode extends InputNode {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface ColaLink extends Link<number> {
  id: string
  length: number
}

interface ColaLayout {
  nodes(nodes: ColaNode[]): this
  links(links: ColaLink[]): this
  avoidOverlaps(value: boolean): this
  handleDisconnected(value: boolean): this
  size(size: [number, number]): this
  convergenceThreshold(value: number): this
  linkDistance(distance: (link: ColaLink) => number): this
  on(eventType: EventType, listener: () => void): this
  start(
    initialUnconstrainedIterations?: number,
    initialUserConstraintIterations?: number,
    initialAllConstraintIterations?: number,
    gridSnapIterations?: number,
    keepRunning?: boolean,
    centerGraph?: boolean,
  ): this
  stop(): this
  tick(): boolean
}

export interface LayoutNode {
  id: string
  label: string
  parentId: string | null
  depth: number
  x: number
  y: number
  visualRadius: number
  boxRadius: number
  footprintRadius: number
  isRoot: boolean
  isLeaf: boolean
  isExpanded: boolean
}

export interface LayoutEdge {
  id: string
  sourceId: string
  targetId: string
}

export interface LayoutBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface LayoutSnapshot {
  version: number
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  visibleCount: number
  totalCount: number
  rootCount: number
  bounds: LayoutBounds
  maxDepth: number
  maxSupportedDepth: number
  solverMode: LayoutSolverMode
  edgeSettings: EdgeLengthSettings
  layoutSettings: LayoutSettings
}

export interface EdgeLengthSettings {
  minLength: number
  parentOrbitFactor: number
  childFootprintFactor: number
  nodeBaseLength: number
}

export interface EdgeLengthSettingBounds {
  minLength: { min: number; max: number; step: number }
  parentOrbitFactor: { min: number; max: number; step: number }
  childFootprintFactor: { min: number; max: number; step: number }
  nodeBaseLength: { min: number; max: number; step: number }
}

export interface LayoutSettings {
  siblingGap: number
  branchPadding: number
  rootGap: number
  subtreeScale: number
}

export interface LayoutSettingBounds {
  siblingGap: { min: number; max: number; step: number }
  branchPadding: { min: number; max: number; step: number }
  rootGap: { min: number; max: number; step: number }
  subtreeScale: { min: number; max: number; step: number }
}

const EDGE_SETTING_BOUNDS: EdgeLengthSettingBounds = {
  minLength: { min: 20, max: 260, step: 5 },
  parentOrbitFactor: { min: 0.08, max: 1.8, step: 0.02 },
  childFootprintFactor: { min: 0.04, max: 1.4, step: 0.02 },
  nodeBaseLength: { min: 0, max: 120, step: 2 },
}

const LAYOUT_SETTING_BOUNDS: LayoutSettingBounds = {
  siblingGap: { min: 0, max: 72, step: 2 },
  branchPadding: { min: 0, max: 80, step: 2 },
  rootGap: { min: 0, max: 140, step: 4 },
  subtreeScale: { min: 0.35, max: 1.1, step: 0.01 },
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step
}

function getVisualRadiusForDepth(depth: number) {
  return Math.max(15, NODE_RADIUS + 8 - depth * 3.5)
}

function getCollisionRadius(state: VisibleNodeState) {
  return Math.max(state.boxRadius, state.footprintRadius + COLLISION_PADDING)
}

export class GraphLayoutEngine {
  private readonly store: GraphStore
  private readonly listeners = new Set<LayoutListener>()
  private readonly fitListeners = new Set<FitListener>()
  private unsubscribeFromStore: (() => void) | null = null
  private activeLayout: { stop: () => void } | null = null
  private lastSnapshot: LayoutSnapshot | null = null
  private runVersion = 0
  private viewportWidth = 1600
  private viewportHeight = 900
  private solverMode: LayoutSolverMode = 'cola'
  private edgeSettings: EdgeLengthSettings = { ...DEFAULT_EDGE_SETTINGS }
  private layoutSettings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS }

  constructor(store: GraphStore) {
    this.store = store
    this.unsubscribeFromStore = this.store.subscribe((snapshot) => {
      this.relayout(snapshot)
    })
  }

  private get graph() {
    return this.store.graph
  }

  subscribe(listener: LayoutListener) {
    this.listeners.add(listener)

    if (this.lastSnapshot) {
      listener(this.lastSnapshot)
    }

    return () => {
      this.listeners.delete(listener)
    }
  }

  onFitRequested(listener: FitListener) {
    this.fitListeners.add(listener)

    return () => {
      this.fitListeners.delete(listener)
    }
  }

  requestFitToScreen() {
    this.fitListeners.forEach((listener) => listener())
  }

  getSnapshot() {
    return this.lastSnapshot
  }

  getSolverMode() {
    return this.solverMode
  }

  updateSolverMode(nextMode: LayoutSolverMode) {
    if (nextMode === this.solverMode) {
      return
    }

    this.solverMode = nextMode
    this.relayout(this.store.getSnapshot())
  }

  getEdgeSettings() {
    return { ...this.edgeSettings }
  }

  getEdgeSettingBounds() {
    return EDGE_SETTING_BOUNDS
  }

  getLayoutSettings() {
    return { ...this.layoutSettings }
  }

  getLayoutSettingBounds() {
    return LAYOUT_SETTING_BOUNDS
  }

  updateEdgeSettings(nextSettings: Partial<EdgeLengthSettings>) {
    const merged: EdgeLengthSettings = {
      minLength: clamp(
        roundToStep(
          nextSettings.minLength ?? this.edgeSettings.minLength,
          EDGE_SETTING_BOUNDS.minLength.step,
        ),
        EDGE_SETTING_BOUNDS.minLength.min,
        EDGE_SETTING_BOUNDS.minLength.max,
      ),
      parentOrbitFactor: clamp(
        roundToStep(
          nextSettings.parentOrbitFactor ?? this.edgeSettings.parentOrbitFactor,
          EDGE_SETTING_BOUNDS.parentOrbitFactor.step,
        ),
        EDGE_SETTING_BOUNDS.parentOrbitFactor.min,
        EDGE_SETTING_BOUNDS.parentOrbitFactor.max,
      ),
      childFootprintFactor: clamp(
        roundToStep(
          nextSettings.childFootprintFactor ?? this.edgeSettings.childFootprintFactor,
          EDGE_SETTING_BOUNDS.childFootprintFactor.step,
        ),
        EDGE_SETTING_BOUNDS.childFootprintFactor.min,
        EDGE_SETTING_BOUNDS.childFootprintFactor.max,
      ),
      nodeBaseLength: clamp(
        roundToStep(
          nextSettings.nodeBaseLength ?? this.edgeSettings.nodeBaseLength,
          EDGE_SETTING_BOUNDS.nodeBaseLength.step,
        ),
        EDGE_SETTING_BOUNDS.nodeBaseLength.min,
        EDGE_SETTING_BOUNDS.nodeBaseLength.max,
      ),
    }

    const changed =
      merged.minLength !== this.edgeSettings.minLength ||
      merged.parentOrbitFactor !== this.edgeSettings.parentOrbitFactor ||
      merged.childFootprintFactor !== this.edgeSettings.childFootprintFactor ||
      merged.nodeBaseLength !== this.edgeSettings.nodeBaseLength

    if (!changed) {
      return
    }

    this.edgeSettings = merged
    this.relayout(this.store.getSnapshot())
  }

  updateLayoutSettings(nextSettings: Partial<LayoutSettings>) {
    const merged: LayoutSettings = {
      siblingGap: clamp(
        roundToStep(
          nextSettings.siblingGap ?? this.layoutSettings.siblingGap,
          LAYOUT_SETTING_BOUNDS.siblingGap.step,
        ),
        LAYOUT_SETTING_BOUNDS.siblingGap.min,
        LAYOUT_SETTING_BOUNDS.siblingGap.max,
      ),
      branchPadding: clamp(
        roundToStep(
          nextSettings.branchPadding ?? this.layoutSettings.branchPadding,
          LAYOUT_SETTING_BOUNDS.branchPadding.step,
        ),
        LAYOUT_SETTING_BOUNDS.branchPadding.min,
        LAYOUT_SETTING_BOUNDS.branchPadding.max,
      ),
      rootGap: clamp(
        roundToStep(
          nextSettings.rootGap ?? this.layoutSettings.rootGap,
          LAYOUT_SETTING_BOUNDS.rootGap.step,
        ),
        LAYOUT_SETTING_BOUNDS.rootGap.min,
        LAYOUT_SETTING_BOUNDS.rootGap.max,
      ),
      subtreeScale: clamp(
        roundToStep(
          nextSettings.subtreeScale ?? this.layoutSettings.subtreeScale,
          LAYOUT_SETTING_BOUNDS.subtreeScale.step,
        ),
        LAYOUT_SETTING_BOUNDS.subtreeScale.min,
        LAYOUT_SETTING_BOUNDS.subtreeScale.max,
      ),
    }

    const changed =
      merged.siblingGap !== this.layoutSettings.siblingGap ||
      merged.branchPadding !== this.layoutSettings.branchPadding ||
      merged.rootGap !== this.layoutSettings.rootGap ||
      merged.subtreeScale !== this.layoutSettings.subtreeScale

    if (!changed) {
      return
    }

    this.layoutSettings = merged
    this.relayout(this.store.getSnapshot())
  }

  setViewportSize(width: number, height: number) {
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
  }

  destroy() {
    this.activeLayout?.stop()
    this.activeLayout = null
    this.unsubscribeFromStore?.()
    this.unsubscribeFromStore = null
    this.listeners.clear()
    this.fitListeners.clear()
  }

  private relayout(storeSnapshot: GraphStoreSnapshot) {
    this.runVersion += 1
    const layoutVersion = this.runVersion

    this.activeLayout?.stop()
    this.activeLayout = null

    const visibleStates = this.buildVisibleState(storeSnapshot)
    const visibleIds = Array.from(visibleStates.keys())
    const edges = this.buildEdges(visibleStates)

    if (visibleIds.length === 0) {
      return
    }

    const rootIds = this.graph.roots.filter((rootId) => visibleStates.has(rootId))
    this.placeRoots(rootIds, visibleStates)

    const colaNodes = visibleIds.map((id, index) => {
      const state = visibleStates.get(id)!
      const collisionRadius = getCollisionRadius(state)

      return {
        id,
        index,
        x: state.initialX,
        y: state.initialY,
        width: collisionRadius * 2,
        height: collisionRadius * 2,
      } satisfies ColaNode
    })

    const nodeIndexById = new Map(colaNodes.map((node) => [node.id, node.index!] as const))
    const colaLinks = edges.map((edge) => {
      const parentState = visibleStates.get(edge.sourceId)!
      const childState = visibleStates.get(edge.targetId)!

      return {
        id: edge.id,
        source: nodeIndexById.get(edge.sourceId)!,
        target: nodeIndexById.get(edge.targetId)!,
        length: Math.max(
          this.edgeSettings.minLength,
          parentState.orbitRadius * this.edgeSettings.parentOrbitFactor +
            (childState.boxRadius * 0.6 + childState.footprintRadius * 0.4) *
              this.edgeSettings.childFootprintFactor +
            this.edgeSettings.nodeBaseLength,
        ),
      } satisfies ColaLink
    })

    const denseLayout = this.solverMode === 'cola-lite'
    const seedOnlyLayout = this.solverMode === 'seed'

    if (colaNodes.length === 1 || seedOnlyLayout) {
      this.publishSnapshot(layoutVersion, colaNodes, visibleStates, edges, storeSnapshot)
      return
    }

    let frameId = 0
    let tickPublishCount = 0

    const layout = adaptor({
      kick: () => {
        const advance = () => {
          if (layoutVersion !== this.runVersion) {
            return
          }

          const done = layout.tick()

          if (!done) {
            frameId = window.requestAnimationFrame(advance)
          }
        }

        frameId = window.requestAnimationFrame(advance)
      },
    }) as unknown as ColaLayout

    const publish = () => {
      if (layoutVersion !== this.runVersion) {
        return
      }

      this.publishSnapshot(layoutVersion, colaNodes, visibleStates, edges, storeSnapshot)
    }

    layout.on(EventType.tick, () => {
      if (!denseLayout) {
        publish()
        return
      }

      tickPublishCount += 1

      if (tickPublishCount % 3 === 0) {
        publish()
      }
    })
    layout.on(EventType.end, publish)
    layout
      .nodes(colaNodes)
      .links(colaLinks)
      .avoidOverlaps(true)
      .handleDisconnected(true)
      .size([
        Math.max(this.viewportWidth * 1.6, this.estimateCanvasWidth(visibleStates)),
        Math.max(this.viewportHeight * 1.6, this.estimateCanvasHeight(visibleStates)),
      ])
      .convergenceThreshold(denseLayout ? 0.34 : 0.14)
      .linkDistance((link) => link.length)
      .start(
        denseLayout ? 10 : 24,
        denseLayout ? 8 : 20,
        denseLayout ? 12 : 28,
        0,
        true,
        false,
      )

    publish()

    this.activeLayout = {
      stop: () => {
        window.cancelAnimationFrame(frameId)
        layout.stop()
      },
    }
  }

  private buildVisibleState(storeSnapshot: GraphStoreSnapshot) {
    const visibleStates = new Map<string, VisibleNodeState>()

    const visit = (nodeId: string) => {
      const node = this.graph.nodes[nodeId]
      const canShowChildren =
        node.children.length > 0 &&
        storeSnapshot.expanded.has(nodeId) &&
        node.depth + 2 <= storeSnapshot.maxDepth
      const visibleChildren = canShowChildren ? [...node.children] : []

      const state: VisibleNodeState = {
        id: nodeId,
        node,
        visibleChildren,
        expanded: visibleChildren.length > 0,
        orbitRadius: 0,
        boxRadius: COLLAPSED_RADIUS,
        footprintRadius: COLLAPSED_RADIUS,
        initialX: 0,
        initialY: 0,
        angle: Math.PI / 2,
      }

      visibleStates.set(nodeId, state)
      visibleChildren.forEach(visit)

      if (visibleChildren.length === 0) {
        return
      }

      const childStates = visibleChildren.map((childId) => visibleStates.get(childId)!)
      const spread = this.getChildSpread(visibleChildren.length)
      const scaledChildRadii = childStates.map((child) =>
        Math.max(COLLAPSED_RADIUS, child.footprintRadius * this.layoutSettings.subtreeScale),
      )
      const maxChildRadius = Math.max(...scaledChildRadii)
      const arcDemand = childStates.reduce(
        (sum, child) =>
          sum +
          Math.max(COLLAPSED_RADIUS, child.footprintRadius * this.layoutSettings.subtreeScale) *
            1.35 +
          this.layoutSettings.siblingGap,
        0,
      )
      const orbitRadius = Math.max(
        NODE_RADIUS + maxChildRadius * 0.74 + this.layoutSettings.branchPadding,
        arcDemand / Math.max(spread, Math.PI * 0.82),
      )

      state.orbitRadius = orbitRadius
      state.boxRadius = Math.max(
        COLLAPSED_RADIUS,
        orbitRadius * 0.2 + maxChildRadius * 0.42,
        NODE_RADIUS + 18,
      )
      state.footprintRadius = Math.max(
        state.boxRadius,
        orbitRadius + maxChildRadius * 0.72 + this.layoutSettings.branchPadding * 0.5,
      )
    }

    this.graph.roots.forEach(visit)

    return visibleStates
  }

  private buildEdges(visibleStates: Map<string, VisibleNodeState>): LayoutEdge[] {
    const edges: LayoutEdge[] = []

    visibleStates.forEach((state) => {
      state.visibleChildren.forEach((childId) => {
        edges.push({
          id: `${state.id}->${childId}`,
          sourceId: state.id,
          targetId: childId,
        })
      })
    })

    return edges
  }

  private placeRoots(rootIds: string[], visibleStates: Map<string, VisibleNodeState>) {
    const maxRootFootprint = Math.max(
      ...rootIds.map((rootId) => visibleStates.get(rootId)!.footprintRadius),
    )
    const columns = Math.max(1, Math.ceil(Math.sqrt(rootIds.length)))
    const rows = Math.max(1, Math.ceil(rootIds.length / columns))
    const cellWidth = maxRootFootprint * 2 + this.layoutSettings.rootGap
    const cellHeight = maxRootFootprint * 2 + this.layoutSettings.rootGap

    rootIds.forEach((rootId, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const rootX = (column - (columns - 1) / 2) * cellWidth
      const rootY = (row - (rows - 1) / 2) * cellHeight
      const rootAngle =
        rootX === 0 && rootY === 0
          ? -Math.PI / 2
          : Math.atan2(rootY, rootX)

      this.placeSubtree(rootId, rootX, rootY, rootAngle, visibleStates)
    })
  }

  private placeSubtree(
    nodeId: string,
    x: number,
    y: number,
    angle: number,
    visibleStates: Map<string, VisibleNodeState>,
  ) {
    const state = visibleStates.get(nodeId)!

    state.initialX = x
    state.initialY = y
    state.angle = angle

    const childCount = state.visibleChildren.length

    if (childCount === 0) {
      return
    }

    const spread = this.getChildSpread(childCount)

    state.visibleChildren.forEach((childId, index) => {
      const childAngle =
        childCount === 1
          ? angle
          : angle - spread / 2 + (spread * index) / (childCount - 1)
      const childX = x + Math.cos(childAngle) * state.orbitRadius
      const childY = y + Math.sin(childAngle) * state.orbitRadius

      this.placeSubtree(childId, childX, childY, childAngle, visibleStates)
    })
  }

  private getChildSpread(childCount: number) {
    if (childCount <= 1) {
      return 0
    }

    return Math.min(Math.PI * 1.18, Math.PI * 0.58 + childCount * 0.18)
  }

  private estimateCanvasWidth(visibleStates: Map<string, VisibleNodeState>) {
    const roots = this.graph.roots
      .filter((rootId) => visibleStates.has(rootId))
      .map((rootId) => visibleStates.get(rootId)!.footprintRadius * 2)

    return (
      roots.reduce((sum, width) => sum + width, 0) +
      Math.max(0, roots.length - 1) * this.layoutSettings.rootGap +
      600
    )
  }

  private estimateCanvasHeight(visibleStates: Map<string, VisibleNodeState>) {
    const height = Math.max(
      900,
      ...Array.from(visibleStates.values(), (state) => state.footprintRadius * 2.7),
    )

    return height + 400
  }

  private publishSnapshot(
    version: number,
    colaNodes: ColaNode[],
    visibleStates: Map<string, VisibleNodeState>,
    edges: LayoutEdge[],
    storeSnapshot: GraphStoreSnapshot,
  ) {
    const nodes: LayoutNode[] = colaNodes.map((colaNode) => {
      const state = visibleStates.get(colaNode.id)!
      const node = state.node

      return {
        id: colaNode.id,
        label: node.label,
        parentId: node.parentId,
        depth: node.depth,
        x: colaNode.x,
        y: colaNode.y,
        visualRadius: getVisualRadiusForDepth(node.depth),
        boxRadius: state.boxRadius,
        footprintRadius: state.footprintRadius,
        isRoot: node.parentId === null,
        isLeaf: node.children.length === 0,
        isExpanded: state.expanded,
      }
    })

    const bounds = nodes.reduce<LayoutBounds>(
      (acc, node) => {
        acc.minX = Math.min(acc.minX, node.x - node.footprintRadius)
        acc.minY = Math.min(acc.minY, node.y - node.footprintRadius)
        acc.maxX = Math.max(acc.maxX, node.x + node.footprintRadius)
        acc.maxY = Math.max(acc.maxY, node.y + node.footprintRadius)
        return acc
      },
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        width: 0,
        height: 0,
      },
    )

    bounds.width = bounds.maxX - bounds.minX
    bounds.height = bounds.maxY - bounds.minY

    this.lastSnapshot = {
      version,
      nodes,
      edges,
      visibleCount: nodes.length,
      totalCount: this.graph.totalNodes,
      rootCount: this.graph.roots.length,
      bounds,
      maxDepth: storeSnapshot.maxDepth,
      maxSupportedDepth: this.graph.maxDepth,
      solverMode: this.solverMode,
      edgeSettings: { ...this.edgeSettings },
      layoutSettings: { ...this.layoutSettings },
    }

    this.listeners.forEach((listener) => listener(this.lastSnapshot!))
  }
}

export function createLayoutEngine(
  store: GraphStore,
) {
  return new GraphLayoutEngine(store)
}
