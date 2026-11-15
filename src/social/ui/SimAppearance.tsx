import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useStore, set } from '../../core/store';
import { Seg } from '../../ui/components/controls';
import { useMedia } from '../../ui/useMedia';
import { resolveDark, SIM_APPEARANCES, type SimAppearance } from '../appearance';

/** Apariencia elegida y si se dibuja en oscuro («Sistema» sigue al equipo y cambia en vivo). */
export function useSimTheme() {
  const pref = useStore(s => s.simAppearance);
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  return { pref, dark: resolveDark(pref, systemDark), systemDark };
}

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/** Selector Claro / Oscuro / Sistema, compartido por todos los simuladores. */
export function SimAppearanceSeg() {
  const { pref, dark } = useSimTheme();
  return (
    <Seg<SimAppearance> value={pref} onChange={v => set({ simAppearance: v })}
      options={SIM_APPEARANCES.map(o => {
        const I = ICON[o.value];
        return { value: o.value, title: o.value === 'system' ? `${o.title} (ahora: ${dark ? 'oscuro' : 'claro'})` : o.title, label: <><I size={12} /> {o.label}</> };
      })} />
  );
}
