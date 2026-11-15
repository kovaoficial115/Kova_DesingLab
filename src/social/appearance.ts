// Apariencia de los simuladores de vista previa (Instagram, Reels, Behance…). Solo cambia la
// interfaz SIMULADA alrededor del diseño (fondo de la app, textos, iconos, separadores); nunca los
// colores del diseño ni lo que se exporta. Funciones puras.

export type SimAppearance = 'light' | 'dark' | 'system';

export const SIM_APPEARANCES: { value: SimAppearance; label: string; title: string }[] = [
  { value: 'light', label: 'Claro', title: 'Interfaz simulada en modo claro' },
  { value: 'dark', label: 'Oscuro', title: 'Interfaz simulada en modo oscuro' },
  { value: 'system', label: 'Sistema', title: 'Sigue el modo claro u oscuro de tu equipo' },
];

export const sanitizeSimAppearance = (v: unknown): SimAppearance => (v === 'dark' || v === 'system' ? v : 'light');

/** ¿Se dibuja en oscuro? «Sistema» sigue la preferencia del equipo. */
export const resolveDark = (pref: SimAppearance, systemDark: boolean) => (pref === 'system' ? systemDark : pref === 'dark');
