// Controles flotantes de los modos de vista: enfoque (paneles ocultos) y presentación.

import React, { useEffect, useRef, useState } from 'react';
import { PanelsTopLeft, Maximize2, Minimize2, Presentation, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useStore, set } from '../core/store';
import { toggleFullscreen, enterPresentation, exitPresentation, presentStep } from './viewModes';

/** Con los paneles ocultos (Tab): una forma visible de volver, sin depender del teclado. */
export function FocusHud() {
  const fullscreen = useStore(s => s.fullscreen);
  return (
    <div className="view-hud focus-hud" onPointerDown={e => e.stopPropagation()} role="toolbar" aria-label="Modo enfoque">
      <button className="btn sm" onClick={() => set({ hideUI: false })} title="Mostrar menús y paneles (Tab o Esc)"><PanelsTopLeft size={13} /> Mostrar paneles</button>
      <button className="icon-btn sm" onClick={() => void toggleFullscreen()} title={fullscreen ? 'Salir de pantalla completa (⌘⇧F)' : 'Pantalla completa (⌘⇧F)'} aria-label="Pantalla completa">
        {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>
      <button className="icon-btn sm" onClick={() => void enterPresentation()} title="Presentación (⌘⌥P)" aria-label="Presentación"><Presentation size={13} /></button>
    </div>
  );
}

/** Presentación: controles mínimos que aparecen al mover el ratón y se ocultan solos. */
export function PresentHud() {
  const [shown, setShown] = useState(true);
  const timer = useRef<number>();
  const count = useStore(s => s.docs.find(d => d.id === s.activeDocId)?.state.artboards.length ?? 0);
  const index = useStore(s => {
    const d = s.docs.find(x => x.id === s.activeDocId);
    if (!d) return 0;
    const abs = [...d.state.artboards].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return abs.findIndex(a => a.id === d.state.activeArtboardId) + 1;
  });
  useEffect(() => {
    const wake = () => { setShown(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setShown(false), 2200); };
    wake();
    window.addEventListener('pointermove', wake);
    return () => { window.removeEventListener('pointermove', wake); window.clearTimeout(timer.current); };
  }, []);
  return (
    <div className={'view-hud present-hud' + (shown ? '' : ' idle')} onPointerDown={e => e.stopPropagation()} role="toolbar" aria-label="Presentación">
      {count > 1 && <>
        <button className="icon-btn sm" onClick={() => presentStep(-1)} title="Mesa anterior (←)" aria-label="Mesa anterior"><ChevronLeft size={15} /></button>
        <span className="mono small">{index} / {count}</span>
        <button className="icon-btn sm" onClick={() => presentStep(1)} title="Mesa siguiente (→)" aria-label="Mesa siguiente"><ChevronRight size={15} /></button>
        <div className="vsep" />
      </>}
      <button className="btn sm" onClick={() => void exitPresentation()} title="Salir de la presentación (Esc)"><X size={13} /> Salir</button>
    </div>
  );
}
