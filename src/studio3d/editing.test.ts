import { describe, it, expect } from 'vitest';
import { inkBoxCm, align, nudge, setInkWidth, snap, measures, applyPreset, presets, type ArtInfo } from './placement';
import { UndoStack } from './history';
import { FrameGovernor, basePixelRatio, qualityScale, PIXEL_BUDGET } from './quality';
import type { ZoneDef } from './zones';
import type { ZonePrint } from '../core/garment3d';

const front: ZoneDef = { id: 'front', view: 'front', centerCm: [0, 34], sizeCm: [32, 40] };
// mesa de 20 × 20 cm con tinta solo en la mitad izquierda
const art: ArtInfo = { wCm: 20, hCm: 20, ink: [0, 0, 0.5, 1] };
const print = (p: Partial<ZonePrint> = {}): ZonePrint => ({ artboardId: 'a', x: 0.5, y: 0.5, scale: 1, rotation: 0, ...p });
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('colocación en cm', () => {
  it('mide la caja con tinta, no la mesa entera', () => {
    const b = inkBoxCm(front, print(), art);
    close(b.w, 10); close(b.h, 20);
    close(b.cx, 16 - 5); // la tinta está 5 cm a la izquierda del centro del arte
    const r = inkBoxCm(front, print({ rotation: 90 }), art);
    close(r.w, 20); close(r.h, 10);
    close(r.cy, 20 - 5); // girada 90° en sentido horario, la mitad izquierda queda arriba
  });
  it('alinea la tinta con bordes y centro del área', () => {
    const p = print();
    const left = { ...p, ...align(front, p, art, 'left', 'top') };
    const b = inkBoxCm(front, left, art);
    close(b.x0, 0); close(b.y0, 0);
    const c = { ...p, ...align(front, p, art, 'center', 'middle') };
    close(inkBoxCm(front, c, art).cx, 16);
  });
  it('desplaza en cm y cambia el ancho conservando el borde superior', () => {
    const p = print();
    close(nudge(front, p, 3.2, -4).x, 0.6); close(nudge(front, p, 3.2, -4).y, 0.4);
    const before = inkBoxCm(front, p, art);
    const q = { ...p, ...setInkWidth(front, p, art, 5) };
    close(measures(front, q, art).width, 5);
    const after = inkBoxCm(front, q, art);
    close(after.y0, before.y0); close(after.cx, before.cx);
  });
  it('ajuste magnético al centro dentro del umbral, y nada fuera de él', () => {
    const p = { ...print(), ...align(front, print(), art, 'center', null) };
    const off = { ...p, x: p.x + 0.5 / 32 }; // medio centímetro
    const s = snap(front, off, art, 0.8);
    close(inkBoxCm(front, { ...off, ...s }, art).cx, 16);
    expect(s.guides.some(g => g.axis === 'x' && g.at === 16)).toBe(true);
    const far = { ...p, x: p.x + 3 / 32 };
    expect(snap(front, far, art, 0.8).guides.filter(g => g.axis === 'x')).toHaveLength(0);
  });
  it('logo de pecho: 9 cm, a la derecha de la pantalla y dentro del área', () => {
    expect(presets(front).map(p => p.id)).toContain('leftChest');
    const q = { ...print(), ...applyPreset(front, print(), art, 'leftChest') };
    const m = measures(front, q, art), b = inkBoxCm(front, q, art);
    close(m.width, 9, 1e-4);
    expect(m.fromCenter).toBeGreaterThan(8);
    expect(b.x1).toBeLessThanOrEqual(32 + 1e-6);
    close(b.y0, 3, 1e-4);
  });
  it('las colocaciones nunca agrandan, solo reducen si no cabe', () => {
    const big: ArtInfo = { wCm: 60, hCm: 20, ink: [0, 0, 1, 1] };
    const q = applyPreset(front, print(), big, 'chest');
    expect(q.scale).toBeCloseTo(32 / 60, 6);
    expect(applyPreset(front, print({ scale: 0.3 }), art, 'center').scale).toBe(0.3);
  });
});

describe('deshacer del estudio', () => {
  it('funde los cambios seguidos del mismo control', () => {
    const h = new UndoStack<number>();
    h.record(0, 'x', 0); h.record(1, 'x', 100); h.record(2, 'x', 300);
    h.record(3, 'y', 400);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.redo(0)).toBe(3);
    expect(h.redo(3)).toBe(4);
  });
  it('un cambio nuevo borra lo que se podía rehacer; seal corta la fusión', () => {
    const h = new UndoStack<string>();
    h.record('a', 'k', 0); h.seal(); h.record('b', 'k', 10);
    expect(h.undo('c')).toBe('b');
    h.record('x');
    expect(h.canRedo).toBe(false);
  });
});

describe('calidad adaptativa', () => {
  it('baja de nivel con fotogramas lentos y no vuelve a un nivel que falló', () => {
    const g = new FrameGovernor(10);
    for (let i = 0; i < 10; i++) g.push(50);
    expect(g.level).toBe(1);
    for (let t = 0; t < 6; t++) for (let i = 0; i < 10; i++) g.push(10);
    expect(g.level).toBe(1);
  });
  it('sube cuando sobra margen y el nivel no había fallado', () => {
    const g = new FrameGovernor(10);
    g.level = 2;
    for (let t = 0; t < 3; t++) for (let i = 0; i < 10; i++) g.push(8);
    expect(g.level).toBe(1);
    expect(g.push(5000)).toBe(false); // una pausa larga no cuenta
  });
  it('limita los píxeles en reposo y nunca baja de densidad 1', () => {
    expect(basePixelRatio(2, 400, 300, 'adaptive')).toBe(2);
    const pr = basePixelRatio(2, 1600, 1200, 'adaptive');
    expect(pr * pr * 1600 * 1200).toBeLessThanOrEqual(PIXEL_BUDGET + 1);
    expect(basePixelRatio(2, 4000, 3000, 'adaptive')).toBe(1);
    expect(basePixelRatio(2, 1600, 1200, 'high')).toBe(2);
    expect(qualityScale('adaptive', 2, false)).toBe(1);
    expect(qualityScale('adaptive', 2, true)).toBe(0.5);
    expect(qualityScale('fast', 0, false)).toBe(0.5);
  });
});
