import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './ui/App';
import { restoreIccProfile } from './engine/cms';
import { startAutosave } from './io/fileOps';
import { restoreFonts, subscribeFonts } from './io/fonts';
import { invalidateTextContent } from './core/render';
import { bumpRender } from './core/store';

restoreIccProfile();
startAutosave();
restoreFonts();

// cuando termina de cargar una fuente, los textos que la usan se vuelven a dibujar
let fontRaf = 0;
const refreshText = () => { cancelAnimationFrame(fontRaf); fontRaf = requestAnimationFrame(() => { invalidateTextContent(); bumpRender(); }); };
document.fonts.addEventListener('loadingdone', refreshText);
subscribeFonts(refreshText);

createRoot(document.getElementById('root')!).render(<App />);
