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

interface MutableBranch {
  id: string
  label: string
  rootIndex: number
  children: MutableBranch[]
}

export const DEFAULT_EXAMPLE_ROOT_COUNT = 30
export const MIN_EXAMPLE_ROOT_COUNT = 1
export const DEFAULT_EXAMPLE_DEPTH = 3
export const MIN_EXAMPLE_DEPTH = 0
export const DEFAULT_CHILD_MIN_COUNT = 2
export const DEFAULT_CHILD_MAX_COUNT = 5
export const MIN_CHILD_COUNT = 0

const ROOT_LABELS = [
  'Atlas',
  'Boreal',
  'Meridian',
  'Solstice',
  'Aster',
  'Cinder',
]

const LABEL_PREFIXES = [
  'Amber',
  'Beacon',
  'Cinder',
  'Delta',
  'Echo',
  'Forge',
  'Grove',
  'Harbor',
  'Ivory',
  'Jade',
  'Keystone',
  'Lumen',
  'Morrow',
  'North',
  'Onyx',
  'Prairie',
  'Quartz',
  'Ridge',
  'Signal',
  'Tidal',
]

const LABEL_SUFFIXES = [
  'Array',
  'Archive',
  'Atrium',
  'Branch',
  'Circuit',
  'Cluster',
  'Field',
  'Gate',
  'Hall',
  'Harbor',
  'Line',
  'Loop',
  'Node',
  'Path',
  'Ring',
  'Spire',
  'Vault',
  'Watch',
  'Wing',
  'Yard',
]

function normalizeRootCount(targetRootCount: number) {
  return Math.max(MIN_EXAMPLE_ROOT_COUNT, Math.round(targetRootCount))
}

function normalizeDepth(targetDepth: number) {
  return Math.max(MIN_EXAMPLE_DEPTH, Math.round(targetDepth))
}

function normalizeChildCount(targetCount: number) {
  return Math.max(MIN_CHILD_COUNT, Math.round(targetCount))
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0 || 1

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function createLabel(index: number, depth: number, rootIndex: number) {
  const prefix = LABEL_PREFIXES[(index + rootIndex * 3 + depth) % LABEL_PREFIXES.length]
  const suffix =
    LABEL_SUFFIXES[
      (Math.floor(index / LABEL_PREFIXES.length) + rootIndex * 5 + depth * 2) %
        LABEL_SUFFIXES.length
    ]

  return `${prefix} ${suffix}`
}

function createRootBranch(index: number): MutableBranch {
  const label = ROOT_LABELS[index] ?? `Root ${index + 1}`

  return {
    id: slugify(label),
    label,
    rootIndex: index,
    children: [],
  }
}

function toBranchInput(branch: MutableBranch): GraphBranchInput {
  return {
    id: branch.id,
    label: branch.label,
    children: branch.children.map(toBranchInput),
  }
}

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

interface ExampleGraphOptions {
  rootCount?: number
  depth?: number
  childMinCount?: number
  childMaxCount?: number
}

export function createExampleGraph(
  options: number | ExampleGraphOptions = DEFAULT_EXAMPLE_ROOT_COUNT,
): GraphDataset {
  const normalizedOptions =
    typeof options === 'number'
      ? { rootCount: options }
      : options
  const rootCount = normalizeRootCount(
    normalizedOptions.rootCount ?? DEFAULT_EXAMPLE_ROOT_COUNT,
  )
  const maxDepth = normalizeDepth(
    normalizedOptions.depth ?? DEFAULT_EXAMPLE_DEPTH,
  )
  const childMinCount = normalizeChildCount(
    normalizedOptions.childMinCount ?? DEFAULT_CHILD_MIN_COUNT,
  )
  const childMaxCount = Math.max(
    childMinCount,
    normalizeChildCount(
      normalizedOptions.childMaxCount ?? DEFAULT_CHILD_MAX_COUNT,
    ),
  )
  const roots = Array.from({ length: rootCount }, (_, index) => createRootBranch(index))
  const random = createSeededRandom(
    rootCount * 2654435761 +
      maxDepth * 40503 +
      childMinCount * 7919 +
      childMaxCount * 15401,
  )
  let nextIndex = rootCount
  let parentLayer = roots

  for (let depth = 1; depth < maxDepth; depth += 1) {
    if (parentLayer.length === 0) {
      break
    }
    const nextLayer: MutableBranch[] = []

    for (const parent of parentLayer) {
      const childCount =
        childMinCount +
        Math.floor(random() * (childMaxCount - childMinCount + 1))

      for (let index = 0; index < childCount; index += 1) {
        const childIndex = parent.children.length
        const label = createLabel(nextIndex, depth, parent.rootIndex)
        const child: MutableBranch = {
          id: `${parent.id}-${slugify(label)}-${childIndex + 1}`,
          label,
          rootIndex: parent.rootIndex,
          children: [],
        }

        parent.children.push(child)
        nextLayer.push(child)
        nextIndex += 1
      }
    }

    parentLayer = nextLayer
  }

  return buildDataset(roots.map(toBranchInput))
}

export const exampleGraph = createExampleGraph({
  rootCount: DEFAULT_EXAMPLE_ROOT_COUNT,
  depth: DEFAULT_EXAMPLE_DEPTH,
  childMinCount: DEFAULT_CHILD_MIN_COUNT,
  childMaxCount: DEFAULT_CHILD_MAX_COUNT,
})
