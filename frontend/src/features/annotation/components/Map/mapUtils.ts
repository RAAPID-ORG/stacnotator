// Shared map utilities and constants

export const CROSSHAIR_SIZE = 20;
export const DEFAULT_CROSSHAIR_COLOR = 'ff0000';
export const PAN_DISTANCE_PIXELS = 100;
export const ZOOM_ANIMATION_MS = 200;
export const PAN_ANIMATION_MS = 150;
export const IMAGERY_CACHE_SIZE = 128;
export const BASEMAP_CACHE_SIZE = 512;
export const EXTENT_LAYER_Z_INDEX = 5;
export const ANNOTATION_LAYER_Z_INDEX = 10;

export function createCrosshairElement(color: string = DEFAULT_CROSSHAIR_COLOR): HTMLDivElement {
  const half = CROSSHAIR_SIZE / 2;
  const el = document.createElement('div');
  el.style.pointerEvents = 'none';
  el.style.width = `${CROSSHAIR_SIZE}px`;
  el.style.height = `${CROSSHAIR_SIZE}px`;
  el.innerHTML =
    `<svg width="${CROSSHAIR_SIZE}" height="${CROSSHAIR_SIZE}" xmlns="http://www.w3.org/2000/svg">` +
    `<line x1="0" y1="${half}" x2="${CROSSHAIR_SIZE}" y2="${half}" stroke="#${color}" stroke-width="1.5"/>` +
    `<line x1="${half}" y1="0" x2="${half}" y2="${CROSSHAIR_SIZE}" stroke="#${color}" stroke-width="1.5"/>` +
    `</svg>`;
  return el;
}

export function updateCrosshairColor(el: HTMLDivElement, color: string): void {
  const lines = el.querySelectorAll('line');
  lines.forEach((line) => line.setAttribute('stroke', `#${color}`));
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
