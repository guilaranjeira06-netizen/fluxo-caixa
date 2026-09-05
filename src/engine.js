/**
 * Motor de calculo do fluxo de caixa.
 *
 * Regras do jogo (o "modelo"):
 *
 *  - Tudo internamente e' em CENTAVOS INTEIROS. Dinheiro em float acumula erro
 *    e aqui a diferenca de um centavo muda a resposta "posso ou nao posso".
 *  - Datas sao strings 'YYYY-MM-DD' convertidas para um indice inteiro de dias
 *    (epoch UTC / 86400000). Sem fuso, sem horario de verao, sem surpresa.
 *  - Uma REGRA descreve um pagamento recorrente ("todo dia 15", "5o dia util").
 *    Expandir a regra sobre um intervalo produz LANCAMENTOS (data + valor).
 *  - A PROJECAO soma os lancamentos dia a dia sobre o saldo inicial.
 *  - O SOLVER responde "quanto posso tirar no dia D sem furar as restricoes",
 *    por busca binaria: tirar mais nunca melhora a situacao, entao a
 *    viabilidade e' monotonica e a binaria e' exata.
 */

(function (raiz, definir) {
  const api = definir();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.FluxoEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MS_DIA = 86400000;

  // ---------------------------------------------------------------- dinheiro

  /** Reais (numero ou string "1.234,56") -> centavos inteiros. */
  function paraCentavos(valor) {
    if (typeof valor === 'number') return Math.round(valor * 100);
    if (valor == null || valor === '') return 0;
    const limpo = String(valor).trim().replace(/[R$\s ]/g, '');
    // "1.234,56" (pt-BR) vs "1234.56" (ingles): quem manda e' o ultimo separador.
    const ultimaVirgula = limpo.lastIndexOf(',');
    const ultimoPonto = limpo.lastIndexOf('.');
    let normalizado;
    if (ultimaVirgula > ultimoPonto) normalizado = limpo.replace(/\./g, '').replace(',', '.');
    else normalizado = limpo.replace(/,/g, '');
    const n = parseFloat(normalizado);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  /** Centavos -> reais (numero). */
  function paraReais(centavos) {
    return centavos / 100;
  }

  /** Centavos -> "R$ 1.234,56". */
  function formatarBRL(centavos) {
    const negativo = centavos < 0;
    const abs = Math.abs(centavos);
    const inteiro = Math.floor(abs / 100).toLocaleString('pt-BR');
    const cent = String(abs % 100).padStart(2, '0');
    return (negativo ? '-' : '') + 'R$ ' + inteiro + ',' + cent;
  }

  // ------------------------------------------------------------------ datas

  function doisDigitos(n) {
    return String(n).padStart(2, '0');
  }

  /** 'YYYY-MM-DD' -> indice inteiro de dias. */
  function isoParaDia(iso) {
    const [a, m, d] = String(iso).split('-').map(Number);
    return Date.UTC(a, m - 1, d) / MS_DIA;
  }

  /** Indice inteiro de dias -> 'YYYY-MM-DD'. */
  function diaParaIso(dia) {
    const dt = new Date(dia * MS_DIA);
    return dt.getUTCFullYear() + '-' + doisDigitos(dt.getUTCMonth() + 1) + '-' + doisDigitos(dt.getUTCDate());
  }

  /** 0 = domingo ... 6 = sabado. */
  function diaDaSemana(dia) {
    return new Date(dia * MS_DIA).getUTCDay();
  }

  function anoDe(dia) {
    return new Date(dia * MS_DIA).getUTCFullYear();
  }

  function mesDe(dia) {
    const dt = new Date(dia * MS_DIA);
    return dt.getUTCFullYear() + '-' + doisDigitos(dt.getUTCMonth() + 1);
  }

  function diasNoMes(ano, mes /* 1..12 */) {
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  }

  const NOMES_DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

  function rotuloCurto(dia) {
    const dt = new Date(dia * MS_DIA);
    return doisDigitos(dt.getUTCDate()) + '/' + doisDigitos(dt.getUTCMonth() + 1);
  }

  // -------------------------------------------------------------- feriados

  /** Domingo de Pascoa (algoritmo de Meeus/Jones/Butcher). */
  function domingoDePascoa(ano) {
    const a = ano % 19;
    const b = Math.floor(ano / 100);
    const c = ano % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(ano, mes - 1, dia) / MS_DIA;
  }

  /**
   * Feriados nacionais + os dois dias em que os bancos nao abrem (24 e 31/12).
   * Retorna Map iso -> nome.
   */
  function feriadosDoAno(ano, opcoes) {
    const opts = opcoes || {};
    const incluirBancarios = opts.feriadosBancarios !== false;
    const pascoa = domingoDePascoa(ano);
    const mapa = new Map();
    const por = (dia, nome) => mapa.set(diaParaIso(dia), nome);
    const fixo = (mes, dia, nome) => por(Date.UTC(ano, mes - 1, dia) / MS_DIA, nome);

    fixo(1, 1, 'Confraternização Universal');
    por(pascoa - 48, 'Carnaval (segunda)');
    por(pascoa - 47, 'Carnaval (terça)');
    por(pascoa - 2, 'Sexta-feira Santa');
    por(pascoa + 60, 'Corpus Christi');
    fixo(4, 21, 'Tiradentes');
    fixo(5, 1, 'Dia do Trabalho');
    fixo(9, 7, 'Independência');
    fixo(10, 12, 'Nossa Senhora Aparecida');
    fixo(11, 2, 'Finados');
    fixo(11, 15, 'Proclamação da República');
    if (ano >= 2024) fixo(11, 20, 'Consciência Negra');
    fixo(12, 25, 'Natal');
    if (incluirBancarios) {
      fixo(12, 24, 'Véspera de Natal (bancos fechados)');
      fixo(12, 31, 'Véspera de Ano Novo (bancos fechados)');
    }
    return mapa;
  }

  /**
   * Calendario de dias uteis para um intervalo. Cacheia os feriados por ano e
   * incorpora os feriados extras (municipais/estaduais) informados pelo usuario.
   */
  function criarCalendario(opcoes) {
    const opts = opcoes || {};
    const extras = new Map();
    for (const item of opts.feriadosExtras || []) {
      if (typeof item === 'string') extras.set(item, 'Feriado local');
      else if (item && item.data) extras.set(item.data, item.nome || 'Feriado local');
    }
    const cacheAno = new Map();

    function feriadosDe(ano) {
      if (!cacheAno.has(ano)) cacheAno.set(ano, feriadosDoAno(ano, opts));
      return cacheAno.get(ano);
    }

    function nomeFeriado(dia) {
      const iso = diaParaIso(dia);
      if (extras.has(iso)) return extras.get(iso);
      const f = feriadosDe(anoDe(dia));
      return f.get(iso) || null;
    }

    function ehUtil(dia) {
      const ds = diaDaSemana(dia);
      if (ds === 0 || ds === 6) return false;
      return nomeFeriado(dia) == null;
    }

    /** Anda para tras/frente ate cair num dia util. */
    function ajustar(dia, direcao) {
      if (direcao === 'nenhum' || !direcao) return dia;
      const passo = direcao === 'anterior' ? -1 : 1;
      let d = dia;
      for (let i = 0; i < 30 && !ehUtil(d); i++) d += passo;
      return d;
    }

    /** N-esimo dia util do mes (n >= 1). Retorna null se o mes nao tiver tantos. */
    function nEsimoDiaUtil(ano, mes, n) {
      const total = diasNoMes(ano, mes);
      let contador = 0;
      for (let d = 1; d <= total; d++) {
        const dia = Date.UTC(ano, mes - 1, d) / MS_DIA;
        if (ehUtil(dia)) {
          contador++;
          if (contador === n) return dia;
        }
      }
      return null;
    }

    function ultimoDiaUtil(ano, mes) {
      const total = diasNoMes(ano, mes);
      for (let d = total; d >= 1; d--) {
        const dia = Date.UTC(ano, mes - 1, d) / MS_DIA;
        if (ehUtil(dia)) return dia;
      }
      return null;
    }

    return { ehUtil, ajustar, nEsimoDiaUtil, ultimoDiaUtil, nomeFeriado };
  }

  // -------------------------------------------------------- regras -> datas

  /**
   * Data em que a regra cai num dado mes. Retorna indice de dia ou null.
   */
  function dataDaRegraNoMes(regra, ano, mes, calendario) {
    const agenda = regra.agenda || {};
    switch (agenda.tipo) {
      case 'diaUtil': {
        const n = Number(agenda.n) || 1;
        return calendario.nEsimoDiaUtil(ano, mes, n);
      }
      case 'ultimoDiaUtil':
        return calendario.ultimoDiaUtil(ano, mes);
      case 'diaFixo': {
        const pedido = Number(agenda.dia) || 1;
        // Dia 31 em fevereiro vira o ultimo dia do mes, nao some.
        const dia = Math.min(pedido, diasNoMes(ano, mes));
        const bruto = Date.UTC(ano, mes - 1, dia) / MS_DIA;
        return calendario.ajustar(bruto, regra.ajuste || 'nenhum');
      }
      default:
        return null;
    }
  }

  /** Compara 'YYYY-MM' como string (ordem lexicografica == cronologica). */
  function dentroDaVigencia(regra, chaveMes) {
    if (regra.vigenciaInicio && chaveMes < regra.vigenciaInicio) return false;
    if (regra.vigenciaFim && chaveMes > regra.vigenciaFim) return false;
    return true;
  }

  /**
   * Expande as regras em lancamentos dentro de [diaInicio, diaFim].
   * Cada lancamento: { dia, iso, nome, tipo, centavos (assinado), regraId, estimado }
   */
  function expandirRegras(regras, diaInicio, diaFim, calendario) {
    const saida = [];
    const primeiro = new Date(diaInicio * MS_DIA);
    const ultimo = new Date(diaFim * MS_DIA);

    for (const regra of regras || []) {
      if (regra.ativo === false) continue;
      const sinal = regra.tipo === 'saida' ? -1 : 1;

      if ((regra.agenda || {}).tipo === 'unica') {
        const iso = regra.agenda.data;
        if (!iso) continue;
        const dia = isoParaDia(iso);
        if (dia < diaInicio || dia > diaFim) continue;
        saida.push({
          dia, iso: diaParaIso(dia), nome: regra.nome || 'Lancamento',
          tipo: regra.tipo || 'entrada', regraId: regra.id,
          centavos: sinal * Math.abs(valorNoMes(regra, mesDe(dia))),
          estimado: !!regra.estimado
        });
        continue;
      }

      // Varre um mes antes e um depois: o ajuste de dia util pode puxar a data
      // para dentro da janela vindo de fora dela.
      let ano = primeiro.getUTCFullYear();
      let mes = primeiro.getUTCMonth() + 1;
      const anoFim = ultimo.getUTCFullYear();
      const mesFim = ultimo.getUTCMonth() + 1;
      mes -= 1;
      if (mes === 0) { mes = 12; ano -= 1; }

      for (let guarda = 0; guarda < 600; guarda++) {
        if (ano > anoFim || (ano === anoFim && mes > mesFim + 1)) break;
        const chaveMes = ano + '-' + doisDigitos(mes);
        if (dentroDaVigencia(regra, chaveMes)) {
          const dia = dataDaRegraNoMes(regra, ano, mes, calendario);
          if (dia != null && dia >= diaInicio && dia <= diaFim) {
            const centavos = valorNoMes(regra, chaveMes);
            if (centavos !== 0) {
              saida.push({
                dia, iso: diaParaIso(dia), nome: regra.nome || 'Lancamento',
                tipo: regra.tipo || 'entrada', regraId: regra.id,
                centavos: sinal * Math.abs(centavos),
                estimado: !!regra.estimado
              });
            }
          }
        }
        mes += 1;
        if (mes === 13) { mes = 1; ano += 1; }
      }
    }

    saida.sort((a, b) => a.dia - b.dia || a.nome.localeCompare(b.nome));
    return saida;
  }

  /** Valor da regra num mes especifico, considerando o override mensal. */
  function valorNoMes(regra, chaveMes) {
    const overrides = regra.valoresPorMes || {};
    if (Object.prototype.hasOwnProperty.call(overrides, chaveMes)) {
      return paraCentavos(overrides[chaveMes]);
    }
    return paraCentavos(regra.valor);
  }

  // --------------------------------------------------------------- projecao

  /**
   * Projeta o saldo dia a dia.
   * @returns { dias: [{dia, iso, entradas, saidas, retirada, saldo, itens}], ... }
   */
  function projetar(entrada) {
    const { saldoInicialCentavos, diaInicio, diaFim, lancamentos } = entrada;
    const retiradas = entrada.retiradas || [];

    const porDia = new Map();
    for (const l of lancamentos) {
      if (l.dia < diaInicio || l.dia > diaFim) continue;
      if (!porDia.has(l.dia)) porDia.set(l.dia, []);
      porDia.get(l.dia).push(l);
    }
    const retiradaPorDia = new Map();
    for (const r of retiradas) {
      const d = typeof r.dia === 'number' ? r.dia : isoParaDia(r.data);
      const c = typeof r.centavos === 'number' ? r.centavos : paraCentavos(r.valor);
      if (c <= 0) continue;
      retiradaPorDia.set(d, (retiradaPorDia.get(d) || 0) + c);
    }

    const dias = [];
    let saldo = saldoInicialCentavos;
    for (let d = diaInicio; d <= diaFim; d++) {
      const itens = porDia.get(d) || [];
      let entradasDia = 0;
      let saidasDia = 0;
      for (const it of itens) {
        if (it.centavos >= 0) entradasDia += it.centavos;
        else saidasDia += -it.centavos;
      }
      const retirada = retiradaPorDia.get(d) || 0;
      saldo = saldo + entradasDia - saidasDia - retirada;
      dias.push({
        dia: d, iso: diaParaIso(d), entradas: entradasDia, saidas: saidasDia,
        retirada, saldo, itens
      });
    }
    return { dias, diaInicio, diaFim };
  }

  // ---------------------------------------------------------------- ciclos

  const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                        'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  /**
   * A que ciclo de cobranca um dia pertence.
   *
   * O banco zera a franquia de dias no vencimento, nao no dia 1. Com
   * `diaVirada` = 1 o ciclo e' o mes calendario; com 15, o ciclo vai do dia 15
   * de um mes ao dia 14 do seguinte, e o dia 10 ainda conta para o mes anterior.
   */
  function chaveCiclo(dia, diaVirada) {
    const dt = new Date(dia * MS_DIA);
    let ano = dt.getUTCFullYear();
    let mes = dt.getUTCMonth() + 1;
    if (dt.getUTCDate() < (diaVirada || 1)) {
      mes -= 1;
      if (mes === 0) { mes = 12; ano -= 1; }
    }
    return ano + '-' + doisDigitos(mes);
  }

  /** '2026-09' -> 'set/2026'. */
  function rotuloCiclo(chave) {
    const [ano, mes] = chave.split('-').map(Number);
    return MESES_CURTOS[mes - 1] + '/' + ano;
  }

  /** '2026-01' -> '2025-12'. */
  function mesAnteriorDe(chave) {
    let [ano, mes] = chave.split('-').map(Number);
    mes -= 1;
    if (mes === 0) { mes = 12; ano -= 1; }
    return ano + '-' + doisDigitos(mes);
  }

  /**
   * Divide a janela em periodos de competencia.
   *
   * O fluxo de caixa e' continuo - o saldo de 30/09 vira o de 01/10 sem nenhum
   * corte. Mas para dizer "quanto investi em setembro" e' preciso escolher uma
   * fronteira, e a fronteira que faz sentido para quem vive de salario nao e' o
   * dia 1: e' o dia em que o dinheiro entra. Setembro comeca quando o salario
   * de setembro cai.
   *
   * `marcos` sao esses dias de virada (as datas de uma regra de entrada, em
   * geral o salario). O periodo leva o nome do MES do seu marco: o periodo que
   * abre em 08/09 e' "set/2026", mesmo terminando em 06/10.
   *
   * As pontas da janela viram periodos `parcial: true` - o primeiro porque
   * comecou antes do marco, o ultimo porque o horizonte cortou. Somar dinheiro
   * de um periodo parcial e comparar com um inteiro daria um grafico mentiroso.
   */
  function calcularPeriodos(marcos, diaInicio, diaFim) {
    const dentro = (marcos || [])
      .filter((d) => d > diaInicio && d <= diaFim)
      .sort((a, b) => a - b);
    const periodos = [];

    function novo(chave, inicio, fim, parcial) {
      periodos.push({
        chave, rotulo: rotuloCiclo(chave), inicio, fim, parcial: !!parcial,
        dias: fim - inicio + 1
      });
    }

    if (!dentro.length) {
      novo(mesDe(diaInicio), diaInicio, diaFim, true);
      return periodos;
    }
    // Sobra da janela antes do primeiro marco: pertence a competencia anterior.
    novo(mesAnteriorDe(mesDe(dentro[0])), diaInicio, dentro[0] - 1, true);
    for (let i = 0; i < dentro.length; i++) {
      const ini = dentro[i];
      const ultimo = i + 1 >= dentro.length;
      novo(mesDe(ini), ini, ultimo ? diaFim : dentro[i + 1] - 1, ultimo);
    }
    return periodos;
  }

  /** Em que periodo um dia cai. */
  function periodoDoDia(periodos, dia) {
    for (const p of periodos) if (dia >= p.inicio && dia <= p.fim) return p;
    return null;
  }

  // ------------------------------------------------------------ restricoes

  /**
   * Avalia a projecao contra as restricoes da conta.
   *
   * restricoes = {
   *   pisoCentavos,          // saldo nunca pode ficar abaixo disso (ex: -200000)
   *   maxDiasNegativos,      // dias CORRIDOS seguidos com saldo < 0 (ex: 10)
   * }
   *
   * A "sequencia aberta" (que ainda esta negativa no ultimo dia projetado) e'
   * tratada como violacao: nao da' para afirmar que ela fecha a tempo.
   */
  function avaliar(projecao, restricoes) {
    const piso = restricoes.pisoCentavos;
    const maxDias = restricoes.maxDiasNegativos;
    const porCiclo = restricoes.modoFranquia !== 'corridos';
    const diaVirada = restricoes.diaViradaCiclo || 1;
    const dias = projecao.dias;

    let furoPiso = null;
    let corrida = 0;
    let inicioCorrida = null;
    let piorCorrida = 0;
    let piorCorridaInicio = null;
    let estouroCorrida = null;
    let menorSaldo = Infinity;
    let menorSaldoDia = null;
    const sequencias = [];

    // Franquia mensal: o contador do banco soma os dias negativos do ciclo,
    // estejam eles grudados ou nao. Tres dias agora e quatro daqui a duas
    // semanas sao sete dias gastos, nao duas sequencias independentes.
    const ciclos = new Map();
    const chaveDoPrimeiro = dias.length ? chaveCiclo(dias[0].dia, diaVirada) : null;
    let estouroCiclo = null;

    function ciclo(chave) {
      if (!ciclos.has(chave)) {
        // O ciclo corrente ja' pode ter dias gastos antes de hoje - o
        // "Total de dias em uso" que o banco mostra.
        const jaUsados = chave === chaveDoPrimeiro
          ? Math.max(0, Number(restricoes.diasJaUsadosNoCiclo) || 0)
          : 0;
        ciclos.set(chave, {
          chave, rotulo: rotuloCiclo(chave), jaUsados,
          dias: jaUsados, limite: maxDias, estourou: false, primeiroDia: null, ultimoDia: null
        });
      }
      return ciclos.get(chave);
    }
    if (chaveDoPrimeiro) ciclo(chaveDoPrimeiro);

    for (let i = 0; i < dias.length; i++) {
      const d = dias[i];
      if (d.saldo < menorSaldo) { menorSaldo = d.saldo; menorSaldoDia = d; }
      if (furoPiso == null && d.saldo < piso) furoPiso = d;

      if (d.saldo < 0) {
        if (corrida === 0) inicioCorrida = d;
        corrida++;
        if (corrida > piorCorrida) { piorCorrida = corrida; piorCorridaInicio = inicioCorrida; }
        if (estouroCorrida == null && corrida > maxDias) estouroCorrida = d;

        const c = ciclo(chaveCiclo(d.dia, diaVirada));
        c.dias++;
        if (c.primeiroDia == null) c.primeiroDia = d;
        c.ultimoDia = d;
        d.diaDoCiclo = c.dias;
        d.ciclo = c;
        if (c.dias > maxDias) {
          c.estourou = true;
          if (estouroCiclo == null) estouroCiclo = { ciclo: c, dia: d };
        }
      } else if (corrida > 0) {
        sequencias.push({ inicio: inicioCorrida, fim: dias[i - 1], dias: corrida, aberta: false });
        corrida = 0;
        inicioCorrida = null;
      }
    }
    let sequenciaAberta = null;
    if (corrida > 0) {
      sequenciaAberta = { inicio: inicioCorrida, fim: dias[dias.length - 1], dias: corrida, aberta: true };
      sequencias.push(sequenciaAberta);
    }

    // A regra da franquia depende do modo; o piso e a sequencia aberta valem
    // nos dois. Sequencia aberta e' violacao porque os dias que faltam para ela
    // fechar estao fora da janela projetada - nao da' para contar o que nao se ve.
    const estouroFranquia = porCiclo ? estouroCiclo : estouroCorrida;
    const ok = furoPiso == null && estouroFranquia == null && sequenciaAberta == null;

    return {
      ok, furoPiso, sequenciaAberta, sequencias,
      modoFranquia: porCiclo ? 'mensal' : 'corridos',
      estouroCorrida, estouroCiclo, estouroFranquia,
      ciclos: Array.from(ciclos.values()).filter((c) => c.dias > 0),
      piorCorrida, piorCorridaInicio, menorSaldo, menorSaldoDia
    };
  }

  // ----------------------------------------------------------------- solver

  /**
   * Contexto reutilizavel para o solver: tudo que nao muda entre as tentativas.
   */
  function criarContexto(cfg) {
    return {
      saldoInicialCentavos: cfg.saldoInicialCentavos,
      diaInicio: cfg.diaInicio,
      diaFim: cfg.diaFim,
      lancamentos: cfg.lancamentos,
      restricoes: cfg.restricoes
    };
  }

  function projetarComRetiradas(ctx, retiradas) {
    return projetar({
      saldoInicialCentavos: ctx.saldoInicialCentavos,
      diaInicio: ctx.diaInicio,
      diaFim: ctx.diaFim,
      lancamentos: ctx.lancamentos,
      retiradas
    });
  }

  function viavel(ctx, retiradas) {
    return avaliar(projetarComRetiradas(ctx, retiradas), ctx.restricoes).ok;
  }

  /**
   * Quanto da' para tirar no dia `diaAlvo`, dado que as retiradas em
   * `retiradasFixas` ja' estao decididas.
   *
   * Monotonicidade: aumentar a retirada so' abaixa a curva de saldo a partir
   * daquele dia, logo so' pode criar violacao, nunca curar uma. Por isso a
   * busca binaria sobre centavos inteiros devolve o maximo exato.
   *
   * @returns { centavos, viavelSemRetirada, avaliacaoBase }
   */
  function maximoRetiravel(ctx, diaAlvo, retiradasFixas) {
    const fixas = retiradasFixas || [];
    const base = projetarComRetiradas(ctx, fixas);
    const avaliacaoBase = avaliar(base, ctx.restricoes);
    if (!avaliacaoBase.ok) {
      return { centavos: 0, viavelSemRetirada: false, avaliacaoBase };
    }

    // Teto, e sao dois limites diferentes:
    //
    //  a) Nao da' para investir dinheiro que nao esta' la'. O saldo do proprio
    //     dia e' o teto duro - o cheque especial existe para ABSORVER as saidas
    //     agendadas, nao para FINANCIAR aporte. Sem essa trava a calculadora
    //     mandaria transferir 5.400 de uma conta com 4.200.
    //  b) Passar de (saldo - piso) ja' fura o piso no proprio dia da retirada.
    //
    // O menor dos dois manda; o resto da curva a busca binaria resolve.
    const linha = base.dias.find((d) => d.dia === diaAlvo);
    if (!linha) return { centavos: 0, viavelSemRetirada: true, avaliacaoBase };
    const tetoDisponivel = linha.saldo;
    const tetoPiso = linha.saldo - ctx.restricoes.pisoCentavos;
    let alto = Math.min(tetoDisponivel, tetoPiso);
    if (alto <= 0) return { centavos: 0, viavelSemRetirada: true, avaliacaoBase };

    const tentar = (c) => viavel(ctx, fixas.concat([{ dia: diaAlvo, centavos: c }]));
    if (tentar(alto)) {
      return {
        centavos: alto, viavelSemRetirada: true, avaliacaoBase,
        trava: alto === tetoDisponivel ? 'saldo' : 'piso'
      };
    }

    let baixo = 0; // sempre viavel (avaliacaoBase.ok)
    while (alto - baixo > 1) {
      const meio = baixo + Math.floor((alto - baixo) / 2);
      if (tentar(meio)) baixo = meio; else alto = meio;
    }
    // O que quebra com um centavo a mais e' exatamente o que limita o valor.
    const excedente = projetarComRetiradas(ctx, fixas.concat([{ dia: diaAlvo, centavos: baixo + 1 }]));
    return {
      centavos: baixo, viavelSemRetirada: true, avaliacaoBase,
      trava: 'fluxo', avaliacaoNoLimite: avaliar(excedente, ctx.restricoes)
    };
  }

  /**
   * Plano de aportes: percorre as datas candidatas em ordem e, em cada uma,
   * tira o maximo possivel considerando o que ja' foi retirado antes.
   *
   * E' guloso-para-o-cedo de proposito: dinheiro parado rende menos, entao a
   * pergunta util e' "qual o maximo hoje", e depois "e no proximo evento".
   *
   * Devolve dois conjuntos diferentes, e confundi-los conta dinheiro em dobro:
   *   linhas    - so' o que o plano esta' PROPONDO agora;
   *   retiradas - tudo que sai da conta, ja' incluindo `retiradasIniciais`.
   * Para projetar, use `retiradas` sozinho.
   */
  function planoDeAportes(ctx, diasCandidatos, minimoCentavos, retiradasIniciais) {
    const minimo = minimoCentavos || 0;
    // Transferencias ja feitas (ou ja agendadas) nao sao sugestao: sao dinheiro
    // que saiu. Entram como ponto de partida, e o plano so' propoe o que sobra.
    const fixas = (retiradasIniciais || []).slice();
    const linhas = [];
    for (const dia of diasCandidatos) {
      if (dia < ctx.diaInicio || dia > ctx.diaFim) continue;
      const r = maximoRetiravel(ctx, dia, fixas);
      if (!r.viavelSemRetirada) break;
      if (r.centavos >= minimo && r.centavos > 0) {
        fixas.push({ dia, centavos: r.centavos });
        linhas.push({ dia, iso: diaParaIso(dia), centavos: r.centavos });
      }
    }
    return { linhas, retiradas: fixas };
  }

  return {
    MS_DIA,
    paraCentavos, paraReais, formatarBRL,
    isoParaDia, diaParaIso, diaDaSemana, mesDe, anoDe, diasNoMes, rotuloCurto,
    NOMES_DIA_SEMANA,
    domingoDePascoa, feriadosDoAno, criarCalendario,
    dataDaRegraNoMes, expandirRegras, valorNoMes,
    chaveCiclo, rotuloCiclo, MESES_CURTOS, mesAnteriorDe,
    calcularPeriodos, periodoDoDia,
    projetar, avaliar,
    criarContexto, projetarComRetiradas, maximoRetiravel, planoDeAportes
  };
});
