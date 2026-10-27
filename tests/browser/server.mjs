import http from 'node:http';
import fs from 'node:fs';
const module = `export class App {
  constructor() { this.coopRoom = null; }
  frameGap() { return 16; }
}
window.testApp = new App();
window.testLoop = setInterval(() => window.testApp.frameGap(), 30);`;
http.createServer((req, res) => {
  if (req.url === '/native-room.mjs') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(new URL('./native-room.mjs', import.meta.url))); return;
  }
  if (req.url === '/assets/main-fixture.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(module); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Co-op adapter browser fixture</title>
    <link rel="modulepreload" href="/assets/main-fixture.js">
    <script type="module">import '/assets/main-fixture.js'; dispatchEvent(new Event('pokebonk:modules-ready'));</script>`);
}).listen(4178, '127.0.0.1');
