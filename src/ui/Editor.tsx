import { presentationKey } from './viewModes';
import { FocusHud, PresentHud } from './ViewHud';
import React, { useEffect } from 'react';
import { useStore, get, set, activeDoc } from '../core/store';
import { MenuBar } from './MenuBar';
import { ToolRail, OptionsBar, DocTabs, QuickBar, ZoomHud, StatusBar } from './Chrome';
import { Viewport, keys } from './Viewport';
import { Dock } from './panels/Dock';
import { handleShortcut, hasInternalClip, pasteObjectsIfOurs } from './commands';
import { nudge } from '../core/actions';
import { pasteImageBlob, pasteSvgText } from '../io/fileOps';
import { isDragging } from '../tools/tools';
import { useMedia, COMPACT_QUERY } from './useMedia';

function isTyping(e: Event) {
  const t = e.target as HTMLElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function useEditorKeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || get().dialog) return;
      if (get().screen !== 'editor') return;
      if (presentationKey(e)) return;
      if (e.code === 'Space' && !e.repeat) { keys.space = true; const el = document.getElementById('kova-viewport'); if (el) el.style.cursor = 'grab'; e.preventDefault(); return; }
      if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey && activeDoc()?.state.selectedLayerIds.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); set(s => ({ hideUI: !s.hideUI })); return; }
      // O mantenida: ver las capas seleccionadas sin efectos (antes/después momentáneo)
      if (e.key.toLowerCase() === 'o' && !e.metaKey && !e.ctrlKey && !e.altKey) { if (!e.repeat) set({ peekOriginal: true }); e.preventDefault(); return; }
      if (isDragging()) return;
      // Ctrl/⌘+V lo gestiona el evento paste (imágenes del sistema) salvo que haya portapapeles interno
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && !hasInternalClip()) return;
      handleShortcut(e);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { keys.space = false; const el = document.getElementById('kova-viewport'); if (el) el.style.cursor = ''; }
      if (e.key.toLowerCase() === 'o' && get().peekOriginal) set({ peekOriginal: false });
    };
    const paste = async (e: ClipboardEvent) => {
      if (isTyping(e) || get().screen !== 'editor' && get().docs.length) return;
      // objetos copiados en KOVA (texto editable, formas, grupos…): el sistema guarda su texto
      if (pasteObjectsIfOurs(e.clipboardData?.getData('text/plain') ?? '')) { e.preventDefault(); return; }
      const items = Array.from(e.clipboardData?.items || []);
      const img = items.find(i => i.type.startsWith('image/'));
      if (img) { e.preventDefault(); const f = img.getAsFile(); if (f) await pasteImageBlob(f); return; }
      const text = e.clipboardData?.getData('text/plain') || '';
      if (text.trim().startsWith('<svg')) { e.preventDefault(); pasteSvgText(text); return; }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const blur = () => { if (get().peekOriginal) set({ peekOriginal: false }); };
    window.addEventListener('blur', blur);
    window.addEventListener('paste', paste);
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('paste', paste); };
  }, []);
}

export function Editor() {
  const doc = useStore(s => s.docs.find(d => d.id === s.activeDocId));
  const hideUI = useStore(s => s.hideUI);
  const dockOpen = useStore(s => s.dockOpen);
  const compact = useMedia(COMPACT_QUERY);
  // al volver a pantalla ancha el cajón deja de tener sentido
  useEffect(() => { if (!compact && get().dockOpen) set({ dockOpen: false }); }, [compact]);
  const presenting = useStore(s => s.presenting);
  const showDock = !hideUI && !!doc;
  if (presenting && doc) {
    // presentación: solo el diseño a toda la ventana (sin menús, paneles, reglas ni guías)
    return (
      <div className="app presenting">
        <div className="stage"><Viewport key={doc.id} doc={doc} /></div>
        <PresentHud />
      </div>
    );
  }
  return (
    <div className={'app' + (hideUI ? ' hide-ui' : '') + (compact ? ' compact' : '')}>
      <MenuBar compact={compact} />
      {!hideUI ? <OptionsBar /> : <div />}
      <div className="workspace" style={hideUI ? { gridTemplateColumns: '0 1fr 0', gap: 0 } : undefined}>
        {!hideUI ? <ToolRail /> : <div />}
        <div className="center">
          <DocTabs />
          {doc ? (
            <div className="stage">
              <Viewport key={doc.id} doc={doc} />
              {!hideUI && <QuickBar />}
              {hideUI && <FocusHud />}
              <ZoomHud />
            </div>
          ) : <div className="muted" style={{ display: 'grid', placeItems: 'center' }}>Abre o crea un documento</div>}
        </div>
        {compact ? (
          showDock && <>
            {dockOpen && <div className="dock-scrim" onPointerDown={() => set({ dockOpen: false })} />}
            <Dock doc={doc!} drawer open={dockOpen} />
          </>
        ) : showDock ? <Dock doc={doc!} /> : <div />}
      </div>
      <StatusBar />
    </div>
  );
}
