import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './ui/App';
import { restoreIccProfile } from './engine/cms';
import { startAutosave } from './io/fileOps';

restoreIccProfile();
startAutosave();

createRoot(document.getElementById('root')!).render(<App />);
