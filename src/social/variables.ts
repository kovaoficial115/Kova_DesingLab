// Plantillas con {{variables}}: lectura de CSV/JSON y sustitución (funciones puras).

export type Row = Record<string, string>;

/** Variables reconocidas de forma especial: {{fecha}} se rellena sola si la fila no la trae. */
export const BUILTIN_VARS = ['producto', 'precio', 'descripcion', 'coleccion', 'imagen', 'fecha'];

const VAR_RE = /\{\{\s*([\p{L}\p{N}_.-]+)\s*\}\}/gu;

export const normKey = (k: string) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, '_');

/** Nombres de variable que aparecen en un texto (normalizados, sin repetir). */
export function findVars(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) out.add(normKey(m[1]));
  return [...out];
}

export function hasVars(text: string) { VAR_RE.lastIndex = 0; return /\{\{\s*[\p{L}\p{N}_.-]+\s*\}\}/u.test(text); }

/** Sustituye {{variables}} por los valores de la fila. Las desconocidas se dejan tal cual. */
export function fillVars(text: string, row: Row, now = new Date()): string {
  return text.replace(VAR_RE, (m, k) => {
    const key = normKey(k);
    if (key in row) return row[key];
    if (key === 'fecha') return now.toLocaleDateString();
    return m;
  });
}

/** CSV (coma, punto y coma o tabulador; comillas dobles con "" escapadas; saltos dentro de comillas). */
export function parseCSV(src: string): Row[] {
  const text = src.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => first.split(c).length - 1;
  const sep = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const head = rows[0].map(h => normKey(h));
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** JSON: una lista de objetos o { filas: [...] } / { rows: [...] } / { items: [...] }. */
export function parseJSONRows(src: string): Row[] {
  let v: any;
  try { v = JSON.parse(src); } catch { throw new Error('El JSON no es válido.'); }
  const list = Array.isArray(v) ? v : Array.isArray(v?.filas) ? v.filas : Array.isArray(v?.rows) ? v.rows : Array.isArray(v?.items) ? v.items : null;
  if (!list) throw new Error('El JSON debe ser una lista de objetos.');
  return list.filter((o: any) => o && typeof o === 'object' && !Array.isArray(o)).map((o: any) =>
    Object.fromEntries(Object.entries(o).map(([k, val]) => [normKey(k), val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)])));
}

/** Lee datos por su contenido (o por la extensión del archivo). */
export function parseRows(src: string, filename = ''): Row[] {
  const t = src.trim();
  if (/\.json$/i.test(filename) || t.startsWith('[') || t.startsWith('{')) return parseJSONRows(t);
  return parseCSV(src);
}

/** Nombre de archivo para una fila: el primer valor útil (producto, nombre…) o el número. */
export function rowFileName(row: Row, i: number, digits: number) {
  const base = row.producto || row.nombre || row.name || row.titulo || '';
  const slug = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `${String(i + 1).padStart(digits, '0')}${slug ? '_' + slug : ''}`;
}
