import { useEffect, useState } from 'react';

/** Diseño compacto: por debajo de este ancho los paneles pasan a un cajón superpuesto. */
export const COMPACT_QUERY = '(max-width: 1023px)';

export function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return match;
}
