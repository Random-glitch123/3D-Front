// Server-side dynamic territory computation
// Computes territories from hex ownership - no predefined countries

import { HexOwnership, Territory, TerritoryBorder, WorldMapData } from '../shared/protocol';

/**
 * Compute all territories from current hex ownership
 * Territories emerge dynamically from ownership patterns
 */
export function computeTerritories(
  hexOwnership: HexOwnership[],
  worldHexes: WorldMapData['hexes']
): Map<string, Territory> {
  // Group hexes by owner
  const ownerHexes = new Map<string, number[]>();
  for (const h of hexOwnership) {
    if (h.ownerId) {
      const existing = ownerHexes.get(h.ownerId);
      if (existing) {
        existing.push(h.hexId);
      } else {
        ownerHexes.set(h.ownerId, [h.hexId]);
      }
    }
  }

  const territories = new Map<string, Territory>();

  // For each player, compute their territory
  for (const [ownerId, hexIds] of ownerHexes) {
    const territory: Territory = {
      ownerId,
      hexIds: [...hexIds],
      borderHexIds: [],
      frontlineHexIds: [],
      interiorHexIds: [],
      neighboringTerritories: new Map()
    };

    // Classify each hex
    for (const hexId of hexIds) {
      const neighbors = worldHexes[hexId]?.neighbors || [];
      let enemyNeighbors = 0;
      let neutralNeighbors = 0;
      let friendlyNeighbors = 0;

      for (const neighborId of neighbors) {
        const neighbor = hexOwnership[neighborId];
        if (!neighbor || !neighbor.ownerId) {
          neutralNeighbors++;
        } else if (neighbor.ownerId === hexOwnership[hexId]?.ownerId) {
          friendlyNeighbors++;
        } else {
          enemyNeighbors++;
        }
      }

      if (enemyNeighbors > 0) {
        territory.frontlineHexIds.push(hexId);
      } else if (neutralNeighbors > 0) {
        territory.borderHexIds.push(hexId);
      } else {
        territory.interiorHexIds.push(hexId);
      }
    }

    territories.set(ownerId, territory);
  }

  // Compute borders between neighboring territories
  for (const [ownerId, territory] of territories) {
    const neighboringTerritories = new Map<string, { enemyId: string; borderHexIds: number[]; enemyBorderHexIds: number[]; length: number }>();

    for (const hexId of territory.frontlineHexIds) {
      const neighbors = worldHexes[hexId]?.neighbors || [];
      for (const neighborId of neighbors) {
        const neighbor = hexOwnership[neighborId];
        if (neighbor && neighbor.ownerId && neighbor.ownerId !== territory.ownerId) {
          const enemyId = neighbor.ownerId;
          let border = neighboringTerritories.get(enemyId);
          if (!border) {
            border = { enemyId, borderHexIds: [], enemyBorderHexIds: [], length: 0 };
            neighboringTerritories.set(enemyId, border);
          }
          border.borderHexIds.push(hexId);
          border.enemyBorderHexIds.push(neighborId);
          border.length++;
        }
      }

      territory.neighboringTerritories = neighboringTerritories;
    }

    // Also check border hexes for enemy neighbors (in case frontline missed some)
    for (const hexId of territory.borderHexIds) {
      const neighbors = worldHexes[hexId]?.neighbors || [];
      for (const neighborId of neighbors) {
        const neighbor = hexOwnership[neighborId];
        if (neighbor && neighbor.ownerId && neighbor.ownerId !== hexOwnership[hexId]?.ownerId) {
          const enemyId = neighbor.ownerId;
          let border = territory.neighboringTerritories.get(enemyId);
          if (!border) {
            border = { enemyId, borderHexIds: [], enemyBorderHexIds: [], length: 0 };
            territory.neighboringTerritories.set(enemyId, border);
          }
          // Only add if not already in frontline
          if (!territory.frontlineHexIds.includes(hexId)) {
            border.borderHexIds.push(hexId);
            border.enemyBorderHexIds.push(neighborId);
            border.length++;
          }
        }
      }
    }
  }

  return territories;
}

/**
 * Get territory for a specific hex
 */
export function getTerritoryForHex(
  hexId: number,
  territories: Map<string, Territory>
): Territory | null {
  for (const territory of territories.values()) {
    if (territory.hexIds.includes(hexId)) {
      return territory;
    }
  }
  return null;
}

/**
 * Get territory classification for a hex (for rendering)
 * Returns: 0 = interior, 1 = border, 2 = frontline, -1 = unowned/neutral
 */
export function getHexTerritoryType(
  hexId: number,
  hexOwnership: HexOwnership[],
  worldHexes: Array<{ neighbors: number[] }>
): number {
  const ownership = hexOwnership[hexId];
  if (!ownership || !ownership.ownerId) return -1; // Neutral

  const ownerId = ownership.ownerId;
  const neighbors = worldHexes[hexId]?.neighbors || [];

  let enemyNeighbors = 0;
  let neutralNeighbors = 0;

  for (const neighborId of neighbors) {
    const neighbor = hexOwnership[neighborId];
    if (!neighbor || !neighbor.ownerId) {
      neutralNeighbors++;
    } else if (neighbor.ownerId !== ownerId) {
      return 2; // Frontline - directly borders enemy
    }
  }

  if (neutralNeighbors > 0) return 1; // Border - touches neutral
  return 0; // Interior - fully surrounded by own
}