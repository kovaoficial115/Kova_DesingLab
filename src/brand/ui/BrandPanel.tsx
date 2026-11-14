// Panel «Marca»: biblioteca del kit activo (colores, tipografías, estilos de texto, logotipos,
// iconos y normas) y los estilos de texto vinculados del documento.

import React, { useMemo, useState } from 'react';
import { Plus, Copy, FileUp, Download, Trash2, Check as CheckIcon, X, Pencil, ShieldCheck, AlertTriangle, Info, Link2Off, Type, ImagePlus } from 'lucide-react';
import type { Doc, Layer, TextStyle, TextStyleProps } from '../../core/types';
import { get, set, toast } from '../../core/store';
import { selectLayers, fitToScreen } from '../../core/actions';
import { layerBounds } from '../../core/util';
import { NumberField, Select, Seg, Check, ColorInput } from '../../ui/components/controls';
import { FontPicker, useFontsVersion } from '../../ui/components/FontPicker';
import { pickFiles } from '../../io/fileOps';
import { platform } from '../../platform';
import { hasFamily, familyValue, primaryFamily } from '../../io/fonts';
import { useKits, setActiveKit, duplicateKit, createKit, deleteKit, updateKit, addImportedKit } from '../kits';
import { colorizeSvg, exportKit, importKit, cleanSvg, svgSize, styleFromText, type BrandAsset, type BrandKit } from '../model';
import {
  applyBrandColor, placeAsset, installKitFonts, kitFontsInstalled, applyTextStyle, updateTextStyle, deleteTextStyle, saveStyleToKit,
  checkBrand, moveLogoToCorner, setLogoBackground, docStyles, CORNERS, type Corner, type BrandIssue,
} from '../actions';

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kit';

export function BrandPanel({ doc }: { doc: Doc }) {
  const { kits, active } = useKits();
  const kit = kits.find(k => k.id === active) ?? kits[0];
  const editable = !kit.builtin;
  const [naming, setNaming] = useState<null | { mode: 'new' | 'dup' | 'rename'; value: string }>(null);
  const edit = (fn: (k: BrandKit) => BrandKit) => { try { updateKit(kit.id, fn); } catch (e: any) { toast(e.message, 'error'); } };

  const confirmName = () => {
    if (!naming) return;
    try {
      if (naming.mode === 'new') setActiveKit(createKit(naming.value.trim()).id);
      else if (naming.mode === 'dup') setActiveKit(duplicateKit(kit.id, naming.value.trim()).id);
      else edit(k => ({ ...k, name: naming.value.trim() || k.name }));
      setNaming(null);
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const importFile = async () => {
    const [f] = await pickFiles(false, '.json,application/json');
    if (!f) return;
    try { const k = addImportedKit(importKit(await f.text())); setActiveKit(k.id); toast(`Kit «${k.name}» importado`, 'ok'); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const exportFile = () => platform.saveFile(new Blob([exportKit(kit)], { type: 'application/json' }), { suggestedName: `${slug(kit.name)}.kova-marca.json` });
  const remove = async () => {
    if (!(await platform.confirm(`¿Eliminar el kit «${kit.name}» de este equipo? Los documentos que ya usan sus recursos no cambian.`, { okLabel: 'Eliminar' }))) return;
    deleteKit(kit.id);
  };

  return (
    <div className="col brand-panel" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 4 }}>
        <Select value={kit.id} width="100%" onChange={v => setActiveKit(v)} options={kits.map(k => ({ value: k.id, label: k.builtin ? `${k.name} · oficial` : k.name }))} title="Kit de marca" />
        <button className="icon-btn sm" title="Kit nuevo" aria-label="Kit nuevo" onClick={() => setNaming({ mode: 'new', value: '' })}><Plus size={13} /></button>
        <button className="icon-btn sm" title={kit.builtin ? 'Duplicar para ampliarlo' : 'Duplicar kit'} aria-label="Duplicar kit" onClick={() => setNaming({ mode: 'dup', value: `${kit.name} (copia)` })}><Copy size={12} /></button>
        <button className="icon-btn sm" title="Importar kit (.json)" aria-label="Importar kit" onClick={importFile}><FileUp size={12} /></button>
        <button className="icon-btn sm" title="Exportar kit (.json)" aria-label="Exportar kit" onClick={exportFile}><Download size={12} /></button>
        {editable && <button className="icon-btn sm" title="Renombrar kit" aria-label="Renombrar kit" onClick={() => setNaming({ mode: 'rename', value: kit.name })}><Pencil size={12} /></button>}
        {editable && <button className="icon-btn sm" title="Eliminar kit" aria-label="Eliminar kit" onClick={remove}><Trash2 size={12} /></button>}
      </div>
      {naming && (
        <div className="row" style={{ gap: 4 }}>
          <input className="input" autoFocus placeholder={naming.mode === 'new' ? 'Nombre del kit' : 'Nombre'} value={naming.value}
            onChange={e => setNaming({ ...naming, value: e.target.value })}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') confirmName(); if (e.key === 'Escape') setNaming(null); }} />
          <button className="icon-btn sm" title="Aceptar" aria-label="Aceptar" onClick={confirmName}><CheckIcon size={13} /></button>
          <button className="icon-btn sm" title="Cancelar" aria-label="Cancelar" onClick={() => setNaming(null)}><X size={13} /></button>
        </div>
      )}
      {kit.source && <div className="tiny muted">{kit.source}{kit.builtin ? ' · solo lectura: duplícalo para ampliarlo' : ''}</div>}

      <Colors kit={kit} editable={editable} edit={edit} />
      <Fonts kit={kit} doc={doc} editable={editable} edit={edit} />
      <Styles kit={kit} doc={doc} editable={editable} edit={edit} />
      <Assets kit={kit} doc={doc} editable={editable} edit={edit} />
      <Rules kit={kit} doc={doc} />
    </div>
  );
}

type SectionProps = { kit: BrandKit; doc?: Doc; editable: boolean; edit: (fn: (k: BrandKit) => BrandKit) => void };

function Colors({ kit, editable, edit }: SectionProps) {
  const fg = get().fg;
  return (
    <>
      <div className="section-title">Colores <span className="grow" />
        {kit.colors.length > 0 && <button className="btn sm ghost" title="Añadir los colores del kit a las muestras del panel Color" onClick={() => set(s => ({ swatches: [...s.swatches, ...kit.colors.map(c => c.hex).filter(h => !s.swatches.includes(h))] }))}>A muestras</button>}
      </div>
      {!kit.colors.length && <div className="tiny muted">Sin colores.</div>}
      <div className="col" style={{ gap: 2 }}>
        {kit.colors.map(c => (
          <div key={c.id} className="brand-color" role="button" tabIndex={0}
            title={`${c.name} · ${c.hex.toUpperCase()}${c.rgb ? ` · RGB ${c.rgb}` : ''}${c.cmyk ? ` · CMYK ${c.cmyk}` : ''}${c.role ? `\n${c.role}` : ''}\nClic: relleno/texto · Mayús+clic: contorno`}
            onClick={e => applyBrandColor(c.hex, e.shiftKey ? 'stroke' : 'fill')}
            onKeyDown={e => { if (e.key === 'Enter') applyBrandColor(c.hex); }}>
            <span className="brand-sw" style={{ background: c.hex }} />
            <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
              <span className="small">{c.name}</span>
              <span className="tiny muted mono">{c.hex.toUpperCase()}{c.cmyk ? ` · CMYK ${c.cmyk}` : ''}</span>
            </span>
            {editable && <button className="icon-btn sm" title="Quitar del kit" aria-label={`Quitar ${c.name}`} onClick={e => { e.stopPropagation(); edit(k => ({ ...k, colors: k.colors.filter(x => x.id !== c.id) })); }}><X size={11} /></button>}
          </div>
        ))}
      </div>
      {editable && (
        <button className="btn sm" title="Añade el color frontal actual" onClick={() => {
          if (kit.colors.some(c => c.hex === fg.toLowerCase())) { toast('Ese color ya está en el kit', 'info'); return; }
          edit(k => ({ ...k, colors: [...k.colors, { id: fg.toLowerCase(), name: fg.toUpperCase(), hex: fg.toLowerCase() }] }));
        }}><Plus size={12} /><span className="brand-sw sm" style={{ background: fg }} />Añadir color frontal</button>
      )}
    </>
  );
}

function selectedText(doc?: Doc): Layer | null {
  if (!doc) return null;
  const s = doc.state;
  const l = s.layers.find(x => x.id === s.selectedLayerIds[s.selectedLayerIds.length - 1]);
  return l?.kind === 'text' && l.text ? l : null;
}

function Fonts({ kit, doc, editable, edit }: SectionProps) {
  useFontsVersion();
  const [busy, setBusy] = useState(false);
  const installed = kitFontsInstalled(kit);
  const bundled = kit.fonts.some(f => f.bundled);
  const t = selectedText(doc);
  return (
    <>
      <div className="section-title">Tipografías</div>
      {!kit.fonts.length && <div className="tiny muted">Sin tipografías.</div>}
      {kit.fonts.map(f => (
        <div key={f.family} className="row brand-font">
          <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
            <span style={{ fontFamily: familyValue(f.family), fontSize: 18, lineHeight: 1.15 }}>{f.family}</span>
            <span className="tiny muted">{f.role || 'Sin uso definido'}</span>
          </span>
          {f.bundled ? <span className={'chip ' + (hasFamily(f.family) ? 'ok' : '')} title={f.license}>{hasFamily(f.family) ? 'Instalada' : 'Incluida'}</span>
            : <span className={'chip ' + (hasFamily(f.family) ? 'ok' : 'warn')}>{hasFamily(f.family) ? 'Instalada' : 'Del sistema'}</span>}
          {editable && <button className="icon-btn sm" title="Quitar del kit" aria-label={`Quitar ${f.family}`} onClick={() => edit(k => ({ ...k, fonts: k.fonts.filter(x => x.family !== f.family) }))}><X size={11} /></button>}
        </div>
      ))}
      {bundled && !installed && (
        <button className="btn sm" disabled={busy} title="Las añade a Mis fuentes: así viajan dentro del .kova y de los SVG exportados"
          onClick={async () => { setBusy(true); try { const n = await installKitFonts(kit); toast(n ? `Tipografías de ${kit.name} instaladas` : 'Ya estaban instaladas', 'ok'); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); } }}>
          <Type size={12} />{busy ? 'Instalando…' : 'Instalar tipografías de la marca'}
        </button>
      )}
      {editable && t && !kit.fonts.some(f => f.family === primaryFamily(t.text!.fontFamily)) && (
        <button className="btn sm" onClick={() => edit(k => ({ ...k, fonts: [...k.fonts, { family: primaryFamily(t.text!.fontFamily), role: '', weights: [t.text!.fontWeight] }] }))}>
          <Plus size={12} />Añadir {primaryFamily(t.text!.fontFamily)} (texto seleccionado)
        </button>
      )}
    </>
  );
}

const PROP_ROWS: { key: keyof TextStyleProps; label: string }[] = [
  { key: 'fontFamily', label: 'Tipografía' }, { key: 'fontWeight', label: 'Peso' }, { key: 'fontSize', label: 'Tamaño' },
  { key: 'lineHeight', label: 'Interlineado' }, { key: 'letterSpacing', label: 'Espaciado' }, { key: 'color', label: 'Color' }, { key: 'caps', label: 'Mayúsculas' },
];
const DEFAULTS: Required<Pick<TextStyleProps, 'fontFamily' | 'fontWeight' | 'fontSize' | 'lineHeight' | 'letterSpacing' | 'color' | 'caps'>> = {
  fontFamily: 'Inter, sans-serif', fontWeight: 400, fontSize: 120, lineHeight: 1.15, letterSpacing: 0, color: '#000000', caps: false,
};

function StyleEditor({ style, from }: { style: TextStyle; from: Layer | null }) {
  const p = style.props;
  const setProp = (k: keyof TextStyleProps, v: any) => updateTextStyle(style.id, { props: { ...p, [k]: v } });
  const toggle = (k: keyof TextStyleProps, on: boolean) => {
    if (!on) { const { [k]: _x, ...rest } = p; updateTextStyle(style.id, { props: rest }); return; }
    const fromText = from?.text ? (styleFromText(from.text) as any)[k] : undefined;
    setProp(k, fromText ?? (DEFAULTS as any)[k]);
  };
  const [name, setName] = useState(style.name);
  return (
    <div className="card col" style={{ padding: 8, gap: 6 }}>
      <input className="input" value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== style.name && updateTextStyle(style.id, { name: name.trim() })}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label="Nombre del estilo" />
      <div className="tiny muted">Marca lo que fija el estilo. Al cambiarlo, sus textos se actualizan salvo en lo que se cambió a mano.</div>
      {PROP_ROWS.map(({ key, label }) => {
        const on = p[key] !== undefined;
        return (
          <div key={key} className="row" style={{ gap: 6, minHeight: 24 }}>
            <Check checked={on} onChange={v => toggle(key, v)} label={<span className="small" style={{ width: 74, display: 'inline-block' }}>{label}</span>} />
            {on && key === 'fontFamily' && <FontPicker value={p.fontFamily!} onChange={v => setProp('fontFamily', v)} width="100%" />}
            {on && key === 'fontWeight' && <Select value={String(p.fontWeight) as any} width={90} onChange={v => setProp('fontWeight', +v)} options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => ({ value: String(w), label: String(w) }))} />}
            {on && key === 'fontSize' && <NumberField label="px" value={p.fontSize!} min={1} max={5000} digits={0} onChange={() => {}} onCommit={v => setProp('fontSize', v)} />}
            {on && key === 'lineHeight' && <NumberField label="×" value={p.lineHeight!} min={0.5} max={4} step={0.05} digits={2} onChange={() => {}} onCommit={v => setProp('lineHeight', v)} />}
            {on && key === 'letterSpacing' && <NumberField label="px" value={p.letterSpacing!} min={-200} max={500} digits={0} onChange={() => {}} onCommit={v => setProp('letterSpacing', v)} />}
            {on && key === 'color' && <ColorInput value={p.color!} onChange={() => {}} onCommit={v => setProp('color', v)} />}
            {on && key === 'caps' && <Seg value={p.caps ? 'y' : 'n'} onChange={v => setProp('caps', v === 'y')} options={[{ value: 'n', label: 'No' }, { value: 'y', label: 'Sí' }]} />}
          </div>
        );
      })}
    </div>
  );
}

function Styles({ kit, doc, editable, edit }: SectionProps) {
  useFontsVersion();
  const [open, setOpen] = useState<string | null>(null);
  const st = doc!.state;
  const ds = docStyles(st);
  const count = (id: string) => st.layers.filter(l => l.text?.styleId === id).length;
  const sel = selectedText(doc);
  const preview = (s: TextStyle) => ({ fontFamily: s.props.fontFamily, fontWeight: s.props.fontWeight, fontStyle: s.props.italic ? 'italic' : undefined, textTransform: s.props.caps ? 'uppercase' as const : undefined });
  const hint = sel ? 'Clic: aplicar al texto seleccionado' : 'Clic: crear un texto con este estilo';
  return (
    <>
      <div className="section-title">Estilos de texto · kit</div>
      {!kit.styles.length && <div className="tiny muted">Sin estilos en el kit.</div>}
      <div className="col" style={{ gap: 1 }}>
        {kit.styles.map(s => (
          <div key={s.id} className="hist-item brand-style" title={hint} onClick={() => applyTextStyle(s)}>
            <span className="grow" style={{ ...preview(s), fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            <span className="tiny muted">{s.role ?? ''}{s.props.fontSize ? ` · ${s.props.fontSize}px` : ''}</span>
            {editable && <button className="icon-btn sm" title="Quitar del kit" aria-label={`Quitar ${s.name}`} onClick={e => { e.stopPropagation(); edit(k => ({ ...k, styles: k.styles.filter(x => x.id !== s.id) })); }}><X size={11} /></button>}
          </div>
        ))}
      </div>
      <div className="section-title">Estilos del documento</div>
      {!ds.length && <div className="tiny muted">Aplica un estilo del kit o crea uno desde un texto (Propiedades → Estilo). Editar un estilo actualiza todos sus textos.</div>}
      {ds.map(s => {
        const n = count(s.id);
        return (
          <React.Fragment key={s.id}>
            <div className={'hist-item brand-style' + (sel?.text?.styleId === s.id ? ' current' : '')} title={hint} onClick={() => applyTextStyle(s)}>
              <span className="grow" style={{ ...preview(s), fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              <span className="tiny muted" title="Textos vinculados">{n} {n === 1 ? 'texto' : 'textos'}</span>
              <button className={'icon-btn sm' + (open === s.id ? ' active' : '')} title="Editar estilo" aria-label={`Editar ${s.name}`} onClick={e => { e.stopPropagation(); setOpen(open === s.id ? null : s.id); }}><Pencil size={11} /></button>
              {editable && <button className="icon-btn sm" title={`Guardar en el kit «${kit.name}»`} aria-label="Guardar en el kit" onClick={e => { e.stopPropagation(); try { saveStyleToKit(s, kit.id); toast(`«${s.name}» guardado en ${kit.name}`, 'ok'); } catch (er: any) { toast(er.message, 'error'); } }}><Download size={11} /></button>}
              <button className="icon-btn sm" title="Eliminar estilo (los textos conservan su aspecto)" aria-label={`Eliminar ${s.name}`} onClick={e => { e.stopPropagation(); deleteTextStyle(s.id); }}><Trash2 size={11} /></button>
            </div>
            {open === s.id && <StyleEditor style={s} from={sel} />}
          </React.Fragment>
        );
      })}
    </>
  );
}

function AssetTile({ a, color, onClick, onRemove }: { a: BrandAsset; color: string; onClick: () => void; onRemove?: () => void }) {
  const url = useMemo(() => svgUrl(a.recolor ? colorizeSvg(a.svg, color) : a.svg), [a, color]);
  return (
    <div className={'brand-tile' + (a.kind === 'logo' || a.kind === 'mark' ? ' wide' : '')} role="button" tabIndex={0} title={`${a.name} · clic para colocar`} onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter') onClick(); }}>
      <img src={url} alt={a.name} draggable={false} />
      {onRemove && <button className="icon-btn sm brand-tile-x" title="Quitar del kit" aria-label={`Quitar ${a.name}`} onClick={e => { e.stopPropagation(); onRemove(); }}><X size={10} /></button>}
    </div>
  );
}

function Assets({ kit, doc, editable, edit }: SectionProps) {
  const [corner, setCorner] = useState<Corner>('tl');
  const [color, setColor] = useState('#ffffff');
  const logos = kit.assets.filter(a => a.kind === 'logo' || a.kind === 'mark');
  const icons = kit.assets.filter(a => a.kind === 'icon' || a.kind === 'graphic');
  const navy = kit.rules.logoBackground ?? '#00001f';
  const removeAsset = editable ? (id: string) => edit(k => ({ ...k, assets: k.assets.filter(x => x.id !== id) })) : undefined;
  const st = doc!.state;
  const selVector = st.layers.find(x => x.id === st.selectedLayerIds[st.selectedLayerIds.length - 1] && x.kind === 'vector' && x.vector);
  const addFromFile = async (kind: BrandAsset['kind']) => {
    const files = await pickFiles(true, '.svg,image/svg+xml');
    const add: BrandAsset[] = [];
    for (const f of files) {
      const svg = cleanSvg(await f.text());
      const size = svg && svgSize(svg);
      if (!svg || !size) { toast(`«${f.name}» no es un SVG válido o trae scripts o enlaces externos.`, 'warn'); continue; }
      add.push({ id: `${slug(f.name.replace(/\.svg$/i, ''))}-${Date.now().toString(36)}`, name: f.name.replace(/\.svg$/i, ''), kind, svg, w: size.w, h: size.h, recolor: /currentColor/.test(svg) });
    }
    if (add.length) edit(k => ({ ...k, assets: [...k.assets, ...add] }));
  };
  const addSelected = () => {
    const v = selVector!.vector!;
    const svg = cleanSvg(v.svg);
    if (!svg) { toast('Ese vector no se puede guardar en el kit (trae scripts o enlaces externos).', 'warn'); return; }
    edit(k => ({ ...k, assets: [...k.assets, { id: `${slug(selVector!.name)}-${Date.now().toString(36)}`, name: selVector!.name, kind: 'graphic', svg, w: v.w, h: v.h, recolor: /currentColor/.test(svg) }] }));
  };
  return (
    <>
      <div className="section-title">Logotipos</div>
      {!logos.length && <div className="tiny muted">Sin logotipos.</div>}
      {logos.length > 0 && <>
        <div className="row" style={{ gap: 4 }}>
          <span className="tiny muted">Esquina</span>
          <Seg value={corner} onChange={v => setCorner(v)} options={CORNERS.map(c => ({ value: c.id, label: c.id === 'tl' ? '↖' : c.id === 'tr' ? '↗' : c.id === 'bl' ? '↙' : '↘', title: c.label }))} />
        </div>
        <div className="brand-grid" style={{ background: navy }}>
          {logos.map(a => <AssetTile key={a.id} a={a} color={color} onClick={() => placeAsset(kit, a, { corner })} onRemove={removeAsset && (() => removeAsset(a.id))} />)}
        </div>
      </>}
      <div className="section-title">Iconos</div>
      {!icons.length && <div className="tiny muted">Sin iconos.</div>}
      {icons.some(a => a.recolor) && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <span className="tiny muted">Color</span>
          {[{ hex: '#ffffff', name: 'Blanco (como en el manual)' }, ...kit.colors].map(c => (
            <button key={c.hex} className={'swatch-btn' + (color === c.hex ? ' on' : '')} title={c.name} aria-label={c.name} style={{ background: c.hex, borderColor: color === c.hex ? 'var(--accent)' : 'var(--border-2)' }} onClick={() => setColor(c.hex)} />
          ))}
        </div>
      )}
      {icons.length > 0 && (
        <div className="brand-grid" style={{ background: color === navy ? '#f0e7de' : navy }}>
          {icons.map(a => <AssetTile key={a.id} a={a} color={color} onClick={() => placeAsset(kit, a, { color })} onRemove={removeAsset && (() => removeAsset(a.id))} />)}
        </div>
      )}
      {editable && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => addFromFile('logo')}><ImagePlus size={12} />Logotipo (SVG)</button>
          <button className="btn sm" onClick={() => addFromFile('icon')}><ImagePlus size={12} />Iconos (SVG)</button>
          {selVector && <button className="btn sm" onClick={addSelected}><Plus size={12} />Vector seleccionado</button>}
        </div>
      )}
    </>
  );
}

function Rules({ kit, doc }: { kit: BrandKit; doc: Doc }) {
  const [issues, setIssues] = useState<BrandIssue[] | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const run = () => setIssues(checkBrand(doc.state, kit));
  const go = (i: BrandIssue) => {
    if (!i.layerId) return;
    const l = doc.state.layers.find(x => x.id === i.layerId);
    if (!l) return;
    selectLayers([l.id]);
    const b = layerBounds(l);
    fitToScreen({ x: b.x - b.w, y: b.y - b.h, w: b.w * 3, h: b.h * 3 });
  };
  const Icon = (lv: BrandIssue['level']) => lv === 'info' ? <Info size={12} className="muted" /> : <AlertTriangle size={12} style={{ color: lv === 'error' ? 'var(--danger)' : 'var(--warn)' }} />;
  return (
    <>
      <div className="section-title">Normas <span className="grow" />
        {kit.rules.notes.length > 0 && <button className="btn sm ghost" onClick={() => setShowNotes(!showNotes)}>{showNotes ? 'Ocultar' : 'Ver'} ({kit.rules.notes.length})</button>}
      </div>
      {showNotes && <ul className="brand-notes">{kit.rules.notes.map((n, i) => <li key={i} className="tiny">{n}</li>)}</ul>}
      <button className="btn sm" onClick={run} title="Tamaño mínimo, área de protección, esquinas y fondo del logotipo; tipografías y colores fuera del kit"><ShieldCheck size={12} />Revisar el documento con este kit</button>
      {issues && !issues.length && <div className="row tiny" style={{ color: 'var(--ok)' }}><ShieldCheck size={12} />Todo cumple las normas del kit.</div>}
      {issues && issues.map((i, k) => (
        <div key={k} className="brand-issue" role={i.layerId ? 'button' : undefined} onClick={() => go(i)}>
          {Icon(i.level)}
          <span className="tiny grow">{i.text}</span>
          {i.fix?.kind === 'background' && i.artboardId && <button className="btn sm" onClick={e => { e.stopPropagation(); setLogoBackground(i.artboardId!, (i.fix as any).hex); run(); }}>Poner fondo</button>}
          {i.fix?.kind === 'corner' && i.layerId && <button className="btn sm" title="Lleva el logotipo a la esquina más cercana, con su área de protección" onClick={e => { e.stopPropagation(); moveLogoToCorner(i.layerId!, nearestCorner(doc, i.layerId!)); run(); }}>A la esquina</button>}
        </div>
      ))}
      {issues && <button className="btn sm ghost" onClick={() => setIssues(null)}><Link2Off size={12} />Cerrar revisión</button>}
    </>
  );
}

function nearestCorner(doc: Doc, id: string): Corner {
  const l = doc.state.layers.find(x => x.id === id)!;
  const b = layerBounds(l);
  const ab = doc.state.artboards.find(a => b.x < a.x + a.w && b.x + b.w > a.x && b.y < a.y + a.h && b.y + b.h > a.y) ?? doc.state.artboards[0];
  const left = b.x + b.w / 2 < ab.x + ab.w / 2, top = b.y + b.h / 2 < ab.y + ab.h / 2;
  return top ? (left ? 'tl' : 'tr') : left ? 'bl' : 'br';
}
