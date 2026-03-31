import {
  Container,
  Graphics,
  Point,
  Rectangle,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from 'pixi.js'
import {
  GraphLayoutEngine,
  type LayoutSnapshot,
} from '../engine/layoutEngine'
import {
  DEFAULT_CHILD_MAX_COUNT,
  DEFAULT_CHILD_MIN_COUNT,
  DEFAULT_EXAMPLE_DEPTH,
  DEFAULT_EXAMPLE_ROOT_COUNT,
  MAX_EXAMPLE_DEPTH,
  MAX_EXAMPLE_ROOT_COUNT,
  MAX_CHILD_COUNT,
  MIN_EXAMPLE_DEPTH,
  MIN_EXAMPLE_ROOT_COUNT,
  MIN_CHILD_COUNT,
} from '../data/exampleGraph'
import { GraphStore } from '../store/graphStore'

const PANEL_X = 20
const PANEL_Y = 20
const PANEL_WIDTH = 386
const PANEL_PADDING = 18
const CONTENT_WIDTH = PANEL_WIDTH - PANEL_PADDING * 2
const BUTTON_HEIGHT = 42
const BUTTON_RADIUS = 14
const SECTION_GAP = 14
const ROW_GAP = 10
const SLIDER_HEIGHT = 60
const SLIDER_TRACK_WIDTH = CONTENT_WIDTH - 108
const CARD_RADIUS = 18
const TEXT_RESOLUTION =
  typeof window === 'undefined'
    ? 2
    : Math.min(3, Math.max(2, window.devicePixelRatio || 1))

const titleStyle = new TextStyle({
  fill: 0xf7fbff,
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  fontSize: 18,
  fontWeight: '700',
  padding: 3,
})

const subtitleStyle = new TextStyle({
  fill: 0x8e98a8,
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  fontSize: 11,
  fontWeight: '500',
  padding: 3,
})

const sectionLabelStyle = new TextStyle({
  fill: 0xcdd7e5,
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 0.9,
  padding: 3,
})

const bodyStyle = new TextStyle({
  fill: 0xe4ebf6,
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  fontSize: 13,
  fontWeight: '600',
  padding: 3,
})

const secondaryBodyStyle = new TextStyle({
  fill: 0x95a1b3,
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  fontSize: 12,
  fontWeight: '600',
  padding: 3,
})

const valueStyle = new TextStyle({
  fill: 0xf7fbff,
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  fontSize: 12,
  fontWeight: '700',
  padding: 3,
})

const buttonLabelStyle = new TextStyle({
  fill: 0xf7fbff,
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  fontSize: 13,
  fontWeight: '700',
  padding: 3,
})

function createHudText(
  text: string,
  style: TextStyle,
  anchor?: number | { x: number; y: number },
) {
  return new Text({
    text,
    style,
    anchor,
    resolution: TEXT_RESOLUTION,
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function drawCard(graphics: Graphics, width: number, height: number) {
  graphics
    .clear()
    .roundRect(0, 0, width, height, CARD_RADIUS)
    .fill({ color: 0x05070a, alpha: 0.96 })
    .stroke({ color: 0x1e2631, width: 1, alpha: 0.94 })
}

class HudButton {
  readonly container = new Container()

  private readonly background = new Graphics()
  private readonly accent = new Graphics()
  private readonly label: Text
  private hovered = false
  private pressed = false
  private width: number

  constructor(text: string, onPress: () => void, width = CONTENT_WIDTH) {
    this.width = width
    this.label = createHudText(text, buttonLabelStyle, 0.5)

    this.container.addChild(this.background, this.accent, this.label)
    this.container.eventMode = 'static'
    this.container.cursor = 'pointer'
    this.container.hitArea = new Rectangle(0, 0, width, BUTTON_HEIGHT)
    this.label.position.set(width / 2, BUTTON_HEIGHT / 2)

    this.container.on('pointertap', (event) => {
      event.stopPropagation()
      onPress()
    })
    this.container.on('pointerover', () => {
      this.hovered = true
      this.redraw()
    })
    this.container.on('pointerout', () => {
      this.hovered = false
      this.pressed = false
      this.redraw()
    })
    this.container.on('pointerdown', (event) => {
      event.stopPropagation()
      this.pressed = true
      this.redraw()
    })
    this.container.on('pointerup', () => {
      this.pressed = false
      this.redraw()
    })
    this.container.on('pointerupoutside', () => {
      this.pressed = false
      this.redraw()
    })

    this.redraw()
  }

  private redraw() {
    const fill = this.pressed ? 0x0a0d12 : this.hovered ? 0x101620 : 0x0b0f15
    const stroke = this.hovered ? 0x5d7fae : 0x222c39

    this.background
      .clear()
      .roundRect(0, 0, this.width, BUTTON_HEIGHT, BUTTON_RADIUS)
      .fill({ color: fill, alpha: 0.98 })
      .stroke({ color: stroke, width: 1, alpha: 0.98 })

    this.accent
      .clear()
      .roundRect(12, BUTTON_HEIGHT - 9, this.width - 24, 3, 2)
      .fill({ color: this.hovered ? 0x86b7ff : 0x6e809d, alpha: this.pressed ? 0.38 : 0.6 })
  }
}

interface SliderOptions {
  label: string
  value: number
  min: number
  max: number
  step: number
  formatValue: (value: number) => string
  onChange: (value: number) => void
}

class HudSlider {
  readonly container = new Container()
  readonly height = SLIDER_HEIGHT

  private readonly shell = new Graphics()
  private readonly valueChip = new Graphics()
  private readonly title: Text
  private readonly valueLabel: Text
  private readonly track = new Graphics()
  private readonly fill = new Graphics()
  private readonly handle = new Graphics()
  private min: number
  private max: number
  private readonly step: number
  private readonly formatValue: (value: number) => string
  private readonly onChange: (value: number) => void
  private value: number
  private dragging = false
  private pointerMove = (event: PointerEvent) => {
    if (!this.dragging) {
      return
    }

    const local = this.track.toLocal(new Point(event.clientX, event.clientY))
    this.updateFromTrackPosition(local.x)
  }
  private pointerUp = () => {
    this.dragging = false
  }

  constructor(options: SliderOptions) {
    this.min = options.min
    this.max = options.max
    this.step = options.step
    this.formatValue = options.formatValue
    this.onChange = options.onChange
    this.value = options.value
    this.title = createHudText(options.label, secondaryBodyStyle)
    this.valueLabel = createHudText(this.formatValue(options.value), valueStyle, {
      x: 1,
      y: 0.5,
    })

    this.container.addChild(
      this.shell,
      this.valueChip,
      this.title,
      this.valueLabel,
      this.track,
      this.fill,
      this.handle,
    )

    this.title.position.set(14, 12)
    this.valueLabel.position.set(CONTENT_WIDTH - 14, 16)
    this.track.position.set(14, 42)
    this.fill.position.set(14, 42)
    this.handle.position.set(14, 42)

    this.track.eventMode = 'static'
    this.track.cursor = 'pointer'
    this.handle.eventMode = 'static'
    this.handle.cursor = 'pointer'

    const startDrag = (event: FederatedPointerEvent) => {
      event.stopPropagation()
      this.dragging = true
      const local = this.track.toLocal(event.global)
      this.updateFromTrackPosition(local.x)
    }

    this.track.on('pointerdown', startDrag)
    this.handle.on('pointerdown', startDrag)

    window.addEventListener('pointermove', this.pointerMove)
    window.addEventListener('pointerup', this.pointerUp)

    this.redraw()
  }

  setValue(nextValue: number) {
    this.value = clamp(nextValue, this.min, this.max)
    this.redraw()
  }

  setRange(min: number, max: number) {
    this.min = min
    this.max = max
    this.value = clamp(this.value, this.min, this.max)
    this.redraw()
  }

  destroy() {
    window.removeEventListener('pointermove', this.pointerMove)
    window.removeEventListener('pointerup', this.pointerUp)
  }

  private updateFromTrackPosition(x: number) {
    const clampedX = clamp(x, 0, SLIDER_TRACK_WIDTH)
    const ratio = SLIDER_TRACK_WIDTH === 0 ? 0 : clampedX / SLIDER_TRACK_WIDTH
    const nextValue = clamp(
      Math.round((this.min + ratio * (this.max - this.min)) / this.step) * this.step,
      this.min,
      this.max,
    )

    if (nextValue === this.value) {
      return
    }

    this.value = nextValue
    this.redraw()
    this.onChange(nextValue)
  }

  private redraw() {
    const ratio = this.max === this.min ? 0 : (this.value - this.min) / (this.max - this.min)
    const handleX = ratio * SLIDER_TRACK_WIDTH

    this.shell
      .clear()
      .roundRect(0, 0, CONTENT_WIDTH, SLIDER_HEIGHT, 16)
      .fill({ color: 0x070a0f, alpha: 0.98 })
      .stroke({ color: 0x1d2530, width: 1, alpha: 0.96 })

    this.valueChip
      .clear()
      .roundRect(CONTENT_WIDTH - 82, 8, 68, 18, 9)
      .fill({ color: 0x0d1118, alpha: 1 })
      .stroke({ color: 0x273240, width: 1, alpha: 0.98 })

    this.track
      .clear()
      .roundRect(0, -4, SLIDER_TRACK_WIDTH, 8, 5)
      .fill({ color: 0x0a0d12, alpha: 1 })
      .stroke({ color: 0x1c2430, width: 1, alpha: 1 })

    this.fill
      .clear()
      .roundRect(0, -4, handleX, 8, 5)
      .fill({ color: 0x8cb9ff, alpha: 0.9 })

    this.handle
      .clear()
      .circle(handleX, 0, 9)
      .fill({ color: 0xf4f8ff, alpha: 1 })
      .stroke({ color: 0x9bc2ff, width: 2, alpha: 0.96 })
      .circle(handleX, 0, 15)
      .stroke({ color: 0x9bc2ff, width: 1, alpha: 0.16 })

    this.valueLabel.text = this.formatValue(this.value)
  }
}

class SectionLabel {
  readonly container = new Container()

  constructor(text: string) {
    const label = createHudText(text, sectionLabelStyle)

    this.container.addChild(label)
  }
}

class StatCard {
  readonly container = new Container()

  private readonly background = new Graphics()
  private readonly label: Text
  private readonly value: Text

  constructor(label: string, value: string, width: number) {
    this.label = createHudText(label.toUpperCase(), sectionLabelStyle)
    this.value = createHudText(value, bodyStyle)

    this.container.addChild(this.background, this.label, this.value)
    this.label.position.set(14, 10)
    this.value.position.set(14, 28)

    this.background
      .roundRect(0, 0, width, 56, 16)
      .fill({ color: 0x070a0f, alpha: 0.98 })
      .stroke({ color: 0x1d2530, width: 1, alpha: 0.96 })
  }

  setValue(value: string) {
    this.value.text = value
  }
}

export class ControlPanel {
  readonly container = new Container()

  private readonly background = new Graphics()
  private readonly statsLeft: StatCard
  private readonly statsRight: StatCard
  private readonly rootCountSlider: HudSlider
  private readonly depthSlider: HudSlider
  private readonly childMinSlider: HudSlider
  private readonly childMaxSlider: HudSlider
  private readonly unsubscribers: Array<() => void> = []
  private panelHeight = 0
  private panelScale = 1

  constructor(
    store: GraphStore,
    layoutEngine: GraphLayoutEngine,
    onRootCountChange?: (rootCount: number) => void,
    onDepthChange?: (depth: number) => void,
    onChildMinChange?: (childMin: number) => void,
    onChildMaxChange?: (childMax: number) => void,
  ) {
    const title = createHudText('Gizmo', titleStyle)
    const subtitle = createHudText(
      'Graph controls. Changes to these settings will reset the graph.',
      subtitleStyle,
    )
    const actionsLabel = new SectionLabel('Actions')
    const graphLabel = new SectionLabel('Graph')
    const expandAll = new HudButton('Expand All', () => store.expandAll())
    const collapseAll = new HudButton('Collapse All', () => store.collapseAll())
    const fitView = new HudButton('Fit To Screen', () => layoutEngine.requestFitToScreen())

    this.statsLeft = new StatCard('Visible Nodes', '0', (CONTENT_WIDTH - 10) / 2)
    this.statsRight = new StatCard('Total Nodes', `${store.graph.totalNodes}`, (CONTENT_WIDTH - 10) / 2)

    this.rootCountSlider = new HudSlider({
      label: 'Root Nodes',
      value: DEFAULT_EXAMPLE_ROOT_COUNT,
      min: MIN_EXAMPLE_ROOT_COUNT,
      max: MAX_EXAMPLE_ROOT_COUNT,
      step: 1,
      formatValue: (value) => `${value}`,
      onChange: (value) => onRootCountChange?.(value),
    })
    this.depthSlider = new HudSlider({
      label: 'Depth',
      value: DEFAULT_EXAMPLE_DEPTH,
      min: MIN_EXAMPLE_DEPTH,
      max: MAX_EXAMPLE_DEPTH,
      step: 1,
      formatValue: (value) => `${value}`,
      onChange: (value) => onDepthChange?.(value),
    })
    this.childMinSlider = new HudSlider({
      label: 'Children Min',
      value: DEFAULT_CHILD_MIN_COUNT,
      min: MIN_CHILD_COUNT,
      max: DEFAULT_CHILD_MAX_COUNT,
      step: 1,
      formatValue: (value) => `${value}`,
      onChange: (value) => {
        this.childMaxSlider.setRange(value, MAX_CHILD_COUNT)
        onChildMinChange?.(value)
      },
    })
    this.childMaxSlider = new HudSlider({
      label: 'Children Max',
      value: DEFAULT_CHILD_MAX_COUNT,
      min: DEFAULT_CHILD_MIN_COUNT,
      max: MAX_CHILD_COUNT,
      step: 1,
      formatValue: (value) => `${value}`,
      onChange: (value) => {
        this.childMinSlider.setRange(MIN_CHILD_COUNT, value)
        onChildMaxChange?.(value)
      },
    })

    this.container.addChild(
      this.background,
      title,
      subtitle,
      actionsLabel.container,
      expandAll.container,
      collapseAll.container,
      fitView.container,
      graphLabel.container,
      this.statsLeft.container,
      this.statsRight.container,
      this.rootCountSlider.container,
      this.depthSlider.container,
      this.childMinSlider.container,
      this.childMaxSlider.container,
    )

    let cursorY = PANEL_PADDING

    title.position.set(PANEL_PADDING, cursorY)
    cursorY += 28
    subtitle.position.set(PANEL_PADDING, cursorY)
    cursorY += 28

    actionsLabel.container.position.set(PANEL_PADDING, cursorY)
    cursorY += 28
    expandAll.container.position.set(PANEL_PADDING, cursorY)
    cursorY += BUTTON_HEIGHT + 8
    collapseAll.container.position.set(PANEL_PADDING, cursorY)
    cursorY += BUTTON_HEIGHT + 8
    fitView.container.position.set(PANEL_PADDING, cursorY)
    cursorY += BUTTON_HEIGHT + SECTION_GAP

    graphLabel.container.position.set(PANEL_PADDING, cursorY)
    cursorY += 28
    this.statsLeft.container.position.set(PANEL_PADDING, cursorY)
    this.statsRight.container.position.set(PANEL_PADDING + (CONTENT_WIDTH - 10) / 2 + 10, cursorY)
    cursorY += 56 + SECTION_GAP
    this.rootCountSlider.container.position.set(PANEL_PADDING, cursorY)
    cursorY += this.rootCountSlider.height + ROW_GAP
    this.depthSlider.container.position.set(PANEL_PADDING, cursorY)
    cursorY += this.depthSlider.height + ROW_GAP
    this.childMinSlider.container.position.set(PANEL_PADDING, cursorY)
    cursorY += this.childMinSlider.height + ROW_GAP
    this.childMaxSlider.container.position.set(PANEL_PADDING, cursorY)
    cursorY += this.childMaxSlider.height + PANEL_PADDING

    this.panelHeight = cursorY
    this.redrawBackground()

    this.unsubscribers.push(
      layoutEngine.subscribe((snapshot: LayoutSnapshot) => {
        this.statsLeft.setValue(`${snapshot.visibleCount}`)
        this.statsRight.setValue(`${snapshot.totalCount}`)
      }),
    )
  }

  resize(viewportWidth: number, viewportHeight: number) {
    const availableHeight = Math.max(220, viewportHeight - PANEL_Y * 2)
    const availableWidth = Math.max(260, viewportWidth - PANEL_X * 2)
    const scaleFromHeight = Math.min(1, availableHeight / this.panelHeight)
    const scaleFromWidth = Math.min(1, availableWidth / PANEL_WIDTH)

    this.panelScale = Math.min(scaleFromHeight, scaleFromWidth)
    this.container.position.set(PANEL_X, PANEL_Y)
    this.container.scale.set(this.panelScale)
  }

  containsPoint(x: number, y: number) {
    const left = this.container.position.x
    const top = this.container.position.y
    const width = PANEL_WIDTH * this.panelScale
    const height = this.panelHeight * this.panelScale

    return (
      x >= left &&
      x <= left + width &&
      y >= top &&
      y <= top + height
    )
  }

  destroy() {
    this.rootCountSlider.destroy()
    this.depthSlider.destroy()
    this.childMinSlider.destroy()
    this.childMaxSlider.destroy()
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
  }

  private redrawBackground() {
    drawCard(this.background, PANEL_WIDTH, this.panelHeight)
  }
}

export function createControlPanel(
  store: GraphStore,
  layoutEngine: GraphLayoutEngine,
  onRootCountChange?: (rootCount: number) => void,
  onDepthChange?: (depth: number) => void,
  onChildMinChange?: (childMin: number) => void,
  onChildMaxChange?: (childMax: number) => void,
) {
  return new ControlPanel(
    store,
    layoutEngine,
    onRootCountChange,
    onDepthChange,
    onChildMinChange,
    onChildMaxChange,
  )
}
