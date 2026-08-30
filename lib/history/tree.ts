import type { Message, SessionTree } from "./types"

/** Normalize one Pi branch to the linear transcript renderer's message list. */
export function messagesForLeaf(tree: SessionTree, leafId: string): Message[] {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]))
  const path = []
  const seen = new Set<string>()
  let current = byId.get(leafId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path.reverse().flatMap((node) => (node.message ? [node.message] : []))
}

/** Leaves in source order, using Pi labels when present and stable fallbacks otherwise. */
export function branchOptions(
  tree: SessionTree,
  fallbackLabel: (branchNumber: number) => string
): { id: string; label: string }[] {
  const parents = new Set(tree.nodes.map((node) => node.parentId).filter(Boolean))
  const byId = new Map(tree.nodes.map((node) => [node.id, node]))
  return tree.nodes
    .filter((node) => !parents.has(node.id))
    .map((node, index) => {
      let current: typeof node | undefined = node
      let fallback = ""
      const seen = new Set<string>()
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        const label = current.label?.trim()
        if (label && current.kind === "label") return { id: node.id, label }
        if (!fallback && label) fallback = label
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
      return { id: node.id, label: fallback || fallbackLabel(index + 1) }
    })
}
