/* Interface da calculadora de fluxo de caixa.
   Todo o calculo mora em src/engine.js; aqui e' estado, DOM e desenho. */
(function () {
  'use strict';

  var E = window.FluxoEngine;
  var CHAVE = 'fluxo-caixa/estado/v1';
  var $ = function (sel) { return document.querySelector(sel); };

  // ------------------------------------------------------------- utilidades

  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  function idNovo() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /**
   * Centavos -> "1.234,56" (sem o "R$", para caber nos inputs).
   * Zero vira "0,00", nao string vazia: um campo em branco parece "nao
   * preenchido", e num app de dinheiro essa duvida custa caro.
   */
  function paraCampo(centavos) {
    return E.formatarBRL(centavos || 0).replace('R$ ', '');
  }

  /** Centavos -> "R$ 1.200" para eixos: sem centavos, com sinal. */
  function formatarCurto(centavos) {
    var neg = centavos < 0;
    var reais = Math.round(Math.abs(centavos) / 100);
    return (neg ? '-' : '') + 'R$ ' + reais.toLocaleString('pt-BR');
  }

  function textoDiaSemana(dia) {
    return E.NOMES_DIA_SEMANA[E.diaDaSemana(dia)];
  }

  /**
   * "05/09 (sab)" - com o ano junto quando ele nao e' o da data de referencia.
   * Com horizonte de 12 meses, "05/09" sozinho e' ambiguo: parece hoje.
   */
  function comAno(dia) {
    var ano = E.anoDe(dia);
    var anoBase = E.anoDe(E.isoParaDia(estado.dataReferencia || hojeISO()));
    return E.rotuloCurto(dia) + (ano === anoBase ? '' : '/' + String(ano).slice(2));
  }

  function dataLonga(iso) {
    var d = E.isoParaDia(iso);
    return comAno(d) + ' (' + textoDiaSemana(d) + ')';
  }

  function criar(tag, atributos, filhos) {
    var el = document.createElement(tag);
    for (var k in atributos || {}) {
      if (k === 'class') el.className = atributos[k];
      else if (k === 'text') el.textContent = atributos[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), atributos[k]);
      else if (atributos[k] != null && atributos[k] !== false) el.setAttribute(k, atributos[k]);
    }
    (filhos || []).forEach(function (f) { if (f) el.appendChild(f); });
    return el;
  }

  // ----------------------------------------------------------------- estado

  function estadoExemplo() {
    return {
      versao: 1,
      exemplo: true,
      saldoInicial: 4200,
      dataReferencia: hojeISO(),
      saldoInformadoEm: hojeISO(),
      limiteNegativo: 2000,
      maxDiasNegativos: 10,
      modoFranquia: 'mensal',
      diasJaUsadosNoCiclo: 0,
      diaViradaCiclo: 1,
      colchao: 300,
      aporteMinimo: 100,
      conservador: false,
      feriadosBancarios: true,
      horizonteMeses: 4,
      feriadosExtras: [],
      regras: [
        { id: idNovo(), nome: 'Salário', tipo: 'entrada', valor: 8500, ativo: true,
          agenda: { tipo: 'diaUtil', n: 5 }, ajuste: 'nenhum', valoresPorMes: {} },
        { id: idNovo(), nome: 'Pagamento do dia 15', tipo: 'entrada', valor: 3200, ativo: true,
          agenda: { tipo: 'diaFixo', dia: 15 }, ajuste: 'anterior', valoresPorMes: {} },
        { id: idNovo(), nome: 'Cartão de crédito', tipo: 'saida', valor: 4300, ativo: true,
          agenda: { tipo: 'diaUtil', n: 5 }, ajuste: 'nenhum', valoresPorMes: {} },
        { id: idNovo(), nome: 'Aluguel', tipo: 'saida', valor: 2600, ativo: true,
          agenda: { tipo: 'diaFixo', dia: 10 }, ajuste: 'seguinte', valoresPorMes: {} },
        { id: idNovo(), nome: 'Escola', tipo: 'saida', valor: 1400, ativo: true,
          agenda: { tipo: 'diaFixo', dia: 10 }, ajuste: 'seguinte', valoresPorMes: {} },
        { id: idNovo(), nome: 'Financiamento', tipo: 'saida', valor: 1900, ativo: true,
          agenda: { tipo: 'diaFixo', dia: 19 }, ajuste: 'seguinte', valoresPorMes: {} }
      ]
    };
  }

  function estadoVazio() {
    var e = estadoExemplo();
    e.exemplo = false;
    e.saldoInicial = 0;
    e.colchao = 0;
    e.regras.forEach(function (r) { r.valor = 0; r.valoresPorMes = {}; });
    return e;
  }

  var estado = carregar();
  var dataFoiAvancada = adiantarParaHoje();

  /**
   * Um app que responde "quanto posso tirar HOJE" nao pode abrir na data de
   * ontem. Avanca sozinho, mas nunca recua: se o usuario apontou para uma data
   * futura de proposito, essa escolha e' dele.
   */
  function adiantarParaHoje() {
    var hoje = hojeISO();
    if (!estado.dataReferencia || estado.dataReferencia < hoje) {
      var mudou = !!estado.dataReferencia && estado.dataReferencia !== hoje;
      estado.dataReferencia = hoje;
      return mudou;
    }
    return false;
  }

  function carregar() {
    try {
      var bruto = localStorage.getItem(CHAVE);
      if (bruto) {
        var e = JSON.parse(bruto);
        if (e && Array.isArray(e.regras)) return e;
      }
    } catch (err) { /* localStorage bloqueado ou JSON corrompido: cai no exemplo */ }
    return estadoExemplo();
  }

  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); }
    catch (err) { /* modo privado: segue sem persistir */ }
  }

  // --------------------------------------------------------------- calculo

  /**
   * Roda o modelo inteiro sobre o estado atual.
   *
   * Duas janelas de tempo, de proposito:
   *  - a de EXIBICAO vai ate horizonteMeses;
   *  - a de CALCULO vai 60 dias alem disso, para que uma sequencia negativa
   *    que comeca perto do fim ainda "veja" a entrada que a fecha. Sem essa
   *    folga, toda projecao terminaria num falso alarme.
   */
  function calcular() {
    var calendario = E.criarCalendario({
      feriadosBancarios: estado.feriadosBancarios !== false,
      feriadosExtras: estado.feriadosExtras || []
    });

    var diaInicio = E.isoParaDia(estado.dataReferencia || hojeISO());
    var meses = Number(estado.horizonteMeses) || 4;
    var dtFim = new Date(diaInicio * E.MS_DIA);
    dtFim.setUTCMonth(dtFim.getUTCMonth() + meses);
    var diaFimExibicao = Math.floor(dtFim.getTime() / E.MS_DIA);
    var diaFimCalculo = diaFimExibicao + 60;

    var lancamentos = E.expandirRegras(estado.regras, diaInicio, diaFimCalculo, calendario);

    // O colchao NAO e' um desconto no fim da conta: ele e' um piso. Somado ao
    // limite da conta vira a unica regra de "ate onde da' para descer", e ai
    // destaque, plano, grafico e extrato falam todos do mesmo numero.
    // Conservador com colchao 300 => nunca abaixo de +300.
    // Limite -2.000 com colchao 300 => nunca abaixo de -1.700.
    var conservador = !!estado.conservador;
    var colchao = E.paraCentavos(estado.colchao);
    var pisoBruto = conservador ? 0 : -Math.abs(E.paraCentavos(estado.limiteNegativo));
    var restricoes = {
      pisoCentavos: pisoBruto + colchao,
      maxDiasNegativos: conservador ? 0 : (Number(estado.maxDiasNegativos) || 0),
      // Sem valor salvo, vale a regra do banco dele: "10 dias esse mes", somados.
      modoFranquia: estado.modoFranquia === 'corridos' ? 'corridos' : 'mensal',
      diaViradaCiclo: Number(estado.diaViradaCiclo) || 1,
      diasJaUsadosNoCiclo: conservador ? 0 : (Number(estado.diasJaUsadosNoCiclo) || 0)
    };

    var ctx = E.criarContexto({
      saldoInicialCentavos: E.paraCentavos(estado.saldoInicial),
      diaInicio: diaInicio, diaFim: diaFimCalculo,
      lancamentos: lancamentos, restricoes: restricoes
    });

    // Datas candidatas a aporte: hoje e todo dia em que entra dinheiro.
    var candidatos = [diaInicio];
    var vistos = {};
    vistos[diaInicio] = true;
    lancamentos.forEach(function (l) {
      if (l.centavos > 0 && l.dia <= diaFimExibicao && !vistos[l.dia]) {
        vistos[l.dia] = true;
        candidatos.push(l.dia);
      }
    });
    candidatos.sort(function (a, b) { return a - b; });

    var minimo = E.paraCentavos(estado.aporteMinimo);
    var plano = E.planoDeAportes(ctx, candidatos, minimo);

    var semAportes = E.projetarComRetiradas(ctx, []);
    var comPlano = E.projetarComRetiradas(ctx, plano.retiradas);
    var avaliacaoBase = E.avaliar(semAportes, restricoes);
    var avaliacaoPlano = E.avaliar(comPlano, restricoes);

    var hoje = E.maximoRetiravel(ctx, diaInicio, []);

    // Entra menos do que sai? Entao a "sobra" de hoje e' so' o caixa acabando
    // devagar, e o numero depende do horizonte escolhido. Isso precisa ser dito.
    //
    // Somar os lancamentos da janela daria um numero torto: os meses das bordas
    // entram pela metade, entao uma regra cai 6 vezes e outra 5. O resultado
    // mensal sai das REGRAS recorrentes, que e' o numero que ele reconhece.
    // Lancamento avulso fica de fora - ele nao se repete.
    var liquidoMensal = (estado.regras || []).reduce(function (soma, regra) {
      if (regra.ativo === false) return soma;
      if ((regra.agenda || {}).tipo === 'unica') return soma;
      var v = Math.abs(E.paraCentavos(regra.valor));
      return soma + (regra.tipo === 'saida' ? -v : v);
    }, 0);
    var deficitMensal = liquidoMensal < 0 ? -liquidoMensal : 0;

    return {
      calendario: calendario, ctx: ctx, restricoes: restricoes,
      diaInicio: diaInicio, diaFimExibicao: diaFimExibicao,
      lancamentos: lancamentos, plano: plano,
      semAportes: semAportes, comPlano: comPlano,
      avaliacaoBase: avaliacaoBase, avaliacaoPlano: avaliacaoPlano,
      sugeridoHoje: hoje.centavos, colchao: colchao, pisoBruto: pisoBruto,
      deficitMensal: deficitMensal,
      trava: hoje, viavel: hoje.viavelSemRetirada
    };
  }

  // ------------------------------------------------------- render: resposta

  function renderResposta(r) {
    var heroi = $('#valor-heroi');
    var nota = $('#nota-heroi');
    var rotulo = $('#rotulo-heroi');
    var avisos = $('#avisos');
    avisos.textContent = '';

    if (!r.viavel) {
      rotulo.textContent = 'Pode transferir hoje para investimento';
      heroi.textContent = 'R$ 0,00';
      heroi.className = 'heroi ruim';
      nota.textContent = 'A conta não fecha nem sem tirar nada. Veja o alerta acima.';
      avisos.appendChild(avisoDoFuro(r));
    } else {
      rotulo.textContent = 'Pode transferir hoje para investimento';
      heroi.textContent = E.formatarBRL(r.sugeridoHoje);
      heroi.className = 'heroi';
      var deixar = E.paraCentavos(estado.saldoInicial) - r.sugeridoHoje;
      nota.innerHTML = 'Deixando <b>' + E.formatarBRL(deixar) + '</b> em conta.' +
        (r.colchao > 0 ? ' O colchão de ' + E.formatarBRL(r.colchao) + ' já está preservado.' : '') +
        '<br><br>' + explicarTrava(r);

      var usoDoVermelho = resumoDoVermelho(r);
      if (usoDoVermelho) {
        avisos.appendChild(montarAviso('atencao', '&#9679;', usoDoVermelho));
      } else if (r.sugeridoHoje > 0) {
        avisos.appendChild(montarAviso('bom', '&#10003;',
          'Com esse aporte a conta não fica negativa nenhum dia dentro do horizonte.'));
      }
    }

    if (r.viavel && estado.saldoInformadoEm && estado.saldoInformadoEm !== estado.dataReferencia) {
      avisos.appendChild(montarAviso('atencao', '&#9679;',
        '<b>Confira o saldo antes de transferir.</b> O valor em conta foi informado em ' +
        dataLonga(estado.saldoInformadoEm) + ' e a projeção já está rodando a partir de ' +
        dataLonga(estado.dataReferencia) + '.'));
    }
    if (r.deficitMensal > 0) {
      avisos.appendChild(montarAviso('atencao', '&#9679;',
        '<b>Suas saídas passam as entradas em cerca de ' + E.formatarBRL(r.deficitMensal) +
        ' por mês.</b> Enquanto isso durar não existe sobra estável para investir: ' +
        'o valor de hoje sai do que já está em caixa e encolhe conforme você aumenta o horizonte.'));
    }

    if (estado.exemplo) $('#banner-exemplo').classList.remove('oculto');
    else $('#banner-exemplo').classList.add('oculto');

    // ------------------------------------------------------------- fatos
    var fatos = $('#fatos');
    fatos.textContent = '';
    var proxima = r.lancamentos.filter(function (l) {
      return l.centavos > 0 && l.dia >= r.diaInicio;
    })[0];
    var proximaSaida = r.lancamentos.filter(function (l) {
      return l.centavos < 0 && l.dia >= r.diaInicio;
    })[0];

    fato(fatos, 'Saldo hoje', E.formatarBRL(E.paraCentavos(estado.saldoInicial)));
    fato(fatos, 'Piso do saldo', E.formatarBRL(r.restricoes.pisoCentavos),
         r.colchao > 0
           ? 'limite ' + E.formatarBRL(r.pisoBruto) + ' + colchão ' + E.formatarBRL(r.colchao)
           : 'a projeção nunca pode passar disso');
    if (proxima) {
      fato(fatos, 'Próxima entrada', E.formatarBRL(proxima.centavos),
           proxima.nome + ' &middot; ' + dataLonga(proxima.iso));
    }
    if (proximaSaida) {
      fato(fatos, 'Próxima saída', E.formatarBRL(-proximaSaida.centavos),
           proximaSaida.nome + ' &middot; ' + dataLonga(proximaSaida.iso));
    }
    var menor = r.avaliacaoPlano.menorSaldoDia;
    if (menor) {
      fato(fatos, 'Dia mais apertado', E.formatarBRL(menor.saldo), dataLonga(menor.iso) + ', com o plano');
    }
    var totalPlano = r.plano.linhas.reduce(function (soma, l) { return soma + l.centavos; }, 0);
    fato(fatos, 'Total do plano', E.formatarBRL(totalPlano),
         r.plano.linhas.length + ' aporte(s) até ' + comAno(r.diaFimExibicao));
  }

  /** Qual restricao esta' segurando o valor de hoje - a pergunta que vem depois do numero. */
  function explicarTrava(r) {
    var t = r.trava || {};
    // Quando o maximo e' zero o motivo importa MAIS, nao menos: e' a diferenca
    // entre "espere o salario" e "sua franquia do mes acabou". Muda so' o
    // enquadramento da frase, nunca o diagnostico.
    var zerado = t.centavos === 0;
    var prefixo = zerado ? '<b>Não sobra nada hoje.</b> ' : '';
    var maisQueIsso = zerado ? 'Tirar qualquer valor' : 'Tirar um real a mais';

    if (!zerado && t.trava === 'saldo') {
      return '<b>O teto é o próprio saldo.</b> Você pode transferir tudo o que tem em conta: ' +
             'as saídas até o próximo recebimento cabem dentro do vermelho permitido.';
    }
    if (!zerado && t.trava === 'piso') {
      return '<b>O teto é o piso do saldo</b> (' + E.formatarBRL(r.restricoes.pisoCentavos) +
             (r.colchao > 0 ? ', já com o colchão preservado' : '') + ').';
    }

    var a = t.avaliacaoNoLimite;
    if (!a) return prefixo + 'O saldo já está comprometido com o que vem pela frente.';

    if (a.furoPiso) {
      return prefixo + maisQueIsso + ' e o saldo de ' + dataLonga(a.furoPiso.iso) +
             ' passaria de ' + E.formatarBRL(r.restricoes.pisoCentavos) +
             (r.colchao > 0 ? ', o piso com o colchão preservado.' : ', o piso da conta.');
    }
    if (a.estouroCiclo && a.modoFranquia === 'mensal') {
      var c = a.estouroCiclo.ciclo;
      return prefixo + '<b>O que trava é a franquia de ' + c.rotulo + '.</b> ' + maisQueIsso +
             ' e você usaria ' + c.dias + ' dos ' + r.restricoes.maxDiasNegativos +
             ' dias de vermelho do ciclo' +
             (c.jaUsados ? ', porque ' + c.jaUsados + ' já foram gastos antes de hoje' : '') +
             ' &mdash; a partir daí o banco cobra juros.';
    }
    if (a.estouroCorrida) {
      return prefixo + '<b>O que trava é o prazo do vermelho.</b> ' + maisQueIsso +
             ' e a conta ficaria negativa por mais de ' + r.restricoes.maxDiasNegativos +
             ' dias corridos a partir de ' + dataLonga(a.piorCorridaInicio.iso) +
             ' &mdash; aí começa a contar juros.';
    }
    if (a.sequenciaAberta) {
      return prefixo + '<b>O que trava é o fim da projeção.</b> ' + maisQueIsso +
             ' e o saldo ficaria negativo desde ' + dataLonga(a.sequenciaAberta.inicio.iso) +
             ' sem entrada que cubra dentro do horizonte.';
    }
    return prefixo;
  }

  /**
   * Quanto da franquia o plano consome. No modo mensal a frase tem que falar
   * em ciclos, nao em sequencias: o que o banco cobra e' o total de dias
   * negativos do mes, grudados ou nao.
   */
  function resumoDoVermelho(r) {
    var a = r.avaliacaoPlano;
    var limite = r.restricoes.maxDiasNegativos;
    var pior = E.formatarBRL(a.menorSaldo);

    if (a.modoFranquia === 'mensal') {
      // Dias que ESTE plano gasta, nao os que ja estavam gastos: um ciclo que
      // so' carrega o contador do banco nao significa que o plano use o vermelho.
      var ciclos = (a.ciclos || []).filter(function (c) { return c.dias > c.jaUsados; });
      if (!ciclos.length) return '';

      function descrever(c) {
        var novos = c.dias - c.jaUsados;
        return '<b>' + novos + ' dia' + (novos > 1 ? 's' : '') + '</b> em ' + c.rotulo +
               ' (' + c.dias + ' de ' + limite + ' no ciclo' +
               (c.jaUsados ? ', contando os ' + c.jaUsados + ' já usados' : '') + ')';
      }

      // Num horizonte de meses, listar todo ciclo vira parede de texto. O que
      // interessa e' o ciclo atual (o que da' para agir hoje) e o mais apertado.
      var texto = '<b>Esse plano usa o vermelho.</b> Consome ' + descrever(ciclos[0]);
      if (ciclos.length > 1) {
        var apertado = ciclos.slice(1).reduce(function (x, y) { return y.dias > x.dias ? y : x; });
        texto += '. Nos meses seguintes o mais apertado é <b>' + apertado.rotulo + '</b>, com ' +
                 apertado.dias + ' de ' + limite +
                 (ciclos.length > 2 ? ' (ao todo ' + ciclos.length + ' meses com vermelho)' : '');
      }
      return texto + '. O pior saldo é ' + pior + '.';
    }

    var seqs = (a.sequencias || []).filter(function (s) { return s.dias > 0; });
    if (!seqs.length) return '';
    var maior = seqs.reduce(function (x, y) { return y.dias > x.dias ? y : x; });
    return '<b>Esse plano usa o vermelho.</b> O saldo fica negativo por ' + maior.dias +
           ' dia' + (maior.dias > 1 ? 's' : '') + ' corrido' + (maior.dias > 1 ? 's' : '') +
           ', de ' + dataLonga(maior.inicio.iso) + ' a ' + dataLonga(maior.fim.iso) +
           ' &mdash; dentro dos ' + limite + ' que a conta permite. O pior saldo é ' + pior + '.';
  }

  function fato(pai, chave, valor, sub) {
    var v = criar('span', { class: 'v' });
    v.appendChild(document.createTextNode(valor));
    if (sub) { var s = criar('small'); s.innerHTML = sub; v.appendChild(s); }
    pai.appendChild(criar('div', { class: 'fato' }, [criar('span', { class: 'k', text: chave }), v]));
  }

  function montarAviso(nivel, icone, html) {
    var el = criar('div', { class: 'aviso ' + nivel });
    var ic = criar('span', { class: 'icone' });
    ic.innerHTML = icone;
    var p = criar('p');
    p.innerHTML = html;
    el.appendChild(ic); el.appendChild(p);
    return el;
  }

  function avisoDoFuro(r) {
    var a = r.avaliacaoBase;
    var texto;
    if (a.furoPiso) {
      var falta = r.restricoes.pisoCentavos - a.furoPiso.saldo;
      texto = '<b>O seu fluxo não fecha sozinho.</b> Em ' + dataLonga(a.furoPiso.iso) +
        ' o saldo chega a ' + E.formatarBRL(a.furoPiso.saldo) + ', ' + E.formatarBRL(falta) +
        ' abaixo do limite de ' + E.formatarBRL(r.restricoes.pisoCentavos) +
        '. Não há o que investir: falta dinheiro.';
    } else if (a.estouroCiclo && a.modoFranquia === 'mensal') {
      var ciclo = a.estouroCiclo.ciclo;
      texto = '<b>A franquia de ' + ciclo.rotulo + ' não dá conta.</b> Mesmo sem tirar nada, ' +
        'o saldo fica negativo ' + ciclo.dias + ' dias nesse ciclo, acima dos ' +
        r.restricoes.maxDiasNegativos + ' sem juros' +
        (ciclo.jaUsados ? ' (' + ciclo.jaUsados + ' já usados antes de hoje)' : '') + '.';
    } else if (a.estouroCorrida) {
      texto = '<b>O vermelho passa do prazo.</b> A partir de ' + dataLonga(a.piorCorridaInicio.iso) +
        ' o saldo fica negativo por ' + a.piorCorrida + ' dias corridos, acima dos ' +
        r.restricoes.maxDiasNegativos + ' permitidos &mdash; aí começa a contar juros.';
    } else if (a.sequenciaAberta) {
      texto = '<b>O saldo fica negativo e não volta.</b> Desde ' + dataLonga(a.sequenciaAberta.inicio.iso) +
        ' a projeção não mostra entrada suficiente para cobrir. Confira se falta cadastrar alguma entrada, ' +
        'ou aumente o horizonte.';
    } else {
      texto = '<b>A projeção não fecha.</b> Revise os lançamentos.';
    }
    return montarAviso('critico', '&#9888;', texto);
  }

  // ---------------------------------------------------------- render: plano

  function renderPlano(r) {
    var corpo = $('#tabela-plano').querySelector('tbody');
    corpo.textContent = '';
    var linhas = r.plano.linhas;
    $('#plano-vazio').classList.toggle('oculto', linhas.length > 0);
    $('#tabela-plano').classList.toggle('oculto', linhas.length === 0);

    var acumulado = 0;
    linhas.forEach(function (l) {
      var motivo;
      if (l.dia === r.diaInicio) {
        motivo = 'hoje, com o saldo em conta';
      } else {
        var entradasDoDia = r.lancamentos.filter(function (x) {
          return x.dia === l.dia && x.centavos > 0;
        }).map(function (x) { return x.nome; });
        motivo = entradasDoDia.length ? 'entrou ' + entradasDoDia.join(' + ') : 'sobra acumulada';
      }
      var valor = l.centavos;
      acumulado += valor;
      corpo.appendChild(criar('tr', { class: l.dia === r.diaInicio ? 'hoje' : '' }, [
        criar('td', { text: comAno(l.dia) }),
        criar('td', { text: textoDiaSemana(l.dia) }),
        criar('td', { text: motivo }),
        criar('td', { class: 'num', text: E.formatarBRL(valor) }),
        criar('td', { class: 'num', text: E.formatarBRL(acumulado) })
      ]));
    });
  }

  // -------------------------------------------------------- render: extrato

  function renderExtrato(r) {
    var corpo = $('#tabela-extrato').querySelector('tbody');
    corpo.textContent = '';
    var todos = $('#chk-todos-dias').checked;
    var dias = r.comPlano.dias.filter(function (d) { return d.dia <= r.diaFimExibicao; });

    dias.forEach(function (d) {
      var relevante = todos || d.itens.length > 0 || d.retirada > 0 || d.saldo < 0 || d.dia === r.diaInicio;
      if (!relevante) return;
      var nomes = criar('td');
      d.itens.forEach(function (it, i) {
        if (i) nomes.appendChild(document.createTextNode(' '));
        nomes.appendChild(criar('span', {
          class: 'marca ' + (it.centavos >= 0 ? 'entrada' : 'saida'), text: it.nome
        }));
      });
      if (d.retirada > 0) {
        if (d.itens.length) nomes.appendChild(document.createTextNode(' '));
        nomes.appendChild(criar('span', { class: 'marca aporte', text: 'aporte' }));
      }
      var classe = [];
      if (d.saldo < 0) classe.push('negativo');
      if (d.dia === r.diaInicio) classe.push('hoje');
      corpo.appendChild(criar('tr', { class: classe.join(' ') }, [
        criar('td', { text: comAno(d.dia) }),
        criar('td', { text: textoDiaSemana(d.dia) }),
        nomes,
        criar('td', { class: 'num', text: d.entradas ? E.formatarBRL(d.entradas) : '' }),
        criar('td', { class: 'num', text: d.saidas ? E.formatarBRL(d.saidas) : '' }),
        criar('td', { class: 'num', text: d.retirada ? E.formatarBRL(d.retirada) : '' }),
        criar('td', { class: 'num saldo', text: E.formatarBRL(d.saldo) }),
        criar('td', { text: d.saldo < 0 ? diaDaSequencia(r, d) : '' })
      ]));
    });
  }

  /** "3º de 10 · set" - em que ponto da franquia esse dia negativo esta'. */
  function diaDaSequencia(r, dia) {
    var limite = r.restricoes.maxDiasNegativos;
    // No modo mensal, avaliar() carimba o contador do ciclo em cada dia.
    if (r.avaliacaoPlano.modoFranquia === 'mensal') {
      if (!dia.ciclo) return '';
      return dia.diaDoCiclo + 'º de ' + limite + ' · ' + dia.ciclo.rotulo.split('/')[0];
    }
    var seq = (r.avaliacaoPlano.sequencias || []).find(function (s) {
      return dia.dia >= s.inicio.dia && dia.dia <= s.fim.dia;
    });
    if (!seq) return '';
    return (dia.dia - seq.inicio.dia + 1) + 'º de ' + limite;
  }

  // -------------------------------------------------------- render: grafico

  // Margens do grafico. A esquerda cabe "-R$ 100.000"; a direita cabe o rotulo
  // do limite e os rotulos diretos das duas series - sem eles, a identidade das
  // linhas dependeria so' da cor.
  var L = 80, Rr = 104, T = 16, B = 30, W = 920, H = 320;

  function renderGrafico(r) {
    var svg = $('#grafico');
    var dias = r.comPlano.dias.filter(function (d) { return d.dia <= r.diaFimExibicao; });
    var base = r.semAportes.dias.filter(function (d) { return d.dia <= r.diaFimExibicao; });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.textContent = '';
    if (dias.length < 2) { estadoGrafico = null; return; }

    var piso = r.restricoes.pisoCentavos;
    var valores = dias.map(function (d) { return d.saldo; }).concat(base.map(function (d) { return d.saldo; }));
    var min = Math.min.apply(null, valores.concat([0, piso]));
    var max = Math.max.apply(null, valores.concat([0]));
    var folga = Math.max((max - min) * 0.08, 5000);
    min -= folga; max += folga;

    var x = function (i) { return L + (i / (dias.length - 1)) * (W - L - Rr); };
    var y = function (v) { return T + (1 - (v - min) / (max - min)) * (H - T - B); };

    var ns = 'http://www.w3.org/2000/svg';
    function el(nome, attrs) {
      var n = document.createElementNS(ns, nome);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    }
    function texto(conteudo, attrs) {
      var n = el('text', attrs);
      n.textContent = conteudo;
      return n;
    }

    // Zona negativa: uma faixa discreta, para o "abaixo de zero" ler como regiao.
    if (min < 0) {
      svg.appendChild(el('rect', {
        x: L, y: y(0), width: W - L - Rr, height: Math.max(0, y(min) - y(0)),
        fill: 'var(--critico)', opacity: 0.05
      }));
    }

    // Grade horizontal em passos redondos.
    var passo = passoBonito((max - min) / 5);
    for (var v = Math.ceil(min / passo) * passo; v <= max; v += passo) {
      var ehZero = Math.abs(v) < 1;
      svg.appendChild(el('line', {
        x1: L, x2: W - Rr, y1: y(v), y2: y(v),
        stroke: ehZero ? 'var(--eixo)' : 'var(--grade)', 'stroke-width': ehZero ? 1.5 : 1
      }));
      svg.appendChild(texto(formatarCurto(v), {
        x: L - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--tinta-3)'
      }));
    }

    // Limite negativo da conta.
    if (piso < 0 && piso > min) {
      svg.appendChild(el('line', {
        x1: L, x2: W - Rr, y1: y(piso), y2: y(piso),
        stroke: 'var(--critico)', 'stroke-width': 2, 'stroke-dasharray': '5 4'
      }));
      svg.appendChild(texto('limite ' + formatarCurto(piso), {
        x: W - Rr + 6, y: y(piso) + 4, 'font-size': 10.5, fill: 'var(--critico)'
      }));
    }

    // Marcas de mes no eixo x.
    var mesAnterior = null;
    dias.forEach(function (d, i) {
      var m = E.mesDe(d.dia);
      if (m !== mesAnterior) {
        mesAnterior = m;
        if (i > 0) {
          svg.appendChild(el('line', {
            x1: x(i), x2: x(i), y1: T, y2: H - B, stroke: 'var(--grade)', 'stroke-width': 1
          }));
        }
        svg.appendChild(texto(E.rotuloCurto(d.dia), {
          x: x(i), y: H - B + 16, 'text-anchor': i === 0 ? 'start' : 'middle',
          'font-size': 11, fill: 'var(--tinta-3)'
        }));
      }
    });

    function caminho(lista) {
      return lista.map(function (d, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d.saldo).toFixed(1); }).join(' ');
    }
    function linha(d, cor) {
      return el('path', {
        d: d, fill: 'none', stroke: cor, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      });
    }

    // Sem nenhum aporte possivel as duas curvas sao a mesma. Desenhar as duas
    // empilha dois rotulos no mesmo pixel e vira ilegivel: vira uma serie so'.
    var iguais = dias.every(function (d, i) { return d.saldo === base[i].saldo; });
    var ultimo = dias.length - 1;

    svg.appendChild(linha(caminho(base), 'var(--serie-1)'));
    if (!iguais) svg.appendChild(linha(caminho(dias), 'var(--serie-2)'));

    // Rotulos diretos: com duas series a identidade nao pode depender so' da cor.
    if (iguais) {
      svg.appendChild(texto('saldo', {
        x: x(ultimo) + 6, y: y(base[ultimo].saldo) + 4, 'font-size': 11, fill: 'var(--serie-1)'
      }));
    } else {
      // Se as pontas ficam perto demais, afasta uma para cima e outra para baixo.
      var ySem = y(base[ultimo].saldo);
      var yCom = y(dias[ultimo].saldo);
      if (Math.abs(ySem - yCom) < 13) {
        var meio = (ySem + yCom) / 2;
        ySem = meio - 7; yCom = meio + 7;
      }
      svg.appendChild(texto('sem tirar', {
        x: x(ultimo) + 6, y: ySem + 4, 'font-size': 11, fill: 'var(--serie-1)'
      }));
      svg.appendChild(texto('com plano', {
        x: x(ultimo) + 6, y: yCom + 4, 'font-size': 11, fill: 'var(--serie-2)'
      }));
    }
    $('#chave-com-plano').classList.toggle('oculto', iguais);

    montarInteracao(svg, el, dias, base, x, y);
  }

  function passoBonito(bruto) {
    var mag = Math.pow(10, Math.floor(Math.log10(Math.max(bruto, 1))));
    var n = bruto / mag;
    var mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return mult * mag;
  }

  /**
   * Crosshair + tooltip. Um grafico de linha em HTML tem que responder ao
   * mouse e ao dedo.
   *
   * O desenho e' refeito a cada recalculo (svg.textContent = ''), mas os
   * listeners ficam no proprio <svg>, que sobrevive. Por isso eles sao ligados
   * UMA vez e leem o estado atual daqui - ligar a cada render empilharia um
   * handler novo por tecla digitada, todos com dados velhos.
   */
  var estadoGrafico = null;
  var interacaoLigada = false;

  function montarInteracao(svg, el, dias, base, x, y) {
    var grupo = el('g', { opacity: 0, 'pointer-events': 'none' });
    var reta = el('line', { y1: T, y2: H - B, stroke: 'var(--tinta-3)', 'stroke-width': 1 });
    var pA = el('circle', { r: 4.5, fill: 'var(--serie-1)', stroke: 'var(--superficie)', 'stroke-width': 2 });
    var pB = el('circle', { r: 4.5, fill: 'var(--serie-2)', stroke: 'var(--superficie)', 'stroke-width': 2 });
    grupo.appendChild(reta); grupo.appendChild(pA); grupo.appendChild(pB);
    svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent', 'pointer-events': 'all' }));
    svg.appendChild(grupo);

    estadoGrafico = { grupo: grupo, reta: reta, pA: pA, pB: pB, dias: dias, base: base, x: x, y: y };
    if (interacaoLigada) return;
    interacaoLigada = true;

    svg.addEventListener('mousemove', mover);
    svg.addEventListener('mouseleave', sairDoGrafico);
    svg.addEventListener('touchstart', mover, { passive: true });
    svg.addEventListener('touchmove', mover, { passive: true });
    svg.addEventListener('touchend', sairDoGrafico);

    function mover(ev) {
      var g = estadoGrafico;
      if (!g || g.dias.length < 2) return;
      var svgAtual = $('#grafico');
      var caixa = svgAtual.getBoundingClientRect();
      if (!caixa.width) return;
      var toque = ev.touches && ev.touches[0];
      var cx = (toque ? toque.clientX : ev.clientX) - caixa.left;
      var escala = W / caixa.width;
      var i = Math.round(((cx * escala) - L) / (W - L - Rr) * (g.dias.length - 1));
      i = Math.max(0, Math.min(g.dias.length - 1, i));
      var d = g.dias[i], b = g.base[i];

      g.grupo.setAttribute('opacity', 1);
      g.reta.setAttribute('x1', g.x(i)); g.reta.setAttribute('x2', g.x(i));
      g.pA.setAttribute('cx', g.x(i)); g.pA.setAttribute('cy', g.y(b.saldo));
      g.pB.setAttribute('cx', g.x(i)); g.pB.setAttribute('cy', g.y(d.saldo));
      g.pB.setAttribute('opacity', b.saldo === d.saldo ? 0 : 1);

      var eventos = d.itens.map(function (it) {
        return it.nome + ' ' + E.formatarBRL(it.centavos);
      });
      if (d.retirada) eventos.push('aporte ' + E.formatarBRL(-d.retirada));

      var dica = $('#dica-grafico');
      dica.innerHTML =
        '<div class="titulo">' + dataLonga(d.iso) + '</div>' +
        (b.saldo === d.saldo
          ? '<div class="par"><span>saldo</span><span class="v">' + E.formatarBRL(d.saldo) + '</span></div>'
          : '<div class="par"><span>sem tirar</span><span class="v">' + E.formatarBRL(b.saldo) + '</span></div>' +
            '<div class="par"><span>com plano</span><span class="v">' + E.formatarBRL(d.saldo) + '</span></div>') +
        (eventos.length ? '<div class="ev">' + eventos.join('<br>') + '</div>' : '');
      dica.classList.add('visivel');
      var esq = (g.x(i) / W) * caixa.width;
      dica.style.left = Math.max(90, Math.min(caixa.width - 90, esq)) + 'px';
      dica.style.top = ((Math.min(g.y(d.saldo), g.y(b.saldo)) / H) * caixa.height - 10) + 'px';
    }

    function sairDoGrafico() {
      if (estadoGrafico) estadoGrafico.grupo.setAttribute('opacity', 0);
      $('#dica-grafico').classList.remove('visivel');
    }
  }

  // --------------------------------------------------------- render: regras

  var TIPOS_AGENDA = [
    ['diaFixo', 'Dia fixo do mês'],
    ['diaUtil', 'N-ésimo dia útil'],
    ['ultimoDiaUtil', 'Último dia útil'],
    ['unica', 'Data única']
  ];
  var AJUSTES = [
    ['nenhum', 'manter a data'],
    ['anterior', 'antecipa'],
    ['seguinte', 'adia']
  ];

  function renderRegras(r) {
    ['entrada', 'saida'].forEach(function (tipo) {
      var alvo = $(tipo === 'entrada' ? '#lista-entradas' : '#lista-saidas');
      var vazio = $(tipo === 'entrada' ? '#entradas-vazio' : '#saidas-vazio');
      alvo.textContent = '';
      var lista = estado.regras.filter(function (x) { return x.tipo === tipo; });
      vazio.classList.toggle('oculto', lista.length > 0);
      lista.forEach(function (regra) { alvo.appendChild(linhaDeRegra(regra, r)); });
    });
  }

  function linhaDeRegra(regra, r) {
    var linha = criar('div', { class: 'regra' + (regra.ativo === false ? ' inativa' : '') });

    var ativo = criar('input', { type: 'checkbox' });
    ativo.checked = regra.ativo !== false;
    ativo.addEventListener('change', function () { regra.ativo = ativo.checked; aplicar(); });
    linha.appendChild(criar('div', {}, [ativo]));

    linha.appendChild(campo('Descrição', inputTexto(regra.nome, function (v) { regra.nome = v; }), 'largo'));
    linha.appendChild(campo('Valor', inputDinheiro(regra.valor, function (v) { regra.valor = v; })));

    var agenda = regra.agenda || (regra.agenda = { tipo: 'diaFixo', dia: 1 });
    var selTipo = inputSelect(TIPOS_AGENDA, agenda.tipo, function (v) {
      agenda.tipo = v;
      if (v === 'diaFixo' && !agenda.dia) agenda.dia = 1;
      if (v === 'diaUtil' && !agenda.n) agenda.n = 1;
      if (v === 'unica' && !agenda.data) agenda.data = estado.dataReferencia;
      aplicar();
    });
    linha.appendChild(campo('Quando', selTipo));

    var detalhe;
    if (agenda.tipo === 'diaFixo') {
      detalhe = campo('Dia', inputNumero(agenda.dia, 1, 31, function (v) { agenda.dia = v; }));
    } else if (agenda.tipo === 'diaUtil') {
      detalhe = campo('Qual dia útil', inputNumero(agenda.n, 1, 23, function (v) { agenda.n = v; }));
    } else if (agenda.tipo === 'unica') {
      detalhe = campo('Data', inputData(agenda.data, function (v) { agenda.data = v; }));
    } else {
      detalhe = campo('', criar('span', { class: 'so-rotulo', text: 'todo mês' }));
    }
    linha.appendChild(detalhe);

    if (agenda.tipo === 'diaFixo' || agenda.tipo === 'unica') {
      linha.appendChild(campo('Se cair em dia não útil',
        inputSelect(AJUSTES, regra.ajuste || 'nenhum', function (v) { regra.ajuste = v; aplicar(); })));
    } else {
      linha.appendChild(criar('div'));
    }

    linha.appendChild(criar('div', {}, [criar('button', {
      class: 'discreto perigo', title: 'Remover', text: '×',
      onclick: function () {
        estado.regras = estado.regras.filter(function (x) { return x.id !== regra.id; });
        aplicar();
      }
    })]));

    // Avancado: vigencia e valores diferentes em meses especificos.
    var det = criar('details', { class: 'dobra regra-extra' });
    var resumo = criar('summary');
    resumo.textContent = resumoAvancado(regra) || 'vigência e valores mês a mês';
    det.appendChild(resumo);
    var grade = criar('div', { class: 'grade-campos', style: 'margin:10px 0 4px' });
    grade.appendChild(campo('Começa em', inputMes(regra.vigenciaInicio, function (v) { regra.vigenciaInicio = v || null; })));
    grade.appendChild(campo('Termina em', inputMes(regra.vigenciaFim, function (v) { regra.vigenciaFim = v || null; })));
    grade.appendChild(campo('Valores mês a mês',
      inputTexto(serializarOverrides(regra.valoresPorMes), function (v) {
        regra.valoresPorMes = lerOverrides(v);
      }), 'largo'));
    det.appendChild(grade);
    det.appendChild(criar('div', { class: 'vazio', text: 'Ex.: 2026-12 = 12000; 2027-01 = 8000' }));

    // Proximas ocorrencias, para conferir se a regra caiu onde devia.
    var proximas = r.lancamentos.filter(function (l) { return l.regraId === regra.id; }).slice(0, 4);
    if (proximas.length) {
      det.appendChild(criar('div', {
        class: 'vazio',
        text: 'Próximas: ' + proximas.map(function (l) {
          return E.rotuloCurto(l.dia) + ' (' + textoDiaSemana(l.dia) + ') ' + E.formatarBRL(Math.abs(l.centavos));
        }).join('  ·  ')
      }));
    }
    linha.appendChild(det);
    return linha;
  }

  function resumoAvancado(regra) {
    var partes = [];
    if (regra.vigenciaInicio) partes.push('de ' + regra.vigenciaInicio);
    if (regra.vigenciaFim) partes.push('até ' + regra.vigenciaFim);
    var n = Object.keys(regra.valoresPorMes || {}).length;
    if (n) partes.push(n + ' mês(es) com valor próprio');
    return partes.join(', ');
  }

  function serializarOverrides(mapa) {
    return Object.keys(mapa || {}).sort().map(function (k) {
      return k + ' = ' + paraCampo(E.paraCentavos(mapa[k]));
    }).join('; ');
  }

  function lerOverrides(texto) {
    var saida = {};
    String(texto || '').split(/[;\n]/).forEach(function (parte) {
      var m = parte.match(/(\d{4}-\d{2})\s*=\s*(.+)/);
      if (m) saida[m[1]] = E.paraReais(E.paraCentavos(m[2]));
    });
    return saida;
  }

  function campo(rotulo, controle, extra) {
    var l = criar('label', { class: 'campo' + (extra ? ' ' + extra : '') });
    if (rotulo) l.appendChild(criar('span', { class: 'so-rotulo', text: rotulo }));
    l.appendChild(controle);
    return l;
  }

  function inputTexto(valor, aoMudar) {
    var i = criar('input', { type: 'text', value: valor == null ? '' : valor });
    i.addEventListener('change', function () { aoMudar(i.value); aplicar(); });
    return i;
  }
  function inputDinheiro(valorReais, aoMudar) {
    var i = criar('input', { type: 'text', inputmode: 'decimal', value: paraCampo(E.paraCentavos(valorReais)) });
    i.addEventListener('change', function () {
      var c = E.paraCentavos(i.value);
      i.value = paraCampo(c);
      aoMudar(E.paraReais(c));
      aplicar();
    });
    return i;
  }
  function inputNumero(valor, min, max, aoMudar) {
    var i = criar('input', { type: 'number', min: min, max: max, step: 1, value: valor == null ? '' : valor });
    i.addEventListener('change', function () { aoMudar(Number(i.value) || min); aplicar(); });
    return i;
  }
  function inputData(valor, aoMudar) {
    var i = criar('input', { type: 'date', value: valor || '' });
    i.addEventListener('change', function () { aoMudar(i.value); aplicar(); });
    return i;
  }
  function inputMes(valor, aoMudar) {
    var i = criar('input', { type: 'month', value: valor || '' });
    i.addEventListener('change', function () { aoMudar(i.value); aplicar(); });
    return i;
  }
  function inputSelect(opcoes, valor, aoMudar) {
    var s = criar('select');
    opcoes.forEach(function (o) {
      var op = criar('option', { value: o[0], text: o[1] });
      if (o[0] === valor) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener('change', function () { aoMudar(s.value); });
    return s;
  }

  // ------------------------------------------------------- config <-> DOM

  function preencherConfig() {
    $('#cfg-saldo').value = paraCampo(E.paraCentavos(estado.saldoInicial));
    $('#cfg-data').value = estado.dataReferencia || hojeISO();
    $('#cfg-limite').value = paraCampo(E.paraCentavos(estado.limiteNegativo));
    $('#cfg-dias').value = estado.maxDiasNegativos;
    $('#cfg-modo-franquia').value = estado.modoFranquia === 'corridos' ? 'corridos' : 'mensal';
    $('#cfg-dias-usados').value = Number(estado.diasJaUsadosNoCiclo) || 0;
    $('#cfg-virada').value = Number(estado.diaViradaCiclo) || 1;
    $('#cfg-colchao').value = paraCampo(E.paraCentavos(estado.colchao));
    $('#cfg-minimo').value = paraCampo(E.paraCentavos(estado.aporteMinimo));
    $('#cfg-horizonte').value = String(estado.horizonteMeses);
    $('#cfg-conservador').checked = !!estado.conservador;
    $('#cfg-bancario').checked = estado.feriadosBancarios !== false;
    $('#cfg-feriados').value = (estado.feriadosExtras || []).map(function (f) {
      return typeof f === 'string' ? f : (f.data + ' ' + (f.nome || ''));
    }).join('\n').trim();
  }

  function ligarConfig() {
    function dinheiro(sel, chave) {
      $(sel).addEventListener('change', function () {
        var c = E.paraCentavos($(sel).value);
        $(sel).value = paraCampo(c);
        estado[chave] = E.paraReais(c);
        estado.exemplo = false;
        aplicar();
      });
    }
    dinheiro('#cfg-saldo', 'saldoInicial');
    // Saber QUANDO o saldo foi digitado e' o que permite avisar que ele envelheceu.
    $('#cfg-saldo').addEventListener('change', function () {
      estado.saldoInformadoEm = estado.dataReferencia;
      dataFoiAvancada = false;
      aplicar();
    });
    dinheiro('#cfg-limite', 'limiteNegativo');
    dinheiro('#cfg-colchao', 'colchao');
    dinheiro('#cfg-minimo', 'aporteMinimo');

    $('#cfg-data').addEventListener('change', function () {
      estado.dataReferencia = $('#cfg-data').value || hojeISO(); aplicar();
    });
    $('#cfg-dias').addEventListener('change', function () {
      estado.maxDiasNegativos = Math.max(0, Number($('#cfg-dias').value) || 0); aplicar();
    });
    $('#cfg-modo-franquia').addEventListener('change', function () {
      estado.modoFranquia = $('#cfg-modo-franquia').value; aplicar();
    });
    $('#cfg-dias-usados').addEventListener('change', function () {
      estado.diasJaUsadosNoCiclo = Math.max(0, Number($('#cfg-dias-usados').value) || 0); aplicar();
    });
    $('#cfg-virada').addEventListener('change', function () {
      estado.diaViradaCiclo = Math.min(28, Math.max(1, Number($('#cfg-virada').value) || 1)); aplicar();
    });
    $('#cfg-horizonte').addEventListener('change', function () {
      estado.horizonteMeses = Number($('#cfg-horizonte').value); aplicar();
    });
    $('#cfg-conservador').addEventListener('change', function () {
      estado.conservador = $('#cfg-conservador').checked; aplicar();
    });
    $('#cfg-bancario').addEventListener('change', function () {
      estado.feriadosBancarios = $('#cfg-bancario').checked; aplicar();
    });
    $('#cfg-feriados').addEventListener('change', function () {
      estado.feriadosExtras = $('#cfg-feriados').value.split('\n').map(function (linha) {
        var m = linha.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
        return m ? { data: m[1], nome: m[2] || 'Feriado local' } : null;
      }).filter(Boolean);
      aplicar();
    });
    $('#chk-todos-dias').addEventListener('change', aplicar);

    $('#btn-nova-entrada').addEventListener('click', function () { novaRegra('entrada'); });
    $('#btn-nova-avulso').addEventListener('click', function () { novaRegra('entrada', 'unica'); });
    $('#btn-nova-saida').addEventListener('click', function () { novaRegra('saida'); });
    $('#btn-limpar-exemplo').addEventListener('click', function () {
      estado = estadoVazio(); aplicar(true);
    });
    $('#btn-exemplo').addEventListener('click', function () {
      if (confirm('Substituir os dados atuais pelo exemplo?')) { estado = estadoExemplo(); aplicar(true); }
    });
    $('#btn-zerar').addEventListener('click', function () {
      if (confirm('Apagar todos os lançamentos e começar do zero?')) { estado = estadoVazio(); aplicar(true); }
    });
    $('#btn-exportar').addEventListener('click', exportar);
    $('#btn-importar').addEventListener('click', function () { $('#arquivo-importar').click(); });
    $('#arquivo-importar').addEventListener('change', importar);
    $('#btn-tema').addEventListener('click', alternarTema);
  }

  function novaRegra(tipo, forma) {
    var avulso = forma === 'unica';
    estado.regras.push({
      id: idNovo(),
      nome: avulso ? 'Reembolso' : (tipo === 'entrada' ? 'Nova entrada' : 'Nova saída'),
      tipo: tipo, valor: 0, ativo: true,
      agenda: avulso ? { tipo: 'unica', data: estado.dataReferencia || hojeISO() } : { tipo: 'diaFixo', dia: 1 },
      ajuste: tipo === 'entrada' ? 'anterior' : 'seguinte',
      valoresPorMes: {}
    });
    estado.exemplo = false;
    aplicar(true);
  }

  // ------------------------------------------------------ backup e tema

  function exportar() {
    var blob = new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = criar('a', { href: url, download: 'fluxo-caixa-' + hojeISO() + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    $('#status-dados').textContent = 'Backup baixado.';
  }

  function importar(ev) {
    var arquivo = ev.target.files && ev.target.files[0];
    if (!arquivo) return;
    var leitor = new FileReader();
    leitor.onload = function () {
      try {
        var novo = JSON.parse(leitor.result);
        if (!novo || !Array.isArray(novo.regras)) throw new Error('formato');
        estado = novo;
        aplicar(true);
        $('#status-dados').textContent = 'Backup restaurado.';
      } catch (err) {
        $('#status-dados').textContent = 'Não consegui ler esse arquivo: ' + err.message;
      }
    };
    leitor.readAsText(arquivo);
    ev.target.value = '';
  }

  function alternarTema() {
    var atual = document.documentElement.getAttribute('data-theme');
    var proximo = atual === 'dark' ? 'light' : atual === 'light' ? '' : 'dark';
    if (proximo) document.documentElement.setAttribute('data-theme', proximo);
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('fluxo-caixa/tema', proximo); } catch (err) { /* ignora */ }
  }

  // ------------------------------------------------------------- orquestra

  function aplicar(redesenharCampos) {
    salvar();
    var r = calcular();
    renderResposta(r);
    renderPlano(r);
    renderGrafico(r);
    renderExtrato(r);
    renderRegras(r);
    if (redesenharCampos) preencherConfig();
  }

  function iniciar() {
    try {
      var tema = localStorage.getItem('fluxo-caixa/tema');
      if (tema) document.documentElement.setAttribute('data-theme', tema);
    } catch (err) { /* ignora */ }
    preencherConfig();
    ligarConfig();
    aplicar();
    if (dataFoiAvancada) salvar();
    registrarServiceWorker();
    window.addEventListener('resize', function () { renderGrafico(calcular()); });
  }

  /**
   * Faz o app abrir sem rede depois da primeira visita.
   *
   * Service worker so' roda em contexto seguro. isSecureContext e' a checagem
   * certa: cobre https, localhost E 127.0.0.1 de uma vez, sem a lista de
   * excecoes que sempre esquece alguma. Aberto por file:// nao registra nada.
   */
  function registrarServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      navigator.serviceWorker.register('sw.js').catch(function () { /* segue sem offline */ });
    } catch (err) { /* segue sem offline */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
