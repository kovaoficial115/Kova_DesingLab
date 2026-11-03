import React from 'react';
import {
  Move, SquareDashed, CircleDashed, Lasso, Wand2, Crop, Pipette, Brush, Eraser, History, PaintBucket, Blend, Type, Shapes, Hand, ZoomIn,
  Frame, ArrowLeftRight, X, Check, Sparkles, Grid3x3, ScanLine, Shirt, Printer, Layers, Eye, SplitSquareHorizontal, Minus, Plus, Maximize,
  Square, Circle, Slash,
} from 'lucide-react';
import { useStore, set, get, activeArtboard, getView } from '../core/store';
import type { ToolId } from '../core/types';
import { setTool, cropState, applyCrop, cancelCrop } from '../tools/tools';
import { NumberField, Seg, Check as CheckBox, Select } from './components/controls';
import { commands, displayKeys, runCommand, openDialog } from './commands';
import { closeDoc, zoomTo, fitToScreen } from '../core/actions';
import { fromPx } from '../core/util';
import { discardAutosave } from '../io/fileOps';

const toolList: (ToolId | '-')[] = ['move', 'artboard', '-', 'marquee', 'ellipseMarquee', 'lasso', 'wand', '-', 'crop', 'eyedropper', '-', 'brush', 'eraser', 'restore', 'fill', 'gradient', '-', 'text', 'shape', '-', 'hand', 'zoom'];
const toolIcons: Record<ToolId, any> = {
  move: Move, marquee: SquareDashed, ellipseMarquee: CircleDashed, lasso: Lasso, wand: Wand2, crop: Crop, eyedropper: Pipette,
  brush: Brush, eraser: Eraser, restore: History, fill: PaintBucket, gradient: Blend, text: Type, shape: Shapes, hand: Hand, zoom: ZoomIn, artboard: Frame,
};
const toolCmd: Record<ToolId, string> = {
  move: 'tool.move', marquee: 'tool.marquee', ellipseMarquee: 'tool.ellipse', lasso: 'tool.lasso', wand: 'tool.wand', crop: 'tool.crop', eyedropper: 'tool.eyedropper',
  brush: 'tool.brush', eraser: 'tool.eraser', restore: 'tool.restore', fill: 'tool.fill', gradient: 'tool.gradient', text: 'tool.text', shape: 'tool.shape', hand: 'tool.hand', zoom: 'tool.zoom', artboard: 'tool.artboard',
};
export const toolLabel = (t: ToolId) => commands[toolCmd[t]].label;

export function ToolRail() {
  const tool = useStore(s => s.tool);
  const fg = useStore(s => s.fg), bg = useStore(s => s.bg);
  return (
    <div className="toolrail">
      {toolList.map((t, i) => {
        if (t === '-') return <div key={i} className="grp-sep" />;
        const Ic = toolIcons[t];
        const c = commands[toolCmd[t]];
        return (
          <button key={t} className={'tool' + (tool === t ? ' active' : '')} title={`${c.label} (${displayKeys(c.keys)})`} onClick={() => setTool(t)}>
            <Ic size={17} strokeWidth={1.8} />
          </button>
        );
      })}
      <div className="swatch-pair">
        <label className="sw fg" style={{ background: fg }} title="Color frontal">
          <input type="color" value={fg} onChange={e => set({ fg: e.target.value })} style={{ opacity: 0, width: 1, height: 1 }} />
        </label>
        <label className="sw bg" style={{ background: bg }} title="Color de fondo">
          <input type="color" value={bg} onChange={e => set({ bg: e.target.value })} style={{ opacity: 0, width: 1, height: 1 }} />
        </label>
      </div>
      <button className="icon-btn sm" title="Intercambiar (X)" onClick={() => runCommand('color.swap')}><ArrowLeftRight size={12} /></button>
    </div>
  );
}

function OptNum(p: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string; digits?: number; step?: number }) {
  return <div className="opt">{p.label}<NumberField value={p.value} onChange={p.onChange} min={p.min} max={p.max} suffix={p.suffix} digits={p.digits ?? 0} step={p.step} label="↔" /></div>;
}

export function OptionsBar() {
  const tool = useStore(s => s.tool);
  const o = useStore(s => s.opts);
  useStore(s => s.renderTick);
  const setO = (p: Partial<typeof o>) => set(s => ({ opts: { ...s.opts, ...p } }));
  const Ic = toolIcons[tool];
  const selModes = (
    <Seg value={o.selMode} onChange={v => setO({ selMode: v })} options={[
      { value: 'new', label: 'Nueva', title: 'Nueva selección' }, { value: 'add', label: '+', title: 'Añadir (Mayús)' },
      { value: 'subtract', label: '−', title: 'Restar (Alt)' }, { value: 'intersect', label: '∩', title: 'Intersecar (Mayús+Alt)' },
    ]} />
  );
  let content: React.ReactNode = null;
  if (tool === 'move') content = <>
    <CheckBox checked={o.autoSelect} onChange={v => setO({ autoSelect: v })} label="Selección automática" />
    <CheckBox checked={o.showTransform} onChange={v => setO({ showTransform: v })} label="Controles de transformación" />
    <div className="vsep" />
    <span className="muted small">Alinear</span>
    {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map(k => (
      <button key={k} className="icon-btn sm" title={`Alinear ${k}`} onClick={() => import('../core/actions').then(m => m.alignLayers(k, 'artboard'))}>
        <AlignIcon kind={k} />
      </button>
    ))}
    <div className="vsep" />
    <span className="muted small">Mayús: proporción libre · Alt: desde el centro / duplicar</span>
  </>;
  if (tool === 'marquee' || tool === 'ellipseMarquee' || tool === 'lasso') content = <>{selModes}<OptNum label="Calar" value={o.feather} onChange={v => setO({ feather: v })} min={0} max={250} suffix="px" /></>;
  if (tool === 'wand') content = <>{selModes}
    <OptNum label="Tolerancia" value={o.wandTolerance} onChange={v => setO({ wandTolerance: v })} min={0} max={255} />
    <CheckBox checked={o.wandContiguous} onChange={v => setO({ wandContiguous: v })} label="Contiguo" />
    <CheckBox checked={o.wandSampleAll} onChange={v => setO({ wandSampleAll: v })} label="Muestrear todas las capas" />
    <OptNum label="Calar" value={o.feather} onChange={v => setO({ feather: v })} min={0} max={250} suffix="px" />
  </>;
  if (tool === 'brush' || tool === 'eraser' || tool === 'restore') content = <>
    <OptNum label="Tamaño" value={o.brushSize} onChange={v => setO({ brushSize: v })} min={1} max={3000} suffix="px" />
    <OptNum label="Dureza" value={Math.round(o.brushHardness * 100)} onChange={v => setO({ brushHardness: v / 100 })} min={0} max={100} suffix="%" />
    <OptNum label="Opacidad" value={Math.round(o.brushOpacity * 100)} onChange={v => setO({ brushOpacity: v / 100 })} min={1} max={100} suffix="%" />
    <OptNum label="Flujo" value={Math.round(o.brushFlow * 100)} onChange={v => setO({ brushFlow: v / 100 })} min={1} max={100} suffix="%" />
    <div className="vsep" />
    <span className="muted small">Pintar en</span>
    <Seg value={o.brushTarget} onChange={v => setO({ brushTarget: v })} options={[{ value: 'pixels', label: 'Píxeles' }, { value: 'mask', label: 'Máscara' }]} />
    {tool === 'restore' && <span className="muted small">Recupera los píxeles originales de la capa</span>}
  </>;
  if (tool === 'fill') content = <>
    <OptNum label="Tolerancia" value={o.fillTolerance} onChange={v => setO({ fillTolerance: v })} min={0} max={255} />
    <CheckBox checked={o.fillContiguous} onChange={v => setO({ fillContiguous: v })} label="Contiguo" />
  </>;
  if (tool === 'gradient') content = <>
    <Seg value={o.gradientType} onChange={v => setO({ gradientType: v })} options={[{ value: 'linear', label: 'Lineal' }, { value: 'radial', label: 'Radial' }]} />
    <CheckBox checked={o.gradientToTransparent} onChange={v => setO({ gradientToTransparent: v })} label="Frontal → transparente" />
  </>;
  if (tool === 'text') content = <>
    <Select value={o.fontFamily} onChange={v => setO({ fontFamily: v })} width={170} options={FONTS.map(f => ({ value: f, label: f.split(',')[0] }))} />
    <OptNum label="Tamaño" value={o.fontSize} onChange={v => setO({ fontSize: v })} min={4} max={3000} suffix="px" />
    <Select value={String(o.fontWeight) as any} onChange={v => setO({ fontWeight: +v })} width={110} options={[300, 400, 500, 600, 700, 800, 900].map(w => ({ value: String(w), label: `Peso ${w}` }))} />
    <span className="muted small">Clic para crear · doble clic con Mover para editar</span>
  </>;
  if (tool === 'shape') content = <>
    <Seg value={o.shapeType} onChange={v => setO({ shapeType: v })} options={[{ value: 'rect', label: <Square size={12} /> }, { value: 'ellipse', label: <Circle size={12} /> }, { value: 'line', label: <Slash size={12} /> }]} />
    <CheckBox checked={o.shapeFill} onChange={v => setO({ shapeFill: v })} label="Relleno (frontal)" />
    <CheckBox checked={o.shapeStroke} onChange={v => setO({ shapeStroke: v })} label="Trazo (fondo)" />
    <OptNum label="Grosor" value={o.shapeStrokeWidth} onChange={v => setO({ shapeStrokeWidth: v })} min={1} max={500} suffix="px" />
    <OptNum label="Radio" value={o.shapeRadius} onChange={v => setO({ shapeRadius: v })} min={0} max={2000} suffix="px" />
  </>;
  if (tool === 'crop') content = <>
    <span className="muted small">Arrastra sobre la mesa para definir el recorte</span>
    {cropState.rect && <>
      <button className="btn sm primary" onClick={applyCrop}><Check size={12} /> Aplicar (Enter)</button>
      <button className="btn sm" onClick={cancelCrop}><X size={12} /> Cancelar</button>
    </>}
    <button className="btn sm" onClick={() => runCommand('image.trim')}>Recortar al contenido</button>
  </>;
  if (tool === 'eyedropper') content = <span className="muted small">Clic: color frontal · Alt+clic: color de fondo</span>;
  if (tool === 'hand') content = <span className="muted small">Arrastra para desplazar · Espacio en cualquier herramienta</span>;
  if (tool === 'zoom') content = <>
    <span className="muted small">Clic: acercar · Alt+clic: alejar</span>
    <button className="btn sm" onClick={() => fitToScreen()}>Ajustar a pantalla</button>
    <button className="btn sm" onClick={() => zoomTo(1)}>100 %</button>
    <button className="btn sm" onClick={() => runCommand('view.print')}>Tamaño de impresión</button>
  </>;
  if (tool === 'artboard') content = <>
    <span className="muted small">Arrastra en vacío para crear · arrastra una mesa para moverla (con su contenido) · esquina para redimensionar</span>
    <button className="btn sm" onClick={() => import('../core/actions').then(m => m.addArtboard())}>+ Nueva mesa</button>
  </>;
  return (
    <div className="optionsbar">
      <div className="tool-name"><Ic size={15} />{toolLabel(tool)}</div>
      <div className="vsep" />
      {content}
    </div>
  );
}

function AlignIcon({ kind }: { kind: string }) {
  const r = (x: number, y: number, w: number, h: number) => <rect x={x} y={y} width={w} height={h} rx="1" fill="currentColor" />;
  const l = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.4" />;
  const m: Record<string, React.ReactNode> = {
    left: <>{l(2, 1, 2, 15)}{r(4, 3, 9, 3)}{r(4, 9, 6, 3)}</>,
    hcenter: <>{l(8, 1, 8, 15)}{r(3, 3, 10, 3)}{r(5, 9, 6, 3)}</>,
    right: <>{l(14, 1, 14, 15)}{r(3, 3, 9, 3)}{r(6, 9, 6, 3)}</>,
    top: <>{l(1, 2, 15, 2)}{r(3, 4, 3, 9)}{r(9, 4, 3, 6)}</>,
    vcenter: <>{l(1, 8, 15, 8)}{r(3, 3, 3, 10)}{r(9, 5, 3, 6)}</>,
    bottom: <>{l(1, 14, 15, 14)}{r(3, 3, 3, 9)}{r(9, 6, 3, 6)}</>,
  };
  return <svg width="14" height="14" viewBox="0 0 16 16">{m[kind]}</svg>;
}
export { AlignIcon };

export const FONTS = [
  'Inter, sans-serif', 'Arial, sans-serif', 'Helvetica, sans-serif', 'Impact, sans-serif', 'Georgia, serif', 'Times New Roman, serif',
  'Courier New, monospace', 'Verdana, sans-serif', 'Trebuchet MS, sans-serif', 'Arial Black, sans-serif', 'Futura, sans-serif',
  'Gill Sans, sans-serif', 'Didot, serif', 'Copperplate, serif', 'Brush Script MT, cursive', 'Marker Felt, fantasy', 'JetBrains Mono, monospace',
];

export function DocTabs() {
  const docs = useStore(s => s.docs);
  const active = useStore(s => s.activeDocId);
  return (
    <div className="tabs">
      {docs.map(d => (
        <div key={d.id} className={'tab' + (d.id === active ? ' active' : '')} onClick={() => set({ activeDocId: d.id })}>
          {d.dirty && <span className="dot" title="Cambios sin guardar" />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
          <span className="tiny muted">{d.colorMode}</span>
          <span className="x" onClick={e => {
            e.stopPropagation();
            if (d.dirty && !confirm(`"${d.name}" tiene cambios sin guardar. ¿Cerrar de todos modos?`)) return;
            discardAutosave(d.id);
            closeDoc(d.id);
          }}><X size={12} /></span>
        </div>
      ))}
      <button className="icon-btn sm" style={{ marginBottom: 3 }} title="Nuevo documento" onClick={() => openDialog('new')}><Plus size={13} /></button>
    </div>
  );
}

export function QuickBar() {
  const hasLayer = useStore(s => { const d = s.docs.find(x => x.id === s.activeDocId); return !!d?.state.selectedLayerIds.length; });
  return (
    <div className="quickbar" onPointerDown={e => e.stopPropagation()}>
      <button className="btn sm" disabled={!hasLayer} onClick={() => runCommand('sel.subject')} title="Selecciona el sujeto principal con IA"><Sparkles size={13} /><span className="qb-label">Seleccionar sujeto</span></button>
      <button className="btn sm" disabled={!hasLayer} onClick={() => runCommand('dtf.bg')} title="Eliminar fondo"><Eraser size={13} /><span className="qb-label">Eliminar fondo</span></button>
      <button className="btn sm" disabled={!hasLayer} onClick={() => runCommand('dtf.halftone')} title="Semitonos"><Grid3x3 size={13} /><span className="qb-label">Semitonos</span></button>
      <button className="btn sm" disabled={!hasLayer} onClick={() => runCommand('dtf.vectorize')} title="Vectorizar"><ScanLine size={13} /><span className="qb-label">Vectorizar</span></button>
      <div className="vsep" />
      <button className="btn sm" onClick={() => runCommand('dtf.mockup')} title="Mockup"><Shirt size={13} /><span className="qb-label">Mockup</span></button>
      <button className="btn sm" onClick={() => runCommand('dtf.gang')} title="Hoja DTF"><Layers size={13} /><span className="qb-label">Hoja DTF</span></button>
      <button className="btn sm" onClick={() => runCommand('dtf.preflight')} title="Preparar"><Printer size={13} /><span className="qb-label">Preparar</span></button>
    </div>
  );
}

export function ZoomHud() {
  const view = useStore(s => (s.activeDocId ? s.views[s.activeDocId] : null));
  const compare = useStore(s => s.compare);
  const proof = useStore(s => s.proof);
  return (
    <div className="zoom-hud" onPointerDown={e => e.stopPropagation()}>
      <button className={'icon-btn sm' + (proof ? ' active' : '')} title="Prueba de color CMYK (Ctrl/⌘+Y)" onClick={() => runCommand('view.proof')}><Eye size={13} /></button>
      <button className={'icon-btn sm' + (compare ? ' active' : '')} title="Comparar antes/después (\\)" onClick={() => runCommand('view.compare')}><SplitSquareHorizontal size={13} /></button>
      <div className="vsep" />
      <button className="icon-btn sm" onClick={() => runCommand('view.zoomOut')}><Minus size={13} /></button>
      <span className="mono small" style={{ minWidth: 46, textAlign: 'center', cursor: 'pointer' }} onClick={() => zoomTo(1)} title="100 %">{Math.round((view?.zoom ?? 1) * 100)}%</span>
      <button className="icon-btn sm" onClick={() => runCommand('view.zoomIn')}><Plus size={13} /></button>
      <button className="icon-btn sm" title="Ajustar (Ctrl/⌘+0)" onClick={() => fitToScreen()}><Maximize size={13} /></button>
    </div>
  );
}

export function StatusBar() {
  const doc = useStore(s => s.docs.find(d => d.id === s.activeDocId));
  const cursor = useStore(s => s.cursor);
  const unit = useStore(s => s.unit);
  const view = useStore(s => (s.activeDocId ? s.views[s.activeDocId] : null));
  if (!doc) return <div className="statusbar">Kova_DesignLab · listo</div>;
  const ab = doc.state.artboards.find(a => a.id === doc.state.activeArtboardId) ?? doc.state.artboards[0];
  const f = (px: number) => fromPx(px, unit, ab.dpi).toFixed(unit === 'px' ? 0 : 2);
  const units: ('px' | 'cm' | 'mm' | 'in')[] = ['px', 'cm', 'mm', 'in'];
  return (
    <div className="statusbar">
      <span><b>{ab.name}</b> {f(ab.w)}×{f(ab.h)} {unit}</span>
      <span>{ab.w}×{ab.h} px</span>
      <span><b>{ab.dpi}</b> ppp</span>
      <span>{doc.colorMode}{get().proof ? ' · prueba' : ''}</span>
      {cursor && <span>X {f(cursor.x - ab.x)} · Y {f(cursor.y - ab.y)}</span>}
      <span>{doc.state.layers.length} capas</span>
      {doc.state.selection && <span>Sel. {f(doc.state.selection.canvas.width)}×{f(doc.state.selection.canvas.height)}</span>}
      <div className="grow" />
      <span>Unidades</span>
      <div className="seg">
        {units.map(u => <button key={u} className={u === unit ? 'on' : ''} onClick={() => set({ unit: u })}>{u}</button>)}
      </div>
      <span>{Math.round((view?.zoom ?? 1) * 100)}%</span>
    </div>
  );
}
void getView; void activeArtboard;
