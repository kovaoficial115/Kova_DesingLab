// Selector de mesas de trabajo o capas de los documentos abiertos, con miniaturas,
// para elegir qué diseño se envía a otro módulo (mockup, hoja de impresión…).

import React, { useEffect, useRef, useState } from 'react';
import { X, EyeOff, Folder } from 'lucide-react';
import { useStore, withBusy, toast } from '../../core/store';
import { renderArtboard, renderLayerAlone } from '../../core/render';
import { layerBounds, trimCanvas, uid } from '../../core/util';
import { childrenOf } from '../../core/doc';
import { sourceFromArtboard, type DesignSource } from '../../io/sources';
import { Select } from './controls';
import type { Doc, DocState, Layer } from '../../core/types';

const THUMB = 44;

function AsyncThumb({ render, deps }: { render: (scale: (w: number, h: number) => number) => Promise<HTMLCanvasElement | null>; deps: unknown[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const S = THUMB * 2;
    render((w, h) => Math.min(1, S / Math.max(w, h, 1))).then(src => {
      const c = ref.current;
      if (!alive || !c) return;
      c.width = S; c.height = S;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, S, S);
      if (!src) return;
      const k = Math.min(S / src.width, S / src.height);
      g.drawImage(src, (S - src.width * k) / 2, (S - src.height * k) / 2, src.width * k, src.height * k);
    });
    return () => { alive = false; };
  }, deps);
  return <canvas ref={ref} className="checker-dark" style={{ width: THUMB, height: THUMB, borderRadius: 6, flexShrink: 0 }} />;
}

/** Estado con la capa y sus grupos padre visibles, para poder renderizar capas ocultas. */
function revealLayer(s: DocState, l: Layer): DocState {
  const ids = new Set<string>([l.id]);
  for (let p = l.parentId; p; p = s.layers.find(x => x.id === p)?.parentId ?? null) ids.add(p);
  return { ...s, layers: s.layers.map(x => (ids.has(x.id) ? { ...x, visible: true } : x)) };
}

/** Resolución de una capa: la de la mesa que contiene su centro (o la mesa activa). */
function layerDpi(s: DocState, l: Layer) {
  const b = layerBounds(l), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const ab = s.artboards.find(a => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h)
    ?? s.artboards.find(a => a.id === s.activeArtboardId) ?? s.artboards[0];
  return ab?.dpi ?? 300;
}

export async function sourceFromLayer(s: DocState, l: Layer): Promise<DesignSource | null> {
  const { canvas } = await renderLayerAlone(revealLayer(s, l), l, 1);
  const t = trimCanvas(canvas);
  return t ? { id: uid('src'), name: l.name, canvas: t.canvas, dpi: layerDpi(s, l) } : null;
}

const cm = (px: number, dpi: number) => ((px / dpi) * 2.54).toFixed(1);

/** Capas en orden visual (la de arriba primero) con su profundidad en el árbol. */
function layerTree(layers: Layer[]) {
  const out: { l: Layer; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    const kids = childrenOf(layers, parent);
    for (let i = kids.length - 1; i >= 0; i--) {
      out.push({ l: kids[i], depth });
      if (kids[i].kind === 'group') walk(kids[i].id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function SourcePicker({ mode, onPick, onClose }: { mode: 'artboard' | 'layer'; onPick: (s: DesignSource) => void; onClose: () => void }) {
  const docs = useStore(s => s.docs);
  const activeDocId = useStore(s => s.activeDocId);
  const [docId, setDocId] = useState(activeDocId ?? docs[0]?.id ?? '');
  const doc: Doc | undefined = docs.find(d => d.id === docId) ?? docs[0];

  const pick = (label: string, make: () => Promise<DesignSource | null>) => withBusy(`Preparando ${label}…`, async () => {
    const s = await make();
    if (!s) return toast(`«${label}» está vacío`, 'warn');
    onPick(s);
  });

  const row = (key: string, thumb: React.ReactNode, title: React.ReactNode, sub: string, onClick: () => void, depth = 0) => (
    <button key={key} className="picker-row" style={{ paddingLeft: 6 + depth * 14 }} onClick={onClick}>
      {thumb}
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="small" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        <span className="tiny muted">{sub}</span>
      </span>
    </button>
  );

  return (
    <div className="picker">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small" style={{ fontWeight: 600 }}>{mode === 'artboard' ? 'Elige una mesa de trabajo' : 'Elige una capa'}</span>
        <button className="icon-btn sm" title="Cerrar" onClick={onClose}><X size={13} /></button>
      </div>
      {docs.length > 1 && <Select value={doc?.id ?? ''} onChange={setDocId} options={docs.map(d => ({ value: d.id, label: d.name }))} />}
      <div className="col" style={{ gap: 2, maxHeight: 280, overflowY: 'auto' }}>
        {!doc && <span className="tiny muted">No hay documentos abiertos.</span>}
        {doc && mode === 'artboard' && doc.state.artboards.map(ab =>
          row(ab.id,
            <AsyncThumb deps={[doc.state.layers, ab]} render={k => renderArtboard(doc.state, ab, k(ab.w, ab.h))} />,
            ab.name,
            `${cm(ab.w, ab.dpi)} × ${cm(ab.h, ab.dpi)} cm · ${ab.dpi} ppp`,
            () => pick(ab.name, () => sourceFromArtboard(doc.state, ab, ab.name))))}
        {doc && mode === 'layer' && (doc.state.layers.length ? layerTree(doc.state.layers).map(({ l, depth }) => {
          const b = layerBounds(l), dpi = layerDpi(doc.state, l);
          return row(l.id,
            <AsyncThumb deps={[doc.state.layers, l]} render={async k => (await renderLayerAlone(revealLayer(doc.state, l), l, k(b.w, b.h))).canvas} />,
            <>{l.kind === 'group' && <Folder size={11} />}{l.name}{!l.visible && <EyeOff size={11} className="muted" />}</>,
            `${cm(b.w, dpi)} × ${cm(b.h, dpi)} cm`,
            () => pick(l.name, () => sourceFromLayer(doc.state, l)), depth);
        }) : <span className="tiny muted">Este documento no tiene capas.</span>)}
      </div>
    </div>
  );
}
