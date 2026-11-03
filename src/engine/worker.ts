/// <reference lib="webworker" />
import { runAdjustment, histogram } from './pixels';
import { halftone } from './halftone';
import { colorKey, refineEdges, outline, underbase, cleanupAlpha, morphAlpha, featherAlpha, dominantColors, alphaStats, garmentKnockout } from './alpha';
import ImageTracer from 'imagetracerjs';

type Msg = { id: number; op: string; data?: Uint8ClampedArray; width: number; height: number; params: any };

self.onmessage = (e: MessageEvent<Msg>) => {
  const { id, op, data, width, height, params } = e.data;
  try {
    const img = { data: data!, width, height };
    let out: any = img;
    let result: any = undefined;
    switch (op) {
      case 'adjust':
        for (const a of params.adjustments) runAdjustment(img, a.type, a.params);
        break;
      case 'halftone': out = halftone(img, params); break;
      case 'colorKey': colorKey(img, params); break;
      case 'knockout': garmentKnockout(img, params); break;
      case 'refine': refineEdges(img, params); break;
      case 'outline': out = outline(img, params); break;
      case 'underbase': out = underbase(img, params); break;
      case 'cleanup': cleanupAlpha(img, params); break;
      case 'morph': morphAlpha(img, params.r); break;
      case 'feather': featherAlpha(img, params.r); break;
      case 'dominant': result = dominantColors(img, params.k); out = null; break;
      case 'stats': result = alphaStats(img); out = null; break;
      case 'histogram': result = histogram(img); out = null; break;
      case 'vectorize': {
        const imgd = { width, height, data };
        result = ImageTracer.imagedataToSVG(imgd, params);
        out = null;
        break;
      }
      default: throw new Error('Operación desconocida: ' + op);
    }
    if (out) (self as any).postMessage({ id, data: out.data, width: out.width, height: out.height, result }, [out.data.buffer]);
    else (self as any).postMessage({ id, result });
  } catch (err: any) {
    (self as any).postMessage({ id, error: String(err?.message || err) });
  }
};
