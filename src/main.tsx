import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './ui/App';
import { restoreIccProfile } from './engine/cms';
import { startAutosave } from './io/fileOps';
import { restoreFonts, subscribeFonts } from './io/fonts';
import { invalidateTextContent } from './core/render';
import { bumpRender, toast } from './core/store';
import { initStorage, onStorageBlocked } from './storage';

onStorageBlocked(() => toast('Cierra las demás pestañas de KOVA Design Lab para terminar de actualizar el almacenamiento local.', 'warn'));
initStorage().catch(e => { console.error(e); toast('El almacenamiento local no está disponible: los proyectos no se podrán guardar en este navegador.', 'error'); });
restoreIccProfile();
startAutosave();
restoreFonts();

// cuando termina de cargar una fuente, los textos que la usan se vuelven a dibujar
let fontRaf = 0;
const refreshText = () => { cancelAnimationFrame(fontRaf); fontRaf = requestAnimationFrame(() => { invalidateTextContent(); bumpRender(); }); };
document.fonts.addEventListener('loadingdone', refreshText);
subscribeFonts(refreshText);

createRoot(document.getElementById('root')!).render(<App />);
