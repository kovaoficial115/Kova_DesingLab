// Registro central de comandos: lo usan los menús, los atajos de teclado y la barra rápida.

import { get, set, undo, redo, activeDoc, activeLayer, docState, toast, withBusy, selectedLayers } from '../core/store';
import * as A from '../core/actions';
import { setTool, applyCrop, cancelCrop, cropState } from '../tools/tools';
import { pickFiles, openFiles, placeFiles, saveProject, saveToBrowserLibrary } from '../io/fileOps';
import type { AdjustmentType, ToolId } from '../core/types';
import { discardAutosave } from '../io/fileOps';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export interface Command { label: string; keys?: string; run: () => any; enabled?: () => boolean; checked?: () => boolean }

const hasDoc = () => !!activeDoc();
const hasLayer = () => !!activeLayer();
const hasSel = () => !!docState()?.selection;
export const openDialog = (type: string, props?: any) => set({ dialog: { type, props } });

const adj = (t: AdjustmentType): Command => ({ label: A.adjustmentDefaults[t].label, run: () => A.addAdjustment(t), enabled: hasLayer });
const toolCmd = (t: ToolId, label: string, keys: string): Command => ({ label, keys, run: () => setTool(t), checked: () => get().tool === t });

export const commands: Record<string, Command> = {
  // Archivo
  'file.home': { label: 'Menú principal', run: () => set({ screen: 'home' }) },
  'file.new': { label: 'Nuevo…', keys: 'mod+n', run: () => openDialog('new') },
  'file.open': { label: 'Abrir…', keys: 'mod+o', run: async () => openFiles(await pickFiles()) },
  'file.place': { label: 'Colocar archivo…', keys: 'mod+shift+p', run: async () => placeFiles(await pickFiles()), enabled: hasDoc },
  'file.save': { label: 'Guardar proyecto (.kova)', keys: 'mod+s', run: () => saveProject(false), enabled: hasDoc },
  'file.saveAs': { label: 'Guardar como…', keys: 'mod+shift+s', run: () => saveProject(true), enabled: hasDoc },
  'file.saveLib': { label: 'Guardar en biblioteca local', run: () => saveToBrowserLibrary(), enabled: hasDoc },
  'file.export': { label: 'Exportar…', keys: 'mod+e', run: () => openDialog('export'), enabled: hasDoc },
  'file.exportPng': { label: 'Exportación rápida PNG DTF', keys: 'mod+shift+e', run: () => openDialog('export', { quick: 'png' }), enabled: hasDoc },
  'file.duplicate': { label: 'Duplicar documento', run: () => A.duplicateDoc(), enabled: hasDoc },
  'file.close': {
    label: 'Cerrar documento', keys: 'mod+w', enabled: hasDoc,
    run: () => {
      const d = activeDoc();
      if (!d) return;
      if (d.dirty && !confirm(`"${d.name}" tiene cambios sin guardar. ¿Cerrar de todos modos?`)) return;
      discardAutosave(d.id);
      A.closeDoc(d.id);
    },
  },
  // Edición
  'edit.undo': { label: 'Deshacer', keys: 'mod+z', run: undo, enabled: () => !!activeDoc()?.past.length },
  'edit.redo': { label: 'Rehacer', keys: 'mod+shift+z', run: redo, enabled: () => !!activeDoc()?.future.length },
  'edit.cut': { label: 'Cortar', keys: 'mod+x', run: () => clipboardCopy(true), enabled: hasLayer },
  'edit.copy': { label: 'Copiar', keys: 'mod+c', run: () => clipboardCopy(false), enabled: hasLayer },
  'edit.copyMerged': { label: 'Copiar combinado', keys: 'mod+shift+c', run: () => clipboardCopy(false, true), enabled: hasDoc },
  'edit.paste': { label: 'Pegar', keys: 'mod+v', run: () => clipboardPaste() },
  'edit.fill': { label: 'Rellenar con color frontal', keys: 'alt+backspace', run: () => A.fillSelection(get().fg), enabled: hasLayer },
  'edit.fillBg': { label: 'Rellenar con color de fondo', keys: 'mod+backspace', run: () => A.fillSelection(get().bg), enabled: hasLayer },
  'edit.delete': { label: 'Borrar', keys: 'delete', run: () => A.deleteSelectionPixels(), enabled: hasLayer },
  'edit.delete2': { label: 'Borrar', keys: 'backspace', run: () => A.deleteSelectionPixels() },
  'edit.transform': { label: 'Transformación libre', keys: 'mod+t', run: () => { setTool('move'); set(s => ({ opts: { ...s.opts, showTransform: true } })); }, enabled: hasLayer },
  'edit.flipH': { label: 'Voltear horizontal', run: () => A.flipLayers('h'), enabled: hasLayer },
  'edit.flipV': { label: 'Voltear vertical', run: () => A.flipLayers('v'), enabled: hasLayer },
  'edit.rot90': { label: 'Rotar 90° horario', run: () => A.rotateLayers(90), enabled: hasLayer },
  'edit.rot-90': { label: 'Rotar 90° antihorario', run: () => A.rotateLayers(-90), enabled: hasLayer },
  'edit.rot180': { label: 'Rotar 180°', run: () => A.rotateLayers(180), enabled: hasLayer },
  'edit.color': { label: 'Ajustes de color / perfiles ICC…', run: () => openDialog('color-settings') },
  'edit.shortcuts': { label: 'Atajos de teclado', keys: 'mod+/', run: () => openDialog('shortcuts') },
  // Imagen
  'image.size': { label: 'Tamaño de imagen…', keys: 'mod+alt+i', run: () => openDialog('image-size'), enabled: hasDoc },
  'image.canvas': { label: 'Tamaño de lienzo…', keys: 'mod+alt+c', run: () => openDialog('canvas-size'), enabled: hasDoc },
  'image.trim': { label: 'Recortar al contenido', run: () => A.trimArtboardToContent(), enabled: hasDoc },
  'image.rot90': { label: 'Rotar mesa 90° horario', run: () => A.rotateArtboard(90), enabled: hasDoc },
  'image.rot-90': { label: 'Rotar mesa 90° antihorario', run: () => A.rotateArtboard(-90), enabled: hasDoc },
  'image.rot180': { label: 'Rotar mesa 180°', run: () => A.rotateArtboard(180), enabled: hasDoc },
  'image.modeRGB': { label: 'Modo RGB', run: () => setMode('RGB'), checked: () => activeDoc()?.colorMode === 'RGB', enabled: hasDoc },
  'image.modeCMYK': { label: 'Modo CMYK (prueba con perfil)', run: () => setMode('CMYK'), checked: () => activeDoc()?.colorMode === 'CMYK', enabled: hasDoc },
  'image.adj.brightnessContrast': adj('brightnessContrast'),
  'image.adj.levels': { ...adj('levels'), keys: 'mod+l' },
  'image.adj.curves': { ...adj('curves'), keys: 'mod+m' },
  'image.adj.exposure': adj('exposure'),
  'image.adj.vibrance': adj('vibrance'),
  'image.adj.hueSaturation': { ...adj('hueSaturation'), keys: 'mod+u' },
  'image.adj.blackWhite': { ...adj('blackWhite'), keys: 'mod+alt+shift+b' },
  'image.adj.invert': { ...adj('invert'), keys: 'mod+i' },
  'image.adj.threshold': adj('threshold'),
  'image.adj.posterize': adj('posterize'),
  'image.applyAdj': { label: 'Aplicar ajustes a los píxeles', run: () => A.applyAdjustments(), enabled: () => !!activeLayer()?.adjustments.length },
  // Capa
  'layer.new': { label: 'Nueva capa', keys: 'mod+shift+n', run: () => A.newEmptyLayer(), enabled: hasDoc },
  'layer.duplicate': { label: 'Duplicar capa', keys: 'mod+j', run: () => (docState()?.selection ? A.layerViaCopy() : A.duplicateSelectedLayers()), enabled: hasLayer },
  'layer.viaCut': { label: 'Capa vía cortar', keys: 'mod+shift+j', run: () => A.layerViaCopy(true), enabled: hasSel },
  'layer.delete': { label: 'Eliminar capa', run: () => A.deleteSelectedLayers(), enabled: hasLayer },
  'layer.group': { label: 'Agrupar capas', keys: 'mod+g', run: () => A.groupSelected(), enabled: hasLayer },
  'layer.ungroup': { label: 'Desagrupar', keys: 'mod+shift+g', run: () => A.ungroupSelected(), enabled: () => activeLayer()?.kind === 'group' },
  'layer.clip': { label: 'Crear/soltar máscara de recorte', keys: 'mod+alt+g', run: () => A.toggleClip(), enabled: hasLayer },
  'layer.mask': { label: 'Añadir máscara de capa (desde selección)', run: () => A.selectionToMask(false), enabled: hasLayer },
  'layer.maskHide': { label: 'Máscara que oculta la selección', run: () => A.selectionToMask(true), enabled: hasLayer },
  'layer.maskApply': { label: 'Aplicar máscara', run: () => A.applyMask(), enabled: () => !!activeLayer()?.mask },
  'layer.maskDelete': { label: 'Eliminar máscara', run: () => { const l = activeLayer(); if (l) A.updateLayer(l.id, { mask: null }, 'Eliminar máscara'); }, enabled: () => !!activeLayer()?.mask },
  'layer.rasterize': { label: 'Rasterizar capa', run: () => { const l = activeLayer(); if (l) A.rasterizeLayer(l.id); }, enabled: hasLayer },
  'layer.resample': { label: 'Remuestrear al tamaño actual', run: () => { const l = activeLayer(); if (l) withBusy('Remuestreando…', () => A.rasterizeLayer(l.id, { bakeScale: true })); }, enabled: hasLayer },
  'layer.mergeDown': { label: 'Combinar hacia abajo / selección', keys: 'mod+e', run: () => A.mergeSelected(), enabled: hasLayer },
  'layer.flatten': { label: 'Acoplar imagen', run: () => A.flattenImage(), enabled: hasDoc },
  'layer.up': { label: 'Traer adelante', keys: 'mod+]', run: () => A.nudgeLayerOrder(1), enabled: hasLayer },
  'layer.down': { label: 'Enviar atrás', keys: 'mod+[', run: () => A.nudgeLayerOrder(-1), enabled: hasLayer },
  'layer.top': { label: 'Traer al frente', keys: 'mod+shift+]', run: () => A.nudgeLayerOrder('top'), enabled: hasLayer },
  'layer.bottom': { label: 'Enviar al fondo', keys: 'mod+shift+[', run: () => A.nudgeLayerOrder('bottom'), enabled: hasLayer },
  'layer.outline': { label: 'Contorno / silueta…', run: () => openDialog('outline'), enabled: hasLayer },
  'layer.text': { label: 'Nueva capa de texto', run: () => setTool('text'), enabled: hasDoc },
  // Selección
  'sel.all': { label: 'Todo', keys: 'mod+a', run: () => A.selectAll(), enabled: hasDoc },
  'sel.none': { label: 'Deseleccionar', keys: 'mod+d', run: () => A.deselect(), enabled: hasSel },
  'sel.invert': { label: 'Invertir', keys: 'mod+shift+i', run: () => A.invertSelection(), enabled: hasDoc },
  'sel.layer': { label: 'Cargar transparencia de la capa', run: () => { const l = activeLayer(); if (l) A.selectLayerAlpha(l.id); }, enabled: hasLayer },
  'sel.colorRange': { label: 'Gama de colores…', run: () => openDialog('color-range'), enabled: hasLayer },
  'sel.subject': { label: 'Seleccionar sujeto (IA)', run: () => openDialog('bg-remove', { tab: 'ai', asSelection: true }), enabled: hasLayer },
  'sel.feather': { label: 'Calar (feather)…', keys: 'shift+f6', run: () => openDialog('modify-sel', { kind: 'feather' }), enabled: hasSel },
  'sel.expand': { label: 'Expandir…', run: () => openDialog('modify-sel', { kind: 'expand' }), enabled: hasSel },
  'sel.contract': { label: 'Contraer…', run: () => openDialog('modify-sel', { kind: 'contract' }), enabled: hasSel },
  'sel.smooth': { label: 'Suavizar…', run: () => openDialog('modify-sel', { kind: 'smooth' }), enabled: hasSel },
  // Filtros
  'filter.blur': adj('blur'),
  'filter.sharpen': adj('sharpen'),
  'filter.denoise': adj('denoise'),
  // DTF
  'dtf.halftone': { label: 'Semitonos (halftone)…', keys: 'mod+shift+h', run: () => openDialog('halftone'), enabled: hasLayer },
  'dtf.bg': { label: 'Eliminar fondo…', keys: 'mod+shift+b', run: () => openDialog('bg-remove'), enabled: hasLayer },
  'dtf.refine': { label: 'Refinar bordes / limpiar alfa…', run: () => openDialog('bg-remove', { tab: 'refine' }), enabled: hasLayer },
  'dtf.vectorize': { label: 'Vectorizar…', keys: 'mod+shift+v', run: () => openDialog('vectorize'), enabled: hasLayer },
  'dtf.underbase': { label: 'Base blanca / knockout de prenda…', run: () => openDialog('underbase'), enabled: hasDoc },
  'dtf.separations': { label: 'Separación de canales CMYK…', run: () => openDialog('separations'), enabled: hasDoc },
  'dtf.mockup': { label: 'Previsualizar en prenda…', keys: 'mod+shift+m', run: () => openDialog('mockup'), enabled: hasDoc },
  'dtf.preflight': { label: 'Preparar para impresión (preflight)…', keys: 'mod+shift+k', run: () => openDialog('preflight'), enabled: hasDoc },
  'dtf.gang': { label: 'Hoja de impresión / imposición…', keys: 'mod+shift+o', run: () => openDialog('gang'), enabled: hasDoc },
  'dtf.palette': { label: 'Detectar colores dominantes', run: () => { set(s => ({ panels: s.panels.map(p => (p.id === 'color' ? { ...p, visible: true, collapsed: false } : p)) })); window.dispatchEvent(new Event('kova:dominant')); }, enabled: hasLayer },
  // Vista
  'view.zoomIn': { label: 'Acercar', keys: 'mod+=', run: () => A.zoomTo((get().views[get().activeDocId!]?.zoom ?? 1) * 1.25), enabled: hasDoc },
  'view.zoomIn2': { label: 'Acercar', keys: 'mod++', run: () => A.zoomTo((get().views[get().activeDocId!]?.zoom ?? 1) * 1.25) },
  'view.zoomOut': { label: 'Alejar', keys: 'mod+-', run: () => A.zoomTo((get().views[get().activeDocId!]?.zoom ?? 1) / 1.25), enabled: hasDoc },
  'view.fit': { label: 'Ajustar a pantalla', keys: 'mod+0', run: () => A.fitToScreen(), enabled: hasDoc },
  'view.100': { label: '100 % (píxeles reales)', keys: 'mod+1', run: () => A.zoomTo(1), enabled: hasDoc },
  'view.print': { label: 'Tamaño de impresión real', run: () => printSize(), enabled: hasDoc },
  'view.rulers': { label: 'Reglas', keys: 'mod+r', run: () => set(s => ({ showRulers: !s.showRulers })), checked: () => get().showRulers },
  'view.grid': { label: 'Cuadrícula', keys: "mod+'", run: () => set(s => ({ showGrid: !s.showGrid })), checked: () => get().showGrid },
  'view.guides': { label: 'Guías y márgenes', keys: 'mod+;', run: () => set(s => ({ showGuides: !s.showGuides })), checked: () => get().showGuides },
  'view.snap': { label: 'Ajuste magnético (snap)', keys: 'mod+shift+;', run: () => set(s => ({ snap: !s.snap })), checked: () => get().snap },
  'view.clearGuides': { label: 'Borrar guías', run: () => A.clearGuides(), enabled: () => !!docState()?.guides.length },
  'view.gridSettings': { label: 'Configurar cuadrícula y unidades…', run: () => openDialog('grid') },
  'view.proof': { label: 'Prueba de color CMYK', keys: 'mod+y', run: () => set(s => ({ proof: !s.proof })), checked: () => get().proof },
  'view.compare': { label: 'Comparar antes/después', keys: '\\', run: () => set(s => ({ compare: !s.compare })), checked: () => get().compare },
  'view.hideUI': { label: 'Ocultar paneles', keys: 'tab', run: () => set(s => ({ hideUI: !s.hideUI })), checked: () => get().hideUI },
  // Herramientas
  'tool.move': toolCmd('move', 'Mover', 'v'),
  'tool.marquee': toolCmd('marquee', 'Marco rectangular', 'm'),
  'tool.ellipse': toolCmd('ellipseMarquee', 'Marco elíptico', 'shift+m'),
  'tool.lasso': toolCmd('lasso', 'Lazo', 'l'),
  'tool.wand': toolCmd('wand', 'Varita mágica', 'w'),
  'tool.crop': toolCmd('crop', 'Recortar', 'c'),
  'tool.eyedropper': toolCmd('eyedropper', 'Cuentagotas', 'i'),
  'tool.brush': toolCmd('brush', 'Pincel', 'b'),
  'tool.eraser': toolCmd('eraser', 'Borrador', 'e'),
  'tool.restore': toolCmd('restore', 'Pincel de restauración', 'y'),
  'tool.fill': toolCmd('fill', 'Bote de pintura', 'g'),
  'tool.gradient': toolCmd('gradient', 'Degradado', 'shift+g'),
  'tool.text': toolCmd('text', 'Texto', 't'),
  'tool.shape': toolCmd('shape', 'Forma', 'u'),
  'tool.hand': toolCmd('hand', 'Mano', 'h'),
  'tool.zoom': toolCmd('zoom', 'Zoom', 'z'),
  'tool.artboard': toolCmd('artboard', 'Mesa de trabajo', 'shift+a'),
  'color.swap': { label: 'Intercambiar colores', keys: 'x', run: () => set(s => ({ fg: s.bg, bg: s.fg })) },
  'color.default': { label: 'Colores por defecto', keys: 'd', run: () => set({ fg: '#000000', bg: '#ffffff' }) },
  'brush.smaller': { label: 'Pincel más pequeño', keys: '[', run: () => set(s => ({ opts: { ...s.opts, brushSize: Math.max(1, Math.round(s.opts.brushSize / 1.2)) } })) },
  'brush.bigger': { label: 'Pincel más grande', keys: ']', run: () => set(s => ({ opts: { ...s.opts, brushSize: Math.min(2000, Math.round(s.opts.brushSize * 1.2 + 1)) } })) },
  'crop.apply': { label: 'Aplicar recorte', keys: 'enter', run: () => applyCrop(), enabled: () => get().tool === 'crop' && !!cropState.rect },
  'esc': { label: 'Cancelar', keys: 'escape', run: () => { if (get().tool === 'crop') cancelCrop(); else if (docState()?.selection) A.deselect(); } },
  // Ayuda
  'help.about': { label: 'Acerca de Kova_DesignLab y limitaciones', run: () => openDialog('about') },
};

function setMode(mode: 'RGB' | 'CMYK') {
  const d = activeDoc();
  if (!d) return;
  set(s => ({ docs: s.docs.map(x => (x.id === d.id ? { ...x, colorMode: mode } : x)) }));
  if (mode === 'CMYK') toast('Modo CMYK: el visor muestra la simulación de impresión. Exporta TIFF CMYK para separaciones reales.', 'info', 5000);
}

function printSize() {
  // 96 px CSS ≈ 1 pulgada en la mayoría de pantallas
  const ab = A.fitToScreen; void ab;
  const abd = docState()?.artboards.find(a => a.id === docState()!.activeArtboardId);
  if (abd) A.zoomTo(96 / abd.dpi);
}

// ---------- portapapeles ----------
let internalClip: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;
async function clipboardCopy(cut: boolean, merged = false) {
  const data = await A.copySelection(merged);
  if (!data) return;
  internalClip = data;
  try {
    const blob: Blob = await new Promise(r => data.canvas.toBlob(b => r(b!), 'image/png'));
    await (navigator.clipboard as any).write([new ClipboardItem({ 'image/png': blob })]);
  } catch { /* sin permiso de portapapeles del sistema: queda el interno */ }
  if (cut) await A.deleteSelectionPixels();
  toast(cut ? 'Cortado' : 'Copiado', 'ok', 1200);
}
export async function clipboardPaste() {
  // El evento paste del documento gestiona las imágenes del sistema; aquí se usa el interno
  if (internalClip && activeDoc()) {
    const { rasterLayer } = await import('../core/doc');
    const c = internalClip;
    A.insertLayers([rasterLayer(c.canvas, 'Pegado', c.x, c.y)], 'Pegar');
    return;
  }
  try {
    const items = await (navigator.clipboard as any).read();
    for (const it of items) {
      const type = it.types.find((t: string) => t.startsWith('image/'));
      if (type) { const { pasteImageBlob } = await import('../io/fileOps'); await pasteImageBlob(await it.getType(type)); return; }
    }
  } catch { toast('Usa Ctrl/⌘+V sobre el lienzo para pegar desde el sistema', 'info'); }
}
export function setInternalClip(v: typeof internalClip) { internalClip = v; }
export function hasInternalClip() { return !!internalClip; }

// ---------- atajos ----------
export function keyString(e: KeyboardEvent) {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  let k = e.key.toLowerCase();
  if (k === ' ') k = 'space';
  if (e.code === 'Backslash') k = '\\';
  if (e.code === 'BracketLeft') k = '[';
  if (e.code === 'BracketRight') k = ']';
  if (e.code === 'Quote') k = "'";
  if (e.code === 'Semicolon') k = ';';
  if (e.code === 'Slash') k = '/';
  if (e.code === 'Equal') k = '=';
  if (e.code === 'Minus') k = '-';
  if (e.code.startsWith('Digit')) k = e.code.slice(5);
  if (e.code.startsWith('Key')) k = e.code.slice(3).toLowerCase();
  parts.push(k);
  return parts.join('+');
}
export function displayKeys(k?: string) {
  if (!k) return '';
  return k.split('+').map(p => {
    if (p === 'mod') return isMac ? '⌘' : 'Ctrl';
    if (p === 'alt') return isMac ? '⌥' : 'Alt';
    if (p === 'shift') return isMac ? '⇧' : 'Mayús';
    if (p === 'backspace') return '⌫';
    if (p === 'delete') return 'Supr';
    if (p === 'enter') return '↵';
    if (p === 'escape') return 'Esc';
    if (p === 'tab') return 'Tab';
    return p.length === 1 ? p.toUpperCase() : p;
  }).join(isMac ? '' : '+');
}
const keyMap = new Map<string, string>();
for (const [id, c] of Object.entries(commands)) if (c.keys && !keyMap.has(c.keys)) keyMap.set(c.keys, id);

export function runCommand(id: string) {
  const c = commands[id];
  if (!c) return;
  if (c.enabled && !c.enabled()) return;
  c.run();
}
export function handleShortcut(e: KeyboardEvent): boolean {
  const k = keyString(e);
  // Mod+E: exportar si no hay capa para combinar
  let id = keyMap.get(k);
  if (k === 'mod+e') id = selectedLayers().length > 1 ? 'layer.mergeDown' : 'file.export';
  if (!id) return false;
  const c = commands[id];
  if (c.enabled && !c.enabled()) return false;
  e.preventDefault();
  c.run();
  return true;
}
