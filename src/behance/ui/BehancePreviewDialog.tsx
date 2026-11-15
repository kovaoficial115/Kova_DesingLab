import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Eye, Monitor, Smartphone, AlertTriangle, Info, CheckCircle2, Download } from 'lucide-react';
import { useActiveDoc, toast } from '../../core/store';
import type { Artboard, DocState } from '../../core/types';
import { Modal, Seg, Check, NumberField, Slider, ColorInput } from '../../ui/components/controls';
import { renderArtboard } from '../../core/render';
import { canvasToBlob, createCanvas, ctx2d, layerBounds } from '../../core/util';
import { platform } from '../../platform';
import { fileKeyFrom } from '../../social/presets';
import { SimAppearanceSeg, useSimTheme } from '../../social/ui/SimAppearance';
import { listProjects, coverCrop, checkCover, seamDifference, crossingItems, BEHANCE_GUIDE, type Check as Chk } from '../model';

// ---------- renders de la vista previa (en caché por estado de capas) ----------
const cache = new WeakMap<object, Map<string, Promise<HTMLCanvasElement>>>();
function previewFor(state: DocState, ab: Artboard, width: number): Promise<HTMLCanvasElement> {
  let m = cache.get(state.layers);
  if (!m) { m = new Map(); cache.set(state.layers, m); }
  const key = `${ab.id}|${ab.x}|${ab.y}|${ab.w}|${ab.h}|${ab.background}|${width}`;
  let p = m.get(key);
  if (!p) { p = renderArtboard(state, ab, Math.min(1, width / ab.w)); m.set(key, p); }
  return p;
}

function Img({ state, ab, width, style, onReady }: { state: DocState; ab: Artboard; width: number; style?: React.CSSProperties; onReady?: (c: HTMLCanvasElement) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let on = true;
    previewFor(state, ab, width).then(c => {
      const el = ref.current;
      if (!on || !el) return;
      el.width = c.width; el.height = c.height;
      const g = el.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(c, 0, 0);
      onReady?.(c);
    });
    return () => { on = false; };
  }, [state.layers, ab.x, ab.y, ab.w, ab.h, ab.background, width]);
  return <canvas ref={ref} style={{ display: 'block', aspectRatio: `${ab.w} / ${ab.h}`, ...style }} />;
}

const Icon = ({ level }: { level: Chk['level'] }) =>
  level === 'error' || level === 'warn' ? <AlertTriangle size={12} style={{ color: 'var(--warn)', flex: 'none' }} />
    : level === 'ok' ? <CheckCircle2 size={12} style={{ color: 'var(--ok)', flex: 'none' }} />
      : <Info size={12} className="muted" style={{ flex: 'none' }} />;

/** Fila inferior / superior de dos renders a 64 px de ancho, para comparar el corte. */
function edgeRow(c: HTMLCanvasElement, bottom: boolean) {
  const s = createCanvas(64, 1);
  const g = ctx2d(s, { willReadFrequently: true });
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 1);
  g.drawImage(c, 0, bottom ? c.height - 1 : 0, c.width, 1, 0, 0, 64, 1);
  return g.getImageData(0, 0, 64, 1).data;
}

type View = 'desktop' | 'mobile';
type Tab = 'project' | 'cover';

export function BehancePreviewDialog({ onClose, project }: { onClose: () => void; project?: string }) {
  const doc = useActiveDoc();
  const projects = doc ? listProjects(doc.state.artboards) : [];
  const proj = projects.find(p => p.id === project) ?? projects[0];
  const [tab, setTab] = useState<Tab>('project');
  const [view, setView] = useState<View>('desktop');
  const { dark } = useSimTheme();
  const [screen, setScreen] = useState(1440);
  const [gap, setGap] = useState(0);
  const [pageBg, setPageBg] = useState('#ffffff');
  const [bounds, setBounds] = useState(false);
  const [seams, setSeams] = useState<Record<number, number>>({});
  const edges = useRef(new Map<string, HTMLCanvasElement>());
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(800);
  // portada
  const [coverId, setCoverId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fx, setFx] = useState(0.5);
  const [fy, setFy] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, [tab]);

  const sections = proj?.sections ?? [];
  const sig = sections.map(a => `${a.id}:${a.h}:${a.w}`).join();
  useEffect(() => { edges.current.clear(); setSeams({}); }, [doc?.state.layers, sig]);

  const crossing = useMemo(() => (doc && proj ? crossingItems(sections, doc.state.layers.filter(l => l.kind !== 'group' && l.visible), l => layerBounds(l)) : []), [doc?.state.layers, sig]);

  if (!doc || !proj) return null;
  const state = doc.state;

  // ---------- geometría de la página simulada ----------
  const screenW = view === 'mobile' ? 390 : screen;
  const k = Math.min(1, (boxW - 2) / screenW);
  const side = view === 'mobile' ? 0 : Math.max(16, Math.round(screenW * 0.04));
  const column = Math.min(BEHANCE_GUIDE.displayWidth, screenW - side * 2);
  const dispW = (a: Artboard) => (view === 'mobile' ? column : Math.min(column, a.w));
  const renderW = Math.round(Math.min(1400, column * k * (window.devicePixelRatio || 1)));
  const fg = dark ? '#f2f2f2' : '#191919', sub = dark ? '#a3a3a3' : '#6b6b6b', chrome = dark ? '#111214' : '#ffffff', line = dark ? '#2a2b2f' : '#e6e6e6';

  const onEdge = (a: Artboard, c: HTMLCanvasElement) => {
    edges.current.set(a.id, c);
    const next: Record<number, number> = {};
    for (let i = 0; i < sections.length - 1; i++) {
      const A = edges.current.get(sections[i].id), B = edges.current.get(sections[i + 1].id);
      if (A && B) next[i] = seamDifference(edgeRow(A, true), edgeRow(B, false));
    }
    setSeams(s => (JSON.stringify(s) === JSON.stringify(next) ? s : next));
  };

  // ---------- comprobaciones de separación ----------
  const checks: Chk[] = [];
  const widths = new Set(sections.map(a => a.w));
  if (widths.size > 1) checks.push({ level: 'warn', text: `Las secciones no tienen el mismo ancho (${[...widths].join(', ')} px): las más estrechas se verán con márgenes.` });
  if (gap > 0 && proj.continuous) checks.push({ level: 'warn', text: `Proyecto continuo con ${gap} px de separación: el diseño se verá cortado entre secciones. Para que encaje, la separación entre imágenes tiene que ser 0.` });
  if (crossing.length) checks.push({ level: gap > 0 ? 'warn' : 'info', text: `${crossing.length} elemento(s) cruzan de una sección a otra${gap > 0 ? ` y con ${gap} px de separación se verán partidos` : '; con separación 0 encajan'}.` });
  const hard = Object.entries(seams).filter(([, d]) => d > 40).map(([i]) => +i);
  if (gap === 0 && hard.length) checks.push({ level: 'info', text: `Corte visible entre ${hard.map(i => `${i + 1}→${i + 2}`).join(', ')}: los bordes que se tocan cambian mucho de color. Si no es intencionado, une el fondo o añade separación.` });
  if (gap === 0 && !hard.length && Object.keys(seams).length === sections.length - 1 && sections.length > 1) checks.push({ level: 'ok', text: 'Las secciones encajan sin cortes bruscos de color entre ellas.' });
  if (sections.some(a => a.w < BEHANCE_GUIDE.displayWidth)) checks.push({ level: 'info', text: 'Hay secciones de menos de 1400 px: Behance las muestra a su tamaño, con márgenes.' });

  // ---------- portada ----------
  const coverAb = sections.find(a => a.id === coverId) ?? sections[0];
  const crop = coverCrop(coverAb.w, coverAb.h, zoom, fx, fy);
  const coverChecks = checkCover(crop.w, crop.h);
  const exportCover = async () => {
    const C = BEHANCE_GUIDE.cover;
    const W = C.w * 2, H = C.h * 2;
    const s = W / crop.w;
    const full = await renderArtboard(state, { ...coverAb, x: coverAb.x + crop.x, y: coverAb.y + crop.y, w: crop.w, h: crop.h }, s);
    const out = createCanvas(W, H);
    const g = ctx2d(out);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.drawImage(full, 0, 0, W, H);
    const blob = await canvasToBlob(out, 'image/jpeg', 0.92);
    await platform.saveFile(blob, { suggestedName: `${fileKeyFrom(proj.name)}_portada.jpg`, pick: true });
    toast(`Portada exportada a ${W}×${H} px`, 'ok');
  };

  return (
    <Modal title={`Vista previa de Behance · ${proj.name}`} icon={<Eye size={16} />} onClose={onClose} width="min(1240px, 96vw)" height="92vh"
      footer={<><span className="tiny muted grow">Simulación aproximada hecha en KOVA: no es la interfaz real de Behance ni reproduce todas sus funciones. Las proporciones y anchos salen de la ayuda de Behance.</span><button className="btn" onClick={onClose}>Cerrar</button></>}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Seg value={tab} onChange={setTab} options={[{ value: 'project', label: 'Proyecto' }, { value: 'cover', label: 'Portada' }]} />
        {tab === 'project' && <>
          <Seg value={view} onChange={setView} options={[{ value: 'desktop', label: <><Monitor size={12} /> Escritorio</> }, { value: 'mobile', label: <><Smartphone size={12} /> Móvil</> }]} />
          {view === 'desktop' && <Seg value={String(screen)} onChange={v => setScreen(+v)} options={['1280', '1440', '1920'].map(v => ({ value: v, label: `${v} px`, title: 'Ancho de la pantalla simulada' }))} />}
        </>}
        <SimAppearanceSeg />
      </div>

      {tab === 'project' ? (
        <div className="sim-split" style={{ gridTemplateColumns: 'minmax(240px, 300px) 1fr' }}>
          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="small grow">Separación entre imágenes</span>
              <NumberField value={gap} onChange={v => setGap(Math.max(0, Math.round(v)))} min={0} max={200} digits={0} suffix="px" width={84} />
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="small grow">Fondo del proyecto</span>
              <ColorInput value={pageBg} onChange={setPageBg} />
            </div>
            <div className="tiny muted">Pon aquí la separación y el fondo que vayas a configurar al montar el proyecto en Behance; KOVA no conoce tus ajustes allí.</div>
            <Check checked={bounds} onChange={setBounds} label="Marcar dónde empieza cada imagen" />
            <div className="section-title">Comprobaciones</div>
            {checks.length ? checks.map((c, i) => <span key={i} className="tiny row" style={{ gap: 4, alignItems: 'flex-start' }}><Icon level={c.level} />{c.text}</span>)
              : <span className="tiny muted">Midiendo…</span>}
            <div className="section-title">Secciones</div>
            {sections.map((a, i) => (
              <div key={a.id} className="tiny row" style={{ gap: 6 }}>
                <span className="mono muted">{String(i + 1).padStart(2, '0')}</span><span className="grow">{a.name}</span><span className="mono muted">{a.w}×{a.h}</span>
                {seams[i] != null && i < sections.length - 1 && <span className="mono muted" title="Diferencia de color con la siguiente (0–255)">Δ{Math.round(seams[i])}</span>}
              </div>
            ))}
          </div>
          <div ref={box} style={{ overflow: 'auto', maxHeight: '70vh', border: `1px solid var(--border)`, borderRadius: 8, background: chrome }}>
            <div style={{ width: screenW * k, margin: '0 auto', background: chrome, color: fg, fontFamily: 'system-ui, sans-serif' }}>
              {/* cabecera genérica: título del proyecto, sin marcas ni botones de la plataforma */}
              <div style={{ padding: `${14 * k}px ${Math.max(10, side * k)}px`, borderBottom: `1px solid ${line}` }}>
                <div style={{ fontWeight: 700, fontSize: Math.max(11, 22 * k) }}>{proj.name}</div>
                <div style={{ fontSize: Math.max(9, 13 * k), color: sub }}>{doc.social?.profile.displayName || 'Tu nombre'}</div>
              </div>
              <div style={{ background: pageBg, padding: `${(view === 'mobile' ? 0 : 24) * k}px 0` }}>
                {sections.map((a, i) => (
                  <div key={a.id} style={{ position: 'relative', width: dispW(a) * k, margin: `0 auto ${i < sections.length - 1 ? gap * k : 0}px` }}>
                    <Img state={state} ab={a} width={renderW} style={{ width: '100%', height: 'auto' }} onReady={c => onEdge(a, c)} />
                    {bounds && <>
                      <div style={{ position: 'absolute', inset: 0, outline: '1px dashed rgba(0,140,255,.9)', pointerEvents: 'none' }} />
                      <span style={{ position: 'absolute', left: 4, top: 4, fontSize: 10, background: 'rgba(0,140,255,.9)', color: '#fff', borderRadius: 4, padding: '0 5px' }}>{i + 1} · {Math.round(dispW(a))}×{Math.round((dispW(a) * a.h) / a.w)}</span>
                    </>}
                  </div>
                ))}
              </div>
              <div style={{ padding: `${18 * k}px`, textAlign: 'center', fontSize: Math.max(9, 12 * k), color: sub, borderTop: `1px solid ${line}` }}>Fin del proyecto · {sections.length} imágenes</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="sim-split" style={{ gridTemplateColumns: 'minmax(240px, 300px) 1fr' }}>
          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="small">Desde</span>
              <select className="select grow" value={coverAb.id} onChange={e => setCoverId(e.target.value)} aria-label="Sección de la portada">
                {sections.map((a, i) => <option key={a.id} value={a.id}>{String(i + 1).padStart(2, '0')} · {a.name}</option>)}
              </select>
            </div>
            <Slider label="Zoom" value={zoom} min={1} max={4} step={0.05} digits={2} onChange={setZoom} />
            <Slider label="Horizontal" value={Math.round(fx * 100)} min={0} max={100} onChange={v => setFx(v / 100)} suffix="%" />
            <Slider label="Vertical" value={Math.round(fy * 100)} min={0} max={100} onChange={v => setFy(v / 100)} suffix="%" />
            {coverChecks.map((c, i) => <span key={i} className="tiny row" style={{ gap: 4, alignItems: 'flex-start' }}><Icon level={c.level} />{c.text}</span>)}
            <div className="tiny muted">Proporción {BEHANCE_GUIDE.cover.w}:{BEHANCE_GUIDE.cover.h}. Behance la muestra pequeña ({BEHANCE_GUIDE.cover.displayW}×{BEHANCE_GUIDE.cover.displayH}) en las listas de proyectos y te deja recortarla al subirla.</div>
            <button className="btn primary" onClick={() => void exportCover()}><Download size={13} />Exportar portada ({BEHANCE_GUIDE.cover.w * 2}×{BEHANCE_GUIDE.cover.h * 2} JPG)</button>
          </div>
          <div ref={box} className="col" style={{ gap: 14, padding: 14, borderRadius: 8, background: chrome, color: fg, border: '1px solid var(--border)' }}>
            <div className="small" style={{ color: sub }}>Recorte sobre la sección</div>
            <div style={{ position: 'relative', width: Math.min(420, boxW - 30), alignSelf: 'flex-start', overflow: 'hidden' }}>
              <Img state={state} ab={coverAb} width={840} style={{ width: '100%', height: 'auto' }} />
              <div style={{ position: 'absolute', left: `${(crop.x / coverAb.w) * 100}%`, top: `${(crop.y / coverAb.h) * 100}%`, width: `${(crop.w / coverAb.w) * 100}%`, height: `${(crop.h / coverAb.h) * 100}%`, outline: '2px solid #0a84ff', boxShadow: '0 0 0 9999px rgba(0,0,0,.45)' }} />
            </div>
            <div className="small" style={{ color: sub }}>Miniatura a tamaño de lista ({BEHANCE_GUIDE.cover.displayW}×{BEHANCE_GUIDE.cover.displayH}) junto a otras (huecos grises de relleno)</div>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {[0, 1, 2].map(i => (
                <div key={i} className="col" style={{ gap: 4, width: BEHANCE_GUIDE.cover.displayW }}>
                  <div style={{ width: BEHANCE_GUIDE.cover.displayW, height: BEHANCE_GUIDE.cover.displayH, borderRadius: 4, overflow: 'hidden', background: dark ? '#26272b' : '#ececec', position: 'relative' }}>
                    {i === 1 && <CoverCrop state={state} ab={coverAb} crop={crop} />}
                  </div>
                  <span className="tiny" style={{ color: i === 1 ? fg : sub, fontWeight: i === 1 ? 600 : 400 }}>{i === 1 ? proj.name : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** El recorte de la portada dibujado a 202×158 (×2 en pantallas retina). */
function CoverCrop({ state, ab, crop }: { state: DocState; ab: Artboard; crop: { x: number; y: number; w: number; h: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let on = true;
    previewFor(state, ab, 840).then(c => {
      const el = ref.current;
      if (!on || !el) return;
      const C = BEHANCE_GUIDE.cover;
      el.width = C.displayW * 2; el.height = C.displayH * 2;
      const s = c.width / ab.w;
      const g = el.getContext('2d')!;
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, el.width, el.height);
      g.drawImage(c, crop.x * s, crop.y * s, crop.w * s, crop.h * s, 0, 0, el.width, el.height);
    });
    return () => { on = false; };
  }, [state.layers, ab.id, ab.w, ab.h, ab.background, crop.x, crop.y, crop.w, crop.h]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
}
