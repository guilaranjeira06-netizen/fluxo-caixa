/*
 * Gera os PNGs do icone a partir de icone.svg.
 *
 * Os PNGs estao versionados, entao isto so' precisa rodar quando o desenho
 * mudar. Precisa do Playwright e de um Chromium:
 *
 *   npm install --no-save playwright
 *   node icones/gerar.js
 *
 * Ajuste executablePath se o seu Chromium estiver em outro lugar.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icone.svg'), 'utf8');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const tamanho of [180, 192, 512]) {
    const p = await b.newPage({ viewport: { width: tamanho, height: tamanho } });
    await p.setContent(`<style>html,body{margin:0;padding:0}svg{display:block;width:${tamanho}px;height:${tamanho}px}</style>${svg}`);
    await p.screenshot({ path: path.join(__dirname, `icone-${tamanho}.png`), omitBackground: false });
    await p.close();
    console.log('icone-' + tamanho + '.png');
  }
  await b.close();
})();
