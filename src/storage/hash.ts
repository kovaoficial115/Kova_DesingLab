// SHA-256 en hexadecimal (Web Crypto: navegador, WKWebView y Node).

export async function sha256(data: Blob | ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data)
    : data instanceof Blob ? new Uint8Array(await data.arrayBuffer())
    : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
