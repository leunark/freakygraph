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

## Layout Approach

The graph only lays out what is currently visible. Hidden branches are excluded from the solve, which keeps the active problem much smaller and avoids paying layout cost for content the user cannot see.

Each visible node represents more than its drawn circle. It also carries an estimated footprint for the visible subtree beneath it. In practice, that means large expanded branches reserve more space than collapsed ones, so the solver separates subtrees based on what they visually occupy rather than just the center points of nodes.

Before the layout is refined, the graph is seeded with deterministic positions. That seed preserves a consistent directional structure, so repeated interactions do not cause the whole scene to rotate or reshuffle unnecessarily. A constrained solve then adjusts those positions to reduce overlap while keeping related nodes connected.

## Why This Works Well

This approach is fast because it solves only the visible graph and reduces each subtree to a compact spatial estimate instead of trying to model every overlap relationship explicitly.

It is stable because the layout starts from a predictable seed rather than a random or unconstrained force simulation. That helps preserve the user's mental map when expanding or collapsing branches.

It is a good fit for interactive trees because it balances structure and flexibility: families stay grouped, larger branches make room for themselves, and the whole scene can still adapt when visibility changes.

## Tradeoffs

The subtree footprint is a heuristic, not exact packing. That means layout quality depends on the estimate being good enough rather than mathematically perfect.

The solver improves readability and separation, but it does not guarantee an optimal layout. The design favors responsiveness and consistency over finding the globally best arrangement.

Compared with a generic full-graph force layout, this is usually more stable and more efficient for expandable trees. Compared with a custom recursive packing algorithm, it is easier to tune and extend, but less exact.
