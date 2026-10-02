import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { supportsWebGL2 } from './webgl';

// MapLibre derives its worker URL from import.meta.url, which is empty when the
// renderer loads from file://, so every map fails with "Worker failed to load".
// ?worker&url bundles the worker into one self-contained asset. Importing this
// module from a map component runs this before the component creates its map.
setWorkerUrl(workerUrl);

let available = false;

/** Whether a map can be drawn here (WebGL 2 is present). A success is kept; a failure is probed again on the next call, in case it was temporary. */
export function mapAvailable(): boolean {
  available ||= supportsWebGL2();
  return available;
}
