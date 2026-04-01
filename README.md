# FreakyGraph

FreakyGraph is an interactive viewer for expandable tree and forest structures.

Its layout is built for a specific problem: when branches expand or collapse, the graph should reflow without turning into a tangled force-directed mess. The goal is not perfect geometric packing. The goal is a layout that stays readable, responsive, and directionally stable as the visible graph changes.

## Getting Started

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Current Layout

FreakyGraph now uses a custom deterministic orbit layout. There is no force solver and no WebCola dependency anymore.

The engine only lays out what is currently visible. Hidden branches are excluded from the active layout problem, which keeps expand and collapse interactions fast even at larger depths.

Each node carries two spatial estimates:
- `boxRadius`: the local body of the node and its immediate branch.
- `footprintRadius`: the full visible subtree size that has to stay clear of sibling subtrees.

Children orbit around their parent on a full 360 degree ring. If sibling subtrees would collide, the ring radius expands. If there is spare circumference, the extra space is distributed evenly around the ring so siblings stay balanced instead of bunching into one direction.

Root families are laid out independently first, then packed apart afterward using their measured bounding boxes. That means one root family never influences the internal structure of another.

## Why This Works Better

- It is faster because there is no iterative physics solve during expand or collapse.
- It is easier to read because parent-child relationships stay explicit and radial.
- It is more stable because the same visible tree always produces the same structure.
- It matches the graph shape better because subtree size affects required ring space directly.

## Tradeoffs

- The subtree footprint is still a heuristic. It is deliberately simple and fast, not a mathematically optimal packing.
- Root families are packed as rectangular bounds after their internal orbit layout is finished, so inter-family packing is approximate rather than exact.
- The current tuning is optimized for clarity and responsiveness, not minimum area.

## Documentation

- Exact algorithm and implementation notes: [docs/layout-algorithm.md](docs/layout-algorithm.md)
- Main engine implementation: `src/engine/layoutEngine.ts`
