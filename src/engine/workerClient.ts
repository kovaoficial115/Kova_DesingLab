// Pool de Web Workers para procesamiento pesado sin bloquear la interfaz.

type Pending = { resolve: (v: any) => void; reject: (e: any) => void };
interface W { worker: Worker; busy: number }

const pool: W[] = [];
const pending = new Map<number, Pending>();
let nextId = 1;

function getWorker(): W {
  if (!pool.length) {
    const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) >> 1));
    for (let i = 0; i < n; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const w: W = { worker, busy: 0 };
      worker.onmessage = (e: MessageEvent) => {
        const { id, error } = e.data;
        const p = pending.get(id);
        pending.delete(id);
        w.busy--;
        if (!p) return;
        if (error) p.reject(new Error(error));
        else p.resolve(e.data);
      };
      worker.onerror = (e) => console.error('Worker error', e);
      pool.push(w);
    }
  }
  return pool.reduce((a, b) => (b.busy < a.busy ? b : a));
}

export interface WorkerResult { image?: ImageData; result?: any }

export function runOp(op: string, img: ImageData | null, params: any = {}): Promise<WorkerResult> {
  const w = getWorker();
  const id = nextId++;
  w.busy++;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (d: any) => resolve({ image: d.data ? new ImageData(d.data, d.width, d.height) : undefined, result: d.result }),
      reject,
    });
    if (img) {
      const data = new Uint8ClampedArray(img.data); // copia: el original sigue siendo válido
      w.worker.postMessage({ id, op, data, width: img.width, height: img.height, params }, [data.buffer]);
    } else w.worker.postMessage({ id, op, width: 0, height: 0, params });
  });
}
