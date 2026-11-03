import React, { useEffect } from 'react';
import { useStore, get, set, activeDoc } from '../core/store';
import { MenuBar } from './MenuBar';
import { ToolRail, OptionsBar, DocTabs, QuickBar, ZoomHud, StatusBar } from './Chrome';
import { Viewport, keys } from './Viewport';
import { Dock } from './panels/Dock';
import { handleShortcut, hasInternalClip } from './commands';
import { nudge } from '../core/actions';
import { pasteImageBlob, pasteSvgText } from '../io/fileOps';
import { isDragging } from '../tools/tools';

function isTyping(e: Event) {
  const t = e.target as HTMLElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function useEditorKeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || get().dialog) return;
      if (get().screen !== 'editor') return;
      if (e.code === 'Space' && !e.repeat) { keys.space = true; const el = document.getElementById('kova-viewport'); if (el) el.style.cursor = 'grab'; e.preventDefault(); return; }
      if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey && activeDoc()?.state.selectedLayerIds.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); set(s => ({ hideUI: !s.hideUI })); return; }
      if (isDragging()) return;
      // Ctrl/⌘+V lo gestiona el evento paste (imágenes del sistema) salvo que haya portapapeles interno
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && !hasInternalClip()) return;
      handleShortcut(e);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { keys.space = false; const el = document.getElementById('kova-viewport'); if (el) el.style.cursor = ''; }
    };
    const paste = async (e: ClipboardEvent) => {
      if (isTyping(e) || get().screen !== 'editor' && get().docs.length) return;
      const items = Array.from(e.clipboardData?.items || []);
      const img = items.find(i => i.type.startsWith('image/'));
      if (img) { e.preventDefault(); const f = img.getAsFile(); if (f) await pasteImageBlob(f); return; }
      const text = e.clipboardData?.getData('text/plain') || '';
      if (text.trim().startsWith('<svg')) { e.preventDefault(); pasteSvgText(text); return; }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('paste', paste);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('paste', paste); };
  }, []);
}

export function Editor() {
  const doc = useStore(s => s.docs.find(d => d.id === s.activeDocId));
  const hideUI = useStore(s => s.hideUI);
  return (
    <div className={'app' + (hideUI ? ' hide-ui' : '')}>
      <MenuBar />
      {!hideUI ? <OptionsBar /> : <div />}
      <div className="workspace" style={hideUI ? { gridTemplateColumns: '0 1fr 0', gap: 0 } : undefined}>
        {!hideUI ? <ToolRail /> : <div />}
        <div className="center">
          <DocTabs />
          {doc ? (
            <div className="stage">
              <Viewport key={doc.id} doc={doc} />
              {!hideUI && <QuickBar />}
              <ZoomHud />
            </div>
          ) : <div className="muted" style={{ display: 'grid', placeItems: 'center' }}>Abre o crea un documento</div>}
        </div>
        {!hideUI && doc ? <Dock doc={doc} /> : <div />}
      </div>
      <StatusBar />
    </div>
  );
}
