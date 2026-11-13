import { describe, it, expect } from 'vitest';
import { BUILTIN_FORMATS, allFormats, findFormat, sanitizeUserFormats, safeRect, aspectLabel, toPixels, fromPixels, fileKeyFrom } from './presets';
import { exportFileName, uniqueNames, feedItems, applyPlan, sanitizeArtboardSocial, sanitizeDocSocial, seriesArtboards } from './model';
import { adaptLayout, applyPlacement, clampInto, isBackground, type AdaptItem, type Rect } from './adapt';
import { panoramaSlides, panoramaCuts, slidePositions, reorderSlides, moveItem } from './carousel';
import { checkArtboard } from './validate';
import { parseCSV, parseJSONRows, parseRows, fillVars, findVars, rowFileName } from './variables';
import type { Artboard } from '../core/types';

const ab = (id: string, preset: string | null, x = 0, y = 0, w = 1080, h = 1350, series?: any, label?: string): Artboard =>
  ({ id, name: id, x, y, w, h, dpi: 72, background: '#fff', margin: 0, social: preset ? { preset, ...(series ? { series } : {}), ...(label ? { label } : {}) } : null });
const within = (b: Rect, r: Rect, tol = 0.01) => b.x >= r.x - tol && b.y >= r.y - tol && b.x + b.w <= r.x + r.w + tol && b.y + b.h <= r.y + r.h + tol;
const covers = (b: Rect, r: Rect, tol = 0.01) => b.x <= r.x + tol && b.y <= r.y + tol && b.x + b.w >= r.x + r.w - tol && b.y + b.h >= r.y + r.h - tol;

describe('formatos', () => {
  it('tienen las medidas pedidas', () => {
    const m = (id: string) => { const f = findFormat(id)!; return `${f.w}x${f.h}`; };
    expect(m('ig-post-portrait')).toBe('1080x1350');
    expect(m('ig-post-34')).toBe('1080x1440');
    expect(m('ig-post-square')).toBe('1080x1080');
    for (const id of ['ig-story', 'ig-reel', 'ig-reel-cover', 'ig-highlight', 'tt-video', 'yt-shorts']) expect(m(id)).toBe('1080x1920');
    expect(m('yt-thumb')).toBe('1280x720');
    expect(m('yt-banner')).toBe('2560x1440');
    expect(m('pin-vertical')).toBe('1000x1500');
    expect(m('pin-square')).toBe('1000x1000');
    expect(new Set(BUILTIN_FORMATS.map(f => f.id)).size).toBe(BUILTIN_FORMATS.length);
  });

  it('las zonas seguras quedan dentro del formato', () => {
    for (const f of BUILTIN_FORMATS) {
      const r = safeRect(f);
      expect(r.w).toBeGreaterThan(0);
      expect(within(r, { x: 0, y: 0, w: f.w, h: f.h })).toBe(true);
      if (f.circle) expect(f.circle.safe).toBeLessThanOrEqual(f.circle.d);
    }
  });

  it('se editan y amplían: los cambios escalan las guías y se pueden restaurar', () => {
    const user = sanitizeUserFormats({ overrides: { 'ig-story': { w: 1440, h: 2560 }, 'no-existe': { w: 5 } }, custom: [{ id: 'user-x', name: 'Mío', w: 800, h: 600, platform: 'raro' }, { id: 'malo', w: 1, h: 1 }] });
    expect(Object.keys(user.overrides)).toEqual(['ig-story']);
    const story = allFormats(user).find(f => f.id === 'ig-story')!;
    expect([story.w, story.h]).toEqual([1440, 2560]);
    expect(story.safe!.top).toBe(Math.round(250 * 2560 / 1920));
    expect(user.custom).toHaveLength(1);
    expect(user.custom[0].platform).toBe('custom');
    expect(findFormat('user-x', user)?.name).toBe('Mío');
    expect(findFormat('ig-story')!.w).toBe(1080); // sin cambios del usuario, valores de fábrica
  });

  it('unidades y proporciones', () => {
    expect(toPixels(10, 'cm', 300)).toBe(1181);
    expect(toPixels(2, 'in', 72)).toBe(144);
    expect(toPixels(1080, 'px', 300)).toBe(1080);
    expect(fromPixels(300, 'in', 300)).toBe(1);
    expect(aspectLabel(1080, 1350)).toBe('4:5');
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectLabel(2560, 1440)).toBe('16:9');
    expect(fileKeyFrom('Colección Ñandú 2026!')).toBe('coleccion_nandu_2026');
  });
});

describe('nombres de archivo', () => {
  it('por plataforma, formato y número de diapositiva', () => {
    const f = (id: string) => findFormat(id);
    expect(exportFileName({ ab: ab('a', 'ig-post-portrait'), format: f('ig-post-portrait'), ext: 'png' })).toBe('instagram_feed_1080x1350.png');
    const s = { id: 's', kind: 'carousel', name: 'C', index: 0 };
    expect(exportFileName({ ab: ab('a', 'ig-carousel', 0, 0, 1080, 1350, s), format: f('ig-carousel'), ext: 'png', slide: 1, total: 5 })).toBe('instagram_carousel_01.png');
    expect(exportFileName({ ab: ab('a', 'ig-post-square', 0, 0, 1080, 1080, { ...s, kind: 'continuous' }), format: f('ig-post-square'), ext: 'jpg', slide: 12, total: 12 })).toBe('instagram_carousel_12.jpg');
    expect(exportFileName({ ab: ab('a', 'ig-highlight', 0, 0, 1080, 1920, { ...s, kind: 'highlights' }, 'DROP 01'), format: f('ig-highlight'), ext: 'png', slide: 2, total: 3 })).toBe('instagram_highlight_cover_02_drop_01.png');
    expect(exportFileName({ ab: { ...ab('Pecho A4', null), w: 2480, h: 3508 }, format: null, ext: 'png' })).toBe('pecho_a4_2480x3508.png');
    expect(uniqueNames(['a.png', 'a.png', 'b.png', 'a.png'])).toEqual(['a.png', 'a_2.png', 'b.png', 'a_3.png']);
  });
});

describe('modelo social', () => {
  it('sanea mesas y documento', () => {
    expect(sanitizeArtboardSocial({ preset: 'ig-story', series: { id: 's', kind: 'otro' } })).toEqual({ preset: 'ig-story' });
    expect(sanitizeArtboardSocial({ preset: '' })).toBeUndefined();
    expect(sanitizeArtboardSocial({ preset: 'x', series: { id: 's', kind: 'carousel', index: -3 } })!.series!.index).toBe(0);
    const d = sanitizeDocSocial({ profile: { username: 7 }, plans: [{ id: 'p', order: ['a', 3, 'b'] }, { nope: 1 }] })!;
    expect(d.profile.username).toBe('');
    expect(d.plans).toEqual([{ id: 'p', name: 'Plan', order: ['a', 'b'], updated: 0 }]);
  });

  it('el feed incluye publicaciones y cada carrusel una vez; no historias ni destacadas', () => {
    const s = (i: number) => ({ id: 'c', kind: 'carousel', name: 'C', index: i });
    const h = { id: 'h', kind: 'highlights', name: 'H', index: 0 };
    const abs = [ab('p1', 'ig-post-portrait'), ab('c2', 'ig-carousel', 0, 0, 1080, 1350, s(1)), ab('c1', 'ig-carousel', 0, 0, 1080, 1350, s(0)), ab('st', 'ig-story'), ab('hl', 'ig-highlight', 0, 0, 1080, 1920, h), ab('rc', 'ig-reel-cover'), ab('dtf', null)];
    expect(feedItems(abs).map(a => a.id)).toEqual(['p1', 'c1', 'rc']);
    expect(seriesArtboards(abs, 'c').map(a => a.id)).toEqual(['c1', 'c2']);
    const plan = { id: 'p', name: 'P', order: ['rc', 'p1'], updated: 0 };
    expect(applyPlan(feedItems(abs), plan).map(a => a.id)).toEqual(['c1', 'rc', 'p1']);
  });
});

describe('motor de adaptación', () => {
  const src = { x: 0, y: 0, w: 1080, h: 1350 };
  const dst = { x: 2000, y: 0, w: 1080, h: 1920 };
  const items: AdaptItem[] = [
    { id: 'bg', role: 'background', bounds: { x: 0, y: 0, w: 1080, h: 1350 } },
    { id: 'title', role: 'text', bounds: { x: 90, y: 40, w: 900, h: 160 } },
    { id: 'photo', role: 'other', bounds: { x: 140, y: 300, w: 800, h: 800 } },
  ];
  const safe = { x: 2064, y: 250, w: 952, h: 1330 };

  it('ningún modo deforma: siempre una escala uniforme', () => {
    for (const mode of ['fit', 'fill', 'crop', 'reflow', 'keep'] as const) {
      const out = adaptLayout(items, src, dst, { mode, safe });
      for (const it of items) {
        const r = applyPlacement(it.bounds, out.get(it.id)!);
        expect(r.w / r.h).toBeCloseTo(it.bounds.w / it.bounds.h, 6);
      }
    }
  });

  it('ajustar: todo cabe y el fondo cubre el formato', () => {
    const out = adaptLayout(items, src, dst, { mode: 'fit', safe });
    expect(covers(applyPlacement(items[0].bounds, out.get('bg')!), dst)).toBe(true);
    for (const id of ['title', 'photo']) expect(within(applyPlacement(items.find(i => i.id === id)!.bounds, out.get(id)!), dst)).toBe(true);
  });

  it('rellenar y reorganizar dejan los textos en la zona segura', () => {
    for (const mode of ['fill', 'reflow'] as const) {
      const out = adaptLayout(items, src, dst, { mode, safe });
      expect(within(applyPlacement(items[1].bounds, out.get('title')!), safe)).toBe(true);
      expect(covers(applyPlacement(items[0].bounds, out.get('bg')!), dst)).toBe(true);
    }
  });

  it('recortar conserva el tamaño; mantener no amplía el fondo', () => {
    const crop = adaptLayout(items, src, dst, { mode: 'crop' });
    expect(crop.get('photo')!.k).toBe(1);
    const keep = adaptLayout(items, src, dst, { mode: 'keep' });
    expect(keep.get('bg')!.k).toBe(keep.get('photo')!.k);
    expect(covers(applyPlacement(items[0].bounds, keep.get('bg')!), dst)).toBe(false);
  });

  it('de vertical a horizontal (post → miniatura de YouTube)', () => {
    const yt = { x: 0, y: 3000, w: 1280, h: 720 };
    const out = adaptLayout(items, src, yt, { mode: 'reflow', safe: { x: 51, y: 3029, w: 1178, h: 662 } });
    expect(covers(applyPlacement(items[0].bounds, out.get('bg')!), yt)).toBe(true);
    expect(within(applyPlacement(items[2].bounds, out.get('photo')!), yt)).toBe(true);
  });

  it('una imagen que sangra por el borde sigue sangrando al reorganizar', () => {
    const bleed: AdaptItem = { id: 'b', role: 'other', bounds: { x: 700, y: 400, w: 600, h: 600 } };
    const r = applyPlacement(bleed.bounds, adaptLayout([bleed], src, dst, { mode: 'reflow' }).get('b')!);
    expect(r.x + r.w).toBeGreaterThan(dst.x + dst.w);
  });

  it('clampInto reduce lo que no cabe y lo mete dentro', () => {
    const p = clampInto({ x: 0, y: 0, w: 400, h: 100 }, { k: 1, dx: -50, dy: 0 }, { x: 0, y: 0, w: 200, h: 200 });
    expect(within(applyPlacement({ x: 0, y: 0, w: 400, h: 100 }, p), { x: 0, y: 0, w: 200, h: 200 })).toBe(true);
    expect(p.k).toBeCloseTo(0.5);
    expect(isBackground({ x: -10, y: -10, w: 1100, h: 1370 }, src)).toBe(true);
    expect(isBackground({ x: 0, y: 0, w: 1080, h: 600 }, src)).toBe(false);
  });
});

describe('carruseles', () => {
  it('panorama de 5400×1350 → 5 diapositivas de 1080 cortadas exactamente', () => {
    expect(panoramaSlides(5400, 1080)).toBe(5);
    expect(panoramaSlides(5401, 1080)).toBe(6);
    expect(panoramaSlides(100000, 1080)).toBe(20);
    const cuts = panoramaCuts(5400, 1350, 1080);
    expect(cuts.map(c => c.x)).toEqual([0, 1080, 2160, 3240, 4320]);
    expect(cuts.every(c => c.w === 1080 && c.h === 1350)).toBe(true);
    expect(slidePositions(3, 1080, 100, 50, 0).map(p => p.x)).toEqual([100, 1180, 2260]);
    expect(slidePositions(3, 1080, 0, 0, 80).map(p => p.x)).toEqual([0, 1160, 2320]);
  });

  it('reordenar mueve cada diapositiva con su contenido', () => {
    const slides = [0, 1, 2].map(i => ({ id: 's' + i, x: i * 1160, y: 0, w: 1080, h: 1350 }));
    const layers = [{ id: 'a', kind: 'raster', x: 100, y: 100 }, { id: 'b', kind: 'raster', x: 1260, y: 100 }, { id: 'c', kind: 'text', x: 2420, y: 100 }];
    const bounds = (l: any) => ({ x: l.x, y: l.y, w: 200, h: 200 });
    const { positions, shifts } = reorderSlides(slides, ['s2', 's0', 's1'], layers, false, bounds);
    expect(positions.get('s2')).toEqual({ x: 0, y: 0, index: 0 });
    expect(positions.get('s0')!.x).toBe(1160);
    expect(shifts.get('c')).toEqual({ dx: -2320, dy: 0 });
    expect(shifts.get('a')).toEqual({ dx: 1160, dy: 0 });
  });

  it('en un carrusel continuo lo que cruza un corte no se mueve al reordenar', () => {
    const slides = [0, 1].map(i => ({ id: 's' + i, x: i * 1080, y: 0, w: 1080, h: 1350 }));
    const layers = [{ id: 'span', kind: 'raster', x: 900, y: 0 }, { id: 'in1', kind: 'raster', x: 1200, y: 0 }];
    const { shifts } = reorderSlides(slides, ['s1', 's0'], layers, true, (l: any) => ({ x: l.x, y: l.y, w: 400, h: 400 }));
    expect(shifts.has('span')).toBe(false);
    expect(shifts.get('in1')).toEqual({ dx: -1080, dy: 0 });
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  });
});

describe('validación', () => {
  const f = findFormat('ig-story')!;
  const base = { ab: { x: 0, y: 0, w: 1080, h: 1920, name: 'H', background: null }, format: f, scale: 1, ext: 'png' };

  it('detecta proporción, ampliaciones, texto fuera de zona segura y recortes', () => {
    const issues = checkArtboard({ ...base, layers: [
      { name: 'Titular', kind: 'text', bounds: { x: 100, y: 20, w: 800, h: 120 } },
      { name: 'Foto', kind: 'raster', bounds: { x: 0, y: 400, w: 1080, h: 1080 }, upscale: 2.2 },
      { name: 'Sello', kind: 'shape', bounds: { x: 1000, y: 900, w: 200, h: 200 } },
    ] });
    const txt = issues.map(i => i.text).join(' | ');
    expect(txt).toMatch(/zona segura.*Titular/);
    expect(txt).toMatch(/ampliadas.*Foto.*×2\.2/);
    expect(txt).toMatch(/recorta.*Sello/);
    expect(checkArtboard({ ...base, ab: { ...base.ab, h: 1350 }, layers: [] })[0].level).toBe('error');
    expect(checkArtboard({ ...base, scale: 0.5, layers: [{ name: 'x', kind: 'shape', bounds: { x: 300, y: 600, w: 10, h: 10 } }] })[0].text).toMatch(/540×960/);
  });

  it('lo que pasa a la diapositiva vecina de un carrusel continuo no es un recorte', () => {
    const issues = checkArtboard({ ...base, format: findFormat('ig-carousel')!, ab: { ...base.ab, h: 1350 }, neighbors: [{ x: 1080, y: 0, w: 1080, h: 1350 }],
      layers: [{ name: 'Panorama', kind: 'raster', bounds: { x: 500, y: 100, w: 1200, h: 600 } }] });
    expect(issues).toEqual([]);
    expect(checkArtboard({ ...base, ext: 'jpg', layers: [{ name: 'x', kind: 'shape', bounds: { x: 300, y: 600, w: 10, h: 10 } }] }).some(i => /JPEG/.test(i.text))).toBe(true);
  });
});

describe('variables', () => {
  it('CSV con comillas, separador ; y acentos en encabezados', () => {
    const rows = parseCSV('Producto;Precio;Descripción\n"Camiseta ""Drop""";$45.000;"Algodón; peinado"\nGorra;$30.000;\n');
    expect(rows).toEqual([{ producto: 'Camiseta "Drop"', precio: '$45.000', descripcion: 'Algodón; peinado' }, { producto: 'Gorra', precio: '$30.000', descripcion: '' }]);
    expect(parseCSV('a,b\n"línea 1\nlínea 2",x')[0].a).toBe('línea 1\nlínea 2');
    expect(parseCSV('solo,cabecera')).toEqual([]);
  });

  it('JSON en lista o con filas', () => {
    expect(parseJSONRows('[{"Producto":"A","precio":10}]')).toEqual([{ producto: 'A', precio: '10' }]);
    expect(parseRows('{"filas":[{"producto":"B"}]}')).toEqual([{ producto: 'B' }]);
    expect(() => parseJSONRows('{"x":1}')).toThrow(/lista/);
  });

  it('sustituye variables y deja las desconocidas', () => {
    expect(findVars('{{Producto}} a {{ precio }} {{producto}}')).toEqual(['producto', 'precio']);
    expect(fillVars('{{producto}} · {{precio}} · {{nada}}', { producto: 'Gorra', precio: '$30' })).toBe('Gorra · $30 · {{nada}}');
    expect(fillVars('{{fecha}}', {}, new Date(2026, 0, 2))).toBe(new Date(2026, 0, 2).toLocaleDateString());
    expect(fillVars('{{fecha}}', { fecha: 'mañana' })).toBe('mañana');
    expect(rowFileName({ producto: 'Camiseta Ñ 01' }, 2, 2)).toBe('03_camiseta_n_01');
  });
});

describe('exportación', () => {
  it('varias series van en carpetas del ZIP (o con su nombre delante)', async () => {
    const { itemNames } = await import('./exportSocial');
    const s1 = (i: number) => ({ id: 'a', kind: 'carousel', name: 'Drop junio', index: i });
    const s2 = (i: number) => ({ id: 'b', kind: 'continuous', name: 'Panorama', index: i });
    const items = [
      { ab: ab('1', 'ig-carousel', 0, 0, 1080, 1350, s1(0)), slide: 1, total: 2, group: 'a' },
      { ab: ab('2', 'ig-carousel', 0, 0, 1080, 1350, s1(1)), slide: 2, total: 2, group: 'a' },
      { ab: ab('3', 'ig-carousel', 0, 0, 1080, 1350, s2(0)), slide: 1, total: 1, group: 'b' },
      { ab: ab('4', 'yt-thumb', 0, 0, 1280, 720), group: '4' },
    ];
    expect(itemNames(items, 'png')).toEqual(['drop_junio/instagram_carousel_01.png', 'drop_junio/instagram_carousel_02.png', 'panorama/instagram_carousel_01.png', 'youtube_thumbnail_1280x720.png']);
    expect(itemNames(items, 'jpg', undefined, false)[2]).toBe('panorama_instagram_carousel_01.jpg');
    expect(itemNames(items.slice(0, 2), 'png')).toEqual(['instagram_carousel_01.png', 'instagram_carousel_02.png']);
  });
});
