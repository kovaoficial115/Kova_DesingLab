// Kit oficial de KOVA, con los valores del manual de marca (KOVA 2026, Juan Felipe Machado y
// Valentina Holguin). Los vectores se extrajeron del propio manual: el logotipo y la marca
// responsive conservan sus colores originales; los iconos usan `currentColor` para colocarse en
// cualquier color de la paleta (manual 3.5: «manteniendo criterios consistentes de… color»).

import type { BrandAsset, BrandKit } from './model';
import { svgSize } from './model';
import logo from './assets/kova-logo.svg?raw';
import responsive from './assets/kova-responsive.svg?raw';
import alaDer from './assets/icono-ala-derecha.svg?raw';
import alaIzq from './assets/icono-ala-izquierda.svg?raw';
import anillo from './assets/icono-anillo-orbital.svg?raw';
import con1 from './assets/icono-conector-1.svg?raw';
import con2 from './assets/icono-conector-2.svg?raw';
import con3 from './assets/icono-conector-3.svg?raw';
import con4 from './assets/icono-conector-4.svg?raw';
import destDoble from './assets/icono-destello-doble.svg?raw';
import destellos from './assets/icono-destellos.svg?raw';
import estrella8 from './assets/icono-estrella-8.svg?raw';
import globo from './assets/icono-globo.svg?raw';
import orbita from './assets/icono-orbita.svg?raw';
import remolino from './assets/icono-remolino.svg?raw';

export const KOVA_KIT_ID = 'kova';

const asset = (id: string, name: string, kind: BrandAsset['kind'], svg: string, recolor: boolean): BrandAsset => {
  const s = svgSize(svg)!;
  return { id, name, kind, svg, w: s.w, h: s.h, recolor };
};

const ANTON = '"Anton", sans-serif';
const SATOSHI = '"Satoshi", sans-serif';

export const KOVA_KIT: BrandKit = {
  id: KOVA_KIT_ID,
  name: 'KOVA Streetwear',
  builtin: true,
  source: 'Manual de marca KOVA 2026',
  // 3.3 Paleta cromática
  colors: [
    { id: 'azul-marino', name: 'Azul marino', hex: '#00001f', rgb: '0;0;31', cmyk: '99;88;50;83', role: 'Color principal: base cromática de la identidad' },
    { id: 'arena', name: 'Arena', hex: '#f0e7de', rgb: '240;231;222', cmyk: '7;9;13;0', role: 'Neutro: aporta equilibrio y versatilidad' },
    { id: 'escarlata', name: 'Escarlata', hex: '#d21625', rgb: '210;22;37', cmyk: '10;99;88;2', role: 'Complementario y de acento: destaca elementos' },
  ],
  // 3.1 y 3.2 Tipografías corporativas
  fonts: [
    { family: 'Anton', role: 'Titulares, destacados y subtítulos', weights: [400], bundled: 'anton', license: 'SIL Open Font License 1.1 (Vernon Adams)' },
    { family: 'Satoshi', role: 'Cuerpos de texto y descripciones', weights: [400], bundled: 'satoshi', license: 'ITF Free Font License (Indian Type Foundry)' },
  ],
  // estilos con la tipografía de cada uso; el manual no fija tamaños, así que no se imponen
  styles: [
    { id: 'kova:titular', name: 'Titular', role: 'Titulares', kit: KOVA_KIT_ID, props: { fontFamily: ANTON, fontWeight: 400 } },
    { id: 'kova:destacado', name: 'Destacado', role: 'Destacados', kit: KOVA_KIT_ID, props: { fontFamily: ANTON, fontWeight: 400 } },
    { id: 'kova:subtitulo', name: 'Subtítulo', role: 'Subtítulos', kit: KOVA_KIT_ID, props: { fontFamily: ANTON, fontWeight: 400 } },
    { id: 'kova:cuerpo', name: 'Cuerpo de texto', role: 'Cuerpos de texto', kit: KOVA_KIT_ID, props: { fontFamily: SATOSHI, fontWeight: 400 } },
    { id: 'kova:descripcion', name: 'Descripción', role: 'Descripciones', kit: KOVA_KIT_ID, props: { fontFamily: SATOSHI, fontWeight: 400 } },
  ],
  assets: [
    asset('logo', 'KOVA Streetwear', 'logo', logo, false),
    asset('responsive', 'Marca responsive', 'mark', responsive, false),
    asset('destello-doble', 'Destello doble', 'icon', destDoble, true),
    asset('estrella-8', 'Estrella de 8 puntas', 'icon', estrella8, true),
    asset('remolino', 'Remolino', 'icon', remolino, true),
    asset('destellos', 'Destellos', 'icon', destellos, true),
    asset('conector-1', 'Conector 1', 'icon', con1, true),
    asset('conector-2', 'Conector 2', 'icon', con2, true),
    asset('conector-3', 'Conector 3', 'icon', con3, true),
    asset('conector-4', 'Conector 4', 'icon', con4, true),
    asset('globo', 'Globo', 'icon', globo, true),
    asset('orbita', 'Órbita', 'icon', orbita, true),
    asset('anillo-orbital', 'Anillo orbital', 'icon', anillo, true),
    asset('ala-izquierda', 'Ala izquierda', 'icon', alaIzq, true),
    asset('ala-derecha', 'Ala derecha', 'icon', alaDer, true),
  ],
  rules: {
    logoBackground: '#00001f',
    minWidthPx: 200,
    minWidthMm: 35,
    clearSpace: 1 / 11,
    cornersOnly: true,
    notes: [
      'El logotipo es una composición integral: tipografía, elemento orbital y destellos no se separan, reorganizan ni modifican (2.2).',
      'La versión principal se usa exclusivamente sobre el azul marino #00001F (2.2).',
      'KOVA STREETWEAR se usa cuando hace falta reforzar la categoría de la marca (2.2).',
      'La marca responsive es la adaptación para formatos reducidos; no se reconstruye, modifica ni combina con otros elementos (2.3).',
      'Unidad X: el identificador mide 11X de ancho por 5X de alto (2.4).',
      'Área de protección: X libre en todos los lados (2.5).',
      'Tamaño mínimo: 35 mm de ancho en impresión y 200 px en digital (2.6).',
      'El logotipo va en una de las cuatro esquinas, con su área de protección y, mejor, sobre fondos oscuros (3.4).',
      'Iconos y patrones complementan la identidad sin competir con el logotipo (3.5, 3.6).',
    ],
  },
};
