import { useEffect, useState } from 'react';

/**
 * Theme preference layer.
 *
 * Three preferences are supported: an explicit `light` / `dark` choice, plus
 * `system` which follows the OS setting live. The resolved theme is painted
 * onto `<html>` as the `dark` class (what Tailwind reads) and as the native
 * `color-scheme` property (what scrollbars and form controls read).
 *
 * The module paints on import so the very first render already has the right
 * surfaces — no light flash before React mounts.
 */

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'atomforge.theme';

/** Subscribers kept outside React so every toggle instance stays in sync. */
const listeners = new Set<() => void>();

let current: ThemePref = 'system';

function isPref(value: unknown): value is ThemePref {
  return value === 'light' || value === 'dark' || value === 'system';
}

function darkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

export function systemPrefersDark(): boolean {
  return darkQuery()?.matches ?? true;
}

export function readThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isPref(raw)) return raw;
  } catch {
    /* storage unavailable (private mode) — fall back to system */
  }
  return 'system';
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

function paint(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function setThemePref(pref: ThemePref): void {
  current = pref;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore — the in-memory preference still applies for this session */
  }
  paint(resolveTheme(pref));
  notify();
}

export function getThemePref(): ThemePref {
  return current;
}

/** Idempotent: safe to call again from app bootstrap. */
export function initTheme(): void {
  current = readThemePref();
  paint(resolveTheme(current));
}

initTheme();

darkQuery()?.addEventListener('change', () => {
  if (current !== 'system') return;
  paint(resolveTheme('system'));
  notify();
});

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => current);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(current));

  useEffect(() => {
    const sync = () => {
      setPref(current);
      setResolved(resolveTheme(current));
    };
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  return { pref, resolved, setPref: setThemePref };
}