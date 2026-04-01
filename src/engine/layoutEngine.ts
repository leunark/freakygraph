import { type GraphNodeRecord } from '../data/exampleGraph'
import { GraphStore, type GraphStoreSnapshot } from '../store/graphStore'

const NODE_RADIUS = 30
const COLLAPSED_RADIUS = NODE_RADIUS + 16
const COLLISION_PADDING = 14
const SUBTREE_ORBIT_INFLUENCE = 0.38
const DEFAULT_LAYOUT_SETTINGS = {
  siblingGap: 0,
  branchPadding: 0,
  rootGap: 140,
  subtreeScale: 0.35,
} as const

type LayoutListener = (snapshot: LayoutSnapshot) => void
type FitListener = () => void

interface LayoutSettings {
  siblingGap: number
  branchPadding: number
  rootGap: number
  subtreeScale: number
}

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
}

interface PositionedNode {
  id: string
  x: number
  y: number
}

interface ChildOrbitLayout {
  orbitRadius: number
  slotArcWidths: number[]
  gapArc: number
  maxChildInfluenceRadius: number
  maxChildFootprintRadius: number
}

interface FamilyLayout {
  rootId: string
  nodes: PositionedNode[]
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
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getVisualRadiusForDepth(depth: number) {
  return Math.max(15, NODE_RADIUS + 8 - depth * 3.5)
}

function getOrbitInfluenceRadius(state: VisibleNodeState, subtreeScale: number) {
  const scaledFootprint = Math.max(COLLAPSED_RADIUS, state.footprintRadius * subtreeScale)
  const subtreeExtra = Math.max(0, scaledFootprint - state.boxRadius)

  return state.boxRadius + subtreeExtra * SUBTREE_ORBIT_INFLUENCE
}

function createEmptyBounds(): LayoutBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    width: 0,
    height: 0,
  }
}

export class GraphLayoutEngine {
  private readonly store: GraphStore
  private readonly listeners = new Set<LayoutListener>()
  private readonly fitListeners = new Set<FitListener>()
  private unsubscribeFromStore: (() => void) | null = null
  private lastSnapshot: LayoutSnapshot | null = null
  private version = 0
  private viewportWidth = 1600
  private viewportHeight = 900
  private readonly layoutSettings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS }

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

  setViewportSize(width: number, height: number) {
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
  }

  refreshLayout() {
    this.relayout(this.store.getSnapshot())
  }

  destroy() {
    this.unsubscribeFromStore?.()
    this.unsubscribeFromStore = null
    this.listeners.clear()
    this.fitListeners.clear()
  }

  private relayout(storeSnapshot: GraphStoreSnapshot) {
    const visibleStates = this.buildVisibleState(storeSnapshot)

    if (visibleStates.size === 0) {
      return
    }

    const edges = this.buildEdges(visibleStates)
    const families = this.graph.roots
      .filter((rootId) => visibleStates.has(rootId))
      .map((rootId) => this.buildFamilyLayout(rootId, visibleStates))

    this.version += 1
    this.publishPackedSnapshot(
      this.version,
      families,
      visibleStates,
      edges,
      storeSnapshot,
    )
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
      }

      visibleStates.set(nodeId, state)
      visibleChildren.forEach(visit)

      if (visibleChildren.length === 0) {
        return
      }

      const childStates = visibleChildren.map((childId) => visibleStates.get(childId)!)
      const orbitLayout = this.getChildOrbitLayout(childStates)

      state.orbitRadius = orbitLayout.orbitRadius
      state.boxRadius = Math.max(
        COLLAPSED_RADIUS,
        NODE_RADIUS + 18,
        NODE_RADIUS + orbitLayout.maxChildInfluenceRadius * 0.14,
      )
      state.footprintRadius = Math.max(
        state.boxRadius,
        orbitLayout.orbitRadius +
          orbitLayout.maxChildFootprintRadius +
          this.layoutSettings.branchPadding * 0.25,
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

  private buildFamilyLayout(
    rootId: string,
    visibleStates: Map<string, VisibleNodeState>,
  ): FamilyLayout {
    this.placeSubtree(rootId, 0, 0, -Math.PI / 2, visibleStates)

    const nodes: PositionedNode[] = []

    const visit = (nodeId: string) => {
      const state = visibleStates.get(nodeId)!

      nodes.push({
        id: nodeId,
        x: state.initialX,
        y: state.initialY,
      })

      state.visibleChildren.forEach(visit)
    }

    visit(rootId)

    return {
      rootId,
      nodes,
    }
  }

  private getChildOrbitLayout(
    childStates: VisibleNodeState[],
    orbitRadiusOverride?: number,
  ): ChildOrbitLayout {
    const childCount = childStates.length

    if (childCount === 0) {
      return {
        orbitRadius: 0,
        slotArcWidths: [],
        gapArc: 0,
        maxChildInfluenceRadius: 0,
        maxChildFootprintRadius: 0,
      }
    }

    const childInfluenceRadii = childStates.map((child) =>
      getOrbitInfluenceRadius(child, this.layoutSettings.subtreeScale),
    )
    const maxChildInfluenceRadius = Math.max(...childInfluenceRadii)
    const maxChildFootprintRadius = Math.max(
      ...childStates.map((child) => child.footprintRadius),
    )
    const slotArcWidths = childStates.map((child) =>
      Math.max(
        COLLAPSED_RADIUS * 1.7,
        child.footprintRadius * 2 + this.layoutSettings.branchPadding * 0.5,
      ),
    )
    const minOrbitRadius =
      NODE_RADIUS +
      maxChildFootprintRadius +
      this.layoutSettings.branchPadding +
      10

    if (childCount === 1) {
      return {
        orbitRadius: Math.max(minOrbitRadius, orbitRadiusOverride ?? 0),
        slotArcWidths,
        gapArc: 0,
        maxChildInfluenceRadius,
        maxChildFootprintRadius,
      }
    }

    const baseGapArc =
      this.layoutSettings.siblingGap +
      this.layoutSettings.branchPadding * 0.4 +
      NODE_RADIUS * 0.5
    const occupiedArc =
      slotArcWidths.reduce((sum, slotArcWidth) => sum + slotArcWidth, 0) +
      baseGapArc * childCount
    const orbitRadius = Math.max(
      minOrbitRadius,
      orbitRadiusOverride ?? 0,
      occupiedArc / (Math.PI * 2),
    )
    const availableArc = orbitRadius * Math.PI * 2
    const extraArc = Math.max(0, availableArc - occupiedArc)
    const sharedExtraGapArc = extraArc / childCount

    return {
      orbitRadius,
      slotArcWidths,
      gapArc: baseGapArc + sharedExtraGapArc,
      maxChildInfluenceRadius,
      maxChildFootprintRadius,
    }
  }

  private placeSubtree(
    nodeId: string,
    x: number,
    y: number,
    parentAngle: number,
    visibleStates: Map<string, VisibleNodeState>,
  ) {
    const state = visibleStates.get(nodeId)!

    state.initialX = x
    state.initialY = y

    const childCount = state.visibleChildren.length

    if (childCount === 0) {
      return
    }

    const childStates = state.visibleChildren.map((childId) => visibleStates.get(childId)!)
    const orbitLayout = this.getChildOrbitLayout(childStates, state.orbitRadius)

    if (childCount === 1) {
      const childId = state.visibleChildren[0]
      const childX = x + Math.cos(parentAngle) * orbitLayout.orbitRadius
      const childY = y + Math.sin(parentAngle) * orbitLayout.orbitRadius

      this.placeSubtree(childId, childX, childY, parentAngle, visibleStates)
      return
    }

    const wrapGapDirection = state.node.parentId === null ? -Math.PI / 2 : parentAngle + Math.PI
    let cursorAngle = wrapGapDirection + orbitLayout.gapArc / orbitLayout.orbitRadius / 2

    state.visibleChildren.forEach((childId, index) => {
      cursorAngle += orbitLayout.slotArcWidths[index] / orbitLayout.orbitRadius / 2

      const childAngle = cursorAngle
      const childX = x + Math.cos(childAngle) * orbitLayout.orbitRadius
      const childY = y + Math.sin(childAngle) * orbitLayout.orbitRadius

      this.placeSubtree(childId, childX, childY, childAngle, visibleStates)

      cursorAngle += orbitLayout.slotArcWidths[index] / orbitLayout.orbitRadius / 2
      cursorAngle += orbitLayout.gapArc / orbitLayout.orbitRadius
    })
  }

  private measureBounds(
    nodes: PositionedNode[],
    visibleStates: Map<string, VisibleNodeState>,
  ) {
    const bounds = nodes.reduce<LayoutBounds>((acc, node) => {
      const state = visibleStates.get(node.id)!

      acc.minX = Math.min(acc.minX, node.x - state.footprintRadius)
      acc.minY = Math.min(acc.minY, node.y - state.footprintRadius)
      acc.maxX = Math.max(acc.maxX, node.x + state.footprintRadius)
      acc.maxY = Math.max(acc.maxY, node.y + state.footprintRadius)

      return acc
    }, createEmptyBounds())

    bounds.width = bounds.maxX - bounds.minX
    bounds.height = bounds.maxY - bounds.minY

    return bounds
  }

  private packFamilies(
    families: FamilyLayout[],
    visibleStates: Map<string, VisibleNodeState>,
  ) {
    const gap = this.layoutSettings.rootGap + COLLISION_PADDING * 2
    const familyMetrics = families.map((family) => ({
      family,
      bounds: this.measureBounds(family.nodes, visibleStates),
    }))

    const totalArea = familyMetrics.reduce(
      (sum, metric) => sum + metric.bounds.width * metric.bounds.height,
      0,
    )
    const aspectRatio = clamp(this.viewportWidth / Math.max(1, this.viewportHeight), 0.72, 1.9)
    const targetRowWidth = Math.max(
      ...familyMetrics.map((metric) => metric.bounds.width),
      Math.sqrt(Math.max(totalArea, 1) * aspectRatio),
    )
    const rows: Array<{
      metrics: typeof familyMetrics
      width: number
      height: number
    }> = []
    let currentRow: typeof familyMetrics = []
    let currentRowWidth = 0
    let currentRowHeight = 0

    const flushRow = () => {
      if (currentRow.length === 0) {
        return
      }

      rows.push({
        metrics: currentRow,
        width: currentRowWidth,
        height: currentRowHeight,
      })
      currentRow = []
      currentRowWidth = 0
      currentRowHeight = 0
    }

    familyMetrics.forEach((metric) => {
      const nextWidth =
        currentRow.length === 0
          ? metric.bounds.width
          : currentRowWidth + gap + metric.bounds.width

      if (currentRow.length > 0 && nextWidth > targetRowWidth) {
        flushRow()
      }

      currentRow.push(metric)
      currentRowWidth =
        currentRow.length === 1
          ? metric.bounds.width
          : currentRowWidth + gap + metric.bounds.width
      currentRowHeight = Math.max(currentRowHeight, metric.bounds.height)
    })

    flushRow()

    const totalHeight =
      rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * gap
    let cursorY = -totalHeight / 2
    const packedNodes: PositionedNode[] = []

    rows.forEach((row) => {
      let cursorX = -row.width / 2

      row.metrics.forEach((metric) => {
        const offsetX = cursorX - metric.bounds.minX
        const offsetY =
          cursorY + (row.height - metric.bounds.height) / 2 - metric.bounds.minY

        metric.family.nodes.forEach((node) => {
          packedNodes.push({
            ...node,
            x: node.x + offsetX,
            y: node.y + offsetY,
          })
        })

        cursorX += metric.bounds.width + gap
      })

      cursorY += row.height + gap
    })

    return packedNodes
  }

  private publishPackedSnapshot(
    version: number,
    families: FamilyLayout[],
    visibleStates: Map<string, VisibleNodeState>,
    edges: LayoutEdge[],
    storeSnapshot: GraphStoreSnapshot,
  ) {
    this.publishSnapshot(
      version,
      this.packFamilies(families, visibleStates),
      visibleStates,
      edges,
      storeSnapshot,
    )
  }

  private publishSnapshot(
    version: number,
    nodesByPosition: PositionedNode[],
    visibleStates: Map<string, VisibleNodeState>,
    edges: LayoutEdge[],
    storeSnapshot: GraphStoreSnapshot,
  ) {
    const nodes: LayoutNode[] = nodesByPosition.map((nodePosition) => {
      const state = visibleStates.get(nodePosition.id)!
      const node = state.node

      return {
        id: nodePosition.id,
        label: node.label,
        parentId: node.parentId,
        depth: node.depth,
        x: nodePosition.x,
        y: nodePosition.y,
        visualRadius: getVisualRadiusForDepth(node.depth),
        boxRadius: state.boxRadius,
        footprintRadius: state.footprintRadius,
        isRoot: node.parentId === null,
        isLeaf: node.children.length === 0,
        isExpanded: state.expanded,
      }
    })

    const bounds = nodes.reduce<LayoutBounds>((acc, node) => {
      acc.minX = Math.min(acc.minX, node.x - node.footprintRadius)
      acc.minY = Math.min(acc.minY, node.y - node.footprintRadius)
      acc.maxX = Math.max(acc.maxX, node.x + node.footprintRadius)
      acc.maxY = Math.max(acc.maxY, node.y + node.footprintRadius)
      return acc
    }, createEmptyBounds())

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
    }

    this.listeners.forEach((listener) => listener(this.lastSnapshot!))
  }
}

export function createLayoutEngine(store: GraphStore) {
  return new GraphLayoutEngine(store)
}
