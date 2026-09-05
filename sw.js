/*
 * Service worker: faz o app abrir sem rede depois da primeira visita.
 *
 * Estrategia: responde do cache na hora e revalida por tras. O app abre
 * instantaneo mesmo no aviao, e a versao nova entra na abertura seguinte -
 * o que evita o pior defeito de service worker mal feito, que e' servir
 * codigo velho para sempre.
 *
 * Ao mexer nos arquivos abaixo, suba a VERSAO.
 */
'use strict';

var VERSAO = 'fluxo-caixa-v1';
var ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/engine.js',
  './src/app.js',
  './icones/icone-180.png',
  './icones/icone-192.png',
  './icones/icone-512.png'
];

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(VERSAO)
      .then(function (cache) { return cache.addAll(ARQUIVOS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys()
      .then(function (nomes) {
        return Promise.all(nomes.map(function (n) {
          return n === VERSAO ? null : caches.delete(n);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (evento) {
  var req = evento.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  evento.respondWith(
    caches.match(req).then(function (cacheado) {
      var rede = fetch(req).then(function (resposta) {
        if (resposta && resposta.ok) {
          var copia = resposta.clone();
          caches.open(VERSAO).then(function (cache) { cache.put(req, copia); });
        }
        return resposta;
      }).catch(function () {
        // Offline e sem cache: numa navegacao, cai para a pagina inicial.
        return cacheado || (req.mode === 'navigate' ? caches.match('./index.html') : Promise.reject());
      });
      return cacheado || rede;
    })
  );
});
