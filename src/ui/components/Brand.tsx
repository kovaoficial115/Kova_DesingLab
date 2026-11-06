import type React from 'react';
import kApp from '../../assets/brand/k-app.svg';
import spark from '../../assets/brand/spark4.svg';
import sparkDuo from '../../assets/brand/spark-duo.svg';
import orbit from '../../assets/brand/orbit.svg';

// Identificador gráfico de la app (especificación «Kova Design Lab», 1.3): solo la letra K del
// logotipo, centrada sobre azul marino #00001F con margen uniforme. Es un vector extraído del
// documento de marca: no se redibuja ni se recolorea.
export function KovaK({ size = 24, title = 'KOVA' }: { size?: number; title?: string }) {
  return <img src={kApp} width={size} height={size} alt={title} draggable={false} style={{ display: 'block', borderRadius: size * 0.2 }} />;
}

// Recursos gráficos de la marca (manual 3.5). Decorativos: se usan con moderación.
export const brandIcons = { spark, sparkDuo, orbit };
/** Icono gráfico de marca (uso puntual). Toma el color del texto (currentColor) mediante máscara. */
export function BrandIcon({ name, size = 16, className, style }: { name: keyof typeof brandIcons; size?: number; className?: string; style?: React.CSSProperties }) {
  const mask = `url("${brandIcons[name]}") center / contain no-repeat`;
  return <span aria-hidden="true" className={className}
    style={{ display: 'inline-block', width: size, height: size, flexShrink: 0, background: 'currentColor', WebkitMask: mask, mask, ...style }} />;
}
