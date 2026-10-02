/** The part of a canvas the probe needs, so tests can pass fakes. */
interface ProbeCanvas {
  getContext(id: 'webgl2'): unknown;
}

interface ProbeContext {
  getExtension(name: 'WEBGL_lose_context'): { loseContext(): void } | null;
}

/**
 * Whether this system gives out a WebGL 2 context. MapLibre 6 needs one and
 * throws when it cannot get it.
 */
export function supportsWebGL2(createCanvas: () => ProbeCanvas = () => document.createElement('canvas')): boolean {
  try {
    const gl = createCanvas().getContext('webgl2') as ProbeContext | null;
    if (!gl) return false;
    // Free the probe context so it does not count against the browser's context limit.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
