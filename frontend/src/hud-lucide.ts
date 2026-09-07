export type HudLucideIconName =
  | 'maximize2'
  | 'minimize2'
  | 'house'
  | 'bookOpen'
  | 'circleHelp'
  | 'history'
  | 'settings'
  | 'sparkles'
  | 'barChart3'
  | 'bot'
  | 'brain'
  | 'send'
  | 'x'
  | 'arrowLeft'
  | 'arrowRight'
  | 'refreshCw'
  | 'split'
  | 'chatgpt';

const ICON_PATHS: Record<HudLucideIconName, Array<string>> = {
  // From lucide-static (ISC): https://unpkg.com/lucide-static/
  maximize2: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'],
  minimize2: ['m14 10 7-7', 'M20 10h-6V4', 'm3 21 7-7', 'M4 14h6v6'],
  house: [
    'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8',
    'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ],
  bookOpen: [
    'M12 7v14',
    'M3 18a1 1 0 0 1 1-1h8',
    'M19 18a1 1 0 0 0-1-1h-8',
    'M3 5a2 2 0 0 1 2-2h7',
    'M21 5a2 2 0 0 0-2-2h-7',
  ],
  circleHelp: ['M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
  history: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
  settings: [
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.15.08a2 2 0 0 1-2-.03l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.17a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2-.03l.15.08a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.15-.08a2 2 0 0 1 2 .03l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.16a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 .03l-.15-.08a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  ],
  arrowLeft: ['m12 19-7-7 7-7', 'M19 12H5'],
  arrowRight: ['m12 5 7 7-7 7', 'M5 12h14'],
  sparkles: [
    'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    'M20 2v4',
    'M22 4h-4',
    'M4 20a2 2 0 1 1 4 0a2 2 0 0 1-4 0',
  ],
  barChart3: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  bot: [
    'M12 2a1 1 0 1 0 0 2a1 1 0 1 0 0-2',
    'M12 4v4',
    'M7 10a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z',
    'M10 14h.01',
    'M14 14h.01',
    'M10 17h4',
  ],
  brain: [
    'M10 12C10 14.2091 11.7909 16 14 16C16.2091 16 18 14.2091 18 12C18 7.58172 14.4183 4 10 4C5.58172 4 2 7.58172 2 12C2 15.5841 3.57127 18.8012 6.06253 21',
    'M14 12C14 9.79086 12.2091 8 10 8C7.79086 8 6 9.79086 6 12C6 16.4183 9.58172 20 14 20C18.4183 20 22 16.4183 22 12C22 8.446 20.455 5.25285 18 3.05557',
  ],
  refreshCw: ['M21 2v6h-6', 'M3 12a9 9 0 0 1 15-6.7L21 8', 'M3 22v-6h6', 'M21 12a9 9 0 0 1-15 6.7L3 16'],
  send: ['M22 2L11 13', 'M22 2 15 22 11 13 2 9 22 2z'],
  x: ['M18 6 6 18', 'M6 6 18 18'],
  split: ['M12 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4z', 'M7 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4z', 'M17 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4z', 'M12 7v6', 'M12 13L7 17', 'M12 13L17 17'],
  // ChatGPT / OpenAI logomark (filled). Source: Bootstrap Icons "openai".
  chatgpt: [
    'M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z',
  ],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function clearSvgChildren(svg: SVGSVGElement): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

type HudLucideMeta = {
  viewBox?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
  strokeLinecap?: string;
  strokeLinejoin?: string;
};

const DEFAULT_META: Required<HudLucideMeta> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '2',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const ICON_META: Partial<Record<HudLucideIconName, HudLucideMeta>> = {
  chatgpt: { viewBox: '0 0 16 16', fill: 'currentColor', stroke: 'none', strokeWidth: '0' },
};

function applyHudLucideMeta(svg: SVGSVGElement, name: HudLucideIconName): void {
  const meta = { ...DEFAULT_META, ...(ICON_META[name] ?? {}) };
  svg.setAttribute('viewBox', meta.viewBox);
  svg.setAttribute('fill', meta.fill);
  svg.setAttribute('stroke', meta.stroke);
  svg.setAttribute('stroke-width', meta.strokeWidth);
  svg.setAttribute('stroke-linecap', meta.strokeLinecap);
  svg.setAttribute('stroke-linejoin', meta.strokeLinejoin);
}

export function setHudLucideIcon(svg: SVGSVGElement, name: HudLucideIconName): void {
  const paths = ICON_PATHS[name] ?? [];
  applyHudLucideMeta(svg, name);
  clearSvgChildren(svg);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
}

export function createHudLucideIcon(name: HudLucideIconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  setHudLucideIcon(svg, name);
  return svg;
}
