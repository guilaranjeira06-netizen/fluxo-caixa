# Calculadora de fluxo de caixa

Responde a uma pergunta só, todo dia: **quanto dá para tirar da conta corrente
hoje e mandar para investimento, sem furar nada.**

Existe porque recebimentos e pagamentos são descasados. O salário cai no 5º dia
útil, um pagamento entra no dia 15, reembolsos caem em dias aleatórios; o cartão
vence no 5º dia útil, dois boletos no dia 10, outro no dia 19. Descobrir quanto
sobra exige refazer a conta na mão toda vez.

Abra `index.html` no navegador. Não tem servidor, não tem login, não tem
instalação. Os dados ficam no `localStorage` do próprio navegador — nada sai
da máquina.

---

## O modelo

Quatro peças, nessa ordem.

### 1. Regras, não lançamentos

Você cadastra a **regra** ("salário, 5º dia útil, R$ 8.500"), não cada
pagamento. A regra se expande sozinha nos meses seguintes. Formas de agendar:

| Agenda | Para quê |
|---|---|
| Dia fixo do mês | boleto do dia 10, pagamento do dia 19 |
| N-ésimo dia útil | salário e fatura do cartão no 5º dia útil |
| Último dia útil | fechamentos de mês |
| Data única | reembolso avulso, 13º, bônus |

Duas coisas que o cálculo na mão erra com frequência:

- **Dia útil é dia útil de verdade.** O calendário inclui os feriados nacionais
  e os móveis derivados da Páscoa (Carnaval, Sexta-feira Santa, Corpus Christi),
  mais os dias em que os bancos não abrem (24 e 31/12). Feriados municipais
  entram à mão. Exemplo real: o 5º dia útil de novembro de 2026 é dia **9**, não
  dia 6, porque Finados cai na segunda-feira dia 2.
- **Cair em fim de semana muda a data.** Cada regra de dia fixo diz se
  antecipa, adia ou mantém.

Cada regra aceita vigência (começa em / termina em) e valor diferente em meses
específicos — `2026-12 = 12000` para o mês do 13º, por exemplo.

### 2. Projeção diária

Saldo inicial mais os lançamentos, dia a dia. Tudo em **centavos inteiros**: em
dinheiro, um centavo de erro de arredondamento muda a resposta de "pode" para
"não pode".

A projeção calcula 60 dias **além** do horizonte que você vê. Sem essa folga,
uma sequência negativa que começa perto do fim pareceria não fechar nunca, só
porque a entrada que a cobre está logo depois da borda.

### 3. As restrições da conta

Duas, e são elas que fazem a ferramenta valer:

- **Piso do saldo.** Limite negativo da conta somado ao colchão de segurança.
  Limite de R$ 2.000 com colchão de R$ 300 dá um piso de −R$ 1.700. No modo
  conservador o limite é zero, e o mesmo colchão vira um piso de +R$ 300. É uma
  regra só, então destaque, plano, gráfico e extrato falam sempre do mesmo número.
- **Prazo do vermelho.** No máximo N dias **corridos seguidos** com saldo
  negativo (10, por padrão). A contagem zera toda vez que o saldo volta ao
  positivo: cinco dias negativo, um dia positivo e mais cinco negativo são duas
  sequências de cinco, não uma de dez.

É essa segunda restrição que libera dinheiro. Sem ela você precisaria deixar em
conta tudo o que vai sair antes do próximo recebimento. Com ela, um mergulho no
vermelho que fecha em três dias é aceitável — e o que estava travado vira aporte.

### 4. O solver

Para uma data, "quanto dá para tirar" sai por **busca binária sobre centavos
inteiros**. Funciona porque tirar mais nunca melhora a situação: a curva de
saldo inteira desce junto, então todo dia negativo continua negativo e nenhuma
violação se cura. A viabilidade é monotônica, e o resultado é exato — um
centavo a mais quebra alguma restrição (tem teste para isso).

O teto tem dois lados, e vale o menor:

- **o saldo do próprio dia** — não dá para investir dinheiro que não está lá. O
  cheque especial existe para absorver as saídas agendadas, não para financiar
  aporte;
- **o piso** — passar dele fura o limite já no dia da retirada.

O **plano de aportes** repete isso em cada data candidata (hoje e todo dia em
que entra dinheiro), na ordem, descontando o que já foi retirado antes. Tirar
mais cedo é o objetivo — dinheiro parado não rende —, e cada linha já conta com
as anteriores.

Quando nem sem tirar nada a conta fecha, o solver devolve zero e diz por quê: o
dia, quanto falta e qual restrição quebrou.

---

## Uso

```
node --test test/     # 31 testes do motor de cálculo
node build.js         # gera dist/fluxo-caixa.html, arquivo único
```

`dist/fluxo-caixa.html` tem CSS e JS embutidos — é o arquivo para mandar para o
celular ou para outra máquina. Cada navegador guarda os próprios dados, então
use **Baixar backup (JSON)** e **Restaurar backup** para levá-los junto.

## Arquivos

| Arquivo | O quê |
|---|---|
| `src/engine.js` | datas, feriados, dias úteis, projeção, restrições, solver |
| `src/app.js` | estado, formulários, gráfico, tabelas |
| `src/styles.css` | tokens de cor, tema claro e escuro |
| `test/engine.test.js` | testes do motor |
| `build.js` | empacota tudo num HTML só |

O motor não conhece o DOM e roda em Node — por isso dá para testar as regras de
calendário e o solver sem abrir navegador.

## Limites

Estimativa de planejamento, não extrato bancário. Não conhece tarifas, juros do
cheque especial, rendimento do investimento nem IOF/IR no resgate. A resposta é
tão boa quanto os lançamentos cadastrados: reembolso que você não previu não
entra na conta.
