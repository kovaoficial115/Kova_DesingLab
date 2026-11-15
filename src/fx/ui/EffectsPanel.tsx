// Biblioteca de efectos: efectos sueltos y preajustes listos para aplicar con un clic, con
// búsqueda, categorías, favoritos, vista previa al pasar el ratón e importación/exportación.

import React, { useEffect, useMemo, useState } from 'react';
import { Search, Star, FileUp, FileDown, Copy, Trash2, Pencil, Waves, Sparkle, Spline, Zap, Tv, Monitor, Sun, Palette, Grid3x3, Plus, Layers2 } from 'lucide-react';
import type { Doc, Layer } from '../../core/types';
import { useStore } from '../../core/store';
import { layerContent, oid } from '../../core/render';
import { Seg, Check } from '../../ui/components/controls';
import { FX_CATS, type FxCat } from '../../engine/fx/registry';
import { PRESET_CATS, type FxPreset, type PresetCat } from '../../engine/fx/presets';
import {
  FX_ITEMS, useFxLibrary, toggleFav, addEffect, previewPreset, endPreview, commitPreviewAs, applyPreset, presetThumb,
  importPresets, exportPresets, deletePreset, duplicatePreset, renamePreset, importLut,
} from '../lib';

export const catIcon: Record<FxCat, any> = { blur: Waves, noise: Sparkle, distortion: Spline, glitch: Zap, vhs: Tv, crt: Monitor, glow: Sun, color: Palette, texture: Grid3x3 };
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PREVIEW_KEY = 'kova.fx.hoverPreview';

function useHoverPreview(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => { try { return localStorage.getItem(PREVIEW_KEY) !== '0'; } catch { return true; } });
  return [v, (x: boolean) => { setV(x); try { localStorage.setItem(PREVIEW_KEY, x ? '1' : '0'); } catch { /* sin almacenamiento */ } }];
}

/** Miniatura de un preajuste, calculada en el worker sobre una copia pequeña de la capa. */
function Thumb({ p, src, srcKey }: { p: FxPreset; src: HTMLCanvasElement | null; srcKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    presetThumb(p, src, srcKey).then(u => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [p, srcKey]);
  return url ? <img src={url} alt="" draggable={false} /> : <div className="fx-thumb-wait" />;
}

export function PresetGrid({ presets, layer, mode }: { presets: FxPreset[]; layer: Layer | null; mode: 'append' | 'replace' }) {
  const { favs } = useFxLibrary();
  const [hover] = useHoverPreview();
  const [renaming, setRenaming] = useState<string | null>(null);
  const src = layer ? layerContent(layer) : null;
  const srcKey = src ? 'c' + oid(src) : 'sample';
  useEffect(() => () => endPreview(), []);
  if (!presets.length) return <div className="tiny muted">No hay preajustes en esta vista.</div>;
  return (
    <div className="fx-grid" onMouseLeave={() => endPreview()}>
      {presets.map(p => {
        const fav = favs.includes('preset:' + p.id);
        return (
          <div key={p.id} className="fx-tile" title={`${p.desc ?? ''}\n${p.items.length} efecto${p.items.length === 1 ? '' : 's'} editable${p.items.length === 1 ? '' : 's'}`.trim()}
            onMouseEnter={() => { if (hover && layer) previewPreset(p, mode); }}
            onClick={() => (layer ? (hover ? commitPreviewAs(p, mode) : applyPreset(p, mode)) : applyPreset(p, mode))}>
            <div className="fx-thumb"><Thumb p={p} src={src} srcKey={srcKey} /></div>
            <div className="fx-tile-foot">
              {renaming === p.id
                ? <input className="input" autoFocus defaultValue={p.name} onClick={e => e.stopPropagation()} maxLength={60}
                    onBlur={e => { renamePreset(p.id, e.target.value); setRenaming(null); }}
                    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                : <span className="fx-tile-name">{p.name}</span>}
              <button className={'icon-btn xs' + (fav ? ' fav' : '')} title={fav ? 'Quitar de favoritos' : 'Añadir a favoritos'} onClick={e => { e.stopPropagation(); toggleFav('preset:' + p.id); }}><Star size={11} /></button>
            </div>
            <div className="fx-tile-tools" onClick={e => e.stopPropagation()}>
              <button className="icon-btn xs" title="Duplicar como preajuste propio" onClick={() => duplicatePreset(p)}><Copy size={11} /></button>
              <button className="icon-btn xs" title="Exportar a un archivo" onClick={() => exportPresets([p])}><FileDown size={11} /></button>
              {!p.builtin && <button className="icon-btn xs" title="Renombrar" onClick={() => setRenaming(p.id)}><Pencil size={11} /></button>}
              {!p.builtin && <button className="icon-btn xs" title="Eliminar" onClick={() => deletePreset(p.id)}><Trash2 size={11} /></button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EffectsPanel({ doc }: { doc: Doc }) {
  const s = doc.state;
  const layer = s.layers.find(x => x.id === s.selectedLayerIds[s.selectedLayerIds.length - 1] && x.kind !== 'group') ?? null;
  const nSel = s.layers.filter(x => s.selectedLayerIds.includes(x.id) && x.kind !== 'group').length;
  const { presets, user, favs } = useFxLibrary();
  const [tab, setTab] = useState<'fx' | 'presets'>('presets');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [pcat, setPcat] = useState<string>('all');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [hover, setHover] = useHoverPreview();
  const peek = useStore(st => st.peekOriginal);
  void peek;

  const items = useMemo(() => {
    const t = norm(q.trim());
    return FX_ITEMS.filter(it => (cat === 'all' || (cat === 'fav' ? favs.includes('fx:' + it.key) : it.cat === cat))
      && (!t || norm(`${it.label} ${it.desc} ${FX_CATS.find(c => c.id === it.cat)?.label}`).includes(t)));
  }, [q, cat, favs]);
  const plist = useMemo(() => {
    const t = norm(q.trim());
    return presets.filter(p => (pcat === 'all' || (pcat === 'fav' ? favs.includes('preset:' + p.id) : p.cat === pcat))
      && (!t || norm(`${p.name} ${p.desc ?? ''} ${PRESET_CATS.find(c => c.id === p.cat)?.label}`).includes(t)));
  }, [q, pcat, presets, favs]);

  return (
    <div className="col fx-lib" style={{ gap: 8 }}>
      <div className="fx-search">
        <Search size={13} />
        <input className="input" placeholder={tab === 'fx' ? 'Buscar efecto (glitch, grano, neón…)' : 'Buscar preajuste (VHS, cine, verde…)'} value={q}
          onChange={e => setQ(e.target.value)} onKeyDown={e => e.stopPropagation()} />
      </div>
      <Seg full value={tab} onChange={setTab} options={[{ value: 'presets', label: 'Preajustes' }, { value: 'fx', label: 'Efectos' }]} />
      {!layer && <div className="tiny muted">Selecciona una capa para aplicar. Las miniaturas muestran una imagen de prueba hasta entonces.</div>}
      {layer && nSel > 1 && <div className="tiny muted">Se aplicará a las {nSel} capas seleccionadas.</div>}

      {tab === 'fx' ? (
        <>
          <div className="fx-chips">
            <button className={'chip' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>Todos</button>
            <button className={'chip' + (cat === 'fav' ? ' on' : '')} onClick={() => setCat('fav')}><Star size={10} />Favoritos</button>
            {FX_CATS.map(c => <button key={c.id} className={'chip' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.label}</button>)}
          </div>
          {(cat === 'color' || cat === 'all') && !q && (
            <button className="btn sm" disabled={!layer} onClick={importLut}><FileUp size={12} />Importar LUT (.cube)…</button>
          )}
          <div className="fx-list">
            {items.map(it => {
              const Ic = catIcon[it.cat];
              const fav = favs.includes('fx:' + it.key);
              return (
                <div key={it.key} className={'fx-row' + (layer ? '' : ' disabled')} title={it.desc} onClick={() => layer && addEffect(it)}>
                  <Ic size={13} className="muted" />
                  <div className="grow col" style={{ gap: 0, minWidth: 0 }}>
                    <span className="small">{it.label}</span>
                    <span className="tiny muted fx-desc">{it.desc}</span>
                  </div>
                  <button className={'icon-btn xs' + (fav ? ' fav' : '')} title={fav ? 'Quitar de favoritos' : 'Añadir a favoritos'} onClick={e => { e.stopPropagation(); toggleFav('fx:' + it.key); }}><Star size={11} /></button>
                  <Plus size={12} className="muted fx-add" />
                </div>
              );
            })}
            {!items.length && <div className="tiny muted">Nada coincide con «{q}».</div>}
          </div>
        </>
      ) : (
        <>
          <div className="fx-chips">
            <button className={'chip' + (pcat === 'all' ? ' on' : '')} onClick={() => setPcat('all')}>Todos</button>
            <button className={'chip' + (pcat === 'fav' ? ' on' : '')} onClick={() => setPcat('fav')}><Star size={10} />Favoritos</button>
            {PRESET_CATS.map(c => <button key={c.id} className={'chip' + (pcat === c.id ? ' on' : '')} onClick={() => setPcat(c.id)}>{c.label}</button>)}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Seg value={mode} onChange={setMode} options={[{ value: 'append', label: 'Añadir', title: 'Los efectos del preajuste se suman a los que ya tiene la capa' }, { value: 'replace', label: 'Reemplazar', title: 'La pila de la capa se sustituye por la del preajuste' }]} />
            <span className="grow" />
            <Check checked={hover} onChange={setHover} label="Vista previa" title="Ver el preajuste en el lienzo al pasar el ratón" />
          </div>
          <PresetGrid presets={plist} layer={layer} mode={mode} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={importPresets}><FileUp size={12} />Importar…</button>
            <button className="btn sm" disabled={!user.length} onClick={() => exportPresets(user)} title="Exporta todos tus preajustes en un archivo"><FileDown size={12} />Exportar los míos</button>
          </div>
          <span className="tiny muted"><Layers2 size={10} /> Un preajuste añade efectos normales a la pila: luego se ajustan, ocultan o reordenan en Ajustes. Para guardar uno propio: Ajustes → Guardar como preajuste.</span>
        </>
      )}
    </div>
  );
}

export type { PresetCat };
