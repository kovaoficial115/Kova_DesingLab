// Deshacer / rehacer del Estudio 3D. Los ajustes 3D (zonas, tela, color) viven fuera del
// historial del editor 2D, así que el estudio guarda el suyo: instantáneas del estado anterior.
// Los cambios seguidos del mismo control (arrastrar un deslizador o el estampado) cuentan como
// uno solo si llegan con menos de `windowMs` entre ellos.

interface Entry<T> { value: T; key?: string; at: number }

export class UndoStack<T> {
  private past: Entry<T>[] = [];
  private future: T[] = [];
  constructor(private limit = 100, private windowMs = 700) {}

  /** Registra `prev` (el estado antes del cambio). Con la misma `key` dentro de la ventana, se funde con el anterior. */
  record(prev: T, key?: string, now = Date.now()) {
    const last = this.past[this.past.length - 1];
    this.future = [];
    if (key && last && last.key === key && now - last.at < this.windowMs) { last.at = now; return; }
    this.past.push({ value: prev, key, at: now });
    if (this.past.length > this.limit) this.past.shift();
  }

  /** Corta la fusión: el próximo cambio abre una entrada nueva aunque sea del mismo control. */
  seal() { const last = this.past[this.past.length - 1]; if (last) last.key = undefined; }

  undo(current: T): T | undefined {
    const e = this.past.pop();
    if (!e) return undefined;
    this.future.push(current);
    return e.value;
  }

  redo(current: T): T | undefined {
    if (!this.future.length) return undefined;
    const v = this.future.pop() as T;
    this.past.push({ value: current, at: 0 });
    return v;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
