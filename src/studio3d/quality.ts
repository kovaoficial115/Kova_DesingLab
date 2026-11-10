// Calidad del visor 3D. El coste de la GPU crece con los píxeles dibujados (la tela tiene un
// sombreador por píxel y antialias): en un portátil con gráfica integrada, una ventana grande
// a densidad 2 no llega a 30 fps. Modos:
//  · adaptive: nítido en reposo; mientras gira o se arrastra un estampado baja la resolución
//    solo si los fotogramas van lentos (mide su duración real) y la recupera al parar.
//  · high / balanced / fast: resolución fija.

export type QualityMode = 'adaptive' | 'high' | 'balanced' | 'fast';
export const QUALITY_LABELS: Record<QualityMode, string> = { adaptive: 'Adaptativa', high: 'Alta', balanced: 'Equilibrada', fast: 'Rápida' };
export const QUALITY_HINTS: Record<QualityMode, string> = {
  adaptive: 'Nítida en reposo; más ligera al girar si el equipo va justo',
  high: 'Siempre a la máxima resolución de la pantalla',
  balanced: 'Tres cuartos de la resolución',
  fast: 'Media resolución: para equipos lentos',
};
export const isQuality = (v: unknown): v is QualityMode => typeof v === 'string' && v in QUALITY_LABELS;

/** Píxeles de dibujo como máximo en reposo (≈ 1600 × 1600). Más allá apenas se nota y cuesta mucho. */
export const PIXEL_BUDGET = 2_600_000;
/** Factores de resolución del modo adaptativo, de más nítido a más ligero. */
export const LEVELS = [1, 0.75, 0.5] as const;
const FIXED: Record<Exclude<QualityMode, 'adaptive'>, number> = { high: 1, balanced: 0.75, fast: 0.5 };

/** Densidad de píxeles base para un lienzo de `w`×`h` px CSS. */
export function basePixelRatio(dpr: number, w: number, h: number, mode: QualityMode, budget = PIXEL_BUDGET) {
  const max = Math.min(Math.max(1, dpr || 1), 2);
  if (mode === 'high') return max;
  // con pantallas muy grandes se limita el total de píxeles, sin bajar nunca de 1
  return Math.min(max, Math.max(1, Math.sqrt(budget / Math.max(1, w * h))));
}

/** Factor de resolución a aplicar ahora. */
export function qualityScale(mode: QualityMode, level: number, moving: boolean) {
  if (mode !== 'adaptive') return FIXED[mode];
  return moving ? LEVELS[Math.min(LEVELS.length - 1, Math.max(0, level))] : 1;
}

/**
 * Decide el nivel del modo adaptativo a partir de la duración de los fotogramas en movimiento:
 * mediana de `window` fotogramas por encima de `slowMs` → baja un nivel; por debajo de `fastMs`
 * en tres tandas seguidas → sube uno, salvo que ese nivel ya se quedara corto antes.
 */
export class FrameGovernor {
  level = 0;
  private samples: number[] = [];
  private calm = 0;
  private failed = new Set<number>();
  constructor(private window = 30, private slowMs = 34, private fastMs = 20) {}

  /** Devuelve true si cambió el nivel. Ignora pausas largas (pestaña oculta, recolección de memoria). */
  push(dtMs: number): boolean {
    if (!(dtMs > 0) || dtMs > 250) return false;
    this.samples.push(dtMs);
    if (this.samples.length < this.window) return false;
    const med = [...this.samples].sort((a, b) => a - b)[this.samples.length >> 1];
    this.samples = [];
    if (med > this.slowMs && this.level < LEVELS.length - 1) {
      this.failed.add(this.level);
      this.level++; this.calm = 0;
      return true;
    }
    if (med < this.fastMs && this.level > 0) {
      if (++this.calm >= 3) {
        this.calm = 0;
        if (!this.failed.has(this.level - 1)) { this.level--; return true; }
      }
    } else this.calm = 0;
    return false;
  }

  reset() { this.level = 0; this.samples = []; this.calm = 0; this.failed.clear(); }
}
