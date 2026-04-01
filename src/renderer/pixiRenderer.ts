import {
  Application,
  Container,
  Graphics,
  Point,
  Rectangle,
  Text,
  TextStyle,
} from 'pixi.js'
import {
  createExampleGraph,
  DEFAULT_EXAMPLE_GRAPH_SETTINGS,
  normalizeExampleGraphSettings,
  type ExampleGraphSettings,
  exampleGraph,
} from '../data/exampleGraph'
import {
  createLayoutEngine,
  type LayoutEdge,
  type LayoutNode,
  type LayoutSnapshot,
} from '../engine/layoutEngine'
import { createGraphStore } from '../store/graphStore'

const CAMERA_MIN_SCALE = 0.012
const CAMERA_MAX_SCALE = 6
const ENTER_EXIT_DURATION = 400
const NODE_SPRING_STRENGTH = 0.12
const NODE_SPRING_DAMPING = 0.74
const NODE_DRAG_THRESHOLD = 6
const NODE_FONT_FAMILY = '"JetBrains Mono", Consolas, "Courier New", monospace'
const TEXT_RESOLUTION =
  typeof window === 'undefined'
    ? 2
    : Math.min(3, Math.max(2, window.devicePixelRatio || 1))

const labelStyle = new TextStyle({
  fill: 0xf6f7fb,
  fontFamily: NODE_FONT_FAMILY,
  fontSize: 12,
  fontWeight: '400',
  align: 'center',
  padding: 3,
})

interface NodeVisual {
  data: LayoutNode
  container: Container
  circle: Graphics
  label: Text
  appearanceKey: string
  displayX: number
  displayY: number
  targetX: number
  targetY: number
  velocityX: number
  velocityY: number
  entryOriginX: number
  entryOriginY: number
  exitOriginX: number
  exitOriginY: number
  exitParentId: string | null
  phase: 'entering' | 'steady' | 'exiting'
  phaseStartedAt: number
}

export interface PixiRendererHandle {
  destroy: () => void
  subscribe: (listener: (snapshot: RendererHudSnapshot) => void) => () => void
  updateGraphSettings: (settings: ExampleGraphSettings) => void
  expandAll: () => void
  collapseAll: () => void
  fitToScreen: () => void
}

export interface RendererHudSnapshot {
  visibleCount: number
  totalCount: number
  fps: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3
}

function getNodePalette(node: LayoutNode) {
  if (node.isRoot) {
    return {
      fill: 0xff9a62,
      inner: 0xffc79d,
      stroke: 0x24160f,
      label: 0x15100b,
    }
  }

  if (node.isLeaf) {
    return {
      fill: 0x5c78d8,
      inner: 0x94a7f7,
      stroke: 0x101626,
      label: 0xf6f8ff,
    }
  }

  if (node.isExpanded) {
    return {
      fill: 0x26a58f,
      inner: 0x7fe0cf,
      stroke: 0x0b1e1a,
      label: 0x041210,
    }
  }

  return {
    fill: 0x20293d,
    inner: 0x7183ba,
    stroke: 0x0d121b,
    label: 0xf5f7ff,
  }
}

function createNodeVisual(node: LayoutNode): NodeVisual {
  const container = new Container()
  const circle = new Graphics()
  const label = new Text({
    text: node.label,
    style: labelStyle,
    anchor: 0.5,
    resolution: TEXT_RESOLUTION,
  })

  label.position.set(0, 0)
  container.addChild(circle, label)
  container.eventMode = 'passive'
  label.eventMode = 'none'
  circle.eventMode = 'none'

  return {
    data: node,
    container,
    circle,
    label,
    appearanceKey: '',
    displayX: node.x,
    displayY: node.y,
    targetX: node.x,
    targetY: node.y,
    velocityX: 0,
    velocityY: 0,
    entryOriginX: node.x,
    entryOriginY: node.y,
    exitOriginX: node.x,
    exitOriginY: node.y,
    exitParentId: node.parentId,
    phase: 'steady',
    phaseStartedAt: performance.now(),
  }
}

const labelStyleCache = new Map<string, TextStyle>()

function getLabelStyle(fontSize: number, fill: number, maxLabelWidth: number) {
  const key = `${fontSize}:${fill}:${Math.round(maxLabelWidth)}`
  const cached = labelStyleCache.get(key)

  if (cached) {
    return cached
  }

  const style = new TextStyle({
    align: 'center',
    breakWords: true,
    fill,
    fontFamily: NODE_FONT_FAMILY,
    fontSize,
    fontWeight: '400',
    lineHeight: Math.max(10, fontSize * 1.02),
    padding: 3,
    wordWrap: true,
    wordWrapWidth: maxLabelWidth,
  })

  labelStyleCache.set(key, style)
  return style
}

function getNodeAppearanceKey(node: LayoutNode) {
  return [
    node.label,
    node.visualRadius.toFixed(2),
    node.isRoot ? 'r' : '',
    node.isLeaf ? 'l' : '',
    node.isExpanded ? 'e' : '',
  ].join('|')
}

function drawNode(visual: NodeVisual) {
  const { data, circle } = visual
  const palette = getNodePalette(data)
  const radius = data.visualRadius
  const ringWidth = data.isRoot ? 3 : 2
  const labelFontSize = Math.max(8, Math.min(14, radius * 0.34))
  const maxLabelWidth = Math.max(20, radius * 1.4)
  const maxLabelHeight = Math.max(18, radius * 1.05)
  visual.appearanceKey = getNodeAppearanceKey(data)

  circle
    .clear()
    .circle(0, 0, radius)
    .fill({ color: palette.fill, alpha: 0.96 })
    .stroke({
      color: palette.stroke,
      width: ringWidth,
      alpha: 0.92,
    })

  visual.label.text = data.label
  visual.label.style = getLabelStyle(labelFontSize, palette.label, maxLabelWidth)
  visual.label.resolution = TEXT_RESOLUTION
  visual.label.visible = true
  visual.label.scale.set(1)

  const widthScale = visual.label.width > 0 ? maxLabelWidth / visual.label.width : 1
  const heightScale = visual.label.height > 0 ? maxLabelHeight / visual.label.height : 1
  const fittedScale = Math.min(1, widthScale, heightScale)

  visual.label.scale.set(Math.max(0.55, fittedScale))
}

function applyCameraZoom(scene: Container, clientX: number, clientY: number, nextScale: number) {
  const currentScale = scene.scale.x
  const worldX = (clientX - scene.position.x) / currentScale
  const worldY = (clientY - scene.position.y) / currentScale

  scene.scale.set(nextScale)
  scene.position.set(clientX - worldX * nextScale, clientY - worldY * nextScale)
}

function getTrackedPinch(activePointers: Map<number, Point>) {
  const trackedPoints = Array.from(activePointers.values())

  if (trackedPoints.length < 2) {
    return null
  }

  const [first, second] = trackedPoints
  const centerX = (first.x + second.x) / 2
  const centerY = (first.y + second.y) / 2

  return {
    centerX,
    centerY,
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  }
}

function normalizeWheelDelta(event: WheelEvent) {
  if (event.deltaMode === 1) {
    return event.deltaY * 16
  }

  if (event.deltaMode === 2) {
    return event.deltaY * window.innerHeight
  }

  return event.deltaY
}

function screenToWorld(scene: Container, clientX: number, clientY: number) {
  const scale = scene.scale.x

  return {
    x: (clientX - scene.position.x) / scale,
    y: (clientY - scene.position.y) / scale,
  }
}

function fitSceneToSnapshot(scene: Container, snapshot: LayoutSnapshot, width: number, height: number) {
  if (snapshot.bounds.width <= 0 || snapshot.bounds.height <= 0) {
    scene.position.set(width / 2, height / 2)
    scene.scale.set(1)
    return
  }

  const landscapeMobile = width > height && height <= 560
  const horizontalPadding = landscapeMobile
    ? clamp(width * 0.008, 4, 10)
    : clamp(width * 0.018, 8, 20)
  const verticalPadding = landscapeMobile
    ? clamp(height * 0.02, 6, 12)
    : clamp(height * 0.04, 10, 28)
  const availableWidth = Math.max(1, width - horizontalPadding * 2)
  const availableHeight = Math.max(1, height - verticalPadding * 2)
  const scale = clamp(
    Math.min(availableWidth / snapshot.bounds.width, availableHeight / snapshot.bounds.height),
    CAMERA_MIN_SCALE,
    Number.POSITIVE_INFINITY,
  )
  const centerX = snapshot.bounds.minX + snapshot.bounds.width / 2
  const centerY = snapshot.bounds.minY + snapshot.bounds.height / 2

  scene.scale.set(scale)
  scene.position.set(width / 2 - centerX * scale, height / 2 - centerY * scale)
}

async function loadNodeFont() {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return
  }

  try {
    await Promise.race([
      document.fonts.load('16px "JetBrains Mono"'),
      new Promise((resolve) => window.setTimeout(resolve, 1500)),
    ])
  } catch {
    // Fall back to the existing stack if the custom font is unavailable.
  }
}

function toHudSnapshot(
  snapshot: LayoutSnapshot | null,
  fps: number,
): RendererHudSnapshot {
  return {
    visibleCount: snapshot?.visibleCount ?? 0,
    totalCount: snapshot?.totalCount ?? 0,
    fps,
  }
}

export async function initPixiRenderer(canvas: HTMLCanvasElement): Promise<PixiRendererHandle> {
  await loadNodeFont()

  const app = new Application()
  await app.init({
    canvas,
    resizeTo: window,
    antialias: true,
    autoDensity: true,
    autoStart: true,
    backgroundAlpha: 0,
    preference: 'webgl',
    resolution: Math.min(2.5, Math.max(1, window.devicePixelRatio || 1)),
  })
  app.start()

  const graphStore = createGraphStore(exampleGraph)
  const layoutEngine = createLayoutEngine(graphStore)
  const backgroundLayer = new Container()
  const backdrop = new Graphics()
  const sceneContainer = new Container()
  const edgeLayer = new Graphics()
  const nodeLayer = new Container()
  const hudListeners = new Set<(snapshot: RendererHudSnapshot) => void>()
  let graphSettings = { ...DEFAULT_EXAMPLE_GRAPH_SETTINGS }
  const rebuildGraph = (nextSettings: ExampleGraphSettings) => {
    const normalizedSettings = normalizeExampleGraphSettings(nextSettings)
    const graphConfigChanged =
      normalizedSettings.rootCount !== graphSettings.rootCount ||
      normalizedSettings.depth !== graphSettings.depth ||
      normalizedSettings.childMinCount !== graphSettings.childMinCount ||
      normalizedSettings.childMaxCount !== graphSettings.childMaxCount

    if (!graphConfigChanged) {
      return
    }

    graphSettings = normalizedSettings
    graphStore.setGraph(createExampleGraph(graphSettings))
    window.requestAnimationFrame(() => {
      layoutEngine.requestFitToScreen()
    })
  }
  const nodeVisuals = new Map<string, NodeVisual>()

  let currentSnapshot: LayoutSnapshot | null = null
  let currentHudSnapshot: RendererHudSnapshot | null = null
  let currentFps = 0
  let lastFpsSampleAt = 0
  let didAutoFit = false
  let destroyed = false
  let isPanning = false
  let pressedNodeId: string | null = null
  let dragNodeId: string | null = null
  let pinchStartDistance = 0
  let pinchStartScale = 1
  let nodeDragOffset = new Point()
  let pointerDownClient = new Point()
  let panStartScene = new Point()
  let panStartPointer = new Point()
  const activePointers = new Map<number, Point>()
  let lastViewportWidth = 0
  let lastViewportHeight = 0
  let viewportSyncFrame = 0
  let viewportSyncTimeout = 0
  let refitAfterViewportRefresh = false

  sceneContainer.addChild(edgeLayer, nodeLayer)
  backgroundLayer.addChild(backdrop)
  app.stage.addChild(backgroundLayer, sceneContainer)
  app.stage.eventMode = 'static'

  const clearInteractions = () => {
    activePointers.clear()
    pinchStartDistance = 0
    pinchStartScale = sceneContainer.scale.x
    isPanning = false
    pressedNodeId = null
    dragNodeId = null
  }

  const syncViewport = () => {
    viewportSyncFrame = 0
    app.resize()

    const width = Math.max(1, Math.round(app.screen.width))
    const height = Math.max(1, Math.round(app.screen.height))
    const hadViewport = lastViewportWidth > 0 && lastViewportHeight > 0
    const orientationFlipped =
      hadViewport &&
      (lastViewportWidth > lastViewportHeight) !== (width > height)
    const widthRatio = hadViewport
      ? Math.max(width / lastViewportWidth, lastViewportWidth / width)
      : 1
    const heightRatio = hadViewport
      ? Math.max(height / lastViewportHeight, lastViewportHeight / height)
      : 1
    const majorViewportChange = orientationFlipped || widthRatio > 1.22 || heightRatio > 1.22

    backdrop
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: 0x020304, alpha: 1 })

    app.stage.hitArea = new Rectangle(0, 0, width, height)
    layoutEngine.setViewportSize(width, height)
    clearInteractions()

    if (majorViewportChange) {
      refitAfterViewportRefresh = true
      layoutEngine.refreshLayout()
    } else if (currentSnapshot) {
      fitSceneToSnapshot(sceneContainer, currentSnapshot, width, height)
    }

    lastViewportWidth = width
    lastViewportHeight = height
    app.render()
  }

  const scheduleViewportSync = () => {
    if (viewportSyncFrame) {
      window.cancelAnimationFrame(viewportSyncFrame)
    }

    if (viewportSyncTimeout) {
      window.clearTimeout(viewportSyncTimeout)
    }

    viewportSyncFrame = window.requestAnimationFrame(() => {
      syncViewport()
      viewportSyncTimeout = window.setTimeout(() => {
        syncViewport()
      }, 180)
    })
  }

  syncViewport()

  const startPinchGesture = () => {
    const pinch = getTrackedPinch(activePointers)

    if (!pinch) {
      pinchStartDistance = 0
      return
    }

    pinchStartDistance = Math.max(1, pinch.distance)
    pinchStartScale = sceneContainer.scale.x
  }

  const pickNodeAt = (clientX: number, clientY: number) => {
    const scale = sceneContainer.scale.x

    for (const visual of Array.from(nodeVisuals.values()).reverse()) {
      if (visual.phase === 'exiting') {
        continue
      }

      const screenX = sceneContainer.position.x + visual.displayX * scale
      const screenY = sceneContainer.position.y + visual.displayY * scale
      const radius = (visual.data.visualRadius + 10) * scale
      const dx = clientX - screenX
      const dy = clientY - screenY

      if (dx * dx + dy * dy <= radius * radius) {
        return visual
      }
    }

    return null
  }

  const pointerMove = (event: PointerEvent) => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, new Point(event.clientX, event.clientY))
    }

    if (activePointers.size >= 2) {
      const pinch = getTrackedPinch(activePointers)

      if (pinch) {
        if (pinchStartDistance <= 0) {
          startPinchGesture()
        }

        const nextScale = clamp(
          pinchStartScale * (pinch.distance / Math.max(1, pinchStartDistance)),
          CAMERA_MIN_SCALE,
          CAMERA_MAX_SCALE,
        )

        pressedNodeId = null
        dragNodeId = null
        isPanning = false
        applyCameraZoom(sceneContainer, pinch.centerX, pinch.centerY, nextScale)
      }

      return
    }

    const moved =
      Math.abs(event.clientX - pointerDownClient.x) > NODE_DRAG_THRESHOLD ||
      Math.abs(event.clientY - pointerDownClient.y) > NODE_DRAG_THRESHOLD

    if (pressedNodeId && moved && !dragNodeId) {
      dragNodeId = pressedNodeId
      pressedNodeId = null
      isPanning = false
    }

    if (dragNodeId) {
      const draggedVisual = nodeVisuals.get(dragNodeId)

      if (!draggedVisual) {
        dragNodeId = null
        return
      }

      const world = screenToWorld(sceneContainer, event.clientX, event.clientY)
      draggedVisual.displayX = world.x + nodeDragOffset.x
      draggedVisual.displayY = world.y + nodeDragOffset.y
      draggedVisual.velocityX = 0
      draggedVisual.velocityY = 0
      draggedVisual.container.position.set(draggedVisual.displayX, draggedVisual.displayY)
      return
    }

    if (!isPanning) {
      return
    }

    const deltaX = event.clientX - panStartPointer.x
    const deltaY = event.clientY - panStartPointer.y
    sceneContainer.position.set(panStartScene.x + deltaX, panStartScene.y + deltaY)
  }

  const pointerUp = (event: PointerEvent) => {
    if (activePointers.has(event.pointerId)) {
      activePointers.delete(event.pointerId)
    }

    if (activePointers.size >= 2) {
      startPinchGesture()
      return
    }

    pinchStartDistance = 0

    if (activePointers.size > 0) {
      pressedNodeId = null
      dragNodeId = null
      isPanning = false
      return
    }

    if (dragNodeId) {
      dragNodeId = null
      pressedNodeId = null
      isPanning = false
      return
    }

    if (!isPanning && pressedNodeId) {
      graphStore.toggle(pressedNodeId)
    }

    isPanning = false
    pressedNodeId = null
  }

  window.addEventListener('pointermove', pointerMove)
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('pointercancel', pointerUp)
  window.addEventListener('resize', scheduleViewportSync)
  window.addEventListener('orientationchange', scheduleViewportSync)
  window.visualViewport?.addEventListener('resize', scheduleViewportSync)

  app.stage.on('pointerdown', (event) => {
    const clientX = event.global.x
    const clientY = event.global.y
    activePointers.set(event.pointerId, new Point(clientX, clientY))

    pointerDownClient = new Point(clientX, clientY)

    if (activePointers.size >= 2) {
      startPinchGesture()
      pressedNodeId = null
      dragNodeId = null
      isPanning = false
      return
    }

    const pickedNode = pickNodeAt(clientX, clientY)

    if (pickedNode) {
      pressedNodeId = pickedNode.data.id
      const world = screenToWorld(sceneContainer, clientX, clientY)
      nodeDragOffset = new Point(
        pickedNode.displayX - world.x,
        pickedNode.displayY - world.y,
      )
      dragNodeId = null
      isPanning = false
      return
    }

    pressedNodeId = null
    isPanning = true
    event.stopPropagation()
    panStartPointer = new Point(clientX, clientY)
    panStartScene = sceneContainer.position.clone()
  })

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault()

    const deltaY = normalizeWheelDelta(event)
    const zoomStrength = event.ctrlKey ? 0.0044 : 0.0026
    const scaleFactor = Math.exp(-deltaY * zoomStrength)
    const nextScale = clamp(
      sceneContainer.scale.x * scaleFactor,
      CAMERA_MIN_SCALE,
      CAMERA_MAX_SCALE,
    )

    applyCameraZoom(sceneContainer, event.clientX, event.clientY, nextScale)
  }

  canvas.addEventListener('wheel', handleWheel, { passive: false })

  const publishHudSnapshot = () => {
    const hudSnapshot = toHudSnapshot(currentSnapshot, currentFps)
    const hudChanged =
      !currentHudSnapshot ||
      hudSnapshot.visibleCount !== currentHudSnapshot.visibleCount ||
      hudSnapshot.totalCount !== currentHudSnapshot.totalCount ||
      hudSnapshot.fps !== currentHudSnapshot.fps

    currentHudSnapshot = hudSnapshot

    if (hudChanged) {
      hudListeners.forEach((listener) => listener(hudSnapshot))
    }
  }

  const syncSnapshot = (snapshot: LayoutSnapshot) => {
    currentSnapshot = snapshot
    publishHudSnapshot()

    const now = performance.now()
    const activeIds = new Set(snapshot.nodes.map((node) => node.id))

    snapshot.nodes.forEach((node) => {
      const existing = nodeVisuals.get(node.id)
      const appearanceKey = getNodeAppearanceKey(node)

      if (!existing) {
        const visual = createNodeVisual(node)
        const parentVisual = node.parentId ? nodeVisuals.get(node.parentId) : null
        const originX = parentVisual ? parentVisual.displayX : node.x
        const originY = parentVisual ? parentVisual.displayY : node.y

        visual.data = node
        visual.displayX = originX
        visual.displayY = originY
        visual.entryOriginX = originX
        visual.entryOriginY = originY
        visual.targetX = node.x
        visual.targetY = node.y
        visual.phase = 'entering'
        visual.phaseStartedAt = now
        visual.container.alpha = 0
        visual.container.scale.set(0)
        drawNode(visual)
        nodeLayer.addChild(visual.container)
        nodeVisuals.set(node.id, visual)
        return
      }

      existing.data = node
      existing.targetX = node.x
      existing.targetY = node.y
      existing.exitParentId = node.parentId

      if (existing.phase === 'exiting') {
        existing.phase = 'entering'
        existing.phaseStartedAt = now
        existing.entryOriginX = existing.displayX
        existing.entryOriginY = existing.displayY
      }

      if (existing.appearanceKey !== appearanceKey) {
        drawNode(existing)
      }
    })

    nodeVisuals.forEach((visual, id) => {
      if (activeIds.has(id) || visual.phase === 'exiting') {
        return
      }

      visual.phase = 'exiting'
      visual.phaseStartedAt = now
      visual.exitOriginX = visual.displayX
      visual.exitOriginY = visual.displayY
    })

    if (refitAfterViewportRefresh) {
      refitAfterViewportRefresh = false
      fitSceneToSnapshot(sceneContainer, snapshot, app.screen.width, app.screen.height)
    }

    if (!didAutoFit && currentSnapshot) {
      didAutoFit = true
      fitSceneToSnapshot(sceneContainer, currentSnapshot, app.screen.width, app.screen.height)
    }

    app.render()
  }

  const unsubscribeLayout = layoutEngine.subscribe(syncSnapshot)
  const unsubscribeFit = layoutEngine.onFitRequested(() => {
    if (!currentSnapshot) {
      return
    }

    fitSceneToSnapshot(sceneContainer, currentSnapshot, app.screen.width, app.screen.height)
  })

  app.ticker.add(() => {
    const now = performance.now()

    if (now - lastFpsSampleAt >= 250) {
      lastFpsSampleAt = now
      currentFps = Math.max(0, Math.round(app.ticker.FPS))
      publishHudSnapshot()
    }

    nodeVisuals.forEach((visual, id) => {
      if (visual.phase === 'entering') {
        const progress = clamp((now - visual.phaseStartedAt) / ENTER_EXIT_DURATION, 0, 1)
        const eased = easeOutCubic(progress)

        visual.displayX = visual.entryOriginX + (visual.targetX - visual.entryOriginX) * eased
        visual.displayY = visual.entryOriginY + (visual.targetY - visual.entryOriginY) * eased
        visual.velocityX = 0
        visual.velocityY = 0
        visual.container.alpha = eased
        visual.container.scale.set(eased)

        if (progress >= 1) {
          visual.phase = 'steady'
          visual.container.alpha = 1
          visual.container.scale.set(1)
        }
      } else if (visual.phase === 'exiting') {
        const progress = clamp((now - visual.phaseStartedAt) / ENTER_EXIT_DURATION, 0, 1)
        const eased = easeOutCubic(progress)
        const parentVisual = visual.exitParentId ? nodeVisuals.get(visual.exitParentId) : null
        const exitTargetX = parentVisual ? parentVisual.displayX : visual.targetX
        const exitTargetY = parentVisual ? parentVisual.displayY : visual.targetY

        visual.displayX = visual.exitOriginX + (exitTargetX - visual.exitOriginX) * eased
        visual.displayY = visual.exitOriginY + (exitTargetY - visual.exitOriginY) * eased
        visual.velocityX = 0
        visual.velocityY = 0
        visual.container.alpha = 1 - eased
        visual.container.scale.set(1 - eased)

        if (progress >= 1) {
          nodeLayer.removeChild(visual.container)
          visual.container.destroy({ children: true })
          nodeVisuals.delete(id)
          return
        }
      } else {
        if (dragNodeId === id) {
          visual.velocityX = 0
          visual.velocityY = 0
          visual.container.alpha = 1
          visual.container.scale.set(1)
          visual.container.position.set(visual.displayX, visual.displayY)
          return
        }

        visual.velocityX =
          (visual.velocityX + (visual.targetX - visual.displayX) * NODE_SPRING_STRENGTH) *
          NODE_SPRING_DAMPING
        visual.velocityY =
          (visual.velocityY + (visual.targetY - visual.displayY) * NODE_SPRING_STRENGTH) *
          NODE_SPRING_DAMPING
        visual.displayX += visual.velocityX
        visual.displayY += visual.velocityY
        visual.container.alpha = 1
        visual.container.scale.set(1)
      }

      visual.container.position.set(visual.displayX, visual.displayY)
    })

    edgeLayer.clear()
    let hasActiveEdges = false

    if (currentSnapshot) {
      currentSnapshot.edges.forEach((edge: LayoutEdge) => {
        const source = nodeVisuals.get(edge.sourceId)
        const target = nodeVisuals.get(edge.targetId)

        if (!source || !target) {
          return
        }

        edgeLayer
          .moveTo(source.displayX, source.displayY)
          .lineTo(target.displayX, target.displayY)
        hasActiveEdges = true
      })

      if (hasActiveEdges) {
        edgeLayer.stroke({ color: 0x90c3ff, width: 1.8, alpha: 0.18 })
      }
    }

    let hasExitingEdges = false

    nodeVisuals.forEach((visual) => {
      if (visual.phase !== 'exiting' || !visual.exitParentId) {
        return
      }

      const parent = nodeVisuals.get(visual.exitParentId)

      if (!parent) {
        return
      }

      edgeLayer
        .moveTo(parent.displayX, parent.displayY)
        .lineTo(visual.displayX, visual.displayY)
      hasExitingEdges = true
    })

    if (hasExitingEdges) {
      edgeLayer.stroke({ color: 0x90c3ff, width: 1.6, alpha: 0.12 })
    }
  })

  app.render()

  return {
    subscribe: (listener) => {
      hudListeners.add(listener)

      if (currentHudSnapshot) {
        listener(currentHudSnapshot)
      }

      return () => {
        hudListeners.delete(listener)
      }
    },
    updateGraphSettings: (settings) => {
      rebuildGraph(settings)
    },
    expandAll: () => {
      graphStore.expandAll()
    },
    collapseAll: () => {
      graphStore.collapseAll()
    },
    fitToScreen: () => {
      layoutEngine.requestFitToScreen()
    },
    destroy: () => {
      if (destroyed) {
        return
      }

      destroyed = true
      unsubscribeLayout()
      unsubscribeFit()
      hudListeners.clear()
      layoutEngine.destroy()
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerUp)
      window.removeEventListener('resize', scheduleViewportSync)
      window.removeEventListener('orientationchange', scheduleViewportSync)
      window.visualViewport?.removeEventListener('resize', scheduleViewportSync)
      if (viewportSyncFrame) {
        window.cancelAnimationFrame(viewportSyncFrame)
      }
      if (viewportSyncTimeout) {
        window.clearTimeout(viewportSyncTimeout)
      }
      canvas.removeEventListener('wheel', handleWheel)
      app.destroy(undefined, { children: true })
    },
  }
}
