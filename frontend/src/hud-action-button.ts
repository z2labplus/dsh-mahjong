import { createHudLucideIcon, type HudLucideIconName, setHudLucideIcon } from './hud-lucide';

export type HudActionButtonParts = {
  iconSvg: SVGSVGElement;
  labelEl: HTMLSpanElement;
};

export function initHudActionButton(
  btn: HTMLButtonElement,
  params: { label: string; icon: HudLucideIconName; kind?: string; title?: string },
): HudActionButtonParts {
  btn.classList.add('mj-hud-btn');
  if (params.kind) {
    btn.dataset.kind = params.kind;
  }
  if (params.title) {
    btn.title = params.title;
  }
  // Clear and rebuild: avoids relying on existing DOM structure from HTML.
  btn.textContent = '';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'mj-hud-btn-icon';
  const iconSvg = createHudLucideIcon(params.icon);
  iconSvg.setAttribute('aria-hidden', 'true');
  iconWrap.appendChild(iconSvg);

  const labelEl = document.createElement('span');
  labelEl.className = 'mj-hud-btn-label';
  labelEl.textContent = params.label;

  btn.appendChild(iconWrap);
  btn.appendChild(labelEl);

  return { iconSvg, labelEl };
}

export function setHudActionButtonIcon(parts: HudActionButtonParts, icon: HudLucideIconName): void {
  setHudLucideIcon(parts.iconSvg, icon);
}

