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
  DEFAULT_CHILD_MAX_COUNT,
  DEFAULT_CHILD_MIN_COUNT,
  DEFAULT_EXAMPLE_DEPTH,
  DEFAULT_EXAMPLE_ROOT_COUNT,
  exampleGraph,
} from '../data/exampleGraph'
import {
  createLayoutEngine,
  type LayoutEdge,
  type LayoutNode,
  type LayoutSnapshot,
} from '../engine/layoutEngine'
import { createControlPanel } from '../hud/controlPanel'
import { createGraphStore } from '../store/graphStore'

const CAMERA_MIN_SCALE = 0.012
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

function drawNode(visual: NodeVisual) {
  const { data, circle } = visual
  const palette = getNodePalette(data)
  const radius = data.visualRadius
  const ringWidth = data.isRoot ? 3 : 2
  const labelFontSize = Math.max(10, Math.min(14, radius * 0.42))

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
  visual.label.style = new TextStyle({
    align: 'center',
    fill: palette.label,
    fontFamily: NODE_FONT_FAMILY,
    fontSize: labelFontSize,
    fontWeight: '400',
    padding: 3,
  })
  visual.label.resolution = TEXT_RESOLUTION
}

function applyCameraZoom(scene: Container, clientX: number, clientY: number, nextScale: number) {
  const currentScale = scene.scale.x
  const worldX = (clientX - scene.position.x) / currentScale
  const worldY = (clientY - scene.position.y) / currentScale

  scene.scale.set(nextScale)
  scene.position.set(clientX - worldX * nextScale, clientY - worldY * nextScale)
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

  const padding = 120
  const availableWidth = Math.max(1, width - padding * 2)
  const availableHeight = Math.max(1, height - padding * 2)
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
  const hudLayer = new Container()
  let rootNodeCount = DEFAULT_EXAMPLE_ROOT_COUNT
  let graphDepth = DEFAULT_EXAMPLE_DEPTH
  let childMinCount = DEFAULT_CHILD_MIN_COUNT
  let childMaxCount = DEFAULT_CHILD_MAX_COUNT
  const rebuildGraph = () => {
    graphStore.setGraph(createExampleGraph({
      rootCount: rootNodeCount,
      depth: graphDepth,
      childMinCount,
      childMaxCount,
    }))
    window.requestAnimationFrame(() => {
      layoutEngine.requestFitToScreen()
    })
  }
  const controlPanel = createControlPanel(
    graphStore,
    layoutEngine,
    (rootCount) => {
      rootNodeCount = rootCount
      rebuildGraph()
    },
    (depth) => {
      graphDepth = depth
      rebuildGraph()
    },
    (childMin) => {
      childMinCount = childMin
      childMaxCount = Math.max(childMaxCount, childMin)
      rebuildGraph()
    },
    (childMax) => {
      childMaxCount = childMax
      childMinCount = Math.min(childMinCount, childMax)
      rebuildGraph()
    },
  )
  const nodeVisuals = new Map<string, NodeVisual>()

  let currentSnapshot: LayoutSnapshot | null = null
  let didAutoFit = false
  let destroyed = false
  let isPanning = false
  let pressedNodeId: string | null = null
  let dragNodeId: string | null = null
  let nodeDragOffset = new Point()
  let pointerDownClient = new Point()
  let panStartScene = new Point()
  let panStartPointer = new Point()

  sceneContainer.addChild(edgeLayer, nodeLayer)
  hudLayer.addChild(controlPanel.container)
  backgroundLayer.addChild(backdrop)
  app.stage.addChild(backgroundLayer, sceneContainer, hudLayer)
  app.stage.eventMode = 'static'

  const resizeStage = () => {
    const width = app.screen.width
    const height = app.screen.height

    backdrop
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: 0x020304, alpha: 1 })
      .rect(0, 0, width, Math.max(180, height * 0.22))
      .fill({ color: 0x06080b, alpha: 0.9 })
      .rect(0, height - Math.max(220, height * 0.26), width, Math.max(220, height * 0.26))
      .fill({ color: 0x05070a, alpha: 0.82 })
      .rect(0, 0, Math.max(220, width * 0.16), height)
      .fill({ color: 0x05070a, alpha: 0.42 })
      .rect(width - Math.max(260, width * 0.18), 0, Math.max(260, width * 0.18), height)
      .fill({ color: 0x06090d, alpha: 0.36 })
      .roundRect(18, 18, width - 36, height - 36, 28)
      .stroke({ color: 0x1b222d, width: 1, alpha: 0.42 })
      .moveTo(32, 96)
      .lineTo(width - 32, 96)
      .stroke({ color: 0xffffff, width: 1, alpha: 0.025 })
      .moveTo(32, height - 88)
      .lineTo(width - 32, height - 88)
      .stroke({ color: 0xffffff, width: 1, alpha: 0.02 })

    app.stage.hitArea = new Rectangle(0, 0, width, height)
    controlPanel.resize(width, height)
    layoutEngine.setViewportSize(width, height)
    app.render()
  }

  resizeStage()

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

  const pointerUp = () => {
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
  window.addEventListener('resize', resizeStage)

  app.stage.on('pointerdown', (event) => {
    const clientX = event.global.x
    const clientY = event.global.y

    pointerDownClient = new Point(clientX, clientY)

    if (controlPanel.containsPoint(clientX, clientY)) {
      pressedNodeId = null
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

    const scaleFactor = Math.exp(-event.deltaY * 0.0015)
    const nextScale = Math.max(CAMERA_MIN_SCALE, sceneContainer.scale.x * scaleFactor)

    applyCameraZoom(sceneContainer, event.clientX, event.clientY, nextScale)
  }

  canvas.addEventListener('wheel', handleWheel, { passive: false })

  const syncSnapshot = (snapshot: LayoutSnapshot) => {
    currentSnapshot = snapshot
    const now = performance.now()
    const activeIds = new Set(snapshot.nodes.map((node) => node.id))

    snapshot.nodes.forEach((node) => {
      const existing = nodeVisuals.get(node.id)

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

      drawNode(existing)
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
          .stroke({ color: 0x90c3ff, width: 1.8, alpha: 0.18 })
      })
    }

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
        .stroke({ color: 0x90c3ff, width: 1.6, alpha: 0.12 })
    })
  })

  app.render()

  return {
    destroy: () => {
      if (destroyed) {
        return
      }

      destroyed = true
      unsubscribeLayout()
      unsubscribeFit()
      controlPanel.destroy()
      layoutEngine.destroy()
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('resize', resizeStage)
      canvas.removeEventListener('wheel', handleWheel)
      app.destroy(undefined, { children: true })
    },
  }
}
