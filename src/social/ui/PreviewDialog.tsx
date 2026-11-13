import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Smartphone, ChevronLeft, ChevronRight, Save, Trash2, Plus, Layers as LayersIcon, Clapperboard, Heart, MessageCircle, Send, Bookmark } from 'lucide-react';
import { useStore, useActiveDoc, toast } from '../../core/store';
import type { Artboard, Doc } from '../../core/types';
import { Modal, Seg, Check } from '../../ui/components/controls';
import { uid } from '../../core/util';
import { findFormat } from '../presets';
import { emptyDocSocial, feedItems, applyPlan, listSeries, seriesArtboards, type DocSocial, type FeedPlan } from '../model';
import { moveItem } from '../carousel';
import { updateDocSocial } from '../actions';
import { thumbFor, averageColor } from './thumbs';
import { CommitInput } from './SocialPanel';

type Tab = 'profile' | 'post' | 'story' | 'reel' | 'planner';

/** Miniatura que llena su caja recortando al centro (como la cuadrícula del perfil). */
function Cover({ doc, ab, max = 360, round = false, onColor }: { doc: Doc; ab: Artboard; max?: number; round?: boolean; onColor?: (c: { r: number; g: number; b: number }) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let on = true;
    thumbFor(doc.state, ab, max).then(c => {
      const el = ref.current;
      if (!on || !el) return;
      el.width = c.width; el.height = c.height;
      const g = el.getContext('2d')!;
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(c, 0, 0);
      onColor?.(averageColor(el));
    });
    return () => { on = false; };
  }, [doc.state.layers, ab.x, ab.y, ab.w, ab.h, ab.background, max]);
  return <canvas ref={ref} className={'sim-cover' + (round ? ' round' : '')} />;
}

const Glyph = ({ icon: I }: { icon: any }) => <span className="sim-glyph" aria-hidden="true"><I size={18} /></span>;

function useSocial(doc: Doc | null): DocSocial { return doc?.social ?? emptyDocSocial(); }

function Avatar({ doc, size = 64 }: { doc: Doc; size?: number }) {
  const pic = doc.state.artboards.find(a => /profile/.test(a.social?.preset ?? ''));
  const so = useSocial(doc);
  const letter = (so.profile.username || doc.name).trim().charAt(0).toUpperCase();
  return (
    <div className="sim-avatar" style={{ width: size, height: size }}>
      {pic ? <Cover doc={doc} ab={pic} max={200} round /> : <span>{letter}</span>}
    </div>
  );
}

/** Desplazamiento horizontal con «snap» (como deslizar un carrusel) y puntos. */
function Swipe({ doc, slides, aspect }: { doc: Doc; slides: Artboard[]; aspect: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const go = (n: number) => { const el = ref.current; if (el) el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' }); };
  return (
    <div className="sim-swipe-wrap" style={{ aspectRatio: aspect }}>
      <div className="sim-swipe" ref={ref} onScroll={e => { const el = e.currentTarget; setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
        {slides.map(a => <div key={a.id} className="sim-slide"><Cover doc={doc} ab={a} max={720} /></div>)}
      </div>
      {slides.length > 1 && <>
        <span className="sim-count">{i + 1}/{slides.length}</span>
        {i > 0 && <button className="sim-arrow left" aria-label="Anterior" onClick={() => go(i - 1)}><ChevronLeft size={16} /></button>}
        {i < slides.length - 1 && <button className="sim-arrow right" aria-label="Siguiente" onClick={() => go(i + 1)}><ChevronRight size={16} /></button>}
        <div className="sim-dots">{slides.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
      </>}
    </div>
  );
}

const slidesOf = (doc: Doc, a: Artboard) => (a.social?.series ? seriesArtboards(doc.state.artboards, a.social.series.id) : [a]);
const isVertical = (doc: Doc, a: Artboard, user: any) => { const f = findFormat(a.social?.preset, user); return a.h / a.w > 1.7 || !!f?.ui; };

export function PreviewDialog({ onClose, tab: tab0 }: { onClose: () => void; tab?: Tab }) {
  const doc = useActiveDoc();
  const user = useStore(s => s.socialFormats);
  const [tab, setTab] = useState<Tab>(tab0 ?? 'profile');
  const [ui, setUi] = useState(true);
  if (!doc) return null;
  const so = useSocial(doc);
  const plan = so.plans.find(p => p.id === so.activePlan) ?? null;
  const feed = applyPlan(feedItems(doc.state.artboards, user), plan);
  const highlights = listSeries(doc.state.artboards).filter(s => s.ref.kind === 'highlights').flatMap(s => s.slides);
  const vertical = doc.state.artboards.filter(a => a.social?.preset && isVertical(doc, a, user) && a.social.series?.kind !== 'highlights');
  const stories = vertical.filter(a => /story/.test(a.social!.preset));
  const reels = vertical.filter(a => !/story/.test(a.social!.preset));
  const name = so.profile.username || doc.name.toLowerCase().replace(/\s+/g, '_');

  return (
    <Modal title="Vista previa local" icon={<Smartphone size={16} />} onClose={onClose} width={860} height="90vh"
      footer={<><span className="tiny muted">Simulación en este equipo: no se conecta con ninguna red social ni publica nada.</span><div className="spacer" /><button className="btn" onClick={onClose}>Cerrar</button></>}>
      <div className="row" style={{ gap: 10 }}>
        <Seg value={tab} onChange={setTab} options={[{ value: 'profile', label: 'Perfil' }, { value: 'post', label: 'Publicación' }, { value: 'story', label: 'Historia' }, { value: 'reel', label: 'Reel' }, { value: 'planner', label: 'Planificador' }]} />
        <div className="spacer" />
        {(tab === 'story' || tab === 'reel') && <Check checked={ui} onChange={setUi} label="Mostrar interfaz" />}
      </div>
      {tab === 'profile' && <ProfileView doc={doc} feed={feed} highlights={highlights} name={name} />}
      {tab === 'post' && <PostView doc={doc} feed={feed} name={name} />}
      {tab === 'story' && <VerticalView doc={doc} list={stories.length ? stories : vertical} name={name} ui={ui} kind="story" />}
      {tab === 'reel' && <VerticalView doc={doc} list={reels.length ? reels : vertical} name={name} ui={ui} kind="reel" />}
      {tab === 'planner' && <Planner doc={doc} feed={feed} plan={plan} />}
    </Modal>
  );
}

function ProfileView({ doc, feed, highlights, name }: { doc: Doc; feed: Artboard[]; highlights: Artboard[]; name: string }) {
  const so = useSocial(doc);
  const setProfile = (k: keyof DocSocial['profile']) => (v: string) => updateDocSocial(s => ({ ...s, profile: { ...s.profile, [k]: v } }));
  return (
    <div className="sim-split">
      <div className="sim-phone">
        <div className="sim-profile-head">
          <Avatar doc={doc} size={72} />
          <div className="col" style={{ gap: 2 }}>
            <b className="small">{name}</b>
            <span className="tiny">{feed.length} publicaciones</span>
          </div>
        </div>
        {(so.profile.displayName || so.profile.bio) && (
          <div className="sim-bio">
            {so.profile.displayName && <b className="tiny">{so.profile.displayName}</b>}
            {so.profile.bio && <div className="tiny" style={{ whiteSpace: 'pre-wrap' }}>{so.profile.bio}</div>}
          </div>
        )}
        {highlights.length > 0 && (
          <div className="sim-highlights">
            {highlights.map(a => (
              <div key={a.id} className="sim-hl">
                <div className="sim-hl-ring"><Cover doc={doc} ab={a} max={240} round /></div>
                <span className="tiny">{a.social?.label || a.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className="sim-grid">
          {feed.map(a => (
            <div key={a.id} className="sim-cell">
              <Cover doc={doc} ab={a} max={300} />
              {a.social?.series && <span className="sim-badge"><LayersIcon size={12} /></span>}
              {/reel|video|shorts/.test(a.social?.preset ?? '') && !a.social?.series && <span className="sim-badge"><Clapperboard size={12} /></span>}
            </div>
          ))}
          {!feed.length && <div className="tiny muted" style={{ gridColumn: '1 / -1', padding: 16 }}>Aún no hay publicaciones, carruseles ni portadas de Reel en el documento.</div>}
        </div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <div className="section-title">Datos de la vista previa</div>
        <div className="tiny muted">Solo para ver cómo queda: se guardan en el proyecto (.kova) y no se envían a ninguna parte.</div>
        <div className="row"><span className="label">Usuario</span><CommitInput value={so.profile.username} onCommit={setProfile('username')} placeholder={name} /></div>
        <div className="row"><span className="label">Nombre</span><CommitInput value={so.profile.displayName} onCommit={setProfile('displayName')} /></div>
        <span className="label">Biografía</span>
        <BioField value={so.profile.bio} onCommit={setProfile('bio')} />
        <div className="tiny muted">La foto de perfil es la mesa con formato «Imagen de perfil»; las destacadas, la serie de portadas de destacadas. La cuadrícula usa el orden del plan activo del planificador.</div>
      </div>
    </div>
  );
}

function BioField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <textarea className="input" rows={4} maxLength={300} value={v} onChange={e => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} style={{ resize: 'vertical' }} />;
}

function PostView({ doc, feed, name }: { doc: Doc; feed: Artboard[]; name: string }) {
  const [i, setI] = useState(0);
  const a = feed[Math.min(i, feed.length - 1)];
  if (!a) return <div className="tiny muted">No hay publicaciones ni carruseles en el documento.</div>;
  const slides = slidesOf(doc, a);
  // Instagram muestra entre 1,91:1 y 3:4: lo que se salga se recorta en el feed
  const r = Math.max(3 / 4, Math.min(1.91, a.w / a.h));
  return (
    <div className="sim-split">
      <div className="sim-phone">
        <div className="sim-post-head"><Avatar doc={doc} size={30} /><b className="tiny">{name}</b></div>
        <Swipe key={a.id} doc={doc} slides={slides} aspect={`${r}`} />
        <div className="sim-actions"><Glyph icon={Heart} /><Glyph icon={MessageCircle} /><Glyph icon={Send} /><span className="grow" /><Glyph icon={Bookmark} /></div>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <div className="section-title">Publicación</div>
        <div className="row"><button className="btn sm" disabled={i <= 0} onClick={() => setI(i - 1)}><ChevronLeft size={12} />Anterior</button><span className="tiny grow" style={{ textAlign: 'center' }}>{Math.min(i, feed.length - 1) + 1} de {feed.length}</span><button className="btn sm" disabled={i >= feed.length - 1} onClick={() => setI(i + 1)}>Siguiente<ChevronRight size={12} /></button></div>
        <div className="tiny muted">{slides.length > 1 ? `Carrusel de ${slides.length} diapositivas: desliza o usa las flechas.` : 'Publicación de una imagen.'} {Math.abs(a.w / a.h - r) > 0.01 && 'La proporción de la mesa no cabe en el feed: Instagram la recortará.'}</div>
      </div>
    </div>
  );
}

function VerticalView({ doc, list, name, ui, kind }: { doc: Doc; list: Artboard[]; name: string; ui: boolean; kind: 'story' | 'reel' }) {
  const [i, setI] = useState(0);
  const a = list[Math.min(i, list.length - 1)];
  if (!a) return <div className="tiny muted">No hay mesas verticales (historias, Reels, TikTok, Shorts) en el documento.</div>;
  return (
    <div className="sim-split">
      <div className="sim-phone tall">
        <div className="sim-vertical">
          <Cover doc={doc} ab={a} max={720} />
          {ui && kind === 'story' && <>
            <div className="sim-progress">{list.map((_, k) => <span key={k} className={k <= i ? 'on' : ''} />)}</div>
            <div className="sim-story-head"><Avatar doc={doc} size={26} /><b className="tiny">{name}</b></div>
            <div className="sim-story-foot"><span className="sim-reply">Enviar mensaje</span><Glyph icon={Heart} /><Glyph icon={Send} /></div>
          </>}
          {ui && kind === 'reel' && <>
            <div className="sim-reel-side"><Glyph icon={Heart} /><Glyph icon={MessageCircle} /><Glyph icon={Send} /></div>
            <div className="sim-reel-foot"><div className="row" style={{ gap: 6 }}><Avatar doc={doc} size={24} /><b className="tiny">{name}</b></div></div>
          </>}
          {list.length > 1 && i > 0 && <button className="sim-tap left" aria-label="Anterior" onClick={() => setI(i - 1)} />}
          {list.length > 1 && i < list.length - 1 && <button className="sim-tap right" aria-label="Siguiente" onClick={() => setI(i + 1)} />}
        </div>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <div className="section-title">{kind === 'story' ? 'Historias' : 'Reels y vídeo vertical'}</div>
        <div className="tiny">{a.name} · {a.w}×{a.h}</div>
        <div className="row"><button className="btn sm" disabled={i <= 0} onClick={() => setI(i - 1)}><ChevronLeft size={12} />Anterior</button><span className="tiny grow" style={{ textAlign: 'center' }}>{Math.min(i, list.length - 1) + 1} de {list.length}</span><button className="btn sm" disabled={i >= list.length - 1} onClick={() => setI(i + 1)}>Siguiente<ChevronRight size={12} /></button></div>
        {kind === 'reel' && (
          <>
            <div className="section-title">Así se ve en la cuadrícula (3:4)</div>
            <div className="sim-cell" style={{ width: 120 }}><Cover doc={doc} ab={a} max={300} /></div>
          </>
        )}
        <div className="tiny muted">Activa «Interfaz de la app» en el panel Redes para ver en el lienzo qué partes tapa la interfaz.</div>
      </div>
    </div>
  );
}

// ---------- planificador ----------
type RGB = { r: number; g: number; b: number };
function toLab({ r, g, b }: RGB) {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = f(r), G = f(g), B = f(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return { L: 116 * t(Y) - 16, a: 500 * (t(X) - t(Y)), b: 200 * (t(Y) - t(Z)) };
}
const dE = (p: RGB, q: RGB) => { const A = toLab(p), B = toLab(q); return Math.hypot(A.L - B.L, A.a - B.a, A.b - B.b); };

function Planner({ doc, feed, plan }: { doc: Doc; feed: Artboard[]; plan: FeedPlan | null }) {
  const so = useSocial(doc);
  const [order, setOrder] = useState(feed.map(a => a.id));
  const [drag, setDrag] = useState<number | null>(null);
  const [colors, setColors] = useState<Record<string, RGB>>({});
  useEffect(() => setOrder(feed.map(a => a.id)), [plan?.id, feed.length]);
  const byId = new Map(feed.map(a => [a.id, a]));
  const items = order.map(id => byId.get(id)).filter(Boolean) as Artboard[];
  const dirty = plan ? plan.order.join() !== order.join() : order.join() !== feed.map(a => a.id).join();

  // armonía: diferencia de color media entre vecinos de la cuadrícula (3 columnas)
  const harmony = useMemo(() => {
    const c = items.map(a => colors[a.id]);
    if (c.length < 2 || c.some(x => !x)) return null;
    const ds: number[] = [];
    c.forEach((x, i) => { if (i % 3 < 2 && c[i + 1]) ds.push(dE(x!, c[i + 1]!)); if (c[i + 3]) ds.push(dE(x!, c[i + 3]!)); });
    const avg = ds.reduce((s, v) => s + v, 0) / ds.length;
    const L = c.map(x => toLab(x!).L);
    const meanL = L.reduce((s, v) => s + v, 0) / L.length;
    const sdL = Math.sqrt(L.reduce((s, v) => s + (v - meanL) ** 2, 0) / L.length);
    return { avg, sdL, label: avg < 18 ? 'Muy coherente' : avg < 32 ? 'Coherente' : avg < 48 ? 'Variado' : 'Contrastado' };
  }, [items.map(a => a.id).join(), colors]);

  const save = (asNew: boolean) => {
    const id = asNew || !plan ? uid('plan') : plan.id;
    const name = asNew || !plan ? `Plan ${so.plans.length + 1}` : plan.name;
    updateDocSocial(s => {
      const p: FeedPlan = { id, name, order, updated: Date.now() };
      const plans = s.plans.some(x => x.id === id) ? s.plans.map(x => (x.id === id ? p : x)) : [...s.plans, p];
      return { ...s, plans, activePlan: id };
    });
    toast(asNew || !plan ? `«${name}» guardado` : 'Plan actualizado', 'ok');
  };

  return (
    <div className="sim-split">
      <div className="sim-phone">
        <div className="sim-grid">
          {items.map((a, i) => (
            <div key={a.id} className={'sim-cell draggable' + (drag !== null && drag !== i ? ' drop' : '')} draggable
              onDragStart={e => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plan', a.id); }}
              onDragEnd={() => setDrag(null)} onDragOver={e => { if (drag !== null) e.preventDefault(); }}
              onDrop={e => { e.preventDefault(); if (drag !== null && drag !== i) setOrder(o => moveItem(o, drag, i)); setDrag(null); }}
              title={`${i + 1}. ${a.name}`}>
              <Cover doc={doc} ab={a} max={300} onColor={c => setColors(m => (m[a.id] && m[a.id].r === c.r && m[a.id].g === c.g ? m : { ...m, [a.id]: c }))} />
              <span className="sim-num">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <div className="section-title">Plan del feed</div>
        <div className="tiny muted">Arrastra las publicaciones para probar el orden. La primera es la más reciente (arriba a la izquierda). Se guarda en el proyecto.</div>
        <select className="select" value={plan?.id ?? ''} onChange={e => updateDocSocial(s => ({ ...s, activePlan: e.target.value || undefined }))}>
          <option value="">Orden del documento</option>
          {so.plans.map(p => <option key={p.id} value={p.id}>{p.name} · {new Date(p.updated).toLocaleDateString()}</option>)}
        </select>
        {plan && <CommitInput value={plan.name} onCommit={v => updateDocSocial(s => ({ ...s, plans: s.plans.map(p => (p.id === plan.id ? { ...p, name: v || p.name } : p)) }))} aria-label="Nombre del plan" />}
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {plan && <button className="btn sm primary" disabled={!dirty} onClick={() => save(false)}><Save size={12} />Guardar cambios</button>}
          <button className="btn sm" onClick={() => save(true)}><Plus size={12} />Guardar como plan nuevo</button>
          {plan && <button className="btn sm ghost" onClick={() => updateDocSocial(s => ({ ...s, plans: s.plans.filter(p => p.id !== plan.id), activePlan: undefined }))}><Trash2 size={12} />Eliminar plan</button>}
          {dirty && <button className="btn sm ghost" onClick={() => setOrder((plan ? applyPlan(feed, plan) : feed).map(a => a.id))}>Descartar</button>}
        </div>
        <div className="section-title">Armonía de color</div>
        <div className="sim-palette">{items.map(a => { const c = colors[a.id]; return <span key={a.id} style={{ background: c ? `rgb(${c.r | 0},${c.g | 0},${c.b | 0})` : 'transparent' }} title={a.name} />; })}</div>
        {harmony ? (
          <div className="tiny">
            <b>{harmony.label}</b> · diferencia media entre vecinas ΔE {harmony.avg.toFixed(0)} · variación de luminosidad {harmony.sdL.toFixed(0)}
            <div className="muted">ΔE &lt; 18: paleta muy unificada; &gt; 48: cada publicación contrasta con sus vecinas (útil para patrones de tablero).</div>
          </div>
        ) : <div className="tiny muted">{items.length < 2 ? 'Hacen falta al menos dos publicaciones.' : 'Calculando…'}</div>}
      </div>
    </div>
  );
}
