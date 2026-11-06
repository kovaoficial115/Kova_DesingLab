import { describe, it, expect } from 'vitest';
import { sha256 } from './hash';

describe('sha256', () => {
  it('coincide con el valor de referencia y no depende del tipo de entrada', async () => {
    const ref = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256('abc')).toBe(ref);
    expect(await sha256(new TextEncoder().encode('abc'))).toBe(ref);
    expect(await sha256(new Blob(['abc']))).toBe(ref);
  });
});
