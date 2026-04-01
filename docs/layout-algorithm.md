# Layout Algorithm

This document describes the current FreakyGraph layout exactly as it is implemented in `src/engine/layoutEngine.ts`.

## Goals

The layout is optimized for these requirements:

1. Parent-child relationships must stay obvious.
2. Sibling subfamilies must not collide.
3. Expanding or collapsing a branch must stay fast.
4. Different root families must not affect each other internally.
5. The same visible graph should always produce the same structure.

Those goals are why the project now uses a deterministic geometric layout instead of a force solver.

## High-Level Pipeline

For every layout refresh, the engine does this:

1. Build the visible tree state from the current expanded set and max depth.
2. Compute subtree size estimates bottom-up.
3. Lay out each root family recursively with a full-ring orbit algorithm.
4. Measure each finished root family.
5. Pack root families apart as bounding boxes.
6. Publish a snapshot for the renderer.

There is no iterative solving phase.

## 1. Visible State

Code: `buildVisibleState(...)`

Only visible nodes participate in layout. A node's children are included only if:

- the node is expanded
- the node actually has children
- the child depth is still within the current depth cap

Hidden descendants are ignored completely. This is one of the main performance wins, because the layout cost scales with what the user can currently see.

## 2. Node Size Model

Each visible node stores:

- `boxRadius`
- `footprintRadius`
- `orbitRadius`

`boxRadius` is the local "body" size of the node and nearby branch.

`footprintRadius` is the total visible subtree radius that sibling branches need to avoid.

`orbitRadius` is the radius of the ring on which this node's direct children will be placed.

The helper `getOrbitInfluenceRadius(...)` compresses subtree size for some local calculations:

```ts
scaledFootprint = max(COLLAPSED_RADIUS, footprintRadius * subtreeScale)
subtreeExtra = max(0, scaledFootprint - boxRadius)
influenceRadius = boxRadius + subtreeExtra * SUBTREE_ORBIT_INFLUENCE
```

Current constants:

- `NODE_RADIUS = 30`
- `COLLAPSED_RADIUS = 46`
- `SUBTREE_ORBIT_INFLUENCE = 0.38`
- default `subtreeScale = 0.35`

Why:

- `footprintRadius` keeps sibling subfamilies from overlapping.
- `influenceRadius` keeps local branch sizing from growing too aggressively when a deep subtree is present.

## 3. Child Ring Sizing

Code: `getChildOrbitLayout(...)`

For a parent with visible children, the engine computes a ring that can hold every child subtree around the full 360 degree circumference.

### 3.1 Slot Width Per Child

Each child subtree gets a required arc width:

```ts
slotArcWidth = max(
  COLLAPSED_RADIUS * 1.7,
  child.footprintRadius * 2 + branchPadding * 0.5
)
```

This is intentionally based on the child's full `footprintRadius`, not the compressed influence radius. That is what prevents sibling subfamilies from colliding.

### 3.2 Minimum Ring Radius

The ring must be at least:

```ts
minOrbitRadius = NODE_RADIUS + maxChildFootprintRadius + branchPadding + 10
```

Why:

- children should sit outside the parent
- the largest child subtree needs immediate radial clearance
- `branchPadding` and the extra `10` keep the ring from feeling cramped

### 3.3 Gap Between Siblings

Each sibling gap starts with:

```ts
baseGapArc = siblingGap + branchPadding * 0.4 + NODE_RADIUS * 0.5
```

This means the ring reserves spacing not only for child subtree disks, but also for explicit air between siblings.

### 3.4 Required Circumference

For `n` children:

```ts
occupiedArc = sum(slotArcWidths) + baseGapArc * n
orbitRadius = max(minOrbitRadius, occupiedArc / (2 * PI))
```

This is the key rule: if the children do not fit on the circumference, the ring expands outward.

That is exactly why the layout can stay 360-degree orbital without letting siblings overlap.

### 3.5 Spare Circumference Distribution

If the ring has extra circumference:

```ts
availableArc = orbitRadius * 2 * PI
extraArc = max(0, availableArc - occupiedArc)
sharedExtraGapArc = extraArc / n
gapArc = baseGapArc + sharedExtraGapArc
```

Why:

- if there is more room than strictly required, the extra space is distributed evenly
- this keeps siblings balanced around the ring instead of bunching into one side

### 3.6 Single Child Special Case

If a parent has exactly one visible child:

- no ring gap is needed
- the child is placed on the incoming direction from the parent

This preserves a readable chain for long single-branch paths.

## 4. Recursive Placement

Code: `placeSubtree(...)`

The layout is then built recursively.

For each node:

1. Place the current node at `(x, y)`.
2. Compute the orbit layout for its visible children.
3. Choose where the "wrap gap" in the full circle should be.
4. Walk around the ring in arc-length order and place children.
5. Recurse into each child using its new position and direction.

### Wrap Gap Direction

The ring is full 360 degrees, but there is still one place where the sequence wraps around. That wrap gap is aligned like this:

- root node: gap points upward (`-PI / 2`)
- non-root node: gap points back toward the parent (`parentAngle + PI`)

Why:

- the open gap stays on the least important side of the ring
- child subtrees naturally occupy the space away from the incoming edge
- the graph reads like nested radial families instead of random circles

### Exact Placement Walk

For multi-child nodes, placement is done by accumulating actual arc length, not equal angles:

```ts
cursorAngle = wrapGapDirection + gapArc / orbitRadius / 2

for each child:
  cursorAngle += slotArcWidth / orbitRadius / 2
  place child at angle = cursorAngle
  cursorAngle += slotArcWidth / orbitRadius / 2
  cursorAngle += gapArc / orbitRadius
```

Why:

- larger subtrees consume more arc
- smaller subtrees consume less arc
- siblings stay evenly distributed relative to the space they actually need

## 5. Root Family Independence

Code: `buildFamilyLayout(...)`

Each root family is laid out independently starting from `(0, 0)`.

This means:

- one root family never changes the internal structure of another
- all subtree decisions are local to that family
- root-level interaction only happens later during family packing

This was a deliberate design decision because cross-family interaction made the graph harder to read and slower to update.

## 6. Root Family Packing

Code: `packFamilies(...)`

After every root family is laid out, the engine measures its bounding box using node positions plus `footprintRadius`.

Families are then packed into rows:

1. Estimate a target row width from total area and viewport aspect ratio.
2. Fill rows from left to right.
3. Start a new row when the next family would exceed the target width.
4. Center the rows overall.
5. Offset each family into its packed position.

The gap between families is:

```ts
rootGap + COLLISION_PADDING * 2
```

Why:

- this keeps different root families visually separate
- it avoids any need for inter-family solving
- it adapts reasonably well to portrait vs. landscape viewports

This packing is intentionally approximate. Internal family layout is the priority; root-family packing only has to keep families apart and use screen space reasonably well.

## 7. Snapshot Publication

Code: `publishSnapshot(...)`

The engine finally converts positioned nodes into a renderer snapshot containing:

- node positions
- edges
- bounds
- visible counts
- depth metadata

The renderer then animates visuals toward the new snapshot positions.

## Why This Algorithm Was Chosen

The current algorithm replaced the old solver-based approach because the orbit layout matched the real product goals better.

### Better Structural Readability

The graph is a tree or forest, so the layout should make parent-child ownership obvious. The orbit model does that directly:

- children orbit their parent
- siblings share the same ring
- subfamilies occupy stable local regions

### Better Performance

There is no iterative solve and no force simulation. Expand and collapse now cost roughly:

- visible subtree traversal
- subtree metric computation
- recursive geometry placement
- root-family packing

That is much cheaper and much more predictable than repeatedly solving constraints.

### Better Stability

The same visible structure produces the same layout. There is no solver drift, no accidental global rotation, and no cross-family tug-of-war.

### Better Handling of Dense Branches

The important rule is simple:

- if siblings do not fit, increase the orbit radius
- if there is spare circumference, spread it evenly

That directly matches the intended behavior for this graph.

## Known Tradeoffs

- Subtree size is still summarized by radii, so this is not an exact disk-packing solution.
- Root-family packing is rectangle-based rather than globally optimal.
- The algorithm favors clarity and determinism over absolute area efficiency.

Those tradeoffs are intentional. For FreakyGraph, readability and fast interaction matter more than perfect compaction.
