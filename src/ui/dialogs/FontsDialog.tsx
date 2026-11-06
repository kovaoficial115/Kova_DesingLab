import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Type, Upload, Trash2, Download, Check as CheckIcon, ExternalLink, AlertTriangle, Search } from 'lucide-react';
import { Modal, Seg, Check } from '../components/controls';
import { useFontsVersion } from '../components/FontPicker';
import { activeLayer, set, toast, withBusy } from '../../core/store';
import { updateLayer } from '../../core/actions';
import {
  FONT_ACCEPT, deleteFamily, downloadCatalogFont, familyValue, hasFamily, importFontFiles, listFonts, loadCatalog, previewFamily,
  type CatalogFont, type FontMeta,
} from '../../io/fonts';
import { pickFiles } from '../../io/fileOps';
import { platform } from '../../platform';

const SOURCE_LABEL: Record<FontMeta['source'], string> = { upload: 'Subida', google: 'Google Fonts', fontsource: 'Fontsource', project: 'De un proyecto' };
const CATEGORIES = [
  { value: 'all', label: 'Todas' }, { value: 'sans-serif', label: 'Sans' }, { value: 'serif', label: 'Serif' },
  { value: 'display', label: 'Display' }, { value: 'handwriting', label: 'Manuscrita' }, { value: 'monospace', label: 'Mono' },
];
const WEIGHT_NAME: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };

/** Aplica la familia a la capa de texto seleccionada (si la hay) y a la herramienta Texto. */
function applyFamily(family: string) {
  const v = familyValue(family);
  set(s => ({ opts: { ...s.opts, fontFamily: v } }));
  const l = activeLayer();
  if (l?.kind === 'text' && l.text) { updateLayer(l.id, x => ({ text: { ...x.text!, fontFamily: v } }), 'Cambiar fuente'); toast(`«${family}» aplicada a «${l.name}»`, 'ok'); }
  else toast(`«${family}» lista en la herramienta Texto`, 'ok');
}

function DropZone({ hint }: { hint: string }) {
  const [over, setOver] = useState(false);
  const run = (files: File[]) => withBusy('Instalando fuentes…', async () => {
    const { added, skipped } = await importFontFiles(files);
    if (added.length) toast(`Instalada${added.length > 1 ? 's' : ''}: ${added.join(', ')}`, 'ok', 5000);
    if (skipped.length) toast(`No se pudo leer: ${skipped.join(', ')}`, 'warn', 6000);
    if (!added.length && !skipped.length) toast('No se encontraron fuentes en los archivos', 'warn');
  });
  return (
    <div className={'font-drop' + (over ? ' over' : '')}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); run(platform.droppedFiles(e.dataTransfer)); }}>
      <Upload size={18} />
      <div className="small" style={{ fontWeight: 600 }}>Suelta aquí tus fuentes</div>
      <div className="tiny muted">{hint}</div>
      <button className="btn sm" onClick={async () => { const f = await pickFiles(true, FONT_ACCEPT); if (f.length) run(f); }}>Elegir archivos…</button>
    </div>
  );
}

function MyFonts({ sample }: { sample: string }) {
  const version = useFontsVersion();
  const fams = useMemo(() => {
    const m = new Map<string, FontMeta[]>();
    for (const f of listFonts()) m.set(f.family, [...(m.get(f.family) ?? []), f]);
    return [...m.entries()];
  }, [version]);
  return (
    <div className="col" style={{ gap: 10, minHeight: 0 }}>
      <DropZone hint="TTF, OTF, WOFF, WOFF2 o un .zip con varias (como los de DaFont). Se guardan en este navegador." />
      {!fams.length && <div className="tiny muted">Aún no has añadido fuentes. Súbelas aquí o descárgalas desde la pestaña Google Fonts.</div>}
      <div className="col" style={{ gap: 6, overflowY: 'auto', minHeight: 0 }}>
        {fams.map(([family, faces]) => (
          <div key={family} className="check-item" style={{ alignItems: 'center' }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontFamily: familyValue(family), fontSize: 24, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sample || family}</div>
              <div className="tiny muted">
                <b style={{ color: 'var(--text-2)' }}>{family}</b> · {faces.map(f => `${WEIGHT_NAME[f.weight] ?? f.weight}${f.style === 'italic' ? ' itálica' : ''}`).join(', ')} · {SOURCE_LABEL[faces[0].source]}{faces[0].license ? ` · ${faces[0].license}` : ''}
              </div>
            </div>
            <button className="btn sm" onClick={() => applyFamily(family)}>Usar</button>
            <button className="icon-btn sm" title="Quitar de este navegador (los textos que la usen pasarán a la fuente alternativa)" onClick={() => deleteFamily(family).then(() => toast(`«${family}» eliminada`, 'info'))}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CatalogRow({ f, sample, open, onToggle }: { f: CatalogFont; sample: string; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [face, setFace] = useState<string | null>(null);
  const [weights, setWeights] = useState<number[]>(() => [400, 700].filter(w => f.weights.includes(w)).length ? [400, 700].filter(w => f.weights.includes(w)) : [f.weights[0]]);
  const [italic, setItalic] = useState(false);
  const installed = hasFamily(f.family);
  // cargar la vista previa solo cuando la fila es visible
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); previewFamily(f).then(setFace).catch(() => setFace('')); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [f.id]);
  const download = () => withBusy(`Descargando ${f.family}…`, async () => {
    await downloadCatalogFont(f, weights, italic);
    toast(`«${f.family}» instalada`, 'ok');
  });
  return (
    <div ref={ref} className={'check-item catalog-row' + (open ? ' open' : '')} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="row" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontFamily: face ? `"${face}", sans-serif` : 'inherit', fontSize: 22, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: face === null ? 0.35 : 1 }}>{sample || f.family}</div>
          <div className="tiny muted">{f.family} · {CATEGORIES.find(c => c.value === f.category)?.label ?? f.category} · {f.weights.length} peso{f.weights.length > 1 ? 's' : ''}{f.styles.includes('italic') ? ' + itálicas' : ''} · {f.license}{f.type === 'other' ? ' · Fontsource' : ''}</div>
        </div>
        {installed ? <span className="chip ok"><CheckIcon size={11} />Instalada</span> : <button className="btn sm" onClick={e => { e.stopPropagation(); onToggle(); }}><Download size={12} />Añadir</button>}
      </div>
      {open && (
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            <span className="tiny muted">Pesos:</span>
            {f.weights.map(w => {
              const on = weights.includes(w);
              return <button key={w} className={'chip' + (on ? ' accent' : '')} style={{ cursor: 'pointer' }} onClick={() => setWeights(ws => (on ? ws.filter(x => x !== w) : [...ws, w].sort((a, b) => a - b)))}>{WEIGHT_NAME[w] ?? w}</button>;
            })}
          </div>
          <div className="row">
            {f.styles.includes('italic') && <Check checked={italic} onChange={setItalic} label="Incluir itálicas" />}
            <div className="grow" />
            {installed && <button className="btn sm" onClick={() => applyFamily(f.family)}>Usar</button>}
            <button className="btn sm primary" disabled={!weights.length} onClick={download}><Download size={12} />{installed ? 'Descargar pesos' : 'Descargar e instalar'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function GoogleFonts({ sample, initialQuery }: { sample: string; initialQuery: string }) {
  useFontsVersion();
  const [list, setList] = useState<CatalogFont[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(initialQuery);
  const [cat, setCat] = useState('all');
  const [onlyGoogle, setOnlyGoogle] = useState(true);
  const [limit, setLimit] = useState(40);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { loadCatalog().then(setList).catch(e => setError(String(e.message || e))); }, []);
  useEffect(() => setLimit(40), [q, cat, onlyGoogle]);
  const filtered = useMemo(() => {
    if (!list) return [];
    const s = q.trim().toLowerCase();
    return list.filter(f => (cat === 'all' || f.category === cat) && (!onlyGoogle || f.type === 'google') && (!s || f.family.toLowerCase().includes(s)));
  }, [list, q, cat, onlyGoogle]);
  return (
    <div className="col" style={{ gap: 10, minHeight: 0 }}>
      <div className="row">
        <div className="font-search grow" style={{ border: '1px solid var(--border-2)', borderRadius: 8 }}><Search size={13} className="muted" /><input autoFocus placeholder="Buscar en el catálogo (p. ej. Bebas, Montserrat, Pacifico)…" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Seg value={cat} onChange={setCat} options={CATEGORIES} />
        <div className="grow" />
        <Check checked={!onlyGoogle} onChange={v => setOnlyGoogle(!v)} label="Incluir otras fuentes libres (Fontsource)" />
      </div>
      {error && <div className="chip danger"><AlertTriangle size={12} />No se pudo cargar el catálogo ({error}). Revisa tu conexión.</div>}
      {!list && !error && <div className="row"><div className="spinner" />Cargando catálogo…</div>}
      {list && <div className="tiny muted">{filtered.length} fuentes · {onlyGoogle ? 'Todas las de Google Fonts tienen licencia libre (OFL, Apache o UFL) y se pueden usar en estampados comerciales.' : 'Revisa la licencia indicada en cada fuente antes de usarla en productos a la venta.'}</div>}
      <div className="col" style={{ gap: 6, overflowY: 'auto', minHeight: 0 }}>
        {filtered.slice(0, limit).map(f => <CatalogRow key={f.id} f={f} sample={sample} open={openId === f.id} onToggle={() => setOpenId(id => (id === f.id ? null : f.id))} />)}
        {filtered.length > limit && <button className="btn sm" style={{ alignSelf: 'center' }} onClick={() => setLimit(l => l + 60)}>Mostrar más ({filtered.length - limit} restantes)</button>}
      </div>
    </div>
  );
}

const SITES = [
  { name: 'DaFont', url: 'https://www.dafont.com/es/', note: 'Enorme variedad decorativa. Revisa la licencia de cada fuente: muchas son solo para uso personal.' },
  { name: 'Font Squirrel', url: 'https://www.fontsquirrel.com/', note: 'Fuentes seleccionadas con licencia para uso comercial.' },
  { name: '1001 Fonts', url: 'https://www.1001fonts.com/', note: 'Permite filtrar por fuentes gratuitas para uso comercial.' },
  { name: 'Google Fonts', url: 'https://fonts.google.com/', note: 'Todas libres; también puedes añadirlas directamente en la pestaña Google Fonts.' },
];

function OtherSites() {
  return (
    <div className="col" style={{ gap: 10, minHeight: 0, overflowY: 'auto' }}>
      <div className="small muted">DaFont y sitios similares no permiten descargar desde otras páginas, así que el proceso es: descarga el .zip en tu navegador y suéltalo aquí tal cual. Kova lo descomprime e instala todas las fuentes que contenga.</div>
      <DropZone hint="Suelta el .zip descargado (o los .ttf / .otf sueltos)." />
      <div className="chip warn" style={{ alignSelf: 'stretch', whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 10px' }}>
        <AlertTriangle size={12} style={{ flexShrink: 0 }} />Para vender prendas necesitas una licencia de uso comercial. En DaFont aparece como «Free for personal use» (no sirve para vender) o «100% Free» / «Free for commercial use».
      </div>
      {SITES.map(s => (
        <a key={s.name} className="check-item" href={s.url} target="_blank" rel="noopener noreferrer" style={{ alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
          <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{s.name}</div><div className="tiny muted">{s.note}</div></div>
          <ExternalLink size={14} className="muted" />
        </a>
      ))}
    </div>
  );
}

export function FontsDialog({ onClose, query, tab: initialTab }: { onClose: () => void; query?: string; tab?: 'mine' | 'google' | 'other' }) {
  const [tab, setTab] = useState<'mine' | 'google' | 'other'>(initialTab ?? (query ? 'google' : 'mine'));
  const [sample, setSample] = useState('');
  const textLayer = activeLayer();
  return (
    <Modal title="Tipografías" icon={<Type size={16} />} onClose={onClose} width={860} height="84vh"
      footer={<>
        <span className="tiny muted">{textLayer?.kind === 'text' ? `«Usar» cambia la fuente de «${textLayer.name}».` : '«Usar» la deja elegida en la herramienta Texto.'}</span>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="col" style={{ gap: 12, height: '100%', minHeight: 0 }}>
        <div className="row">
          <Seg value={tab} onChange={setTab} options={[{ value: 'mine', label: 'Mis fuentes' }, { value: 'google', label: 'Google Fonts' }, { value: 'other', label: 'DaFont y otros' }]} />
          <div className="grow" />
          {tab !== 'other' && <input className="input" style={{ width: 240 }} placeholder="Texto de muestra" value={sample} onChange={e => setSample(e.target.value)} />}
        </div>
        <div className="col" style={{ flex: 1, minHeight: 0 }}>
          {tab === 'mine' && <MyFonts sample={sample} />}
          {tab === 'google' && <GoogleFonts sample={sample} initialQuery={query ?? ''} />}
          {tab === 'other' && <OtherSites />}
        </div>
      </div>
    </Modal>
  );
}
