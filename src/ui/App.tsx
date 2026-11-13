import React, { Suspense, lazy, useEffect } from 'react';

// el Estudio 3D (Three.js) solo se descarga al abrirlo
const Studio = lazy(() => import('../studio3d/Studio').then(m => ({ default: m.Studio })));
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { useStore, set, get } from '../core/store';
import { Home } from './Home';
import { Editor, useEditorKeys } from './Editor';
import { setInternalClip } from './commands';
import { CollabHost } from '../collab/ui';
import { collabPending } from '../collab/engine';
import { initFromUrl } from '../collab/rooms';
import { platform } from '../platform';

const dialogs: Record<string, React.LazyExoticComponent<any>> = {
  new: lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.NewDocDialog }))),
  'image-size': lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.ImageSizeDialog }))),
  'canvas-size': lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.CanvasSizeDialog }))),
  'modify-sel': lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.ModifySelectionDialog }))),
  'color-range': lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.ColorRangeDialog }))),
  grid: lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.GridDialog }))),
  'color-settings': lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.ColorSettingsDialog }))),
  shortcuts: lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.ShortcutsDialog }))),
  fonts: lazy(() => import('./dialogs/FontsDialog').then(m => ({ default: m.FontsDialog }))),
  about: lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.AboutDialog }))),
  outline: lazy(() => import('./dialogs/BasicDialogs').then(m => ({ default: m.OutlineDialog }))),
  export: lazy(() => import('./dialogs/ExportDialog').then(m => ({ default: m.ExportDialog }))),
  halftone: lazy(() => import('./dialogs/HalftoneDialog').then(m => ({ default: m.HalftoneDialog }))),
  'bg-remove': lazy(() => import('./dialogs/BgRemoveDialog').then(m => ({ default: m.BgRemoveDialog }))),
  vectorize: lazy(() => import('./dialogs/VectorizeDialog').then(m => ({ default: m.VectorizeDialog }))),
  underbase: lazy(() => import('./dialogs/DtfDialogs').then(m => ({ default: m.UnderbaseDialog }))),
  separations: lazy(() => import('./dialogs/DtfDialogs').then(m => ({ default: m.SeparationsDialog }))),
  preflight: lazy(() => import('./dialogs/DtfDialogs').then(m => ({ default: m.PreflightDialog }))),
  gang: lazy(() => import('./dialogs/GangSheetDialog').then(m => ({ default: m.GangSheetDialog }))),
  mockup: lazy(() => import('./dialogs/MockupDialog').then(m => ({ default: m.MockupDialog }))),
  backups: lazy(() => import('./dialogs/BackupsDialog').then(m => ({ default: m.BackupsDialog }))),
  'social-new': lazy(() => import('../social/ui/SocialNewDialog').then(m => ({ default: m.SocialNewDialog }))),
  'social-export': lazy(() => import('../social/ui/SocialExportDialog').then(m => ({ default: m.SocialExportDialog }))),
  'social-adapt': lazy(() => import('../social/ui/AdaptDialog').then(m => ({ default: m.AdaptDialog }))),
  'social-preview': lazy(() => import('../social/ui/PreviewDialog').then(m => ({ default: m.PreviewDialog }))),
  'social-batch': lazy(() => import('../social/ui/BatchDialog').then(m => ({ default: m.BatchDialog }))),
  'collab-identity': lazy(() => import('../collab/dialogs').then(m => ({ default: m.IdentityDialog }))),
};

function DialogHost() {
  const dialog = useStore(s => s.dialog);
  if (!dialog) return null;
  const C = dialogs[dialog.type];
  if (!C) return null;
  return (
    <Suspense fallback={<div className="busy"><div className="spinner" />Cargando módulo…</div>}>
      <C {...(dialog.props || {})} onClose={() => set({ dialog: null })} />
    </Suspense>
  );
}

function Toasts() {
  const toasts = useStore(s => s.toasts);
  const busy = useStore(s => s.busy);
  const icon = { ok: CheckCircle2, warn: AlertTriangle, error: XCircle, info: Info };
  return (
    <>
      {busy && <div className="busy"><div className="spinner" />{busy}</div>}
      <div className="toasts">
        {toasts.map(t => { const I = icon[t.kind]; return <div key={t.id} className={'toast ' + t.kind}><I size={14} />{t.text}</div>; })}
      </div>
    </>
  );
}

export function App() {
  const screen = useStore(s => s.screen);
  useEditorKeys();
  useEffect(() => {
    const unguard = platform.guardClose(() => get().docs.some(d => d.dirty && !d.collab) || collabPending());
    const blur = () => setInternalClip(null);
    initFromUrl();
    window.addEventListener('blur', blur);
    return () => { unguard(); window.removeEventListener('blur', blur); };
  }, []);
  return (
    <>
      {screen === 'home' ? <Home /> : screen === 'studio' ? <Suspense fallback={<div className="busy"><div className="spinner" />Cargando Estudio 3D…</div>}><Studio /></Suspense> : <Editor />}
      <DialogHost />
      <CollabHost />
      <Toasts />
    </>
  );
}
