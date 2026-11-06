// Colores de marca KOVA para lo que se dibuja en <canvas> (el resto usa las variables CSS de styles.css).
// Manual de marca 3.3: azul marino #00001F (base), arena #F0E7DE (neutro) y escarlata #D21625 (acento).
export const KOVA = {
  navy: '#00001F',
  arena: '#F0E7DE',
  red: '#D21625',
  font: "Satoshi, system-ui, -apple-system, 'Segoe UI', sans-serif",
  redA: (a: number) => `rgba(210,22,37,${a})`,
  arenaA: (a: number) => `rgba(240,231,222,${a})`,
} as const;
