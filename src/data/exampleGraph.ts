export interface GraphNodeRecord {
  id: string
  label: string
  parentId: string | null
  children: string[]
  depth: number
  order: number
  rootId: string
}

export interface GraphDataset {
  nodes: Record<string, GraphNodeRecord>
  roots: string[]
  totalNodes: number
  maxDepth: number
}

interface GraphBranchInput {
  id: string
  label: string
  children?: GraphBranchInput[]
}

const graphDefinition: GraphBranchInput[] = [
  {
    id: 'atlas',
    label: 'Atlas',
    children: [
      {
        id: 'atlas-foundry',
        label: 'Foundry',
        children: [
          { id: 'atlas-foundry-ore', label: 'Ore Lens' },
          {
            id: 'atlas-foundry-forge',
            label: 'Forge Line',
            children: [
              {
                id: 'atlas-foundry-forge-a',
                label: 'Spark A',
                children: [
                  {
                    id: 'atlas-foundry-forge-a-ember',
                    label: 'Ember Trace',
                    children: [
                      {
                        id: 'atlas-foundry-forge-a-ember-map',
                        label: 'Kiln Map',
                        children: [
                          {
                            id: 'atlas-foundry-forge-a-ember-map-seam',
                            label: 'Seam Coil',
                            children: [
                              {
                                id: 'atlas-foundry-forge-a-ember-map-seam-core',
                                label: 'Core Tap',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                id: 'atlas-foundry-forge-b',
                label: 'Spark B',
                children: [
                  {
                    id: 'atlas-foundry-forge-b-glass',
                    label: 'Glass Thread',
                    children: [
                      {
                        id: 'atlas-foundry-forge-b-glass-vault',
                        label: 'Heat Vault',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { id: 'atlas-foundry-cooling', label: 'Cooling Bay' },
        ],
      },
      {
        id: 'atlas-harbor',
        label: 'Harbor',
        children: [
          { id: 'atlas-harbor-fleet', label: 'Fleet' },
          {
            id: 'atlas-harbor-signals',
            label: 'Signals',
            children: [
              { id: 'atlas-harbor-signals-east', label: 'East Relay' },
              { id: 'atlas-harbor-signals-west', label: 'West Relay' },
              { id: 'atlas-harbor-signals-north', label: 'North Relay' },
            ],
          },
        ],
      },
      {
        id: 'atlas-archives',
        label: 'Archives',
        children: [
          { id: 'atlas-archives-ledger', label: 'Ledger' },
          { id: 'atlas-archives-index', label: 'Index' },
        ],
      },
    ],
  },
  {
    id: 'boreal',
    label: 'Boreal',
    children: [
      {
        id: 'boreal-canopy',
        label: 'Canopy',
        children: [
          {
            id: 'boreal-canopy-birds',
            label: 'Bird Ring',
            children: [
              { id: 'boreal-canopy-birds-south', label: 'South Wing' },
              { id: 'boreal-canopy-birds-west', label: 'West Wing' },
            ],
          },
          { id: 'boreal-canopy-light', label: 'Light Well' },
        ],
      },
      {
        id: 'boreal-understory',
        label: 'Understory',
        children: [
          { id: 'boreal-understory-moss', label: 'Moss Field' },
          {
            id: 'boreal-understory-stream',
            label: 'Cold Stream',
            children: [
              { id: 'boreal-understory-stream-stones', label: 'Stone Bed' },
              { id: 'boreal-understory-stream-fish', label: 'Silver Fish' },
              {
                id: 'boreal-understory-stream-fog',
                label: 'Fog Pocket',
                children: [
                  {
                    id: 'boreal-understory-stream-fog-reed',
                    label: 'Reed Line',
                    children: [
                      {
                        id: 'boreal-understory-stream-fog-reed-hollow',
                        label: 'Hollow Reed',
                        children: [
                          {
                            id: 'boreal-understory-stream-fog-reed-hollow-drift',
                            label: 'Drift Nest',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { id: 'boreal-understory-ferns', label: 'Ferns' },
        ],
      },
      { id: 'boreal-roots', label: 'Root Vault' },
    ],
  },
  {
    id: 'meridian',
    label: 'Meridian',
    children: [
      {
        id: 'meridian-east',
        label: 'East Quarter',
        children: [
          { id: 'meridian-east-market', label: 'Market' },
          { id: 'meridian-east-plaza', label: 'Plaza' },
          {
            id: 'meridian-east-docks',
            label: 'Dock Loop',
            children: [
              { id: 'meridian-east-docks-a', label: 'Pier A' },
              { id: 'meridian-east-docks-b', label: 'Pier B' },
              { id: 'meridian-east-docks-c', label: 'Pier C' },
            ],
          },
        ],
      },
      {
        id: 'meridian-west',
        label: 'West Quarter',
        children: [
          { id: 'meridian-west-garden', label: 'Garden' },
          {
            id: 'meridian-west-hall',
            label: 'Hall',
            children: [
              {
                id: 'meridian-west-hall-amber',
                label: 'Amber Wing',
                children: [
                  {
                    id: 'meridian-west-hall-amber-archive',
                    label: 'Amber Archive',
                    children: [
                      {
                        id: 'meridian-west-hall-amber-archive-lower',
                        label: 'Lower Stack',
                        children: [
                          {
                            id: 'meridian-west-hall-amber-archive-lower-seal',
                            label: 'Seal Room',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              { id: 'meridian-west-hall-cinder', label: 'Cinder Wing' },
            ],
          },
        ],
      },
      { id: 'meridian-core', label: 'Core' },
      { id: 'meridian-gates', label: 'Gates' },
    ],
  },
  {
    id: 'solstice',
    label: 'Solstice',
    children: [
      {
        id: 'solstice-dawn',
        label: 'Dawn Deck',
        children: [
          { id: 'solstice-dawn-choir', label: 'Choir' },
          { id: 'solstice-dawn-beacons', label: 'Beacons' },
        ],
      },
      {
        id: 'solstice-noon',
        label: 'Noon Array',
        children: [
          {
            id: 'solstice-noon-prisms',
            label: 'Prisms',
            children: [
              { id: 'solstice-noon-prisms-red', label: 'Red Prism' },
              { id: 'solstice-noon-prisms-gold', label: 'Gold Prism' },
              { id: 'solstice-noon-prisms-teal', label: 'Teal Prism' },
            ],
          },
          { id: 'solstice-noon-mirror', label: 'Mirror Run' },
          { id: 'solstice-noon-lens', label: 'Lens Rack' },
        ],
      },
      {
        id: 'solstice-dusk',
        label: 'Dusk Ramp',
        children: [
          { id: 'solstice-dusk-lanterns', label: 'Lanterns' },
          {
            id: 'solstice-dusk-watch',
            label: 'Watch',
            children: [
              {
                id: 'solstice-dusk-watch-inner',
                label: 'Inner Watch',
                children: [
                  {
                    id: 'solstice-dusk-watch-inner-stair',
                    label: 'Stairwell',
                    children: [
                      {
                        id: 'solstice-dusk-watch-inner-stair-bell',
                        label: 'Bell Deck',
                        children: [
                          {
                            id: 'solstice-dusk-watch-inner-stair-bell-vigil',
                            label: 'Vigil Post',
                            children: [
                              {
                                id: 'solstice-dusk-watch-inner-stair-bell-vigil-star',
                                label: 'Star Latch',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              { id: 'solstice-dusk-watch-outer', label: 'Outer Watch' },
            ],
          },
        ],
      },
    ],
  },
]

function buildDataset(definition: GraphBranchInput[]): GraphDataset {
  const nodes: Record<string, GraphNodeRecord> = {}
  const roots = definition.map((node) => node.id)
  let maxDepth = 0

  const visit = (
    branch: GraphBranchInput,
    parentId: string | null,
    depth: number,
    order: number,
    rootId: string,
  ) => {
    const children = branch.children ?? []

    nodes[branch.id] = {
      id: branch.id,
      label: branch.label,
      parentId,
      children: children.map((child) => child.id),
      depth,
      order,
      rootId,
    }

    maxDepth = Math.max(maxDepth, depth + 1)

    children.forEach((child, index) => {
      visit(child, branch.id, depth + 1, index, rootId)
    })
  }

  definition.forEach((root, index) => {
    visit(root, null, 0, index, root.id)
  })

  return {
    nodes,
    roots,
    totalNodes: Object.keys(nodes).length,
    maxDepth,
  }
}

export const exampleGraph = buildDataset(graphDefinition)
