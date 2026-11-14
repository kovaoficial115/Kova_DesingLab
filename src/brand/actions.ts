// Acciones de la biblioteca de marca sobre el documento: colocar logotipos e iconos, aplicar
// colores de la paleta, instalar las tipografías, estilos de texto vinculados y revisión de las
// normas del manual. Todo pasa por el historial (se deshace con ⌘Z).

import type { Artboard, DocState, Layer, TextStyle, TextStyleProps } from '../core/types';
import { commit, docState, activeArtboard, toast, get, set } from '../core/store';
import { layerBounds, uid, type Rect } from '../core/util';
import { vectorLayer, textLayer, defaultText, centerIn, descendants } from '../core/doc';
import { insertLayers } from '../core/actions';
import { installFontData, hasFamily, primaryFamily, listFonts } from '../io/fonts';
import { colorizeSvg, minLogoWidth, applyStyleProps, restyle, styleFromText, type BrandAsset, type BrandKit } from './model';
import { getKit, updateKit, kits } from './kits';
import antonUrl from '../assets/fonts/anton-400.woff2?url';
import satoshi400 from '../assets/fonts/satoshi-400.woff2?url';
import satoshi500 from '../assets/fonts/satoshi-500.woff2?url';
import satoshi700 from '../assets/fonts/satoshi-700.woff2?url';

// ---------- tipografías incluidas ----------
const BUNDLED: Record<string, { weight: number; url: string }[]> = {
  anton: [{ weight: 400, url: antonUrl }],
  satoshi: [{ weight: 400, url: satoshi400 }, { weight: 500, url: satoshi500 }, { weight: 700, url: satoshi700 }],
};

/** ¿Están las tipografías del kit en la biblioteca de fuentes (y por tanto viajan en .kova y SVG)? */
export function kitFontsInstalled(kit: BrandKit) {
  return kit.fonts.every(f => !f.bundled || hasFamily(f.family));
}

/** Instala en la biblioteca de fuentes las tipografías incluidas del kit. */
export async function installKitFonts(kit: BrandKit) {
  const have = listFonts();
  let n = 0;
  for (const f of kit.fonts) {
    for (const b of (f.bundled && BUNDLED[f.bundled]) || []) {
      if (have.some(x => x.family === f.family && x.weight === b.weight && x.style === 'normal')) continue;
      const r = await fetch(b.url);
      if (!r.ok) throw new Error(`No se pudo leer la tipografía ${f.family}`);
      await installFontData({ family: f.family, weight: b.weight, style: 'normal', format: 'woff2', license: f.license }, await r.arrayBuffer());
      n++;
    }
  }
  return n;
}
/** Instala sin bloquear (al aplicar un estilo de marca). */
function ensureFontsFor(family: string | undefined) {
  if (!family) return;
  const fam = primaryFamily(family);
  if (hasFamily(fam)) return;
  for (const k of kits()) {
    const f = k.fonts.find(x => x.family === fam && x.bundled);
    if (f) { void installKitFonts({ ...k, fonts: [f] }).catch(e => console.warn(e)); return; }
  }
}

// ---------- colores ----------
/** Aplica un color de la paleta a la selección: texto, relleno de formas, iconos recoloreables.
 *  Sin selección, pasa a ser el color frontal. */
export function applyBrandColor(hex: string, target: 'fill' | 'stroke' = 'fill') {
  const st = docState();
  const ids = new Set(st?.selectedLayerIds ?? []);
  const sel = st ? st.layers.filter(l => ids.has(l.id)) : [];
  // dentro de un grupo seleccionado también cuentan sus capas
  const all = st ? [...new Set([...sel, ...sel.flatMap(l => descendants(st.layers, l.id))])] : [];
  const targets = all.filter(l => (l.kind === 'text' && l.text) || (l.kind === 'shape' && l.shape) || (l.kind === 'vector' && l.brand?.color));
  if (!targets.length) { set(target === 'fill' ? { fg: hex } : { bg: hex }); return; }
  const tid = new Set(targets.map(l => l.id));
  commit(target === 'fill' ? 'Color de marca' : 'Contorno de marca', s => ({
    ...s,
    layers: s.layers.map(l => {
      if (!tid.has(l.id)) return l;
      if (l.text) return { ...l, text: target === 'fill' ? { ...l.text, color: hex } : { ...l.text, strokeColor: hex, strokeWidth: l.text.strokeWidth || Math.max(1, Math.round(l.text.fontSize / 30)) } };
      if (l.shape) return { ...l, shape: target === 'fill' && l.shape.shape !== 'line' ? { ...l.shape, fill: hex } : { ...l.shape, stroke: hex } };
      if (l.vector && l.brand?.color) return recolored(l, hex);
      return l;
    }),
  }));
}

function recolored(l: Layer, hex: string): Layer {
  const kit = getKit(l.brand!.kit);
  const a = kit?.assets.find(x => x.id === l.brand!.asset);
  // con el recurso original a mano se regenera; si no (kit de otro equipo), se cambia el color usado
  const svg = a?.recolor ? colorizeSvg(a.svg, hex) : l.vector!.svg.split(l.brand!.color!).join(hex);
  return { ...l, vector: { ...l.vector!, svg }, brand: { ...l.brand!, color: hex } };
}

export function recolorAsset(layerId: string, hex: string) {
  commit('Color del icono', s => ({ ...s, layers: s.layers.map(l => (l.id === layerId && l.vector && l.brand?.color ? recolored(l, hex) : l)) }));
}

// ---------- logotipos e iconos ----------
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export const CORNERS: { id: Corner; label: string }[] = [
  { id: 'tl', label: 'Arriba izquierda' }, { id: 'tr', label: 'Arriba derecha' }, { id: 'bl', label: 'Abajo izquierda' }, { id: 'br', label: 'Abajo derecha' },
];

const isLogo = (a: BrandAsset) => a.kind === 'logo' || a.kind === 'mark';

/** Posición en una esquina respetando el área de protección (X a cada lado). */
export function cornerPosition(ab: Artboard, w: number, h: number, corner: Corner, clear: number) {
  return {
    x: corner === 'tl' || corner === 'bl' ? ab.x + clear : ab.x + ab.w - clear - w,
    y: corner === 'tl' || corner === 'tr' ? ab.y + clear : ab.y + ab.h - clear - h,
  };
}

/** Coloca un recurso del kit en la mesa activa. Los logotipos van a una esquina, con su área de
 *  protección y al menos su tamaño mínimo; los iconos, al centro. */
export function placeAsset(kit: BrandKit, a: BrandAsset, opts: { color?: string; corner?: Corner } = {}) {
  const ab = activeArtboard();
  if (!ab) return;
  const color = a.recolor ? opts.color ?? '#ffffff' : undefined;
  const svg = color ? colorizeSvg(a.svg, color) : a.svg;
  const min = minLogoWidth(kit.rules, ab.dpi);
  let w: number;
  if (isLogo(a)) w = Math.min(ab.w * 0.6, Math.max(min, ab.w * 0.24));
  else w = Math.max(24, Math.min(ab.w, ab.h) * 0.18);
  w = Math.round(w);
  const h = Math.round((w * a.h) / a.w);
  let l: Layer = { ...vectorLayer(svg, w, h, a.name), brand: { kit: kit.id, asset: a.id, ...(color ? { color } : {}) } };
  if (isLogo(a)) {
    const clear = w * (kit.rules.clearSpace ?? 0);
    l = { ...l, ...cornerPosition(ab, w, h, opts.corner ?? 'tl', clear) };
  } else l = centerIn(l, ab);
  insertLayers([l], `Colocar ${a.name}`);
  if (isLogo(a) && w < min - 0.5) toast(`La mesa es pequeña: el logotipo queda por debajo de su tamaño mínimo (${Math.round(min)} px).`, 'warn', 6000);
  if (a.kind === 'logo' && kit.rules.logoBackground && (ab.background ?? '').toLowerCase() !== kit.rules.logoBackground) {
    toast(`El logotipo principal se usa solo sobre ${kit.rules.logoBackground.toUpperCase()}. Revisa el fondo (Marca → Revisar).`, 'warn', 6000);
  }
}

/** Lleva un logotipo a una esquina de su mesa, con el área de protección del kit. */
export function moveLogoToCorner(layerId: string, corner: Corner) {
  const st = docState();
  const l = st?.layers.find(x => x.id === layerId);
  if (!st || !l) return;
  const b = layerBounds(l);
  const ab = st.artboards.find(a => rectsOverlap(a, b)) ?? activeArtboard();
  if (!ab) return;
  const kit = l.brand ? getKit(l.brand.kit) : null;
  const clear = b.w * (kit?.rules.clearSpace ?? 0);
  const p = cornerPosition(ab, b.w, b.h, corner, clear);
  commit('Logotipo a la esquina', s => ({ ...s, layers: s.layers.map(x => (x.id === layerId ? { ...x, x: x.x + p.x - b.x, y: x.y + p.y - b.y } : x)) }));
}

/** Pone el fondo de la mesa en el color que exige el logotipo. */
export function setLogoBackground(abId: string, hex: string) {
  commit('Fondo de la marca', s => ({ ...s, artboards: s.artboards.map(a => (a.id === abId ? { ...a, background: hex } : a)) }));
}

// ---------- estilos de texto vinculados ----------
export const docStyles = (s: DocState | null | undefined) => s?.textStyles ?? [];

function upsertStyle(list: TextStyle[], st: TextStyle) {
  return list.some(x => x.id === st.id) ? list : [...list, { ...st, props: { ...st.props } }];
}

/** Aplica un estilo (del kit o del documento) a los textos seleccionados; sin textos
 *  seleccionados, crea uno nuevo con ese estilo. El estilo queda en el documento y vinculado. */
export function applyTextStyle(style: TextStyle, ids?: string[]) {
  const st = docState();
  if (!st) return;
  // si el documento ya tiene ese estilo (quizá editado), manda el del documento
  const docStyle = docStyles(st).find(x => x.id === style.id) ?? style;
  ensureFontsFor(docStyle.props.fontFamily);
  const sel = new Set(ids ?? st.selectedLayerIds);
  const texts = st.layers.filter(l => sel.has(l.id) && l.kind === 'text' && l.text);
  if (!texts.length) {
    const ab = activeArtboard();
    if (!ab) return;
    const base = defaultText(get().fg, Math.round(Math.min(ab.w, ab.h) / 10));
    const t = { ...applyStyleProps({ ...base, text: style.role || style.name }, docStyle.props), styleId: style.id };
    const l = centerIn(textLayer(t, 0, 0), ab);
    commit(`Texto «${style.name}»`, s => ({ ...s, textStyles: upsertStyle(docStyles(s), docStyle), layers: [...s.layers, l], selectedLayerIds: [l.id] }));
    return;
  }
  const tid = new Set(texts.map(l => l.id));
  commit(`Estilo «${style.name}»`, s => ({
    ...s,
    textStyles: upsertStyle(docStyles(s), docStyle),
    layers: s.layers.map(l => (tid.has(l.id) && l.text ? { ...l, text: { ...applyStyleProps(l.text, docStyle.props), styleId: docStyle.id } } : l)),
  }));
}

/** Cambia un estilo del documento: sus textos vinculados se actualizan (salvo lo cambiado a mano). */
export function updateTextStyle(id: string, patch: { name?: string; props?: TextStyleProps }) {
  commit('Editar estilo de texto', s => {
    const old = docStyles(s).find(x => x.id === id);
    if (!old) return s;
    const next: TextStyle = { ...old, ...(patch.name !== undefined ? { name: patch.name } : {}), props: patch.props ? { ...patch.props } : old.props };
    return {
      ...s,
      textStyles: docStyles(s).map(x => (x.id === id ? next : x)),
      layers: s.layers.map(l => (l.text?.styleId === id ? { ...l, text: restyle(l.text, old.props, next.props) } : l)),
    };
  });
  const st = docState();
  ensureFontsFor(docStyles(st).find(x => x.id === id)?.props.fontFamily);
}

export function deleteTextStyle(id: string) {
  commit('Eliminar estilo de texto', s => ({
    ...s,
    textStyles: docStyles(s).filter(x => x.id !== id),
    layers: s.layers.map(l => (l.text?.styleId === id ? { ...l, text: { ...l.text, styleId: null } } : l)),
  }));
}

/** Quita los cambios a mano: el texto vuelve a los valores de su estilo. */
export function resetToStyle(ids: string[]) {
  commit('Restablecer estilo', s => {
    const map = new Map(docStyles(s).map(x => [x.id, x]));
    return { ...s, layers: s.layers.map(l => (ids.includes(l.id) && l.text?.styleId && map.has(l.text.styleId) ? { ...l, text: applyStyleProps(l.text, map.get(l.text.styleId)!.props) } : l)) };
  });
}

/** El estilo pasa a tener los valores de este texto (y los demás textos con ese estilo lo siguen). */
export function redefineStyle(layerId: string) {
  const l = docState()?.layers.find(x => x.id === layerId);
  if (!l?.text?.styleId) return;
  updateTextStyle(l.text.styleId, { props: styleFromText(l.text) });
}

/** Estilo nuevo del documento a partir de un texto (queda vinculado). */
export function styleFromLayer(layerId: string, name: string) {
  const l = docState()?.layers.find(x => x.id === layerId);
  if (!l?.text) return null;
  const style: TextStyle = { id: uid('ts'), name: name.trim() || 'Estilo', props: styleFromText(l.text) };
  commit(`Nuevo estilo «${style.name}»`, s => ({
    ...s,
    textStyles: [...docStyles(s), style],
    layers: s.layers.map(x => (x.id === layerId && x.text ? { ...x, text: { ...x.text, styleId: style.id } } : x)),
  }));
  return style;
}

export function unlinkStyle(ids: string[]) {
  commit('Desvincular estilo', s => ({ ...s, layers: s.layers.map(l => (ids.includes(l.id) && l.text?.styleId ? { ...l, text: { ...l.text, styleId: null } } : l)) }));
}

/** Guarda un estilo del documento en un kit del usuario (para usarlo en otros proyectos). */
export function saveStyleToKit(style: TextStyle, kitId: string) {
  const sid = style.id.startsWith(kitId + ':') ? style.id : `${kitId}:${uid('ts')}`;
  updateKit(kitId, k => ({ ...k, styles: [...k.styles.filter(x => x.id !== style.id && x.id !== sid), { ...style, id: sid, kit: kitId, props: { ...style.props } }] }));
}

// ---------- revisión de las normas ----------
export interface BrandIssue { level: 'error' | 'warn' | 'info'; text: string; layerId?: string; artboardId?: string; fix?: { kind: 'background'; hex: string } | { kind: 'corner' } }

const rectsOverlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const contains = (o: Rect, i: Rect) => o.x <= i.x + 0.5 && o.y <= i.y + 0.5 && o.x + o.w >= i.x + i.w - 0.5 && o.y + o.h >= i.y + i.h - 0.5;
const q = (n: string) => `«${n.length > 26 ? n.slice(0, 25) + '…' : n}»`;
const norm = (hex: string) => hex.toLowerCase();

/** Revisa el documento con las normas del kit: tamaño mínimo, área de protección, esquinas,
 *  fondo del logotipo, tipografías y colores fuera del kit. */
export function checkBrand(st: DocState, kit: BrandKit): BrandIssue[] {
  const out: BrandIssue[] = [];
  const visible = st.layers.filter(l => l.visible && l.kind !== 'group');
  const index = new Map(st.layers.map((l, i) => [l.id, i]));
  for (const l of st.layers) {
    if (!l.visible || l.brand?.kit !== kit.id) continue;
    const a = kit.assets.find(x => x.id === l.brand!.asset);
    if (!a || !isLogo(a)) continue;
    const b = layerBounds(l);
    const ab = st.artboards.find(x => rectsOverlap(x, b));
    if (!ab) continue;
    const min = minLogoWidth(kit.rules, ab.dpi);
    if (min && b.w < min - 0.5) {
      const parts = [kit.rules.minWidthPx ? `${kit.rules.minWidthPx} px en digital` : '', kit.rules.minWidthMm ? `${kit.rules.minWidthMm} mm en impresión` : ''].filter(Boolean).join(' y ');
      out.push({ level: 'error', layerId: l.id, text: `${q(l.name)} mide ${Math.round(b.w)} px de ancho; el mínimo es ${Math.round(min)} px (${parts}).` });
    }
    const X = b.w * (kit.rules.clearSpace ?? 0);
    if (X > 0) {
      const zone = { x: b.x - X, y: b.y - X, w: b.w + 2 * X, h: b.h + 2 * X };
      const own = new Set([l.id, ...descendants(st.layers, l.id).map(d => d.id)]);
      const intruders = visible.filter(o => !own.has(o.id) && rectsOverlap(layerBounds(o), zone) && !contains(layerBounds(o), zone));
      if (intruders.length) out.push({ level: 'warn', layerId: l.id, text: `Invade el área de protección de ${q(l.name)} (X = ${Math.round(X)} px): ${intruders.slice(0, 3).map(o => q(o.name)).join(', ')}${intruders.length > 3 ? '…' : ''}.` });
      const inside = zone.x >= ab.x - 0.5 && zone.y >= ab.y - 0.5 && zone.x + zone.w <= ab.x + ab.w + 0.5 && zone.y + zone.h <= ab.y + ab.h + 0.5;
      if (!inside) out.push({ level: 'warn', layerId: l.id, text: `${q(l.name)} está más cerca del borde que su área de protección (X = ${Math.round(X)} px).`, fix: { kind: 'corner' } });
    }
    if (kit.rules.cornersOnly) {
      const cx = b.x + b.w / 2 - ab.x, cy = b.y + b.h / 2 - ab.y;
      const inCorner = (cx < ab.w / 3 || cx > (ab.w * 2) / 3) && (cy < ab.h / 3 || cy > (ab.h * 2) / 3);
      if (!inCorner) out.push({ level: 'warn', layerId: l.id, text: `${q(l.name)} debe ir en una de las cuatro esquinas de la composición.`, fix: { kind: 'corner' } });
    }
    if (a.kind === 'logo' && kit.rules.logoBackground) {
      const bg = norm(kit.rules.logoBackground);
      const below = st.layers.filter(o => o.visible && (index.get(o.id) ?? 0) < (index.get(l.id) ?? 0) && contains(layerBounds(o), b));
      const top = below[below.length - 1];
      const under = top ? (top.shape?.fill ? norm(top.shape.fill) : 'otro') : norm(ab.background ?? 'transparente');
      if (under !== bg) out.push({ level: 'error', layerId: l.id, artboardId: ab.id, text: `${q(l.name)}: el logotipo principal se usa solo sobre ${bg.toUpperCase()}.`, ...(!top ? { fix: { kind: 'background' as const, hex: bg } } : {}) });
    }
  }
  // tipografías y colores de los textos
  if (kit.fonts.length || kit.colors.length) {
    const fams = new Set(kit.fonts.map(f => f.family.toLowerCase()));
    const cols = new Set([...kit.colors.map(c => norm(c.hex)), '#ffffff']);
    const badFont = new Map<string, string[]>(), badColor = new Map<string, string[]>();
    for (const l of visible) {
      if (l.text) {
        const f = primaryFamily(l.text.fontFamily);
        if (fams.size && !fams.has(f.toLowerCase())) badFont.set(f, [...(badFont.get(f) ?? []), l.id]);
        if (kit.colors.length && !cols.has(norm(l.text.color))) badColor.set(norm(l.text.color), [...(badColor.get(norm(l.text.color)) ?? []), l.id]);
      }
      if (l.shape?.fill && kit.colors.length && !cols.has(norm(l.shape.fill))) badColor.set(norm(l.shape.fill), [...(badColor.get(norm(l.shape.fill)) ?? []), l.id]);
    }
    for (const [f, ids] of badFont) out.push({ level: 'info', layerId: ids[0], text: `Tipografía fuera del kit: ${f} (${ids.length} ${ids.length === 1 ? 'texto' : 'textos'}).` });
    for (const [c, ids] of badColor) out.push({ level: 'info', layerId: ids[0], text: `Color fuera de la paleta: ${c.toUpperCase()} (${ids.length} ${ids.length === 1 ? 'capa' : 'capas'}).` });
  }
  return out;
}
