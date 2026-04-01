import type { ChangeEvent } from 'react'
import {
  MAX_CHILD_COUNT,
  MAX_EXAMPLE_DEPTH,
  MAX_EXAMPLE_ROOT_COUNT,
  MIN_CHILD_COUNT,
  MIN_EXAMPLE_DEPTH,
  MIN_EXAMPLE_ROOT_COUNT,
  type ExampleGraphSettings,
} from '../data/exampleGraph'
import type { RendererHudSnapshot } from '../renderer/pixiRenderer'

interface GizmoPanelProps {
  open: boolean
  graphSettings: ExampleGraphSettings
  stats: RendererHudSnapshot
  onToggle: () => void
  onRootCountChange: (value: number) => void
  onDepthChange: (value: number) => void
  onChildMinChange: (value: number) => void
  onChildMaxChange: (value: number) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onFitToScreen: () => void
}

interface RangeFieldProps {
  id: string
  label: string
  min: number
  max: number
  value: number
  onChange: (value: number) => void
}

function RangeField({ id, label, min, max, value, onChange }: RangeFieldProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(Number.parseInt(event.target.value, 10))
  }

  return (
    <label className="gizmo-control" htmlFor={id}>
      <span className="gizmo-control-row">
        <span>{label}</span>
        <output htmlFor={id}>{value}</output>
      </span>
      <input
        id={id}
        className="gizmo-range"
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={handleChange}
      />
      <span className="gizmo-control-hint">
        {min} to {max}
      </span>
    </label>
  )
}

export function GizmoPanel({
  open,
  graphSettings,
  stats,
  onToggle,
  onRootCountChange,
  onDepthChange,
  onChildMinChange,
  onChildMaxChange,
  onExpandAll,
  onCollapseAll,
  onFitToScreen,
}: GizmoPanelProps) {
  return (
    <div className="gizmo-shell">
      <button
        type="button"
        className="gizmo-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="gizmo-panel"
      >
        {open ? 'Hide Gizmo' : 'Show Gizmo'}
      </button>

      {open ? (
        <aside id="gizmo-panel" className="gizmo-panel">
          <div className="gizmo-header">
            <p className="gizmo-eyebrow">Graph Controls</p>
            <h1>Gizmo</h1>
            <p className="gizmo-copy"></p>
          </div>

          <section className="gizmo-section">
            <div className="gizmo-stats">
              <div className="gizmo-stat-card">
                <span>Visible Nodes</span>
                <strong>{stats.visibleCount}</strong>
              </div>
              <div className="gizmo-stat-card">
                <span>Total Nodes</span>
                <strong>{stats.totalCount}</strong>
              </div>
            </div>
          </section>

          <section className="gizmo-section">
            <div className="gizmo-section-header">
              <h2>Actions</h2>
            </div>
            <div className="gizmo-actions">
              <button type="button" className="gizmo-action" onClick={onExpandAll}>
                Expand All
              </button>
              <button type="button" className="gizmo-action" onClick={onCollapseAll}>
                Collapse All
              </button>
              <button
                type="button"
                className="gizmo-action gizmo-action-wide"
                onClick={onFitToScreen}
              >
                Fit To Screen
              </button>
            </div>
          </section>

          <section className="gizmo-section">
            <div className="gizmo-section-header">
              <h2>Graph</h2>
            </div>
            <div className="gizmo-control-list">
              <RangeField
                id="root-count"
                label="Root Nodes"
                min={MIN_EXAMPLE_ROOT_COUNT}
                max={MAX_EXAMPLE_ROOT_COUNT}
                value={graphSettings.rootCount}
                onChange={onRootCountChange}
              />
              <RangeField
                id="graph-depth"
                label="Depth"
                min={MIN_EXAMPLE_DEPTH}
                max={MAX_EXAMPLE_DEPTH}
                value={graphSettings.depth}
                onChange={onDepthChange}
              />
              <RangeField
                id="child-min"
                label="Children Min"
                min={MIN_CHILD_COUNT}
                max={MAX_CHILD_COUNT}
                value={graphSettings.childMinCount}
                onChange={onChildMinChange}
              />
              <RangeField
                id="child-max"
                label="Children Max"
                min={MIN_CHILD_COUNT}
                max={MAX_CHILD_COUNT}
                value={graphSettings.childMaxCount}
                onChange={onChildMaxChange}
              />
            </div>
          </section>

        </aside>
      ) : null}
    </div>
  )
}
