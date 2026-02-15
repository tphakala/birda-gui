import { Mutex } from 'async-mutex';
import { loadSettings, saveSettings } from './loader';
import type { AppSettings } from '$shared/types';

/**
 * Centralized settings store with mutex protection to prevent race conditions.
 * All settings modifications must go through this store to ensure atomicity.
 *
 * Race condition scenario (without mutex):
 *   Thread 1: Read settings → { theme: 'light', model: 'birdnet-v24' }
 *   Thread 2: Read settings → { theme: 'light', model: 'birdnet-v24' }
 *   Thread 1: Write { ...current, theme: 'dark' }
 *   Thread 2: Write { ...current, model: 'new-model' } ← overwrites Thread 1's change!
 *
 * With mutex protection:
 *   Thread 1: Acquire lock → Read → Modify → Write → Release lock
 *   Thread 2: Wait for lock → Read → Modify → Write → Release lock
 */
class SettingsStore {
  private mutex = new Mutex();
  private cache: AppSettings | null = null;

  /**
   * Load settings with caching. Cache is invalidated on each update.
   * Safe for concurrent access (read-only operation).
   */
  async get(): Promise<AppSettings> {
    // Use cached value if available to reduce file I/O
    if (this.cache) {
      return this.cache;
    }

    // No mutex needed for initial load (read-only)
    this.cache = await loadSettings();
    return this.cache;
  }

  /**
   * Atomically update settings with partial values.
   * Guarantees no concurrent modifications can overwrite each other.
   *
   * @param partial - Partial settings to merge with current settings
   * @returns The updated complete settings object
   */
  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    return await this.mutex.runExclusive(async () => {
      // Load current settings inside the critical section
      const current = await loadSettings();

      // Merge partial update
      const updated = { ...current, ...partial };

      // Write to disk
      await saveSettings(updated);

      // Update cache
      this.cache = updated;

      return updated;
    });
  }

  /**
   * Replace entire settings object (used for initialization or reset).
   * Guarantees atomicity with other updates.
   *
   * @param settings - Complete settings object to save
   */
  async set(settings: AppSettings): Promise<void> {
    await this.mutex.runExclusive(async () => {
      await saveSettings(settings);
      this.cache = settings;
    });
  }

  /**
   * Invalidate cache to force fresh read on next get().
   * Use when external processes might modify settings file.
   */
  invalidateCache(): void {
    this.cache = null;
  }
}

// Singleton instance - shared across all IPC handlers
export const settingsStore = new SettingsStore();
