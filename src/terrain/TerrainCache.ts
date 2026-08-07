/**
 * TerrainCache.ts — Caches terrain K values for a large region to avoid recomputing on every move.
 *
 * Stores K values for a 3x3 grid region (105x105 cells). When the avatar moves
 * within the cached region, we just remap coordinates without calling the worker.
 * Only fetches new data when the avatar moves more than 1 grid radius from the
 * cache center.
 */

import { Vector2 } from 'three';

export interface CacheEntry {
  k: number; // 0-16 or 255 for uncomputed
  timestamp: number;
}

export class TerrainCache {
  private cache: Map<string, CacheEntry> = new Map();
  private center: Vector2 = new Vector2(0, 0);
  private readonly radius: number;
  private readonly ttl: number;

  constructor(radius: number = 52, ttl: number = 60000) {
    this.radius = radius; // 52 = 3 * 17 + 1, covers 3x3 visible grids
    this.ttl = ttl;
  }

  /**
   * Check if a coordinate is within the cached region.
   */
  isWithinCache(coord: Vector2): boolean {
    const dx = Math.abs(coord.x - this.center.x);
    const dy = Math.abs(coord.y - this.center.y);
    return dx <= this.radius && dy <= this.radius;
  }

  /**
   * Get K value from cache. Returns 255 if not cached or expired.
   */
  get(coord: Vector2): number {
    const key = `${coord.x},${coord.y}`;
    const entry = this.cache.get(key);
    
    if (!entry) return 255;
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return 255;
    }
    
    return entry.k;
  }

  /**
   * Store K value in cache.
   */
  set(coord: Vector2, k: number): void {
    const key = `${coord.x},${coord.y}`;
    this.cache.set(key, { k, timestamp: Date.now() });
  }

  /**
   * Get the current cache center.
   */
  getCenter(): Vector2 {
    return this.center.clone();
  }

  /**
   * Update cache center and prune entries outside new region.
   */
  setCenter(center: Vector2): void {
    this.center.copy(center);
    
    // Prune old entries outside new region
    for (const [key] of this.cache) {
      const [x, y] = key.split(',').map(Number);
      const coord = new Vector2(x, y);
      if (!this.isWithinCache(coord)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get coordinates that need computing (not in cache or expired).
   */
  getMissingCoordinates(center: Vector2, radius: number): Vector2[] {
    const missing: Vector2[] = [];
    const now = Date.now();
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const coord = new Vector2(center.x + dx, center.y + dy);
        const key = `${coord.x},${coord.y}`;
        const entry = this.cache.get(key);
        
        if (!entry || (now - entry.timestamp > this.ttl)) {
          missing.push(coord);
        }
      }
    }
    
    return missing;
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics for debugging.
   */
  getStats() {
    return {
      size: this.cache.size,
      center: this.center.clone(),
      radius: this.radius,
    };
  }
}

// Global singleton instance
export const terrainCache = new TerrainCache();
