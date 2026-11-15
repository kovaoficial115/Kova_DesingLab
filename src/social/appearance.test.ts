import { describe, it, expect } from 'vitest';
import { resolveDark, sanitizeSimAppearance, SIM_APPEARANCES } from './appearance';

describe('apariencia de los simuladores', () => {
  it('claro y oscuro son fijos; sistema sigue al equipo', () => {
    expect(resolveDark('light', true)).toBe(false);
    expect(resolveDark('dark', false)).toBe(true);
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
  });
  it('las preferencias guardadas dañadas vuelven a claro', () => {
    expect(sanitizeSimAppearance('dark')).toBe('dark');
    expect(sanitizeSimAppearance('system')).toBe('system');
    expect(sanitizeSimAppearance('neón')).toBe('light');
    expect(sanitizeSimAppearance(undefined)).toBe('light');
    expect(SIM_APPEARANCES.map(a => a.value)).toEqual(['light', 'dark', 'system']);
  });
});
