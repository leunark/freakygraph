import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_EXAMPLE_GRAPH_SETTINGS,
  normalizeExampleGraphSettings,
  type ExampleGraphSettings,
} from './data/exampleGraph'
import type { LayoutSolverMode } from './engine/layoutEngine'
import {
  initPixiRenderer,
  type PixiRendererHandle,
  type RendererHudSnapshot,
} from './renderer/pixiRenderer'
import { GizmoPanel } from './ui/GizmoPanel'

function getInitialGizmoOpen() {
  if (typeof window === 'undefined') {
    return true
  }

  return window.innerWidth >= 920
}

const INITIAL_HUD_SNAPSHOT: RendererHudSnapshot = {
  visibleCount: 0,
  totalCount: 0,
  solverMode: 'cola',
}

function areGraphSettingsEqual(left: ExampleGraphSettings, right: ExampleGraphSettings) {
  return (
    left.rootCount === right.rootCount &&
    left.depth === right.depth &&
    left.childMinCount === right.childMinCount &&
    left.childMaxCount === right.childMaxCount
  )
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<PixiRendererHandle | null>(null)
  const graphSettingsRef = useRef<ExampleGraphSettings>(DEFAULT_EXAMPLE_GRAPH_SETTINGS)
  const solverModeRef = useRef<LayoutSolverMode>('cola')
  const [gizmoOpen, setGizmoOpen] = useState(getInitialGizmoOpen)
  const [graphSettings, setGraphSettings] = useState<ExampleGraphSettings>(
    DEFAULT_EXAMPLE_GRAPH_SETTINGS,
  )
  const [hudSnapshot, setHudSnapshot] =
    useState<RendererHudSnapshot>(INITIAL_HUD_SNAPSHOT)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    let disposed = false
    let unsubscribe: (() => void) | null = null

    void initPixiRenderer(canvas).then((nextHandle) => {
      if (disposed) {
        nextHandle.destroy()
        return
      }

      rendererRef.current = nextHandle
      unsubscribe = nextHandle.subscribe((snapshot) => {
        solverModeRef.current = snapshot.solverMode
        setHudSnapshot(snapshot)
      })
      nextHandle.updateGraphSettings(graphSettingsRef.current)
      nextHandle.updateSolverMode(solverModeRef.current)
    })

    return () => {
      disposed = true
      unsubscribe?.()
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    graphSettingsRef.current = graphSettings
    rendererRef.current?.updateGraphSettings(graphSettings)
  }, [graphSettings])

  useEffect(() => {
    if (!gizmoOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGizmoOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [gizmoOpen])

  const updateGraphSettings = (
    recipe: (current: ExampleGraphSettings) => ExampleGraphSettings,
  ) => {
    setGraphSettings((current) => {
      const next = normalizeExampleGraphSettings(recipe(current))

      return areGraphSettingsEqual(current, next)
        ? current
        : next
    })
  }

  return (
    <div className="app-shell">
      <canvas ref={canvasRef} className="graph-canvas" />
      <GizmoPanel
        open={gizmoOpen}
        graphSettings={graphSettings}
        solverMode={hudSnapshot.solverMode}
        stats={hudSnapshot}
        onToggle={() => setGizmoOpen((current) => !current)}
        onRootCountChange={(value) => {
          updateGraphSettings((current) => ({
            ...current,
            rootCount: value,
          }))
        }}
        onDepthChange={(value) => {
          updateGraphSettings((current) => ({
            ...current,
            depth: value,
          }))
        }}
        onChildMinChange={(value) => {
          updateGraphSettings((current) => ({
            ...current,
            childMinCount: value,
            childMaxCount: Math.max(current.childMaxCount, value),
          }))
        }}
        onChildMaxChange={(value) => {
          updateGraphSettings((current) => ({
            ...current,
            childMinCount: Math.min(current.childMinCount, value),
            childMaxCount: value,
          }))
        }}
        onSolverModeChange={(value) => {
          solverModeRef.current = value
          setHudSnapshot((current) => ({
            ...current,
            solverMode: value,
          }))
          rendererRef.current?.updateSolverMode(value)
        }}
        onExpandAll={() => rendererRef.current?.expandAll()}
        onCollapseAll={() => rendererRef.current?.collapseAll()}
        onFitToScreen={() => rendererRef.current?.fitToScreen()}
      />
    </div>
  )
}

export default App
