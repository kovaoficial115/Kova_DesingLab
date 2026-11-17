// Registro central de comandos: lo usan los menús, los atajos de teclado y la barra rápida.

import { collabConfigured } from '../collab/config';
import { get, set, undo, redo, activeDoc, activeLayer, docState, toast, withBusy, selectedLayers, brushFor, setBrush, redrawOverlay } from '../core/store';
import * as A from '../core/actions';
import { setTool, applyCrop, cancelCrop, cropState, imageCrop, imageCropTarget, beginImageCrop, removeImageCrop, hasEditableCrop } from '../tools/tools';
import { pickFiles, openFiles, placeFiles, saveProject, saveToBrowserLibrary, autosave } from '../io/fileOps';
import type { AdjustmentType, ToolId } from '../core/types';
import { discardAutosave } from '../io/fileOps';
import { platform } from '../platform';
import * as SA from '../social/actions';
import * as CA from '../core/components';
import { defaultPath } from '../core/textpath';
import { live, finishLive } from '../core/store';
import { layerPivot, placeAtPivot } from '../core/util';
import type { TextPath } from '../core/types';
import type { SocialGuides, PanelId } from '../core/store';
import { FX } from '../engine/fx/registry';
import { addEffect, importLut } from '../fx/lib';
import * as AL from '../core/adjustLayers';
import { COMPOSITIONS } from '../editorial/layout';
import { clipText, type LayerClip } from '../core/clipboard';
import { editableLoss, mergeWarningText } from '../core/layerOps';
import { childrenOf } from '../core/doc';
import { toggleFullscreen, enterPresentation } from './viewModes';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export interface Command { label: string; keys?: string; run: () => any; enabled?: () => boolean; checked?: () => boolean }

const hasDoc = () => !!activeDoc();
const hasLayer = () => !!activeLayer();
/** Capa hermana justo debajo de la activa (la que recibe «Combinar con la capa inferior»). */
function layerBelow() {
  const s = docState(), l = activeLayer();
  if (!s || !l) return null;
  const sibs = childrenOf(s.layers, l.parentId);
  return sibs[sibs.findIndex(x => x.id === l.id) - 1] ?? null;
}
/** Aviso antes de combinar o acoplar si se pierde algo editable (acoplar siempre pregunta). */
export async function confirmMerge(kind: 'sel' | 'below' | 'flatten'): Promise<boolean> {
  const s = docState();
  if (!s) return false;
  if (kind === 'flatten') {
    const loss = editableLoss(s.layers, s.layers.filter(l => !l.parentId).map(l => l.id));
    const extra = loss.length ? `\n\nSe convierten en píxeles: ${loss.join(', ')}.` : '';
    return platform.confirm(`Acoplar la imagen une todas las capas de la mesa activa en una sola capa de píxeles.${extra}\n\nPuedes deshacerlo con ⌘Z / Ctrl+Z.`, { okLabel: 'Acoplar' });
  }
  const below = layerBelow();
  const ids = kind === 'sel' ? s.selectedLayerIds : [activeLayer()?.id, below?.id].filter((x): x is string => !!x);
  const loss = editableLoss(s.layers, ids);
  if (!loss.length) return true;
  return platform.confirm(mergeWarningText(kind === 'sel' ? 'Combinar las capas seleccionadas' : 'Combinar con la capa inferior', loss), { okLabel: 'Combinar' });
}

const hasSel = () => !!docState()?.selection;
const hasSocial = () => !!docState()?.artboards.some(a => a.social?.preset);
const behanceProject = () => { const s = docState(); return s?.artboards.find(a => a.id === s.activeArtboardId)?.behance?.project ?? s?.artboards.find(a => a.behance)?.behance?.project; };
const A_activeArtboard = () => { const s = docState(); return s ? s.artboards.find(a => a.id === s.activeArtboardId) ?? null : null; };
export const openDialog = (type: string, props?: any) => set({ dialog: { type, props } });
function toggleQuickMask() {
  const on = !get().quickMask;
  set({ quickMask: on });
  if (on) {
    if (get().tool !== 'brush' && get().tool !== 'eraser') setTool('brush');
    toast('Máscara rápida: el Pincel añade a la selección; el Borrador (o Alt) quita. Pulsa Q para volver a la selección', 'info', 6000);
  }
}

const showPanel = (id: PanelId) => set(s => ({ panels: s.panels.map(p => (p.id === id ? { ...p, visible: true, collapsed: false } : p)) }));
const adj = (t: AdjustmentType): Command => ({ label: A.adjustmentDefaults[t].label, run: () => A.addAdjustment(t), enabled: hasLayer });
const toolCmd = (t: ToolId, label: string, keys: string): Command => ({ label, keys, run: () => setTool(t), checked: () => get().tool === t });

/** [ y ]: tamaño de la herramienta de pintura activa (el pincel si no hay ninguna). */
function resizeBrush(fn: (v: number) => number) {
  const t = get().tool;
  const k = t === 'eraser' || t === 'restore' ? t : 'brush';
  setBrush(k, { size: fn(brushFor(k).size) });
  redrawOverlay();
}

const masterOfActive = () => { const s = docState(), l = activeLayer(); return s && l ? CA.masterRootOf(s.layers, l) : null; };
const variantOfActive = () => { const s = docState(), l = activeLayer(); return s && l ? CA.variantRootOf(s.layers, l) : null; };
const activeText = () => { const l = activeLayer(); return l?.kind === 'text' && l.text ? l : null; };
/** Pone (o quita) una trayectoria al texto activo sin mover su centro. */
function textPathCmd(kind: TextPath['kind'] | null) {
  const l = activeText();
  if (!l) return;
  live(s => ({
    ...s, layers: s.layers.map(x => {
      if (x.id !== l.id || !x.text) return x;
      const c = layerPivot(x);
      const nx = { ...x, text: { ...x.text, path: kind ? defaultPath(kind, x.text.fontSize, x.text.path?.kind === kind ? x.text.path : null) : null } };
      return { ...nx, ...placeAtPivot(nx, c.x, c.y) };
    }),
  }));
  finishLive(kind ? 'Texto en trayectoria' : 'Quitar trayectoria');
}

export const commands: Record<string, Command> = {
  // Archivo
  'file.home': { label: 'Menú principal', run: () => set({ screen: 'home' }) },
  'file.new': { label: 'Nuevo…', keys: 'mod+n', run: () => openDialog('new') },
  'file.open': { label: 'Abrir…', keys: 'mod+o', run: async () => openFiles(await pickFiles()) },
  'file.place': { label: 'Colocar archivo…', keys: 'mod+shift+p', run: async () => placeFiles(await pickFiles()), enabled: hasDoc },
  'file.save': { label: 'Guardar proyecto (.kova)', keys: 'mod+s', run: () => saveProject(false), enabled: hasDoc },
  'file.saveAs': { label: 'Guardar como…', keys: 'mod+shift+s', run: () => saveProject(true), enabled: hasDoc },
  'file.saveLib': { label: 'Guardar en biblioteca local', run: () => saveToBrowserLibrary(), enabled: hasDoc },
  'file.fonts': { label: 'Tipografías…', keys: 'mod+alt+t', run: () => openDialog('fonts') },
  'file.share': { label: 'Compartir y colaborar…', keys: 'mod+alt+s', run: () => import('../collab/rooms').then(m => m.shareActiveDoc()), enabled: () => hasDoc() && collabConfigured },
  'file.versions': { label: 'Historial de versiones…', run: () => openDialog('collab-versions'), enabled: () => !!activeDoc()?.collab },
  'file.profile': { label: 'Mi perfil de colaboración…', run: () => openDialog('collab-identity'), enabled: () => collabConfigured },
  'file.export': { label: 'Exportar…', keys: 'mod+e', run: () => openDialog('export'), enabled: hasDoc },
  'file.exportPng': { label: 'Exportación rápida PNG DTF', keys: 'mod+shift+e', run: () => openDialog('export', { quick: 'png' }), enabled: hasDoc },
  'file.duplicate': { label: 'Duplicar documento', run: () => A.duplicateDoc(), enabled: hasDoc },
  'file.exportAll': { label: 'Exportar todos los proyectos…', run: () => withBusy('Exportando proyectos…', async () => {
    const { exportAllProjects } = await import('../io/library');
    const n = await exportAllProjects();
    if (n === 0) toast('La biblioteca local no tiene proyectos', 'info');
    else if (n) toast(`${n} proyecto(s) exportados en un .zip`, 'ok');
  }) },
  'file.importAll': { label: 'Importar copia de proyectos (.zip)…', run: async () => {
    const [f] = await pickFiles(false, '.zip,application/zip');
    if (!f) return;
    await withBusy('Importando proyectos…', async () => {
      const { importProjectsArchive } = await import('../io/library');
      const r = await importProjectsArchive(f);
      const parts = [`${r.added} importado(s)`];
      if (r.copies) parts.push(`${r.copies} como copia`);
      if (r.skipped) parts.push(`${r.skipped} ya estaba(n)`);
      if (r.failed.length) parts.push(`${r.failed.length} con error: ${r.failed.map(x => `${x.name} (${x.error})`).join('; ')}`);
      toast(parts.join(' · '), r.failed.length ? 'warn' : 'ok');
      window.dispatchEvent(new Event('kova:library-changed'));
    });
  } },
  'social.new': { label: 'Nuevo diseño para redes…', run: () => openDialog('social-new', { mode: 'new' }) },
  'social.add': { label: 'Añadir formato al documento…', run: () => openDialog('social-new', { mode: 'add' }), enabled: hasDoc },
  'social.carousel': { label: 'Carrusel / destacadas…', run: () => openDialog('social-new', { mode: activeDoc() ? 'add' : 'new', tab: 'series' }) },
  'social.panorama': {
    label: 'Carrusel panorámico desde la capa', enabled: () => !!activeLayer() && activeLayer()!.kind !== 'group',
    run: () => { const f = SA.formatOf(A_activeArtboard()); SA.panoramaFromLayer(activeLayer()!.id, f?.carousel ? f : SA.formats().find(x => x.id === 'ig-carousel')!); },
  },
  'social.adapt': { label: 'Adaptar a otros formatos…', run: () => openDialog('social-adapt'), enabled: () => !!SA.formatOf(A_activeArtboard()) },
  'social.preview': { label: 'Vista previa y planificador del feed…', run: () => openDialog('social-preview'), enabled: hasSocial },
  'social.batch': { label: 'Plantilla con variables (CSV/JSON)…', run: () => openDialog('social-batch'), enabled: hasDoc },
  'social.export': { label: 'Exportar para redes…', keys: 'mod+alt+e', run: () => openDialog('social-export'), enabled: hasSocial },
  'social.formats': { label: 'Editar formatos…', run: () => openDialog('social-new', { mode: activeDoc() ? 'add' : 'new', tab: 'formats' }) },
  ...Object.fromEntries(([['safe', 'Zona segura'], ['ui', 'Interfaz de la app'], ['circle', 'Recorte circular'], ['thirds', 'Tercios'], ['crops', 'Recortes de cuadrícula'], ['numbers', 'Numeración de diapositivas']] as [keyof SocialGuides, string][]).map(([k, label]) => [
    `social.g.${k}`, { label, run: () => set(s => ({ socialGuides: { ...s.socialGuides, [k]: !s.socialGuides[k] } })), checked: () => get().socialGuides[k] } as Command,
  ])),
  'behance.new': { label: 'Nuevo proyecto Behance…', run: () => openDialog('behance-new', { mode: 'new' }) },
  'behance.add': { label: 'Proyecto Behance en este documento…', run: () => openDialog('behance-new', { mode: 'add' }), enabled: hasDoc },
  'behance.preview': { label: 'Vista previa de Behance…', run: () => openDialog('behance-preview', { project: behanceProject() }), enabled: () => !!behanceProject() },
  'behance.export': { label: 'Exportar para Behance…', run: () => openDialog('behance-export', { project: behanceProject() }), enabled: () => !!behanceProject() },
  'behance.guides': { label: 'Guías de sección', run: () => set(s => ({ behanceGuides: !s.behanceGuides })), checked: () => get().behanceGuides },
  'view.studio3d': { label: 'Estudio 3D…', keys: 'mod+alt+3', run: () => set({ screen: 'studio' }) },
  'file.backups': { label: 'Copias de respaldo…', run: () => openDialog('backups') },
  ...Object.fromEntries([0, 4, 30, 120].map(sec => [`file.autosave.${sec}`, {
    label: sec === 0 ? 'Desactivado' : sec < 60 ? `Cada ${sec} s tras un cambio` : `Cada ${sec / 60} min tras un cambio`,
    run: () => { set({ autosaveSec: sec }); autosave(); },
    checked: () => get().autosaveSec === sec,
  } satisfies Command])),
  'file.close': {
    label: 'Cerrar documento', keys: 'mod+w', enabled: hasDoc,
    run: async () => {
      const d = activeDoc();
      if (!d) return;
      if (d.dirty && !(await platform.confirm(`"${d.name}" tiene cambios sin guardar. ¿Cerrar de todos modos?`, { okLabel: 'Cerrar' }))) return;
      discardAutosave(d.id);
      A.closeDoc(d.id);
    },
  },
  // Edición
  'edit.undo': { label: 'Deshacer', keys: 'mod+z', run: () => { if (imageCrop.layerId) cancelCrop(); else undo(); }, enabled: () => !!imageCrop.layerId || !!activeDoc()?.past.length },
  'edit.redo': { label: 'Rehacer', keys: 'mod+shift+z', run: redo, enabled: () => !!activeDoc()?.future.length },
  'edit.cut': { label: 'Cortar', keys: 'mod+x', run: () => clipboardCopy(true), enabled: hasLayer },
  'edit.copy': { label: 'Copiar', keys: 'mod+c', run: () => clipboardCopy(false), enabled: hasLayer },
  'edit.copyMerged': { label: 'Copiar combinado', keys: 'mod+shift+c', run: () => clipboardCopy(false, true), enabled: hasDoc },
  'edit.paste': { label: 'Pegar', keys: 'mod+v', run: () => clipboardPaste() },
  'edit.duplicate': { label: 'Duplicar', keys: 'mod+d', run: () => A.duplicateWithOffset(pasteStep()), enabled: hasLayer },
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
  'image.adj.colorize': adj('colorize'),
  'image.adj.gradientMap': adj('gradientMap'),
  'image.adj.blackWhite': { ...adj('blackWhite'), keys: 'mod+alt+shift+b' },
  'image.adj.invert': { ...adj('invert'), keys: 'mod+i' },
  'image.adj.threshold': adj('threshold'),
  'image.adj.posterize': adj('posterize'),
  'image.applyAdj': { label: 'Aplicar ajustes a los píxeles', run: () => A.applyAdjustments(), enabled: () => !!activeLayer()?.adjustments.length },
  // Capa
  'layer.new': { label: 'Nueva capa', keys: 'mod+shift+n', run: () => A.newEmptyLayer(), enabled: hasDoc },
  'layer.duplicate': { label: 'Duplicar capa', keys: 'mod+j', run: () => (docState()?.selection ? A.layerViaCopy() : A.duplicateSelectedLayers()), enabled: hasLayer },
  'layer.viaCut': { label: 'Capa vía cortar', keys: 'mod+shift+j', run: () => A.layerViaCopy(true), enabled: hasSel },
  'artboard.fromSelection': { label: 'Crear mesa de trabajo con el tamaño de la imagen', keys: 'mod+alt+a', run: () => A.artboardFromSelection('move'), enabled: hasLayer },
  'artboard.copyToNew': { label: 'Copiar a una mesa nueva del mismo tamaño', run: () => A.artboardFromSelection('copy'), enabled: hasLayer },
  'layer.delete': { label: 'Eliminar capa', run: () => A.deleteSelectedLayers(), enabled: hasLayer },
  'layer.group': { label: 'Agrupar capas', keys: 'mod+g', run: () => A.groupSelected(), enabled: hasLayer },
  'layer.component': { label: 'Crear componente', keys: 'mod+alt+k', run: () => { const l = activeLayer(); if (l) CA.makeComponent(l.id); }, enabled: () => { const s = docState(), l = activeLayer(); return !!s && !!l && CA.canBeComponent(s.layers, l); } },
  'layer.variant': { label: 'Crear variante vinculada', keys: 'mod+alt+j', run: () => { const m = masterOfActive() ?? (() => { const v = variantOfActive(); return v?.link ? docState()!.layers.find(x => x.id === v.link!.master) ?? null : null; })(); if (m) CA.createVariant(m.id); }, enabled: () => !!masterOfActive() || !!variantOfActive() },
  'layer.variantReset': { label: 'Restablecer variante', run: () => { const v = variantOfActive(); if (v) CA.resetVariantAction(v.id); }, enabled: () => !!variantOfActive() },
  'layer.variantDetach': { label: 'Desvincular variante', run: () => { const v = variantOfActive(); if (v) CA.detachVariant(v.id); }, enabled: () => !!variantOfActive() },
  'text.pathCircle': { label: 'En círculo', run: () => textPathCmd('circle'), enabled: () => !!activeText(), checked: () => activeText()?.text?.path?.kind === 'circle' },
  'text.pathArc': { label: 'En arco', run: () => textPathCmd('arc'), enabled: () => !!activeText(), checked: () => activeText()?.text?.path?.kind === 'arc' },
  'text.pathWave': { label: 'En onda', run: () => textPathCmd('wave'), enabled: () => !!activeText(), checked: () => activeText()?.text?.path?.kind === 'wave' },
  'text.pathNone': { label: 'En renglones', run: () => textPathCmd(null), enabled: () => !!activeText()?.text?.path },
  'layer.ungroup': { label: 'Desagrupar', keys: 'mod+shift+g', run: () => A.ungroupSelected(), enabled: () => activeLayer()?.kind === 'group' },
  'layer.clip': { label: 'Crear/soltar máscara de recorte', keys: 'mod+alt+g', run: () => A.toggleClip(), enabled: hasLayer },
  'layer.mask': { label: 'Añadir máscara de capa (desde selección)', run: () => A.selectionToMask(false), enabled: hasLayer },
  'layer.maskHide': { label: 'Máscara que oculta la selección', run: () => A.selectionToMask(true), enabled: hasLayer },
  'layer.maskApply': { label: 'Aplicar máscara', run: () => A.applyMask(), enabled: () => !!activeLayer()?.mask },
  'layer.maskDelete': { label: 'Eliminar máscara', run: () => { const l = activeLayer(); if (l) A.updateLayer(l.id, { mask: null }, 'Eliminar máscara'); }, enabled: () => !!activeLayer()?.mask },
  'layer.maskReveal': { label: 'Máscara que revela todo', run: () => AL.addMaskFill(false), enabled: hasLayer },
  'layer.maskHideAll': { label: 'Máscara que oculta todo', run: () => AL.addMaskFill(true), enabled: hasLayer },
  'layer.maskLumLights': { label: 'Máscara de luminancia (luces)', run: () => AL.luminanceMask(false), enabled: hasLayer },
  'layer.maskLumShadows': { label: 'Máscara de luminancia (sombras)', run: () => AL.luminanceMask(true), enabled: hasLayer },
  'layer.maskGradient': { label: 'Máscara de degradado', run: () => AL.gradientMask(), enabled: hasLayer },
  'layer.maskInvert': { label: 'Invertir máscara', run: () => AL.invertMask(), enabled: () => !!activeLayer()?.mask },
  'layer.maskView': { label: 'Ver la máscara en blanco y negro', run: () => { const l = activeLayer(); set(st => ({ maskView: st.maskView || !l ? null : l.id })); }, enabled: () => !!activeLayer()?.mask || !!get().maskView, checked: () => !!get().maskView },
  'layer.newAdjust': { label: 'Nueva capa de ajuste', keys: 'mod+alt+n', run: () => AL.newAdjustmentLayer(), enabled: hasDoc },
  'layer.newAdjustClip': { label: 'Capa de ajuste solo para esta capa', run: () => AL.newAdjustmentLayer({ clip: true }), enabled: () => { const l = activeLayer(); return !!l && l.kind !== 'group' && l.kind !== 'adjust'; } },
  'layer.rasterize': { label: 'Rasterizar capa', run: () => { const l = activeLayer(); if (l) A.rasterizeLayer(l.id); }, enabled: hasLayer },
  'layer.resample': { label: 'Remuestrear al tamaño actual', run: () => { const l = activeLayer(); if (l) withBusy('Remuestreando…', () => A.rasterizeLayer(l.id, { bakeScale: true })); }, enabled: hasLayer },
  'layer.mergeDown': { label: 'Combinar hacia abajo / selección', keys: 'mod+e', run: async () => { if (await confirmMerge(selectedLayers().length > 1 ? 'sel' : 'below')) await A.mergeSelected(); }, enabled: hasLayer },
  'layer.mergeSel': { label: 'Combinar capas seleccionadas', run: async () => { if (await confirmMerge('sel')) await A.mergeSelected(); }, enabled: () => selectedLayers().length > 1 },
  'layer.mergeBelow': { label: 'Combinar con la capa inferior', run: async () => { if (await confirmMerge('below')) await A.mergeDown(); }, enabled: () => !!layerBelow() },
  'layer.flatten': { label: 'Acoplar imagen', run: async () => { if (await confirmMerge('flatten')) await A.flattenImage(); }, enabled: hasDoc },
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
  'sel.subjectQuick': { label: 'Sujeto rápido (sin IA, aproximado)', run: () => A.quickSubjectSelection(), enabled: hasLayer },
  'sel.refineHair': { label: 'Refinar borde (cabello)…', run: () => openDialog('modify-sel', { kind: 'hair' }), enabled: hasSel },
  'sel.quickMask': { label: 'Máscara rápida (pintar la selección)', keys: 'q', run: () => toggleQuickMask(), enabled: hasDoc, checked: () => get().quickMask },
  'sel.viewAnts': { label: 'Hormigas', run: () => set({ selView: 'ants' }), checked: () => get().selView === 'ants' },
  'sel.viewOverlay': { label: 'Superposición roja', run: () => set({ selView: 'overlay' }), checked: () => get().selView === 'overlay' },
  'sel.viewMask': { label: 'Blanco y negro', run: () => set({ selView: 'mask' }), checked: () => get().selView === 'mask' },
  'subj.hideBg': { label: 'Ocultar el fondo (máscara)', run: () => AL.hideBackground(), enabled: hasSel },
  'subj.extract': { label: 'Extraer el sujeto a una capa nueva', run: () => AL.extractSubject(), enabled: hasSel },
  'subj.replaceBg': { label: 'Reemplazar el fondo por el color frontal', run: () => AL.replaceBackground(get().fg), enabled: () => hasSel() || !!activeLayer()?.mask },
  'subj.fxSubject': { label: 'Efectos solo en el sujeto', run: () => AL.effectsOnSelection(false), enabled: hasSel },
  'subj.fxBackground': { label: 'Efectos solo en el fondo', run: () => AL.effectsOnSelection(true), enabled: hasSel },
  'subj.export': { label: 'Exportar el sujeto como PNG…', run: () => AL.exportSubjectPng(), enabled: hasSel },
  'sel.feather': { label: 'Calar (feather)…', keys: 'shift+f6', run: () => openDialog('modify-sel', { kind: 'feather' }), enabled: hasSel },
  'sel.expand': { label: 'Expandir…', run: () => openDialog('modify-sel', { kind: 'expand' }), enabled: hasSel },
  'sel.contract': { label: 'Contraer…', run: () => openDialog('modify-sel', { kind: 'contract' }), enabled: hasSel },
  'sel.smooth': { label: 'Suavizar…', run: () => openDialog('modify-sel', { kind: 'smooth' }), enabled: hasSel },
  // Filtros
  'filter.blur': adj('blur'),
  'filter.sharpen': adj('sharpen'),
  'filter.denoise': adj('denoise'),
  // Efectos (biblioteca)
  'fx.library': { label: 'Biblioteca de efectos y preajustes', keys: 'mod+alt+f', run: () => showPanel('effects'), enabled: hasDoc },
  'fx.colorlab': { label: 'Color Lab', keys: 'mod+shift+l', run: () => showPanel('colorlab'), enabled: hasDoc },
  'fx.importLut': { label: 'Importar LUT (.cube)…', run: () => importLut(), enabled: hasLayer },
  'fx.peek': { label: 'Ver original (sin efectos) mientras se pulsa', keys: 'o', run: () => {}, enabled: hasLayer },
  ...Object.fromEntries(['lensBlur', 'motionBlur', 'radialBlur', 'zoomBlur', 'tiltShift', 'noise', 'rgbSplit', 'hGlitch', 'pixelSort', 'datamosh', 'vhsTracking', 'colorBleed', 'crtScanlines', 'screenCurvature', 'bloom', 'neonGlow', 'contourEcho', 'lightLines']
    .map(t => ['fx.add.' + t, { label: FX[t].label, run: () => addEffect({ type: t, label: FX[t].label }), enabled: hasLayer } as Command])),
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
  'view.layout': { label: 'Retícula de maquetación', keys: "mod+shift+'", run: () => set(s => ({ showLayout: !s.showLayout })), checked: () => get().showLayout },
  'view.layoutSettings': { label: 'Retícula y composición…', run: () => openDialog('editorial-layout'), enabled: hasDoc },
  'view.comp.none': { label: 'Ninguna', run: () => set({ composition: null }), checked: () => !get().composition },
  ...Object.fromEntries(COMPOSITIONS.map(c => [`view.comp.${c.id}`, { label: c.name, run: () => set(s => ({ composition: s.composition === c.id ? null : c.id })), checked: () => get().composition === c.id } as Command])),
  'view.comp.turn': { label: 'Girar la espiral', run: () => set(s => ({ compositionTurn: (s.compositionTurn + 1) % 4 })), enabled: () => get().composition === 'spiral' },
  'view.comp.all': { label: 'En todas las mesas', run: () => set(s => ({ compositionAll: !s.compositionAll })), checked: () => get().compositionAll },
  'view.snap': { label: 'Ajuste magnético (snap)', keys: 'mod+shift+;', run: () => set(s => ({ snap: !s.snap })), checked: () => get().snap },
  'view.clearGuides': { label: 'Borrar guías', run: () => A.clearGuides(), enabled: () => !!docState()?.guides.length },
  'view.gridSettings': { label: 'Configurar cuadrícula y unidades…', run: () => openDialog('grid') },
  'view.proof': { label: 'Prueba de color CMYK', keys: 'mod+y', run: () => set(s => ({ proof: !s.proof })), checked: () => get().proof },
  'view.compare': { label: 'Comparar antes/después', keys: '\\', run: () => set(s => ({ compare: !s.compare })), checked: () => get().compare },
  'view.fullscreen': { label: 'Pantalla completa', keys: 'mod+shift+f', run: () => { void toggleFullscreen(); }, checked: () => get().fullscreen },
  'view.present': { label: 'Presentación', keys: 'mod+alt+p', run: () => { void enterPresentation(); }, enabled: hasDoc },
  'view.hideUI': { label: 'Modo enfoque (ocultar paneles)', keys: 'tab', run: () => set(s => ({ hideUI: !s.hideUI })), checked: () => get().hideUI },
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
  'brush.smaller': { label: 'Pincel más pequeño', keys: '[', run: () => resizeBrush(v => Math.max(1, Math.round(v / 1.2))) },
  'brush.bigger': { label: 'Pincel más grande', keys: ']', run: () => resizeBrush(v => Math.min(5000, Math.round(v * 1.2 + 1))) },
  'crop.apply': { label: 'Aplicar recorte', keys: 'enter', run: () => applyCrop(), enabled: () => get().tool === 'crop' && (!!cropState.rect || !!imageCrop.layerId) },
  'layer.cropImage': { label: 'Recortar imagen…', run: () => { beginImageCrop(); }, enabled: () => !!imageCropTarget() },
  'layer.uncropImage': { label: 'Quitar recorte de imagen', run: () => removeImageCrop(), enabled: () => hasEditableCrop(imageCropTarget()) },
  'esc': { label: 'Cancelar', keys: 'escape', run: () => { if (get().gradientEdit) set({ gradientEdit: null }); else if (get().tool === 'crop') cancelCrop(); else if (docState()?.selection) A.deselect(); else if (get().hideUI) set({ hideUI: false }); } },
  // Ayuda
  'help.about': { label: 'Acerca de KOVA Design Lab y limitaciones', run: () => openDialog('about') },
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
// Dos clases de contenido: píxeles (con una selección activa, o «Copiar combinado») y objetos
// editables (capas, grupos, textos, formas…), que se pegan como capas nuevas sin rasterizar.
let internalClip: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;
let layerClip: { clip: LayerClip; stamp: string | null; pastes: number } | null = null;
/** desplazamiento del pegado en px del documento: ~16 px de pantalla al zoom actual */
const pasteStep = () => Math.max(1, Math.round(16 / (get().views[get().activeDocId!]?.zoom ?? 1)));

async function clipboardCopy(cut: boolean, merged = false) {
  if (!merged && !docState()?.selection) return copyObjects(cut);
  const data = await A.copySelection(merged);
  if (!data) return;
  internalClip = data;
  layerClip = null;
  try {
    const blob: Blob = await new Promise(r => data.canvas.toBlob(b => r(b!), 'image/png'));
    await (navigator.clipboard as any).write([new ClipboardItem({ 'image/png': blob })]);
  } catch { /* sin permiso de portapapeles del sistema: queda el interno */ }
  if (cut) await A.deleteSelectionPixels();
  toast(cut ? 'Cortado' : 'Copiado', 'ok', 1200);
}
async function copyObjects(cut: boolean) {
  const clip = A.clipFromSelection();
  if (!clip) return;
  internalClip = null;
  layerClip = { clip, stamp: null, pastes: 0 };
  const entry = layerClip;
  // en el portapapeles del sistema queda el texto (sirve para pegarlo en otra app); al volver a
  // pegar aquí, ese mismo texto indica que lo último copiado siguen siendo estos objetos
  const text = clipText(clip);
  try { await navigator.clipboard.writeText(text); entry.stamp = text; } catch { /* sin permiso: se usa el interno */ }
  const n = clip.roots.length;
  if (cut) A.deleteSelectedLayers(n > 1 ? `Cortar ${n} objetos` : 'Cortar');
  toast(`${cut ? 'Cortado' : 'Copiado'}${n > 1 ? `: ${n} objetos` : ''}`, 'ok', 1200);
}
function pasteObjects() {
  if (!layerClip || !activeDoc()) return false;
  layerClip.pastes++;
  const roots = A.pasteClip(layerClip.clip, pasteStep() * layerClip.pastes);
  return roots.length > 0;
}
/** El evento paste trae el texto del portapapeles del sistema: si es el que dejamos al copiar
 *  objetos, se pegan esos objetos (editables). */
export function pasteObjectsIfOurs(systemText: string): boolean {
  if (!layerClip || layerClip.stamp === null || systemText !== layerClip.stamp) return false;
  return pasteObjects();
}
export async function clipboardPaste() {
  // El evento paste del documento gestiona las imágenes del sistema; aquí se usa el interno
  if (internalClip && activeDoc()) {
    const { rasterLayer } = await import('../core/doc');
    const c = internalClip;
    A.insertLayers([rasterLayer(c.canvas, 'Pegado', c.x, c.y)], 'Pegar');
    return;
  }
  if (layerClip && activeDoc()) {
    // desde el menú no hay evento paste: se comprueba si el sistema aún tiene nuestro texto
    let sys: string | null = null;
    try { sys = await navigator.clipboard.readText(); } catch { /* sin permiso de lectura */ }
    if (sys === null || layerClip.stamp === null || sys === layerClip.stamp) { pasteObjects(); return; }
  }
  try {
    const items = await (navigator.clipboard as any).read();
    for (const it of items) {
      const type = it.types.find((t: string) => t.startsWith('image/'));
      if (type) { const { pasteImageBlob } = await import('../io/fileOps'); await pasteImageBlob(await it.getType(type)); return; }
    }
  } catch { toast('Usa Ctrl/⌘+V sobre el lienzo para pegar desde el sistema', 'info'); }
}
/** Al salir de la ventana se olvidan los píxeles copiados (lo nuevo del sistema manda); los
 *  objetos se conservan porque su texto en el portapapeles dice si siguen siendo lo último. */
export function setInternalClip(v: typeof internalClip) { internalClip = v; }
/** ¿Debe gestionar ⌘V el atajo (portapapeles interno) en lugar del evento paste del sistema? */
export function hasInternalClip() { return !!internalClip || (!!layerClip && layerClip.stamp === null); }

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
  // ⌘D: con una selección de píxeles deselecciona (como siempre); si no, duplica los objetos
  if (k === 'mod+d') id = docState()?.selection ? 'sel.none' : 'edit.duplicate';
  if (!id) return false;
  const c = commands[id];
  if (c.enabled && !c.enabled()) return false;
  e.preventDefault();
  c.run();
  return true;
}
