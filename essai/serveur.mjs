// Sert essai/index.html sur http://localhost:3000, l'origine autorisée pour les essais.
//   node essai/serveur.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./index.html', import.meta.url));
createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
}).listen(3000, 'localhost', () => console.log('Essai sur http://localhost:3000'));
