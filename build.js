#!/usr/bin/env node
/**
 * Gera dist/fluxo-caixa.html: um unico arquivo com CSS e JS embutidos.
 *
 * Serve para levar a calculadora para o celular ou para outra maquina sem
 * carregar a pasta inteira junto. Uso: node build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const raiz = __dirname;
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');

let html = ler('index.html');
const css = ler('src/styles.css');
const engine = ler('src/engine.js');
const app = ler('src/app.js');

// Fecha </script> dentro de string JS quebraria o HTML que o envolve.
const escapar = (js) => js.replace(/<\/script/gi, '<\\/script');

// O arquivo unico e' para abrir por file://, onde manifest, icones e service
// worker nao existem. Tirar os links evita 404 silencioso e um icone quebrado.
html = html.replace(
  /\n<!-- Instalacao na tela de inicio -->[\s\S]*?<meta name="theme-color"[^>]*media="\(prefers-color-scheme: dark\)">\n/,
  '\n'
);

const antes = html;
html = html.replace(
  '<link rel="stylesheet" href="src/styles.css">',
  '<style>\n' + css + '\n</style>'
);
html = html.replace(
  '<script src="src/engine.js"></script>\n<script src="src/app.js"></script>',
  '<script>\n' + escapar(engine) + '\n</script>\n<script>\n' + escapar(app) + '\n</script>'
);
if (html === antes) {
  console.error('Nada foi substituido: os marcadores do index.html mudaram?');
  process.exit(1);
}

fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
const saida = path.join(raiz, 'dist', 'fluxo-caixa.html');
fs.writeFileSync(saida, html);
console.log('Gerado ' + path.relative(raiz, saida) + ' (' + Math.round(html.length / 1024) + ' KB)');

// E tambem monta site/, a pasta publicavel. O mesmo comando serve para o CI e
// para arrastar num servico de hospedagem estatica - assim nao existe uma
// receita de montagem no workflow que ninguem consegue reproduzir na maquina.
const site = path.join(raiz, 'site');
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(site, { recursive: true });
for (const item of ['index.html', 'manifest.webmanifest', 'sw.js', 'src', 'icones', 'dist']) {
  fs.cpSync(path.join(raiz, item), path.join(site, item), { recursive: true });
}
console.log('Montado ' + path.relative(raiz, site) + '/ para publicacao');
