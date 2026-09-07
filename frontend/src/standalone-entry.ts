import { prepareStandaloneSession } from './standalone-session';

void prepareStandaloneSession().then(() => import('./hand')).catch((error: unknown) => {
  const text = document.getElementById('loading-text');
  const hint = document.getElementById('loading-hint');
  if (text) text.textContent = error instanceof Error ? error.message : '无法进入牌桌。';
  if (hint) hint.textContent = '请使用有效的牌局邀请链接。';
  document.getElementById('loading')?.setAttribute('aria-busy', 'false');
});
