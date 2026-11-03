// Puntos de anclaje en la interfaz del editor donde la sala activa dibuja (vía portales de React,
// que conservan el contexto de RoomProvider).
import { useSyncExternalStore } from 'react';

const slots = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(f => f()); };
export function registerSlot(name: string, el: HTMLElement | null) {
  if (el) { if (slots.get(name) === el) return; slots.set(name, el); }
  else if (slots.has(name)) slots.delete(name);
  else return;
  emit();
}
export function useSlot(name: string) {
  useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, () => version);
  return slots.get(name) ?? null;
}
