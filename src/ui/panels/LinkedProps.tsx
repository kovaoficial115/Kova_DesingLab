// Secciones de Propiedades para lo vinculado: estilo de texto, texto en trayectoria, componentes
// y variantes, y recursos de marca (logotipos e iconos).

import React, { useState } from 'react';
import { Link2, Link2Off, RotateCcw, Component, CopyPlus, Crosshair, Spline, FlipVertical2, Check as CheckIcon, X } from 'lucide-react';
import type { Doc, Layer, TextPath } from '../../core/types';
import { live, finishLive, commit, toast } from '../../core/store';
import { NumberField, Select } from '../components/controls';
import { selectLayers, fitToScreen } from '../../core/actions';
import { layerBounds, layerPivot, placeAtPivot } from '../../core/util';
import { defaultPath, rebuildPath, shapeOutline, samplePath, pathBounds } from '../../core/textpath';
import { overrides, subtree } from '../../core/links';
import { makeComponent, createVariant, detachVariant, resetVariantAction, removeComponent, renameComponent, canBeComponent, variantRoots, variantRootOf, masterRootOf } from '../../core/components';
import { docStyles, applyTextStyle, resetToStyle, redefineStyle, styleFromLayer, unlinkStyle, recolorAsset, moveLogoToCorner, CORNERS } from '../../brand/actions';
import { styleOverrides } from '../../brand/model';
import { getKit, useKits } from '../../brand/kits';

const PROP_LABEL: Record<string, string> = {
  fontFamily: 'tipografía', fontSize: 'tamaño', fontWeight: 'peso', italic: 'cursiva', color: 'color', lineHeight: 'interlineado',
  letterSpacing: 'espaciado', caps: 'mayúsculas', align: 'alineación', paraSpacing: 'espacio tras párrafo', underline: 'subrayado',
};

// ---------- estilo de texto ----------
export function TextStyleRow({ l, doc }: { l: Layer; doc: Doc }) {
  const t = l.text!;
  const styles = docStyles(doc.state);
  const style = styles.find(s => s.id === t.styleId) ?? null;
  const ov = style ? styleOverrides(t as any, style.props) : [];
  const [naming, setNaming] = useState<string | null>(null);
  const ids = doc.state.selectedLayerIds.filter(id => doc.state.layers.find(x => x.id === id)?.kind === 'text');
  const save = () => { if (naming?.trim()) { styleFromLayer(l.id, naming); setNaming(null); } };
  return (
    <>
      <div className="row" style={{ gap: 4 }}>
        <span className="small muted" style={{ width: 38 }}>Estilo</span>
        <Select value={style?.id ?? ''} width="100%" title="Estilo de texto del documento"
          onChange={v => { if (!v) unlinkStyle(ids); else { const s = styles.find(x => x.id === v); if (s) applyTextStyle(s, ids); } }}
          options={[{ value: '', label: t.styleId && !style ? 'Estilo eliminado' : 'Sin estilo' }, ...styles.map(s => ({ value: s.id, label: s.name }))]} />
        <button className="icon-btn sm" title="Nuevo estilo con este texto" aria-label="Nuevo estilo con este texto" onClick={() => setNaming('')}><CopyPlus size={12} /></button>
      </div>
      {naming !== null && (
        <div className="row" style={{ gap: 4 }}>
          <input className="input" autoFocus placeholder="Nombre del estilo" value={naming} onChange={e => setNaming(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(null); }} />
          <button className="icon-btn sm" title="Crear estilo" aria-label="Crear estilo" onClick={save}><CheckIcon size={13} /></button>
          <button className="icon-btn sm" title="Cancelar" aria-label="Cancelar" onClick={() => setNaming(null)}><X size={13} /></button>
        </div>
      )}
      {style && ov.length > 0 && (
        <div className="row tiny" style={{ gap: 4, flexWrap: 'wrap' }}>
          <span className="chip warn" title="Cambiado a mano en este texto: no sigue al estilo">+ {ov.map(k => PROP_LABEL[k] ?? k).join(', ')}</span>
          <button className="btn sm ghost" title="Vuelve a los valores del estilo" onClick={() => resetToStyle(ids)}><RotateCcw size={11} />Restablecer</button>
          <button className="btn sm ghost" title="El estilo toma los valores de este texto (y los demás textos del estilo lo siguen)" onClick={() => redefineStyle(l.id)}>Redefinir estilo</button>
        </div>
      )}
    </>
  );
}

// ---------- texto en trayectoria ----------
const liveText = (id: string, fn: (t: NonNullable<Layer['text']>) => Partial<NonNullable<Layer['text']>>) =>
  live(s => ({ ...s, layers: s.layers.map(l => (l.id === id && l.text ? { ...l, text: { ...l.text, ...fn(l.text) } } : l)) }));

/** Cambia la trayectoria manteniendo el centro de la capa en su sitio. */
function setPath(l: Layer, path: TextPath | null, label?: string) {
  live(s => ({
    ...s, layers: s.layers.map(x => {
      if (x.id !== l.id || !x.text) return x;
      const c = layerPivot(x);
      const nx = { ...x, text: { ...x.text, path } };
      return { ...nx, ...placeAtPivot(nx, c.x, c.y) };
    }),
  }));
  if (label) finishLive(label);
}

export function TextPathProps({ l, doc }: { l: Layer; doc: Doc }) {
  const t = l.text!;
  const p = t.path ?? null;
  const kind = p?.kind ?? 'none';
  const other = doc.state.layers.find(x => doc.state.selectedLayerIds.includes(x.id) && x.id !== l.id && ((x.kind === 'shape' && x.shape) || (x.kind === 'vector' && x.vector)));
  const up = (patch: Partial<TextPath>, c = true) => {
    const next = rebuildPath({ ...p!, ...patch });
    const geometric = 'r' in patch || 'sweep' in patch || 'amp' in patch || 'wavelength' in patch || 'waves' in patch;
    if (geometric) setPath(l, next); else liveText(l.id, () => ({ path: next }));
    if (c) finishLive('Trayectoria del texto');
  };
  const choose = (k: string) => {
    if (k === 'none') { setPath(l, null, 'Quitar trayectoria'); return; }
    setPath(l, defaultPath(k as TextPath['kind'], t.fontSize, p?.kind === k ? p : null), 'Texto en trayectoria');
  };
  return (
    <>
      <div className="section-title"><Spline size={11} />Trayectoria</div>
      <Select value={kind} width="100%" onChange={choose} options={[
        { value: 'none', label: 'En renglones (sin trayectoria)' }, { value: 'circle', label: 'Círculo' }, { value: 'arc', label: 'Arco' }, { value: 'wave', label: 'Onda' },
        ...(p?.kind === 'custom' ? [{ value: 'custom', label: 'Trazado de otra capa' }] : []),
      ]} title="Las letras siguen una curva" />
      {other && (
        <button className="btn sm" title="El texto sigue el contorno de la otra capa seleccionada (forma o vector)" onClick={() => pathFromLayer(l, other)}>
          <Spline size={12} />Seguir el contorno de «{other.name.slice(0, 18)}»
        </button>
      )}
      {!other && !p && <div className="tiny muted">Para seguir el contorno de una forma o un vector, selecciónalo junto con el texto (⇧ clic).</div>}
      {p && <>
        <div className="grid2">
          {(p.kind === 'circle' || p.kind === 'arc') && <NumberField label="Radio" value={p.r ?? 100} min={4} max={20000} digits={0} suffix="px" onChange={v => up({ r: v }, false)} onCommit={v => up({ r: v })} />}
          {p.kind === 'arc' && <NumberField label="Arco" value={p.sweep ?? 140} min={5} max={359} digits={0} suffix="°" onChange={v => up({ sweep: v }, false)} onCommit={v => up({ sweep: v })} />}
          {p.kind === 'wave' && <>
            <NumberField label="Altura" value={p.amp ?? 20} min={0} max={20000} digits={0} suffix="px" onChange={v => up({ amp: v }, false)} onCommit={v => up({ amp: v })} />
            <NumberField label="Largo" value={p.wavelength ?? 200} min={10} max={50000} digits={0} suffix="px" onChange={v => up({ wavelength: v }, false)} onCommit={v => up({ wavelength: v })} />
            <NumberField label="Ondas" value={p.waves ?? 2} min={0.5} max={20} step={0.5} digits={1} onChange={v => up({ waves: v }, false)} onCommit={v => up({ waves: v })} />
          </>}
          <NumberField label="Posición" value={p.pos} min={0} max={100} digits={0} suffix="%" title="Dónde va el texto a lo largo de la curva (según su alineación)" onChange={v => up({ pos: v }, false)} onCommit={v => up({ pos: v })} />
          <NumberField label="Base" value={p.shift} min={-5000} max={5000} digits={0} suffix="px" title="Separa las letras de la curva (positivo: hacia fuera)" onChange={v => up({ shift: v }, false)} onCommit={v => up({ shift: v })} />
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className={'btn sm' + (p.flip ? ' active' : '')} title="Recorre la curva al revés: las letras pasan al otro lado (p. ej. abajo de un círculo, legibles)"
            onClick={() => up({ flip: !p.flip, ...(p.kind === 'circle' ? { pos: (p.pos + 50) % 100 } : {}) })}><FlipVertical2 size={12} />Invertir lado</button>
          <span className="tiny muted grow">La alineación del párrafo decide si el texto empieza, se centra o termina en la posición.</span>
        </div>
      </>}
    </>
  );
}

/** El texto pasa a seguir el contorno de una forma o del primer trazado de un vector. */
function pathFromLayer(textLayer: Layer, other: Layer) {
  let d: string | null = null;
  let w = 0, h = 0;
  if (other.shape) {
    const sx = Math.abs(other.scaleX), sy = Math.abs(other.scaleY);
    w = other.shape.w * sx; h = other.shape.h * sy;
    d = shapeOutline(other.shape.shape, w, h, other.shape.radius * Math.min(sx, sy));
  } else if (other.vector) {
    const r = firstSvgPath(other.vector.svg, other.vector.w * Math.abs(other.scaleX), other.vector.h * Math.abs(other.scaleY));
    if (r) { d = r; w = other.vector.w * Math.abs(other.scaleX); h = other.vector.h * Math.abs(other.scaleY); }
  }
  if (!d) { toast('Esa capa no tiene un trazado que el texto pueda seguir.', 'warn'); return; }
  const t = textLayer.text!;
  const path: TextPath = { kind: 'custom', d, pos: t.align === 'center' ? 50 : t.align === 'right' ? 100 : 0, flip: false, shift: 0 };
  // misma rotación que la capa del contorno; el centro de la curva cae donde está en esa capa
  const S = samplePath(d);
  if (!S) { toast('Ese trazado está vacío.', 'warn'); return; }
  const pb = pathBounds(S);
  const ox = pb.x + pb.w / 2 - w / 2, oy = pb.y + pb.h / 2 - h / 2;
  const rad = (other.rotation * Math.PI) / 180;
  const pc = layerPivot(other);
  const c = { x: pc.x + ox * Math.cos(rad) - oy * Math.sin(rad), y: pc.y + ox * Math.sin(rad) + oy * Math.cos(rad) };
  commit('Texto sobre contorno', s => ({
    ...s, layers: s.layers.map(x => {
      if (x.id !== textLayer.id || !x.text) return x;
      const nx: Layer = { ...x, scaleX: 1, scaleY: 1, rotation: other.rotation, text: { ...x.text, path } };
      return { ...nx, ...placeAtPivot(nx, c.x, c.y, 1, 1) };
    }),
    selectedLayerIds: [textLayer.id],
  }));
}

/** Primer trazado de un SVG (path, circle, ellipse, rect, line, polyline/polygon) en px de la capa. */
function firstSvgPath(svg: string, w: number, h: number): string | null {
  const docu = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = docu.documentElement;
  if (root.nodeName !== 'svg') return null;
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb.length === 4 && vb.every(isFinite) ? vb : [0, 0, parseFloat(root.getAttribute('width') || '') || w, parseFloat(root.getAttribute('height') || '') || h];
  const kx = w / (vw || w), ky = h / (vh || h);
  const el = root.querySelector('path, circle, ellipse, rect, line, polyline, polygon');
  if (!el) return null;
  const n = (a: string) => parseFloat(el.getAttribute(a) || '0');
  let d = '';
  switch (el.nodeName) {
    case 'path': d = el.getAttribute('d') || ''; break;
    case 'circle': { const cx = n('cx'), cy = n('cy'), r = n('r'); d = `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx} ${cy + r}A${r} ${r} 0 1 1 ${cx} ${cy - r}Z`; break; }
    case 'ellipse': { const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry'); d = `M${cx} ${cy - ry}A${rx} ${ry} 0 1 1 ${cx} ${cy + ry}A${rx} ${ry} 0 1 1 ${cx} ${cy - ry}Z`; break; }
    case 'rect': { const x = n('x'), y = n('y'), rw = n('width'), rh = n('height'); d = `M${x} ${y}H${x + rw}V${y + rh}H${x}Z`; break; }
    case 'line': d = `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`; break;
    default: { const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number); for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? 'L' : 'M'}${pts[i]} ${pts[i + 1]}`; if (el.nodeName === 'polygon') d += 'Z'; }
  }
  if (!d) return null;
  // escala al tamaño de la capa (los comandos de arco escalan sus radios aparte)
  return scalePath(d, kx, ky, vx, vy);
}

/** Lleva un trazado SVG del viewBox a px de la capa: cada número se escala según su papel en el
 *  comando (coordenada x o y, radio de arco, banderas). */
function scalePath(d: string, kx: number, ky: number, ox: number, oy: number): string {
  const out: string[] = [];
  const re = /([a-df-z])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;
  let cmd = '', idx = 0, nCmd = 0, m: RegExpExecArray | null;
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  while ((m = re.exec(d))) {
    if (m[1]) { cmd = m[1]; idx = 0; nCmd++; out.push(cmd); continue; }
    const v = parseFloat(m[2]);
    const C = cmd.toUpperCase();
    // una «m» inicial es absoluta (su primer par)
    const rel = cmd !== C && !(nCmd === 1 && C === 'M' && idx < 2);
    const a = arity[C] || 2;
    const k = idx % a;
    let r = v;
    if (C === 'H') r = rel ? v * kx : (v - ox) * kx;
    else if (C === 'V') r = rel ? v * ky : (v - oy) * ky;
    else if (C === 'A') r = k === 0 ? v * kx : k === 1 ? v * ky : k === 5 ? (rel ? v * kx : (v - ox) * kx) : k === 6 ? (rel ? v * ky : (v - oy) * ky) : v;
    else r = k % 2 === 0 ? (rel ? v * kx : (v - ox) * kx) : (rel ? v * ky : (v - oy) * ky);
    out.push(String(+r.toFixed(2)));
    idx++;
  }
  return out.join(' ');
}

// ---------- componentes y variantes ----------
export function VariantProps({ l, doc }: { l: Layer; doc: Doc }) {
  const layers = doc.state.layers;
  const master = masterRootOf(layers, l);
  const vroot = variantRootOf(layers, l);
  const [name, setName] = useState<string | null>(null);
  if (master) {
    const roots = variantRoots(layers, master.id);
    return (
      <>
        <div className="section-title"><Component size={11} />Componente principal</div>
        <div className="row" style={{ gap: 4 }}>
          {name === null
            ? <span className="small grow" title="Doble clic para renombrar" onDoubleClick={() => setName(master.component!.name)}>{master.component!.name}</span>
            : <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim()) renameComponent(master.id, name.trim()); setName(null); }}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setName(null); }} />}
          <span className="chip accent">{roots.length} {roots.length === 1 ? 'variante' : 'variantes'}</span>
        </div>
        <div className="tiny muted">Lo que cambies aquí pasa a sus variantes, salvo lo que cada variante cambió (texto, colores…).</div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => createVariant(master.id)}><CopyPlus size={12} />Crear variante</button>
          {roots.length > 0 && <button className="btn sm" onClick={() => selectLayers(roots.map(r => r.id))}>Seleccionar variantes</button>}
          <button className="btn sm ghost" title="Deja de ser componente; sus variantes quedan como capas normales" onClick={() => removeComponent(master.id)}>Quitar componente</button>
        </div>
      </>
    );
  }
  if (vroot && l.link) {
    const m = layers.find(x => x.id === l.link!.master);
    const src = layers.find(x => x.id === l.link!.src);
    const inst = subtree(layers, vroot.id).filter(x => x.link?.master === l.link!.master);
    const changed = new Set<string>();
    for (const x of inst) { const s = layers.find(y => y.id === x.link!.src); if (s && x.id !== vroot.id) overrides(x, s).forEach(o => changed.add(o)); }
    const own = src && l.id !== vroot.id ? overrides(l, src) : [];
    return (
      <>
        <div className="section-title"><Link2 size={11} />Variante vinculada</div>
        <div className="small">{m?.component ? <>De «{m.component.name}»</> : <span style={{ color: 'var(--warn)' }}>El componente principal ya no existe</span>}</div>
        {own.length > 0 && <div className="tiny"><span className="chip warn" title="Cambios propios de esta capa">Cambiado aquí: {own.join(', ')}</span></div>}
        {!own.length && changed.size > 0 && <div className="tiny muted">Cambios en la variante: {[...changed].join(', ')}</div>}
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {m && <button className="btn sm" title="Selecciona el componente principal" onClick={() => { selectLayers([m.id]); const b = layerBounds(m.kind === 'group' ? (subtree(layers, m.id).find(x => x.kind !== 'group') ?? m) : m); fitToScreen({ x: b.x - b.w, y: b.y - b.h, w: b.w * 3, h: b.h * 3 }); }}><Crosshair size={12} />Ir al principal</button>}
          {m && <button className="btn sm" title="Quita los cambios de la variante (conserva su posición)" onClick={() => resetVariantAction(vroot.id)}><RotateCcw size={12} />Restablecer</button>}
          <button className="btn sm ghost" title="Deja de seguir al principal" onClick={() => detachVariant(vroot.id)}><Link2Off size={12} />Desvincular</button>
        </div>
      </>
    );
  }
  if (!canBeComponent(layers, l)) return null;
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="btn sm" title="Convierte esta capa o grupo en componente: podrás crear variantes vinculadas que siguen sus cambios" onClick={() => makeComponent(l.id)}><Component size={12} />Crear componente</button>
    </div>
  );
}

// ---------- recursos de marca ----------
export function BrandAssetProps({ l }: { l: Layer }) {
  useKits();
  const ref = l.brand!;
  const kit = getKit(ref.kit);
  const a = kit?.assets.find(x => x.id === ref.asset);
  const logo = a && (a.kind === 'logo' || a.kind === 'mark');
  return (
    <>
      <div className="section-title">Marca</div>
      <div className="small">{a ? a.name : 'Recurso de marca'}{kit ? <span className="muted"> · {kit.name}</span> : <span className="muted"> · kit no instalado en este equipo</span>}</div>
      {logo && <div className="tiny muted">Composición integral: no se separa ni se modifica (manual 2.2).</div>}
      {ref.color && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <span className="tiny muted">Color</span>
          {[{ hex: '#ffffff', name: 'Blanco' }, ...(kit?.colors ?? [])].map(c => (
            <button key={c.hex} className="swatch-btn" title={c.name} aria-label={c.name} style={{ background: c.hex, borderColor: ref.color === c.hex ? 'var(--accent)' : 'var(--border-2)' }} onClick={() => recolorAsset(l.id, c.hex)} />
          ))}
        </div>
      )}
      {logo && (
        <div className="row" style={{ gap: 4 }}>
          <span className="tiny muted">Esquina</span>
          {CORNERS.map(c => <button key={c.id} className="icon-btn sm" title={`${c.label}, con el área de protección`} onClick={() => moveLogoToCorner(l.id, c.id)}>{c.id === 'tl' ? '↖' : c.id === 'tr' ? '↗' : c.id === 'bl' ? '↙' : '↘'}</button>)}
        </div>
      )}
    </>
  );
}
