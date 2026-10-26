/**
 * Startup Academy light/dark theme. The rest of Metwork stays light; the
 * Academy follows the device by default and remembers a manual choice per
 * device. The theme is scoped to the Academy wrapper (`.dark` on that element
 * re-points the design tokens of globals.css), so leaving the Academy never
 * leaves the platform dark.
 */

export const ACADEMY_THEME_STORAGE_KEY = 'metwork-academy-theme';
export const ACADEMY_THEME_ROOT_ATTR = 'data-academy-theme';

export type AcademyThemePref = 'system' | 'light' | 'dark';

export function isThemePref(v: unknown): v is AcademyThemePref {
  return v === 'system' || v === 'light' || v === 'dark';
}

/**
 * Runs inline as the wrapper's first child, before paint, so a dark-mode
 * visitor never sees a light flash. Must stay dependency-free and tiny.
 */
export const ACADEMY_THEME_BOOTSTRAP = `(function(){try{var el=document.currentScript&&document.currentScript.parentElement;if(!el)return;var p=null;try{p=localStorage.getItem('${ACADEMY_THEME_STORAGE_KEY}')}catch(e){}var d=p==='dark'||(p!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);el.classList.toggle('dark',!!d);el.style.colorScheme=d?'dark':'light';el.setAttribute('data-theme-pref',p==='dark'||p==='light'?p:'system')}catch(e){}})();`;
