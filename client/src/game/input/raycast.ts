// Screen -> hex picking helpers.
//
// Babylon's Scene.createPickingRay signature is:
//   createPickingRay(x, y, world, camera)
// The THIRD argument is a world Matrix, not the camera. Passing a camera there
// throws "world.multiplyToRef is not a function". Always pass null/identity.
//
// Coordinates are canvas-relative CSS pixels (Babylon divides by the hardware
// scaling level internally, so devicePixelRatio is handled for us).

import { Vector3 } from '@babylonjs/core';
import type { Ray, Scene } from '@babylonjs/core';
import type { WorldMapData } from '../../shared/protocol';

export interface CanvasPoint {
  x: number;
  y: number;
}

/** Convert a mouse event to canvas-relative CSS pixels. */
export function eventToCanvasPoint(e: MouseEvent, canvas: HTMLCanvasElement): CanvasPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

/** Build a picking ray from canvas-relative CSS pixels. */
export function createScreenRay(scene: Scene, camera: any, x: number, y: number): Ray {
  return scene.createPickingRay(x, y, null, camera);
}

/** Ray/sphere intersection. Returns the nearest positive distance or null. */
export function raySphereDistance(ray: Ray, center: Vector3, radius: number): number | null {
  const oc = ray.origin.subtract(center);
  const a = Vector3.Dot(ray.direction, ray.direction);
  if (a <= 0) return null;

  const b = 2 * Vector3.Dot(ray.direction, oc);
  const c = Vector3.Dot(oc, oc) - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrt = Math.sqrt(discriminant);
  const t1 = (-b - sqrt) / (2 * a);
  const t2 = (-b + sqrt) / (2 * a);
  if (t1 > 1e-4) return t1;
  if (t2 > 1e-4) return t2;
  return null;
}

/**
 * Return the hex index under a canvas-relative CSS pixel, or -1 on a miss.
 *
 * Strategy: intersect the picking ray with the globe sphere, normalise the hit
 * point, then choose the hex whose centre is angularly closest. This is stable,
 * cheap (~10k dot products) and avoids Babylon mesh picking entirely.
 */
export function pickHexAtScreen(
  scene: Scene,
  camera: any,
  worldMap: WorldMapData,
  x: number,
  y: number,
): number {
  const radius = worldMap.meta.radius;
  const ray = createScreenRay(scene, camera, x, y);
  const t = raySphereDistance(ray, Vector3.Zero(), radius);
  if (t === null) return -1;

  const hit = ray.origin.add(ray.direction.scale(t)).normalize();
  const hexes = worldMap.hexes;

  let best = -1;
  let bestDot = -2;
  for (let i = 0; i < hexes.length; i++) {
    const c = hexes[i].center;
    const dot = hit.x * c[0] + hit.y * c[1] + hit.z * c[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}
