import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { useStore, useActiveDoc } from '../../core/store';
import { Modal, Seg } from '../../ui/components/controls';
import { renderArtboard } from '../../core/render';
import { allFormats, PLATFORMS, safeRect, type SocialFormat } from '../presets';
import { ADAPT_MODES, type AdaptMode } from '../adapt';
import * as S from '../actions';

function Preview({ f, mode }: { f: SocialFormat; mode: AdaptMode }) {
  const doc = useActiveDoc();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!doc) return;
    const src = doc.state.artboards.find(a => a.id === doc.state.activeArtboardId);
    if (!src) return;
    let on = true;
    const { state, ab } = S.previewAdapt(doc.state, src, f, mode);
    const scale = Math.min(1, 220 / Math.max(f.w, f.h));
    renderArtboard(state, ab, scale).then(c => {
      const el = ref.current;
      if (!on || !el) return;
      el.width = c.width; el.height = c.height;
      const g = el.getContext('2d')!;
      g.drawImage(c, 0, 0);
      // zona segura, solo en la vista previa
      if (f.safe) {
        const r = safeRect(f, c.width, c.height);
        g.setLineDash([4, 3]); g.strokeStyle = 'rgba(255,196,0,.9)';
        g.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      }
    });
    return () => { on = false; };
  }, [doc?.state, f, mode]);
  return (
    <div className="col" style={{ gap: 3, alignItems: 'center' }}>
      <canvas ref={ref} className="social-thumb" style={{ maxWidth: 160, maxHeight: 200, aspectRatio: `${f.w} / ${f.h}` }} />
      <span className="tiny muted">{f.name} · {f.w}×{f.h}</span>
    </div>
  );
}

export function AdaptDialog({ onClose }: { onClose: () => void }) {
  const doc = useActiveDoc();
  const user = useStore(s => s.socialFormats);
  const formats = useMemo(() => allFormats(user), [user]);
  const src = doc?.state.artboards.find(a => a.id === doc.state.activeArtboardId);
  const cur = S.formatOf(src);
  const [mode, setMode] = useState<AdaptMode>('reflow');
  const [picked, setPicked] = useState<string[]>(() => ['ig-story', 'ig-post-square', 'yt-thumb'].filter(id => id !== cur?.id));
  if (!doc || !src) return null;
  const targets = picked.map(id => formats.find(f => f.id === id)).filter(Boolean) as SocialFormat[];
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  return (
    <Modal title={`Adaptar «${src.name}» a otros formatos`} icon={<Shuffle size={16} />} onClose={onClose} width={760} height="86vh"
      footer={<>
        <span className="tiny muted">Se crean {targets.length} mesa(s) nuevas con copias de las capas; el original no cambia.</span>
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!targets.length} onClick={() => { S.adaptToFormats(src.id, targets, mode); onClose(); }}>Crear {targets.length || ''}</button>
      </>}>
      <Seg value={mode} onChange={setMode} full options={ADAPT_MODES.map(m => ({ value: m.id, label: m.name, title: m.hint }))} />
      <div className="tiny muted">{ADAPT_MODES.find(m => m.id === mode)?.hint} Los fondos (capas que cubren la mesa) se amplían para no dejar huecos; nada se deforma.</div>
      <div className="adapt-grid">
        {PLATFORMS.map(p => {
          const list = formats.filter(f => f.platform === p.id && f.id !== cur?.id);
          if (!list.length) return null;
          return (
            <div key={p.id} className="col" style={{ gap: 2 }}>
              <b className="tiny">{p.name}</b>
              {list.map(f => (
                <label key={f.id} className="row tiny" style={{ gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.includes(f.id)} onChange={() => toggle(f.id)} />
                  <span className="grow">{f.name}</span><span className="muted mono">{f.w}×{f.h}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      {targets.length > 0 && <div className="section-title">Vista previa</div>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        {targets.slice(0, 6).map(f => <Preview key={f.id} f={f} mode={mode} />)}
      </div>
      {targets.length > 6 && <div className="tiny muted">Y {targets.length - 6} formato(s) más.</div>}
    </Modal>
  );
}
