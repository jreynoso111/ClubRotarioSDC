import { createServer } from 'node:http';
const response = await fetch('https://www.clubrotariosdcolonial.org/auth/sign-in');
const policy = response.headers.get('content-security-policy');
const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
if (!nonce || !policy.includes("'strict-dynamic'")) throw Error('Production CSP must be enforced first.');
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/close') { response.end('closed'); server.close(); return; }
  if (request.method !== 'GET') { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html lang="es"><head><title>Prueba aislada de CSP</title></head><body><h1>Política CSP publicada del Club</h1><p id="allowed">Script autorizado pendiente</p><p id="blocked">Script sin nonce bloqueado</p><script nonce="${nonce}">document.getElementById('allowed').textContent='Script autorizado ejecutado';</script><script>document.getElementById('blocked').textContent='ERROR: script sin nonce ejecutado';</script></body></html>`);
});
server.listen(3012, '127.0.0.1', () => console.log('Isolated CSP browser probe: http://127.0.0.1:3012'));
setTimeout(() => server.close(), 600000).unref();
