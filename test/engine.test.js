'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');

const cal = E.criarCalendario({});

function ctxDe({ saldo, inicio, fim, lancamentos, piso = -200000, maxDias = 10 }) {
  return E.criarContexto({
    saldoInicialCentavos: E.paraCentavos(saldo),
    diaInicio: E.isoParaDia(inicio),
    diaFim: E.isoParaDia(fim),
    lancamentos,
    restricoes: { pisoCentavos: piso, maxDiasNegativos: maxDias }
  });
}

function lanc(iso, valor, nome) {
  return { dia: E.isoParaDia(iso), iso, nome: nome || 'x', centavos: E.paraCentavos(valor) };
}

test('paraCentavos aceita pt-BR, ingles e numero', () => {
  assert.strictEqual(E.paraCentavos(1234.56), 123456);
  assert.strictEqual(E.paraCentavos('1.234,56'), 123456);
  assert.strictEqual(E.paraCentavos('R$ 1.234,56'), 123456);
  assert.strictEqual(E.paraCentavos('1234.56'), 123456);
  assert.strictEqual(E.paraCentavos('1,5'), 150);
  assert.strictEqual(E.paraCentavos(''), 0);
  assert.strictEqual(E.paraCentavos(0.1 + 0.2), 30); // sem lixo de float
});

test('formatarBRL', () => {
  assert.strictEqual(E.formatarBRL(123456), 'R$ 1.234,56');
  assert.strictEqual(E.formatarBRL(-500), '-R$ 5,00');
  assert.strictEqual(E.formatarBRL(0), 'R$ 0,00');
});

test('Pascoa em anos conhecidos', () => {
  assert.strictEqual(E.diaParaIso(E.domingoDePascoa(2024)), '2024-03-31');
  assert.strictEqual(E.diaParaIso(E.domingoDePascoa(2025)), '2025-04-20');
  assert.strictEqual(E.diaParaIso(E.domingoDePascoa(2026)), '2026-04-05');
  assert.strictEqual(E.diaParaIso(E.domingoDePascoa(2027)), '2027-03-28');
});

test('feriados moveis derivados da Pascoa de 2026', () => {
  const f = E.feriadosDoAno(2026, {});
  assert.ok(f.has('2026-02-16'), 'carnaval segunda');
  assert.ok(f.has('2026-02-17'), 'carnaval terca');
  assert.ok(f.has('2026-04-03'), 'sexta-feira santa');
  assert.ok(f.has('2026-06-04'), 'corpus christi');
  assert.ok(f.has('2026-11-20'), 'consciencia negra');
  assert.ok(f.has('2026-12-24') && f.has('2026-12-31'), 'fechamento bancario');
});

test('dia util ignora fim de semana e feriado', () => {
  assert.strictEqual(cal.ehUtil(E.isoParaDia('2026-09-05')), false); // sabado
  assert.strictEqual(cal.ehUtil(E.isoParaDia('2026-09-07')), false); // Independencia (segunda)
  assert.strictEqual(cal.ehUtil(E.isoParaDia('2026-09-08')), true);
});

test('5o dia util pula o feriado da Independencia em setembro/2026', () => {
  // set/2026: 1 ter, 2 qua, 3 qui, 4 sex, 7 feriado, 8 ter -> 5o util = dia 8
  const d = cal.nEsimoDiaUtil(2026, 9, 5);
  assert.strictEqual(E.diaParaIso(d), '2026-09-08');
});

test('5o dia util em um mes sem feriado', () => {
  // out/2026: 1 qui, 2 sex, 5 seg, 6 ter, 7 qua -> 5o util = dia 7
  assert.strictEqual(E.diaParaIso(cal.nEsimoDiaUtil(2026, 10, 5)), '2026-10-07');
});

test('ultimo dia util de maio/2026 nao cai no fim de semana', () => {
  // 31/05/2026 e' domingo, 30 sabado -> 29 (sexta)
  assert.strictEqual(E.diaParaIso(cal.ultimoDiaUtil(2026, 5)), '2026-05-29');
});

test('ajuste "anterior" antecipa dia nao util', () => {
  // 19/09/2026 e' sabado -> anterior util = sexta 18
  const d = cal.ajustar(E.isoParaDia('2026-09-19'), 'anterior');
  assert.strictEqual(E.diaParaIso(d), '2026-09-18');
});

test('ajuste "seguinte" adia dia nao util', () => {
  const d = cal.ajustar(E.isoParaDia('2026-09-19'), 'seguinte');
  assert.strictEqual(E.diaParaIso(d), '2026-09-21'); // segunda
});

test('dia fixo 31 nao some em fevereiro', () => {
  const regra = { tipo: 'saida', agenda: { tipo: 'diaFixo', dia: 31 }, ajuste: 'nenhum' };
  assert.strictEqual(E.diaParaIso(E.dataDaRegraNoMes(regra, 2026, 2, cal)), '2026-02-28');
});

test('expandirRegras respeita vigencia e override mensal', () => {
  const regras = [{
    id: 'r1', nome: 'Salario', tipo: 'entrada', valor: 5000,
    agenda: { tipo: 'diaUtil', n: 5 },
    vigenciaInicio: '2026-10', vigenciaFim: '2026-11',
    valoresPorMes: { '2026-11': 7000 }
  }];
  const ls = E.expandirRegras(regras, E.isoParaDia('2026-09-01'), E.isoParaDia('2026-12-31'), cal);
  assert.strictEqual(ls.length, 2);
  assert.strictEqual(ls[0].iso, '2026-10-07');
  assert.strictEqual(ls[0].centavos, 500000);
  assert.strictEqual(ls[1].iso, '2026-11-09'); // 5o util de nov/2026: Finados (seg 02) empurra
  assert.strictEqual(ls[1].centavos, 700000);
});

test('regra inativa nao gera lancamento', () => {
  const regras = [{ id: 'r', nome: 'x', tipo: 'saida', valor: 100, ativo: false, agenda: { tipo: 'diaFixo', dia: 10 } }];
  assert.strictEqual(E.expandirRegras(regras, E.isoParaDia('2026-09-01'), E.isoParaDia('2026-10-31'), cal).length, 0);
});

test('regra unica so aparece na sua data', () => {
  const regras = [{ id: 'u', nome: 'Reembolso', tipo: 'entrada', valor: 800, agenda: { tipo: 'unica', data: '2026-09-22' } }];
  const ls = E.expandirRegras(regras, E.isoParaDia('2026-09-01'), E.isoParaDia('2026-12-31'), cal);
  assert.deepStrictEqual(ls.map((l) => l.iso), ['2026-09-22']);
  assert.strictEqual(ls[0].centavos, 80000);
});

test('projecao acumula saldo dia a dia', () => {
  const p = E.projetar({
    saldoInicialCentavos: E.paraCentavos(1000),
    diaInicio: E.isoParaDia('2026-09-01'),
    diaFim: E.isoParaDia('2026-09-05'),
    lancamentos: [lanc('2026-09-02', -300), lanc('2026-09-04', 500)]
  });
  assert.deepStrictEqual(p.dias.map((d) => d.saldo), [100000, 70000, 70000, 120000, 120000]);
});

test('avaliar detecta furo do piso', () => {
  const p = E.projetar({
    saldoInicialCentavos: 0, diaInicio: E.isoParaDia('2026-09-01'), diaFim: E.isoParaDia('2026-09-03'),
    lancamentos: [lanc('2026-09-02', -3000), lanc('2026-09-03', 3000)]
  });
  const a = E.avaliar(p, { pisoCentavos: -200000, maxDiasNegativos: 10 });
  assert.ok(a.furoPiso, 'deveria furar o piso de -2000');
  assert.strictEqual(a.furoPiso.iso, '2026-09-02');
});

test('avaliar conta dias corridos negativos e nao os soma entre sequencias', () => {
  // negativo 01-03, positivo 04, negativo 05-07: duas sequencias de 3, nao uma de 6
  const p = E.projetar({
    saldoInicialCentavos: E.paraCentavos(-10),
    diaInicio: E.isoParaDia('2026-09-01'), diaFim: E.isoParaDia('2026-09-08'),
    lancamentos: [lanc('2026-09-04', 20), lanc('2026-09-05', -20), lanc('2026-09-08', 20)]
  });
  const a = E.avaliar(p, { pisoCentavos: -1000000, maxDiasNegativos: 4 });
  assert.strictEqual(a.piorCorrida, 3);
  assert.strictEqual(a.estouroCorrida, null);
  assert.strictEqual(a.ok, true);
});

test('sequencia negativa maior que o limite reprova', () => {
  const p = E.projetar({
    saldoInicialCentavos: E.paraCentavos(-10),
    diaInicio: E.isoParaDia('2026-09-01'), diaFim: E.isoParaDia('2026-09-20'),
    lancamentos: [lanc('2026-09-13', 20)]
  });
  // negativo de 01 a 12 = 12 dias corridos, limite 10
  const a = E.avaliar(p, { pisoCentavos: -1000000, maxDiasNegativos: 10 });
  assert.strictEqual(a.piorCorrida, 12);
  assert.ok(a.estouroCorrida);
  assert.strictEqual(a.ok, false);
});

test('sequencia ainda aberta no fim da projecao e tratada como violacao', () => {
  const p = E.projetar({
    saldoInicialCentavos: E.paraCentavos(-10),
    diaInicio: E.isoParaDia('2026-09-01'), diaFim: E.isoParaDia('2026-09-03'),
    lancamentos: []
  });
  const a = E.avaliar(p, { pisoCentavos: -1000000, maxDiasNegativos: 10 });
  assert.ok(a.sequenciaAberta, 'sequencia aberta deve ser sinalizada');
  assert.strictEqual(a.ok, false);
});

test('maximo retiravel respeita o piso quando nao ha entrada futura', () => {
  const ctx = ctxDe({
    saldo: 5000, inicio: '2026-09-01', fim: '2026-09-30',
    lancamentos: [lanc('2026-09-30', 10)], // termina positivo
    piso: 0, maxDias: 10
  });
  const r = E.maximoRetiravel(ctx, E.isoParaDia('2026-09-01'), []);
  assert.strictEqual(r.centavos, 500000); // pode zerar a conta, piso = 0
});

test('sem poder ficar negativo, a saida futura trava a retirada', () => {
  const ctx = ctxDe({
    saldo: 5000, inicio: '2026-09-01', fim: '2026-09-30',
    lancamentos: [lanc('2026-09-10', -2000)],
    piso: 0, maxDias: 10
  });
  const r = E.maximoRetiravel(ctx, E.isoParaDia('2026-09-01'), []);
  assert.strictEqual(r.centavos, 300000); // 5000 - 2000
});

test('a franquia de dias negativos libera retirada extra', () => {
  // Sai 2000 no dia 10, entra 2000 no dia 15: 5 dias negativos, dentro da franquia.
  const base = {
    saldo: 5000, inicio: '2026-09-01', fim: '2026-10-31',
    lancamentos: [lanc('2026-09-10', -2000), lanc('2026-09-15', 2000)]
  };
  const conservador = E.maximoRetiravel(ctxDe({ ...base, piso: 0, maxDias: 0 }), E.isoParaDia('2026-09-01'), []);
  const comFranquia = E.maximoRetiravel(ctxDe({ ...base, piso: -200000, maxDias: 10 }), E.isoParaDia('2026-09-01'), []);
  assert.strictEqual(conservador.centavos, 300000); // preso ao vale de 3000
  assert.strictEqual(comFranquia.centavos, 500000); // pode mergulhar ate -2000
  assert.ok(comFranquia.centavos > conservador.centavos);
});

test('a franquia so vale se o negativo fechar dentro do prazo', () => {
  // Mesmo vale, mas a entrada so' chega 20 dias depois: 20 > 10, franquia inutil.
  const ctx = ctxDe({
    saldo: 5000, inicio: '2026-09-01', fim: '2026-10-31',
    lancamentos: [lanc('2026-09-10', -2000), lanc('2026-09-30', 2000)],
    piso: -200000, maxDias: 10
  });
  const r = E.maximoRetiravel(ctx, E.isoParaDia('2026-09-01'), []);
  assert.strictEqual(r.centavos, 300000); // nao pode usar o negativo
});

test('a retirada maxima e exata: um centavo a mais ja quebra', () => {
  const ctx = ctxDe({
    saldo: 5000, inicio: '2026-09-01', fim: '2026-10-31',
    lancamentos: [lanc('2026-09-10', -2000), lanc('2026-09-15', 2000)],
    piso: -200000, maxDias: 10
  });
  const dia = E.isoParaDia('2026-09-01');
  const max = E.maximoRetiravel(ctx, dia, []).centavos;
  const ok = E.avaliar(E.projetarComRetiradas(ctx, [{ dia, centavos: max }]), ctx.restricoes).ok;
  const quebra = E.avaliar(E.projetarComRetiradas(ctx, [{ dia, centavos: max + 1 }]), ctx.restricoes).ok;
  assert.strictEqual(ok, true);
  assert.strictEqual(quebra, false);
});

test('fluxo que ja nao fecha sozinho devolve zero e sinaliza', () => {
  const ctx = ctxDe({
    saldo: 0, inicio: '2026-09-01', fim: '2026-10-31',
    lancamentos: [lanc('2026-09-10', -9000)],
    piso: -200000, maxDias: 10
  });
  const r = E.maximoRetiravel(ctx, E.isoParaDia('2026-09-01'), []);
  assert.strictEqual(r.centavos, 0);
  assert.strictEqual(r.viavelSemRetirada, false);
  assert.ok(r.avaliacaoBase.furoPiso);
});

test('plano de aportes nunca quebra as restricoes no conjunto', () => {
  const lancamentos = [
    lanc('2026-09-08', 9000, 'Salario'), lanc('2026-09-10', -3500, 'Boletos'),
    lanc('2026-09-15', 2000, 'Extra'), lanc('2026-09-18', -1500, 'Pagamento'),
    lanc('2026-10-07', 9000, 'Salario'), lanc('2026-10-09', -3500, 'Boletos'),
    lanc('2026-10-15', 2000, 'Extra'), lanc('2026-10-19', -1500, 'Pagamento'),
    lanc('2026-11-06', 9000, 'Salario')
  ];
  const ctx = ctxDe({ saldo: 4000, inicio: '2026-09-05', fim: '2026-11-10', lancamentos, piso: -200000, maxDias: 10 });
  const candidatos = [ctx.diaInicio].concat(lancamentos.filter((l) => l.centavos > 0).map((l) => l.dia));
  const plano = E.planoDeAportes(ctx, candidatos, 0);
  assert.ok(plano.linhas.length > 0, 'deveria sobrar algo para investir');
  const a = E.avaliar(E.projetarComRetiradas(ctx, plano.retiradas), ctx.restricoes);
  assert.strictEqual(a.ok, true, 'o plano inteiro tem que ser viavel');
  // E' maximal: um centavo a mais em qualquer linha quebra.
  for (let i = 0; i < plano.retiradas.length; i++) {
    const mexido = plano.retiradas.map((r, j) => (j === i ? { dia: r.dia, centavos: r.centavos + 1 } : r));
    assert.strictEqual(
      E.avaliar(E.projetarComRetiradas(ctx, mexido), ctx.restricoes).ok, false,
      'linha ' + i + ' deveria estar no limite'
    );
  }
});

test('plano respeita aporte minimo', () => {
  const lancamentos = [lanc('2026-09-08', 100, 'Pinga'), lanc('2026-09-20', 9000, 'Salario')];
  const ctx = ctxDe({ saldo: 100, inicio: '2026-09-05', fim: '2026-11-30', lancamentos, piso: 0, maxDias: 0 });
  const candidatos = [E.isoParaDia('2026-09-08'), E.isoParaDia('2026-09-20')];
  const plano = E.planoDeAportes(ctx, candidatos, E.paraCentavos(500));
  assert.ok(plano.linhas.every((l) => l.centavos >= 50000));
});

test('retirar cedo reduz o que sobra depois (o plano e coerente no tempo)', () => {
  const lancamentos = [lanc('2026-09-20', 3000, 'Salario'), lanc('2026-09-25', -1000, 'Conta')];
  const ctx = ctxDe({ saldo: 2000, inicio: '2026-09-05', fim: '2026-11-30', lancamentos, piso: 0, maxDias: 0 });
  const d1 = E.isoParaDia('2026-09-05');
  const d2 = E.isoParaDia('2026-09-20');
  const sozinhoDepois = E.maximoRetiravel(ctx, d2, []).centavos;
  const cedo = E.maximoRetiravel(ctx, d1, []).centavos;
  const depoisDeTirarCedo = E.maximoRetiravel(ctx, d2, [{ dia: d1, centavos: cedo }]).centavos;
  assert.strictEqual(cedo + depoisDeTirarCedo, sozinhoDepois);
});

test('nao da para investir dinheiro que nao esta na conta', () => {
  // Saldo 4200, franquia de -2000. Sem a trava, o solver liberaria 5700 -
  // financiando o aporte com cheque especial.
  const ctx = ctxDe({
    saldo: 4200, inicio: '2026-09-05', fim: '2027-01-31',
    lancamentos: [lanc('2026-10-07', 8500, 'Salario')],
    piso: -200000, maxDias: 10
  });
  const r = E.maximoRetiravel(ctx, E.isoParaDia('2026-09-05'), []);
  assert.strictEqual(r.centavos, 420000);
  assert.strictEqual(r.trava, 'saldo');
});

test('a trava do saldo tambem vale para as datas seguintes do plano', () => {
  const lancamentos = [lanc('2026-09-08', 8500, 'Salario'), lanc('2026-10-07', 8500, 'Salario')];
  const ctx = ctxDe({ saldo: 4200, inicio: '2026-09-05', fim: '2027-01-31', lancamentos, piso: -200000, maxDias: 10 });
  const plano = E.planoDeAportes(ctx, [ctx.diaInicio].concat(lancamentos.map((l) => l.dia)), 0);
  const projecao = E.projetarComRetiradas(ctx, plano.retiradas);
  for (const linha of plano.linhas) {
    const antes = projecao.dias.find((d) => d.dia === linha.dia);
    // Saldo pos-aporte nunca pode ficar negativo por causa do proprio aporte.
    assert.ok(antes.saldo + antes.saidas >= 0, 'aporte em ' + linha.iso + ' excedeu o disponivel');
  }
  assert.strictEqual(E.avaliar(projecao, ctx.restricoes).ok, true);
});

test('o motivo da trava distingue saldo de fluxo futuro', () => {
  const porFluxo = ctxDe({
    saldo: 10000, inicio: '2026-09-05', fim: '2026-12-31',
    lancamentos: [lanc('2026-09-10', -9000, 'Boletos'), lanc('2026-12-01', 20000, 'Salario')],
    piso: 0, maxDias: 0
  });
  const r = E.maximoRetiravel(porFluxo, E.isoParaDia('2026-09-05'), []);
  assert.strictEqual(r.trava, 'fluxo');
  assert.strictEqual(r.centavos, 100000); // 10000 - 9000
  assert.ok(r.avaliacaoNoLimite.furoPiso, 'deve apontar o dia que quebraria');
  assert.strictEqual(r.avaliacaoNoLimite.furoPiso.iso, '2026-09-10');
});
