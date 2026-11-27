// Server-side pathfinding for hex grid
// A* pathfinding with hex graph, respects territory borders

import { HexOwnership, WorldMapData } from '../shared/protocol';

export interface PathResult {
  path: number[];
  accessible: boolean;
  distance: number;
}

/**
 * A* pathfinding on hex grid
 * Only traverses through owned or neutral hexes
 */
export function findPath(
  fromHexId: number,
  toHexId: number,
  hexOwnership: HexOwnership[],
  worldHexes: WorldMapData['hexes'],
  playerId: string
): PathResult {
  if (fromHexId === toHexId) {
    return { path: [fromHexId], accessible: true, distance: 0 };
  }

  const start = fromHexId;
  const goal = toHexId;

  // Open set (priority queue by f-score)
  const openSet = new Set<number>([start]);
  const cameFrom = new Map<number, number>();
  
  const gScore = new Map<number, number>();
  gScore.set(start, 0);
  
  const fScore = new Map<number, number>();
  fScore.set(start, heuristic(start, goal, worldHexes));

  while (openSet.size > 0) {
    // Find node with lowest f-score
    let current = -1;
    let lowestF = Infinity;
    for (const node of openSet) {
      const f = fScore.get(node) || Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = node;
      }
    }

    if (current === goal) {
      return reconstructPath(cameFrom, current);
    }

    openSet.delete(current);

    const neighbors = worldHexes[current]?.neighbors || [];
    for (const neighbor of neighbors) {
      // Check if neighbor is traversable (owned by player or neutral)
      const ownership = hexOwnership[neighbor];
      if (ownership && ownership.ownerId && ownership.ownerId !== playerId) {
        continue; // Enemy territory - cannot pass through
      }

      const tentativeGScore = (gScore.get(current) || Infinity) + 1;
      const neighborGScore = gScore.get(neighbor) || Infinity;
      
      if (tentativeGScore < neighborGScore) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeGScore);
        fScore.set(neighbor, tentativeGScore + heuristic(neighbor, goal, worldHexes));
        openSet.add(neighbor);
      }
    }
  }

  return { path: [], accessible: false, distance: -1 };
}

/**
 * Find shortest attack paths from multiple selected hexes to a target
 * Returns paths from each frontline hex to target
 */
export function findAttackPaths(
  fromHexIds: number[],
  targetHexId: number,
  hexOwnership: HexOwnership[],
  worldHexes: Array<{ neighbors: number[] }>,
  playerId: string
): Map<number, { path: number[]; accessible: boolean }> {
  const results = new Map<number, { path: number[]; accessible: boolean }>();
  
  for (const fromHexId of fromHexIds) {
    // Only allow attacks from frontline hexes (those bordering enemy)
    const ownership = hexOwnership[fromHexId];
    if (!ownership || ownership.ownerId !== playerId) {
      results.set(fromHexId, { path: [], accessible: false });
      continue;
    }

    // Check if this hex is on frontline (borders enemy)
    const neighbors = worldHexes[fromHexId]?.neighbors || [];
    let isFrontline = false;
    for (const neighborId of worldHexes[fromHexId]?.neighbors || []) {
      const neighbor = hexOwnership[neighborId];
      if (neighbor && neighbor.ownerId && neighbor.ownerId !== playerId) {
        isFrontline = true;
        break;
      }
    }

    if (!isFrontline) {
      results.set(fromHexId, { path: [], accessible: false });
      continue;
    }

    const result = findPath(fromHexId, targetHexId, hexOwnership, 
      worldHexes as WorldMapData['hexes'], playerId);
    results.set(fromHexId, { path: result.path, accessible: result.accessible });
  }

  return results;
}

/**
 * Check if a hex is on the frontline (borders enemy territory)
 */
export function isFrontlineHex(
  hexId: number,
  hexOwnership: HexOwnership[],
  worldHexes: Array<{ neighbors: number[] }>,
  playerId: string
): boolean {
  const ownership = hexOwnership[hexId];
  if (!ownership || ownership.ownerId !== playerId) return false;

  for (const neighborId of worldHexes[hexId]?.neighbors || []) {
    const neighbor = hexOwnership[neighborId];
    if (neighbor && neighbor.ownerId && neighbor.ownerId !== playerId) {
      return true;
    }
  }
  return false;
}

/**
 * Get all frontline hexes for a player
 */
export function getFrontlineHexes(
  playerId: string,
  hexOwnership: HexOwnership[],
  worldHexes: Array<{ neighbors: number[] }>
): number[] {
  const frontline: number[] = [];
  for (const ownership of hexOwnership) {
    if (ownership.ownerId === playerId && isFrontlineHex(ownership.hexId, hexOwnership, worldHexes, playerId)) {
      frontline.push(ownership.hexId);
    }
  }
  return frontline;
}

// Heuristic: straight-line distance on hex grid (approximate)
function heuristic(a: number, b: number, worldHexes: WorldMapData['hexes']): number {
  const hexA = worldHexes[a];
  const hexB = worldHexes[b];
  if (!hexA || !hexB) return 0;
  
  // Approximate distance using hex centers
  const dx = hexA.center[0] - hexB.center[0];
  const dy = hexA.center[1] - hexB.center[1];
  const dz = hexA.center[2] - hexB.center[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function reconstructPath(cameFrom: Map<number, number>, current: number): PathResult {
  const path = [current];
  let currentNode = current;
  while (cameFrom.has(currentNode)) {
    currentNode = cameFrom.get(currentNode)!;
    path.unshift(currentNode);
  }
  return { path, accessible: true, distance: path.length - 1 };
}