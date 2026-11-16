/**
 * shardSearch.ts: the search under a list of your shards (arkinox,
 * 2026-11-16: "search should filter results. folder trees open to reveal
 * matching folder names, and folders open to reveal matching shards").
 *
 * Pure, so a test can pin it down. A match is a case-insensitive substring
 * of a name, a shard's or a folder's. Over the drawn tree (buildTree):
 *
 * - a shard shows when its name matches;
 * - a folder whose name matches shows everything in it, and opens;
 * - a folder with a match anywhere under it shows, and opens, so the way
 *   down to every match is open;
 * - a folder inside a matching folder shows even with no match of its own,
 *   folded (a tap opens it);
 * - every other folder and shard is hidden.
 *
 * Which folders open is worked out here and never written to the folder
 * store: clearing the search puts every folder back as it was folded before.
 */

import type { FolderNode } from './shardFolders'

/** A query as matched: trimmed and lower-cased. Empty means no search. */
export function searchKey(query: string): string {
  return query.trim().toLowerCase()
}

/** Whether `text` holds `key` (a searchKey), ignoring case. An empty key matches everything. */
export function matches(text: string, key: string): boolean {
  return key === '' || text.toLowerCase().includes(key)
}

/**
 * Where `key` first sits in `text`, for the highlight: [start, end), or null.
 * Null as well when lower-casing changed the text's length (a few scripts do),
 * since the offsets would then point at the wrong letters.
 */
export function matchRange(text: string, key: string): [number, number] | null {
  if (key === '') return null
  const lower = text.toLowerCase()
  if (lower.length !== text.length) return null
  const at = lower.indexOf(key)
  return at < 0 ? null : [at, at + key.length]
}

/** The tree as a search draws it, and which folders it opens. */
export interface Filtered<T> {
  folders: FolderNode<T>[]
  items: T[]
  /** Folders the search opens: every match's folders above it, and every folder whose name matches. */
  open: Set<string>
}

/**
 * The drawn tree cut down to a search (rules above). `keep` is a folder
 * shown and opened whatever its name, as a match is: one just made, being
 * named. A folder's count becomes what it shows.
 */
export function filterTree<T>(
  built: { folders: readonly FolderNode<T>[]; items: readonly T[] },
  query: string,
  nameOf: (item: T) => string,
  keep?: string | null,
): Filtered<T> {
  const key = searchKey(query)
  const open = new Set<string>()
  const hit = (item: T): boolean => matches(nameOf(item), key)

  const walk = (node: FolderNode<T>, inside: boolean): { node: FolderNode<T>; found: boolean } | null => {
    const self = node.folder.id === keep || matches(node.folder.name, key)
    const all = inside || self
    const kids = node.folders.map((k) => walk(k, all)).filter((k): k is { node: FolderNode<T>; found: boolean } => k !== null)
    const items = all ? node.items : node.items.filter(hit)
    const found = self || items.some(hit) || kids.some((k) => k.found)
    if (!found && !inside) return null
    if (found) open.add(node.folder.id)
    const folders = kids.map((k) => k.node)
    return { node: { folder: node.folder, folders, items, count: items.length + folders.reduce((n, f) => n + f.count, 0) }, found }
  }

  const folders = built.folders.map((n) => walk(n, false)).filter((k) => k !== null).map((k) => k!.node)
  return { folders, items: built.items.filter(hit), open }
}
