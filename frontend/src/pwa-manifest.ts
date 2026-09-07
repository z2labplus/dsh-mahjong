import { getBasePath } from './ws-url';

export function ensurePwaManifestLink(): void {
  if (typeof document === 'undefined') return;
  const basePath = getBasePath();
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const href = `${normalizedBase}manifest.webmanifest`;

  const absoluteHref = new URL(href, window.location.origin).toString();
  const existing = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;

  const link = existing ?? document.createElement('link');
  if (!existing) {
    link.rel = 'manifest';
    document.head.appendChild(link);
  }

  if (link.href !== absoluteHref) {
    link.href = href;
  }
}
