import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Home, Download, Undo2, Redo2 } from 'lucide-react';
import { commands, displayKeys, runCommand } from './commands';
import { useStore, set } from '../core/store';
import type { PanelId } from '../core/store';

type Item = string | '-' | { head: string } | { label: string; sub: Item[] } | { label: string; run: () => void; checked?: () => boolean };

const panelNames: Record<PanelId, string> = { color: 'Color', properties: 'Propiedades', adjustments: 'Ajustes', layers: 'Capas', history: 'Historial', artboards: 'Mesas de trabajo', channels: 'Canales y color' };

function panelToggle(id: PanelId): Item {
  return {
    label: panelNames[id],
    run: () => set(s => ({ panels: s.panels.map(p => (p.id === id ? { ...p, visible: !p.visible, collapsed: false } : p)) })),
    checked: () => !!useStore.getState().panels.find(p => p.id === id)?.visible,
  };
}

const menus: { label: string; items: Item[] }[] = [
  { label: 'Archivo', items: ['file.home', '-', 'file.new', 'file.open', 'file.place', '-', 'file.save', 'file.saveAs', 'file.saveLib', 'file.duplicate', '-', 'file.export', 'file.exportPng', '-', 'file.close'] },
  {
    label: 'Edición', items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.copyMerged', 'edit.paste', '-', 'edit.fill', 'edit.fillBg', 'edit.delete', '-',
      'edit.transform', { label: 'Transformar', sub: ['edit.flipH', 'edit.flipV', '-', 'edit.rot90', 'edit.rot-90', 'edit.rot180'] }, '-', 'edit.color', 'edit.shortcuts'],
  },
  {
    label: 'Imagen', items: [
      { label: 'Modo', sub: ['image.modeRGB', 'image.modeCMYK'] },
      { label: 'Ajustes', sub: ['image.adj.brightnessContrast', 'image.adj.levels', 'image.adj.curves', 'image.adj.exposure', '-', 'image.adj.vibrance', 'image.adj.hueSaturation', 'image.adj.blackWhite', '-', 'image.adj.invert', 'image.adj.threshold', 'image.adj.posterize'] },
      'image.applyAdj', '-', 'image.size', 'image.canvas', 'image.trim', '-',
      { label: 'Rotación de mesa', sub: ['image.rot90', 'image.rot-90', 'image.rot180'] },
    ],
  },
  {
    label: 'Capa', items: ['layer.new', 'layer.duplicate', 'layer.viaCut', 'layer.delete', '-', 'layer.group', 'layer.ungroup', '-',
      { label: 'Máscara de capa', sub: ['layer.mask', 'layer.maskHide', 'layer.maskApply', 'layer.maskDelete'] }, 'layer.clip', '-',
      { label: 'Organizar', sub: ['layer.top', 'layer.up', 'layer.down', 'layer.bottom'] }, '-',
      'layer.rasterize', 'layer.resample', 'layer.outline', '-', 'layer.mergeDown', 'layer.flatten'],
  },
  { label: 'Selección', items: ['sel.all', 'sel.none', 'sel.invert', '-', 'sel.layer', 'sel.colorRange', 'sel.subject', '-', { label: 'Modificar', sub: ['sel.feather', 'sel.expand', 'sel.contract', 'sel.smooth'] }] },
  { label: 'Filtro', items: [{ head: 'Filtros no destructivos' }, 'filter.blur', 'filter.sharpen', 'filter.denoise'] },
  {
    label: 'DTF', items: [{ head: 'Producción' }, 'dtf.preflight', 'dtf.gang', 'dtf.mockup', '-', { head: 'Preparación' }, 'dtf.halftone', 'dtf.bg', 'dtf.refine', 'dtf.underbase', 'dtf.vectorize', '-', { head: 'Color' }, 'dtf.separations', 'dtf.palette', 'edit.color'],
  },
  {
    label: 'Vista', items: ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.100', 'view.print', '-', 'view.proof', 'view.compare', '-',
      'view.rulers', 'view.grid', 'view.guides', 'view.snap', 'view.clearGuides', 'view.gridSettings'],
  },
  {
    label: 'Ventana', items: [panelToggle('color'), panelToggle('properties'), panelToggle('adjustments'), panelToggle('layers'), panelToggle('channels'), panelToggle('artboards'), panelToggle('history'), '-', 'view.hideUI',
      { label: 'Restablecer espacio de trabajo', run: () => { localStorage.removeItem('kova.prefs'); location.reload(); } }],
  },
  { label: 'Ayuda', items: ['edit.shortcuts', 'help.about'] },
];

function MenuList({ items, onClose, x, y }: { items: Item[]; onClose: () => void; x: number; y: number }) {
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  return (
    <div className="menu-pop" ref={ref} style={{ left: pos.x, top: pos.y }} onPointerDown={e => e.stopPropagation()}>
      {items.map((it, i) => {
        if (it === '-') return <div key={i} className="menu-sep" />;
        if (typeof it === 'object' && 'head' in it) return <div key={i} className="menu-head">{it.head}</div>;
        if (typeof it === 'object' && 'sub' in it) {
          return (
            <div key={i} className="menu-item" onPointerEnter={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSub({ i, x: r.right + 2, y: r.top - 5 }); }}>
              <span className="chk" />{it.label}<span className="sc"><ChevronRight size={12} /></span>
              {sub?.i === i && <MenuList items={it.sub} onClose={onClose} x={sub.x} y={sub.y} />}
            </div>
          );
        }
        if (typeof it === 'object' && 'run' in it) {
          return (
            <div key={i} className="menu-item" onPointerEnter={() => setSub(null)} onClick={() => { onClose(); it.run(); }}>
              <span className="chk">{it.checked?.() && <Check size={12} />}</span>{it.label}
            </div>
          );
        }
        const c = commands[it as string];
        if (!c) return null;
        const disabled = c.enabled ? !c.enabled() : false;
        return (
          <div key={i} className={'menu-item' + (disabled ? ' disabled' : '')} onPointerEnter={() => setSub(null)} onClick={() => { onClose(); runCommand(it as string); }}>
            <span className="chk">{c.checked?.() && <Check size={12} />}</span>{c.label}<span className="sc">{displayKeys(c.keys)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const doc = useStore(s => s.docs.find(d => d.id === s.activeDocId));
  useStore(s => s.renderTick); // refresca estados habilitados
  useEffect(() => {
    if (open == null) return;
    const close = () => setOpen(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const openAt = (i: number, el: HTMLElement) => { const r = el.getBoundingClientRect(); setAnchor({ x: r.left, y: r.bottom + 4 }); setOpen(i); };
  return (
    <div className="menubar">
      <div className="brand" onClick={() => set({ screen: 'home' })} title="Menú principal">
        <div className="brand-logo"><KovaMark size={14} /></div>
        <span>Kova<small>_DesignLab</small></span>
      </div>
      {menus.map((m, i) => (
        <button key={m.label} className={'menu-trigger' + (open === i ? ' open' : '')}
          onPointerDown={e => { e.stopPropagation(); open === i ? setOpen(null) : openAt(i, e.currentTarget); }}
          onPointerEnter={e => { if (open != null && open !== i) openAt(i, e.currentTarget); }}>
          {m.label}
        </button>
      ))}
      {open != null && <MenuList items={menus[open].items} onClose={() => setOpen(null)} x={anchor.x} y={anchor.y} />}
      <div className="grow" />
      {doc && <span className="small muted" style={{ marginRight: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }} title={doc.lastLabel}>{doc.lastLabel}</span>}
      <button className="icon-btn" title="Deshacer" disabled={!doc?.past.length} onClick={() => runCommand('edit.undo')}><Undo2 size={15} /></button>
      <button className="icon-btn" title="Rehacer" disabled={!doc?.future.length} onClick={() => runCommand('edit.redo')}><Redo2 size={15} /></button>
      <div className="vsep" />
      <button className="icon-btn" title="Menú principal" onClick={() => set({ screen: 'home' })}><Home size={15} /></button>
      <button className="btn primary sm" style={{ marginLeft: 6 }} disabled={!doc} onClick={() => runCommand('file.export')}><Download size={13} /> Exportar</button>
    </div>
  );
}

export function KovaMark({ size = 16, color = '#d7f25c' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32"><path d="M9 6v20M9 16l11-10M12.8 12.6L21 26" stroke={color} strokeWidth="3.4" fill="none" strokeLinecap="round" /></svg>
  );
}
