import { describe, it, expect } from 'vitest';
import { parseCollabLink } from './api';
import { PUBLIC_WEB_URL } from './config';

describe('enlaces de colaboración', () => {
  it('lee invitaciones y proyectos de cualquier origen', () => {
    expect(parseCollabLink('https://kovaoficial115.github.io/Kova_DesingLab/#invite=abc123')).toEqual({ invite: 'abc123' });
    expect(parseCollabLink('  tauri://localhost/#room=kova-x1  ')).toEqual({ room: 'kova-x1' });
    expect(parseCollabLink('invite=tok')).toEqual({ invite: 'tok' });
    expect(parseCollabLink('https://example.com/')).toBeNull();
    expect(parseCollabLink('')).toBeNull();
  });
  it('la versión web pública termina en barra', () => {
    expect(PUBLIC_WEB_URL).toBe('https://kovaoficial115.github.io/Kova_DesingLab/');
  });
});
