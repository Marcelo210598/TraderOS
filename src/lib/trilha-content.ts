// Conteúdo da Trilha de Aprendizado do MeuTrade.
// Texto escrito para traders BR iniciantes/intermediários que operam futuros
// americanos (NQ/ES) via prop firms (Apex). Editável livremente.
//
// Os blocos são renderizados por src/components/trilha/lesson-content.tsx.
// Suporta **negrito** inline em parágrafos, tips, warnings e itens de lista.

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "list"; items: string[] }
  | { type: "tip"; text: string }
  | { type: "warn"; text: string }
  | { type: "key"; text: string }

export interface Lesson {
  id: string // ex: "1-1"
  title: string
  duration: string // estimativa de leitura
  blocks: Block[]
}

export interface TrilhaModule {
  id: number
  slug: string
  title: string
  description: string
  icon: string // chave mapeada para ícone lucide no componente
  color: string
  bg: string
  lessons: Lesson[]
}

export const TRILHA: TrilhaModule[] = [
  // ───────────────────────────── MÓDULO 1 ─────────────────────────────
  {
    id: 1,
    slug: "fundamentos",
    title: "Fundamentos do Trading",
    description: "Entenda os conceitos básicos antes de operar",
    icon: "BookOpen",
    color: "text-teal",
    bg: "bg-teal/10",
    lessons: [
      {
        id: "1-1",
        title: "O que é um contrato futuro?",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Um **contrato futuro** é um acordo padronizado para comprar ou vender um ativo em uma data futura, por um preço definido hoje. No nosso caso, você não quer receber nada físico — você quer lucrar com a **variação do preço** entre o momento que entra e o momento que sai." },
          { type: "p", text: "Quando você opera o índice NASDAQ (NQ), por exemplo, está negociando um contrato cujo valor sobe e desce junto com as 100 maiores empresas de tecnologia dos EUA. Você não compra ações — compra exposição ao movimento do índice." },
          { type: "h", text: "Por que traders usam futuros?" },
          { type: "list", items: [
            "**Alavancagem**: com pouca margem você controla um contrato de valor alto.",
            "**Liquidez gigante**: dá pra entrar e sair em frações de segundo.",
            "**Opera nos dois lados**: ganha na alta (long) e na queda (short).",
            "**Horário estendido**: o mercado roda quase 24h durante a semana.",
          ] },
          { type: "warn", text: "Alavancagem corta dos dois lados. Ela amplifica lucro **e** prejuízo. É por isso que gestão de risco (Módulo 2) é mais importante que qualquer setup." },
          { type: "key", text: "Futuro = contrato pra lucrar com a variação do preço. Você ganha na alta e na queda, com alavancagem — o que torna o controle de risco inegociável." },
        ],
      },
      {
        id: "1-2",
        title: "Os índices que você vai operar (NQ, ES e os micros)",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "Como trader de futuros americanos, 90% da sua vida vai girar em torno de dois índices e suas versões 'mini'." },
          { type: "h", text: "Os dois grandes" },
          { type: "list", items: [
            "**ES (S&P 500)**: as 500 maiores empresas dos EUA. Mais 'calmo', movimentos mais suaves. Cada ponto vale **US$ 50**.",
            "**NQ (NASDAQ 100)**: as 100 maiores de tecnologia. Mais rápido e volátil. Cada ponto vale **US$ 20**.",
          ] },
          { type: "h", text: "As versões micro (comece por elas!)" },
          { type: "list", items: [
            "**MES (Micro S&P)**: 1/10 do ES. Cada ponto vale **US$ 5**.",
            "**MNQ (Micro NASDAQ)**: 1/10 do NQ. Cada ponto vale **US$ 2**.",
          ] },
          { type: "tip", text: "Iniciante deve começar nos **micros (MNQ/MES)**. Mesmo movimento, mesmo aprendizado, mas com 1/10 do risco financeiro. É a melhor escola que existe." },
          { type: "key", text: "ES (US$50/pt) e NQ (US$20/pt) são os grandes. MES e MNQ são as versões micro — comece por elas pra aprender pagando barato pelos erros." },
        ],
      },
      {
        id: "1-3",
        title: "Ticks, pontos e quanto vale cada movimento",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Antes de operar você PRECISA saber quanto dinheiro entra ou sai do seu bolso a cada movimento. Isso evita o erro clássico do iniciante: tomar um stop e levar um susto com o valor." },
          { type: "h", text: "Ponto vs tick" },
          { type: "p", text: "Um **ponto** é a unidade cheia (ex: o NQ saiu de 20.000 para 20.001). Um **tick** é a menor fração que o preço se move." },
          { type: "list", items: [
            "NQ/MNQ: 1 ponto = 4 ticks (cada tick = 0,25).",
            "ES/MES: 1 ponto = 4 ticks (cada tick = 0,25).",
          ] },
          { type: "h", text: "Quanto vale na prática" },
          { type: "list", items: [
            "**NQ**: 1 ponto = US$ 20 → um movimento de 10 pontos = US$ 200.",
            "**MNQ**: 1 ponto = US$ 2 → 10 pontos = US$ 20.",
            "**ES**: 1 ponto = US$ 50 → 10 pontos = US$ 500.",
            "**MES**: 1 ponto = US$ 5 → 10 pontos = US$ 50.",
          ] },
          { type: "tip", text: "No MeuTrade, o PnL de cada trade já é calculado automaticamente pelo ativo que você seleciona. Mas saber a conta de cabeça te dá controle em tempo real." },
          { type: "key", text: "Sempre saiba quanto vale o ponto do que você opera. NQ = US$20/pt, MNQ = US$2/pt. Sem isso, você está operando no escuro." },
        ],
      },
      {
        id: "1-4",
        title: "Long e Short: ganhando na alta e na queda",
        duration: "4 min de leitura",
        blocks: [
          { type: "p", text: "A grande vantagem dos futuros: você lucra independente da direção, desde que acerte o movimento." },
          { type: "list", items: [
            "**Long (comprado)**: você aposta que o preço vai **subir**. Compra embaixo, vende em cima.",
            "**Short (vendido)**: você aposta que o preço vai **cair**. Vende em cima, recompra embaixo.",
          ] },
          { type: "p", text: "No short você vende algo que não tem (o contrato permite isso) e recompra depois. Se o preço caiu, a diferença é seu lucro." },
          { type: "warn", text: "Iniciante tende a só comprar, porque 'subir' parece mais natural. Mas mercado cai mais rápido do que sobe. Aprender a operar short dobra suas oportunidades." },
          { type: "key", text: "Long = aposta na alta. Short = aposta na queda. Dominar os dois lados é o que separa o trader do investidor." },
        ],
      },
      {
        id: "1-5",
        title: "Tipos de ordem: mercado, limite e stop",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "A ordem é como você comunica sua intenção ao mercado. Usar a ordem errada na hora errada custa caro." },
          { type: "h", text: "As três que importam" },
          { type: "list", items: [
            "**Mercado (market)**: executa AGORA, no melhor preço disponível. Rápida, mas você paga o spread e pode sofrer slippage.",
            "**Limite (limit)**: executa só no preço que você definir ou melhor. Você controla o preço, mas pode não ser executada.",
            "**Stop**: vira ordem a mercado quando o preço atinge um nível. É o que você usa para o **stop loss** (sair no prejuízo) e para entradas de rompimento.",
          ] },
          { type: "h", text: "Stop loss x stop de entrada" },
          { type: "p", text: "O mesmo mecanismo serve para dois propósitos: **proteger** (stop loss fecha o trade perdedor) ou **entrar** (stop de compra acima da resistência, por exemplo)." },
          { type: "tip", text: "Configure SEMPRE o stop loss junto com a entrada. Nunca entre 'pra ver no que dá' sem saber onde vai sair se der errado." },
          { type: "key", text: "Mercado = velocidade. Limite = preço. Stop = gatilho (e seu stop loss). Toda entrada já nasce com o stop definido." },
        ],
      },
      {
        id: "1-6",
        title: "Sessões e horários que realmente importam",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "O mercado de futuros roda quase 24h, mas nem todo horário presta. Operar no horário errado é jogar contra a falta de liquidez." },
          { type: "h", text: "Horários (de Brasília)" },
          { type: "list", items: [
            "**Abertura de NY (~10h30/11h BRT)**: o momento mais líquido e com mais oportunidade. A maioria dos movimentos do dia nasce aqui.",
            "**Meio do dia (~13h30-15h BRT)**: o 'lunch', mercado morno, movimentos falsos. Cuidado.",
            "**Fechamento (~16h30/17h BRT)**: volta a esquentar.",
            "**Overnight (madrugada)**: baixa liquidez, movimentos traiçoeiros. Evite como iniciante.",
          ] },
          { type: "warn", text: "Muitos iniciantes quebram operando de madrugada por 'falta de paciência' de esperar a abertura. Disciplina de horário é parte da estratégia." },
          { type: "tip", text: "O MeuTrade classifica cada trade por sessão (AM/PM/Overnight). Depois, no Analytics, você descobre em qual horário você realmente ganha dinheiro — e em qual você só perde." },
          { type: "key", text: "A abertura de NY é onde mora a oportunidade. Meio do dia e madrugada são armadilhas de baixa liquidez. Horário é estratégia." },
        ],
      },
    ],
  },

  // ───────────────────────────── MÓDULO 2 ─────────────────────────────
  {
    id: 2,
    slug: "gestao-de-risco",
    title: "Gestão de Risco",
    description: "Stop loss, position sizing e proteção de capital",
    icon: "Shield",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    lessons: [
      {
        id: "2-1",
        title: "A regra de ouro: arrisque pouco por trade",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Existe uma única razão pela qual a maioria dos traders quebra: **arriscam demais por operação**. Acertar o mercado é a parte fácil. Sobreviver tempo suficiente pra que sua vantagem apareça é o jogo real." },
          { type: "h", text: "A conta que salva sua carreira" },
          { type: "p", text: "Risque no máximo **1% a 2% da sua banca por trade**. Numa conta de US$ 5.000, isso é US$ 50 a US$ 100 de risco máximo por operação." },
          { type: "p", text: "Por quê? Porque com risco de 1%, você precisaria errar **100 vezes seguidas** para zerar. Isso praticamente não acontece. Com risco de 20% por trade, **5 erros seguidos** te quebram — e 5 erros seguidos acontecem o tempo todo." },
          { type: "warn", text: "O iniciante pensa em quanto pode GANHAR. O profissional pensa primeiro em quanto pode PERDER. Inverta sua cabeça." },
          { type: "key", text: "1-2% de risco por trade. Isso te mantém vivo durante as sequências ruins — e elas vão acontecer." },
        ],
      },
      {
        id: "2-2",
        title: "Stop loss: onde colocar e por que nunca tirar",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "O stop loss é o preço onde você admite que estava errado e sai. Não é opcional. É o que transforma um erro pequeno num erro pequeno — em vez de num desastre." },
          { type: "h", text: "Onde colocar" },
          { type: "p", text: "O stop deve ficar num lugar onde, se o preço chegar lá, sua ideia de trade **deixou de fazer sentido** — não a uma distância aleatória. Exemplos: abaixo do fundo recente (num long), acima da resistência (num short)." },
          { type: "h", text: "O erro que mata" },
          { type: "p", text: "Arrastar o stop pra 'dar mais uma chance'. O preço chega perto do seu stop, bate o medo, você afasta o stop... e o pequeno prejuízo vira um buraco. Isso é **a forma número 1 de quebrar uma conta**." },
          { type: "warn", text: "Stop é sagrado. Defina ANTES de entrar, quando você ainda está racional. Depois que o trade está aberto, seu cérebro mente pra você." },
          { type: "key", text: "Stop loss no ponto onde sua tese morre. Definido antes da entrada. Jamais afastado. Esse é o hábito mais valioso do trading." },
        ],
      },
      {
        id: "2-3",
        title: "Position sizing: quantos contratos operar",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "Sizing é onde a teoria do risco vira número de contratos. É uma conta simples que quase ninguém faz — e por isso quase todo mundo erra." },
          { type: "h", text: "A fórmula" },
          { type: "p", text: "**Contratos = Risco em US$ ÷ (distância do stop em pontos × valor do ponto)**" },
          { type: "p", text: "Exemplo: banca de US$ 5.000, risco de 1% = US$ 50. Você quer operar MNQ (US$ 2/ponto) com stop de 10 pontos. Cada contrato arrisca 10 × 2 = US$ 20. Então: 50 ÷ 20 = **2 contratos** (arredondando pra baixo, 2 contratos = US$ 40 de risco)." },
          { type: "tip", text: "Regra prática: stop mais largo → menos contratos. Stop mais curto → mais contratos. O risco em US$ fica sempre o mesmo. É assim que você mantém o 1-2% constante." },
          { type: "warn", text: "Nunca defina o número de contratos pela 'vontade de ganhar mais'. Defina pelo stop e pelo risco máximo. O tamanho da posição é consequência, não escolha emocional." },
          { type: "key", text: "Contratos = risco em US$ ÷ (pontos do stop × valor do ponto). O tamanho da posição se adapta ao stop, nunca à ganância." },
        ],
      },
      {
        id: "2-4",
        title: "Risco:Retorno e por que você não precisa acertar sempre",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "A pergunta errada é 'qual minha taxa de acerto?'. A pergunta certa é 'quanto eu ganho quando acerto vs quanto perco quando erro?'. Isso é o **risco:retorno (R:R)**." },
          { type: "h", text: "O poder do R múltiplo" },
          { type: "p", text: "Se você arrisca 10 pontos pra ganhar 20, seu R:R é 1:2. Com R:R de 1:2, você pode **errar 60% das vezes e ainda lucrar**." },
          { type: "list", items: [
            "10 trades, 4 ganhos (4 × 20 = +80 pts), 6 perdas (6 × 10 = -60 pts).",
            "Resultado: **+20 pontos**, mesmo acertando só 40%.",
          ] },
          { type: "tip", text: "Busque trades com R:R mínimo de 1:1,5 ou 1:2. Isso tira o peso de 'ter que acertar' das suas costas — e é justamente quando o trader relaxa que ele opera melhor." },
          { type: "key", text: "Com bom risco:retorno (1:2), você lucra acertando menos da metade. Pare de caçar acerto, comece a caçar trades assimétricos." },
        ],
      },
      {
        id: "2-5",
        title: "Drawdown: o conceito que quebra contas",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "**Drawdown** é a queda do seu capital a partir do pico. Entender drawdown — e o estrago matemático que ele causa — é o que separa quem dura de quem some." },
          { type: "h", text: "A matemática cruel da recuperação" },
          { type: "list", items: [
            "Perdeu 10%? Precisa de +11% pra voltar.",
            "Perdeu 25%? Precisa de +33%.",
            "Perdeu 50%? Precisa de **+100%** (dobrar a conta!).",
          ] },
          { type: "p", text: "Quanto mais fundo o buraco, mais desproporcional é a escalada de volta. Por isso proteger o capital vale mais do que perseguir lucro." },
          { type: "warn", text: "Em prop firms como a Apex, o drawdown não é só matemático — é uma **regra rígida**. Atingiu o limite, a conta morre. Vamos detalhar isso no Módulo 5." },
          { type: "tip", text: "O **Guardian** do MeuTrade calcula seu trailing drawdown em tempo real e te dá um semáforo de risco. É a sua rede de proteção contra o erro que quebra a conta." },
          { type: "key", text: "Drawdown profundo exige recuperação desproporcional (-50% precisa de +100%). Proteger capital > perseguir lucro. Sempre." },
        ],
      },
    ],
  },

  // ───────────────────────────── MÓDULO 3 ─────────────────────────────
  {
    id: 3,
    slug: "leitura-de-mercado",
    title: "Leitura de Mercado",
    description: "Order flow, market structure e price action",
    icon: "TrendingUp",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    lessons: [
      {
        id: "3-1",
        title: "Estrutura de mercado: topos e fundos",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "Antes de qualquer indicador, o mercado conta uma história simples através de **topos e fundos**. Ler essa estrutura é a base de tudo." },
          { type: "list", items: [
            "**Alta**: o preço faz topos mais altos e fundos mais altos (HH/HL).",
            "**Baixa**: topos mais baixos e fundos mais baixos (LH/LL).",
            "**Quebra de estrutura**: quando essa sequência se rompe, pode sinalizar reversão.",
          ] },
          { type: "p", text: "Você não precisa adivinhar o futuro. Precisa apenas ler o que o preço já está fazendo e operar a favor disso." },
          { type: "tip", text: "Marque no gráfico os últimos topos e fundos relevantes antes de entrar. Se você não consegue dizer se o mercado está fazendo HH/HL ou LH/LL, você não tem motivo pra estar no trade." },
          { type: "key", text: "Topos/fundos ascendentes = alta. Descendentes = baixa. Opere a favor da estrutura, não contra ela." },
        ],
      },
      {
        id: "3-2",
        title: "Suporte e resistência",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Suporte e resistência são regiões onde o preço historicamente parou e reagiu. São zonas de decisão — onde compradores e vendedores brigam." },
          { type: "list", items: [
            "**Suporte**: região abaixo do preço onde a compra costuma aparecer (o preço 'segura').",
            "**Resistência**: região acima onde a venda costuma aparecer (o preço 'trava').",
          ] },
          { type: "p", text: "Pense em zonas, não em linhas exatas. O preço raramente respeita um número milimétrico — ele reage a uma **região**." },
          { type: "tip", text: "Quando um suporte é rompido com força, ele tende a virar resistência (e vice-versa). Esse 'flip' é uma das leituras mais confiáveis do price action." },
          { type: "key", text: "Suporte segura, resistência trava. Pense em zonas. Níveis rompidos invertem de papel." },
        ],
      },
      {
        id: "3-3",
        title: "Tendência vs lateralização",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Existem basicamente dois estados de mercado, e cada um pede uma postura diferente. Confundir os dois é fonte garantida de prejuízo." },
          { type: "list", items: [
            "**Tendência**: o preço caminha numa direção clara. Aqui você opera **a favor** e segura o movimento.",
            "**Lateralização (range)**: o preço oscila entre suporte e resistência sem direção. Aqui você compra embaixo e vende em cima do range — ou simplesmente fica de fora.",
          ] },
          { type: "warn", text: "O erro clássico: aplicar estratégia de tendência num mercado lateral (e tomar stop nas duas pontas) ou tentar 'pegar topo/fundo' contra uma tendência forte. Identifique o estado ANTES de escolher a tática." },
          { type: "key", text: "Tendência: opere a favor e segure. Range: opere as bordas ou fique fora. Primeiro identifique o estado, depois a estratégia." },
        ],
      },
      {
        id: "3-4",
        title: "Price action: o que as velas dizem",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "Cada vela (candle) é uma fotografia da briga entre compradores e vendedores naquele período. Você não precisa decorar 50 padrões — precisa entender a lógica por trás de alguns poucos." },
          { type: "h", text: "Sinais que importam" },
          { type: "list", items: [
            "**Pavio longo embaixo** numa zona de suporte: vendedores tentaram derrubar e falharam → pressão compradora.",
            "**Pavio longo em cima** numa resistência: compradores empurraram e foram rejeitados → pressão vendedora.",
            "**Corpo grande na direção da tendência**: convicção, continuação provável.",
            "**Corpos pequenos / indecisão**: o mercado está em dúvida — não force entrada.",
          ] },
          { type: "tip", text: "Price action vale muito mais COM contexto. Um pavio de rejeição numa zona de suporte importante vale ouro. O mesmo pavio no meio do nada não significa quase nada." },
          { type: "key", text: "A vela mostra quem ganhou a briga. Pavios = rejeição. Corpos grandes = convicção. Mas só faz sentido dentro do contexto da estrutura." },
        ],
      },
      {
        id: "3-5",
        title: "Order flow: uma introdução ao fluxo",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "Order flow é a análise das ordens sendo executadas em tempo real — quem está agredindo o mercado, comprando ou vendendo a mercado. É leitura avançada, mas vale entender o conceito desde já." },
          { type: "list", items: [
            "**Book de ofertas (DOM)**: mostra as ordens limite esperando compra e venda.",
            "**Fita (Times & Sales)**: mostra as negociações acontecendo, tick a tick.",
            "**Footprint**: mostra o volume comprado vs vendido dentro de cada vela.",
          ] },
          { type: "p", text: "A ideia central: preço sobe quando compradores agressivos consomem as vendas; cai quando vendedores agressivos consomem as compras. O fluxo te mostra essa agressão antes do gráfico de velas confirmar." },
          { type: "warn", text: "Order flow é poderoso mas não é pra primeira semana. Domine estrutura, suporte/resistência e price action primeiro. Fluxo é a cereja, não o bolo." },
          { type: "key", text: "Order flow = leitura da agressão em tempo real (book, fita, footprint). Conceito avançado: construa a base antes de mergulhar nele." },
        ],
      },
      {
        id: "3-6",
        title: "Volume: o que ele revela",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Volume é a quantidade de contratos negociados. Ele não diz a direção, mas diz a **convicção** por trás de um movimento — e isso muda tudo." },
          { type: "list", items: [
            "**Rompimento com volume alto**: mais confiável, há gente de verdade empurrando.",
            "**Rompimento com volume baixo**: desconfie, pode ser uma armadilha (fakeout).",
            "**Volume secando numa tendência**: o movimento pode estar perdendo força.",
          ] },
          { type: "tip", text: "Combine volume com estrutura: um rompimento de resistência importante COM volume alto é um dos sinais mais fortes que existem. Sem volume, é só uma esperança." },
          { type: "key", text: "Volume mede convicção. Movimento com volume = confiável. Sem volume = suspeito. Use junto com os níveis-chave." },
        ],
      },
      {
        id: "3-7",
        title: "Os horários de maior probabilidade",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Nem todo minuto do dia tem a mesma qualidade. Concentrar suas operações nas janelas de maior probabilidade aumenta seu resultado sem você mudar nada na estratégia." },
          { type: "list", items: [
            "**Abertura de NY (primeiros 60-90 min)**: maior volume, maior movimento, melhores oportunidades de tendência.",
            "**Reações a notícias/dados econômicos**: alta volatilidade — oportunidade pra quem sabe, armadilha pra quem não sabe.",
            "**Final da tarde**: pode voltar a ter movimento direcional rumo ao fechamento.",
          ] },
          { type: "warn", text: "Operar o dia inteiro não te faz ganhar mais — te faz operar nos horários ruins e devolver o que ganhou nos bons. Menos é mais." },
          { type: "tip", text: "Use o Analytics do MeuTrade pra ver seu desempenho por sessão. Quase todo trader descobre que ganha numa janela específica e perde nas outras." },
          { type: "key", text: "Concentre-se na abertura de NY e em janelas de alta probabilidade. Operar menos horas, mas as horas certas, melhora o resultado." },
        ],
      },
      {
        id: "3-8",
        title: "Montando seu primeiro setup",
        duration: "7 min de leitura",
        blocks: [
          { type: "p", text: "Setup é um conjunto de condições objetivas que, quando aparecem juntas, te dão sinal pra entrar. Um bom setup é simples, repetível e testável." },
          { type: "h", text: "Anatomia de um setup" },
          { type: "list", items: [
            "**Contexto**: estado de mercado (tendência? range?) e direção que você vai operar.",
            "**Gatilho**: o evento exato que te faz entrar (ex: rejeição no suporte + vela de força).",
            "**Stop**: onde a ideia morre.",
            "**Alvo**: onde você realiza, definindo o risco:retorno.",
          ] },
          { type: "p", text: "Exemplo de setup simples: em tendência de alta, espero o preço recuar até um suporte, ver um pavio de rejeição com volume, entro long, stop abaixo do fundo, alvo no topo anterior (R:R 1:2)." },
          { type: "tip", text: "Cadastre seus setups na **Biblioteca de Setups** do MeuTrade. Conforme você registra trades, a plataforma calcula o win rate e o profit factor de CADA setup — e você descobre qual realmente funciona pra você." },
          { type: "key", text: "Setup = contexto + gatilho + stop + alvo, tudo objetivo. Simples, repetível, mensurável. Cadastre e meça os seus no MeuTrade." },
        ],
      },
    ],
  },

  // ───────────────────────────── MÓDULO 4 ─────────────────────────────
  {
    id: 4,
    slug: "psicologia",
    title: "Psicologia do Trader",
    description: "Disciplina, controle emocional e rotina vencedora",
    icon: "Brain",
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    lessons: [
      {
        id: "4-1",
        title: "Por que você sabota seus próprios trades",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "A maior parte dos prejuízos não vem de não saber operar — vem de não conseguir EXECUTAR o que se sabe. O inimigo é interno." },
          { type: "h", text: "Os vieses que te traem" },
          { type: "list", items: [
            "**Aversão à perda**: a dor de perder é ~2x mais forte que o prazer de ganhar. Por isso você segura perdedores e realiza vencedores cedo demais — exatamente o contrário do certo.",
            "**Excesso de confiança**: depois de alguns ganhos, você aumenta o risco e devolve tudo.",
            "**Necessidade de estar certo**: você prefere ter razão a ganhar dinheiro, e isso te faz brigar com o mercado.",
          ] },
          { type: "tip", text: "Você não vai eliminar essas emoções — elas são humanas. O objetivo é criar um **processo** (regras, checklist, journaling) que funcione apesar delas." },
          { type: "key", text: "Saber operar não basta; executar sob pressão é o jogo real. Aversão à perda e ego sabotam você — vença-os com processo, não com força de vontade." },
        ],
      },
      {
        id: "4-2",
        title: "Revenge trading e FOMO",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Dois comportamentos destroem mais contas do que qualquer setup ruim: a vingança e o medo de ficar de fora." },
          { type: "list", items: [
            "**Revenge trading**: você toma um stop, fica com raiva e entra de novo na hora pra 'recuperar'. Quase sempre dobra o prejuízo.",
            "**FOMO (Fear Of Missing Out)**: o mercado dispara sem você, você entra atrasado no topo do movimento — bem na hora da correção.",
          ] },
          { type: "warn", text: "Os dois nascem da mesma raiz: operar pela **emoção do momento** em vez do plano. O gatilho é físico (coração acelerado, urgência). Aprenda a reconhecer o sinal no corpo e pare." },
          { type: "tip", text: "Regra prática: depois de 2 stops seguidos, **levante da cadeira**. 15 minutos longe quebram o ciclo de vingança. O mercado vai estar lá quando você voltar." },
          { type: "key", text: "Revenge e FOMO = operar pela emoção, não pelo plano. Reconheça os sinais no corpo e tenha uma regra de pausa pronta antes de precisar dela." },
        ],
      },
      {
        id: "4-3",
        title: "A rotina do trader consistente",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "Consistência não é talento — é rotina. Os traders que duram têm um processo quase chato de repetitivo. É justamente o tédio que protege o resultado." },
          { type: "h", text: "Antes do mercado" },
          { type: "list", items: [
            "Revisar o cenário e definir os níveis-chave do dia.",
            "Definir o **máximo de perda diária** e o objetivo — e respeitar.",
            "Check-in emocional: como estou hoje? Cansado, ansioso, confiante?",
          ] },
          { type: "h", text: "Depois do mercado" },
          { type: "list", items: [
            "Registrar os trades (journaling).",
            "Revisar: segui o plano? As entradas foram do setup ou impulsivas?",
            "Anotar 1 ponto a melhorar amanhã.",
          ] },
          { type: "tip", text: "O MeuTrade tem **Check-in (pré e pós sessão)** e **Planner** justamente pra estruturar essa rotina. Quem cumpre o ritual ganha consistência; quem improvisa vive na montanha-russa." },
          { type: "key", text: "Consistência = rotina chata e repetível. Plano antes, registro e revisão depois. O ritual é o que segura o resultado no longo prazo." },
        ],
      },
      {
        id: "4-4",
        title: "Journaling: como o MeuTrade te faz evoluir",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "Você não melhora no que não mede. O diário de trades (journal) é a ferramenta mais subestimada do trader — e a que mais acelera a evolução." },
          { type: "h", text: "O que registrar em cada trade" },
          { type: "list", items: [
            "O setup usado (foi do plano ou impulso?).",
            "O resultado e o R múltiplo.",
            "Seu estado emocional na hora.",
            "Um print do gráfico (a plataforma suporta screenshots).",
          ] },
          { type: "p", text: "Depois de 20-30 trades, padrões começam a saltar aos olhos: 'eu perco quase sempre depois do almoço', 'meus melhores trades são quando estou calmo', 'esse setup tem profit factor negativo'." },
          { type: "tip", text: "No plano PRO, a **Vega IA** lê seu histórico (até 90 dias de contexto real) e te aponta correlações que você não enxerga sozinho — entre emoção, horário, setup e resultado. É como ter um coach que leu cada trade seu." },
          { type: "key", text: "Você só melhora no que mede. Registre setup, resultado, emoção e print. Os padrões aparecem — e a Vega IA acelera a leitura deles." },
        ],
      },
    ],
  },

  // ───────────────────────────── MÓDULO 5 ─────────────────────────────
  {
    id: 5,
    slug: "apex",
    title: "Apex Trader Funding",
    description: "Regras, estratégias e como passar na avaliação",
    icon: "Target",
    color: "text-pink-400",
    bg: "bg-pink-400/10",
    lessons: [
      {
        id: "5-1",
        title: "O que é uma mesa proprietária (prop firm)",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Uma **prop firm** (mesa proprietária) é uma empresa que dá capital pra você operar. Você não arrisca o seu dinheiro no mercado — arrisca apenas a taxa da avaliação. Em troca, divide os lucros com a empresa." },
          { type: "h", text: "Como funciona o ciclo" },
          { type: "list", items: [
            "Você paga uma mensalidade e faz uma **avaliação** (conta demo com regras).",
            "Atingindo a meta sem quebrar as regras, você é **aprovado**.",
            "Recebe uma conta **PA (Performance Account)** com capital da firma.",
            "Os lucros que você gera são divididos (você fica com a maior parte).",
          ] },
          { type: "p", text: "A **Apex Trader Funding** é uma das mais populares no Brasil justamente pela facilidade de avaliação e bons termos de payout." },
          { type: "key", text: "Prop firm = capital da empresa pra você operar. Você arrisca a taxa, não a banca. Passou na avaliação → conta financiada → divisão de lucros." },
        ],
      },
      {
        id: "5-2",
        title: "Como funciona a avaliação Apex",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "A avaliação é uma conta de tamanho fixo (de PA 25K até PA 250K) onde você precisa atingir uma meta de lucro respeitando o drawdown. Sem prazo mínimo apertado — o foco é não quebrar as regras." },
          { type: "h", text: "Os pilares da avaliação" },
          { type: "list", items: [
            "**Meta de lucro**: o valor que você precisa alcançar (varia por tamanho de conta).",
            "**Trailing drawdown**: o limite de perda que 'persegue' seu pico (próxima aula — é o que mais reprova).",
            "**Dias mínimos de operação**: você precisa operar um número mínimo de dias.",
          ] },
          { type: "tip", text: "O **Guardian** do MeuTrade já vem com as regras reais de cada tamanho de conta Apex (PA 25K a 250K). Você seleciona sua conta e ele monitora meta, drawdown e consistência por você." },
          { type: "key", text: "Avaliação Apex = atingir a meta de lucro sem violar o trailing drawdown, cumprindo os dias mínimos. Não quebrar regras importa mais que correr." },
        ],
      },
      {
        id: "5-3",
        title: "Trailing drawdown: o conceito que mais reprova",
        duration: "7 min de leitura",
        blocks: [
          { type: "p", text: "Se existe UM motivo pelo qual a maioria reprova na Apex, é não entender o trailing drawdown. Preste atenção dobrada aqui." },
          { type: "h", text: "Como funciona" },
          { type: "p", text: "O drawdown é um 'piso' que fica te seguindo. Ele sobe junto com o **pico de saldo** da sua conta, mas nunca desce. Se a conta de PA 50K tem drawdown de US$ 2.500, seu piso começa em US$ 47.500." },
          { type: "p", text: "Conforme você lucra e o saldo faz novo pico, o piso sobe junto (mantendo a distância). Mas atenção: na maioria dos casos ele considera o **lucro não realizado** (o pico intradiário), então ele pode subir até com posição aberta." },
          { type: "warn", text: "O erro fatal: deixar um trade vencedor virar perdedor. Se você estava +US$ 800 e devolve tudo, o piso já subiu com aquele pico — e agora está muito mais perto de te estourar. **Proteja os lucros parciais.**" },
          { type: "tip", text: "O Guardian mostra exatamente onde está seu piso, quanta margem te resta e um semáforo (verde/amarelo/vermelho). Use antes de cada sessão." },
          { type: "key", text: "Trailing drawdown sobe com seu pico e nunca desce. Deixar lucro virar prejuízo aproxima o piso e te reprova. Proteja o que já ganhou." },
        ],
      },
      {
        id: "5-4",
        title: "A regra de consistência (30%)",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "Além do drawdown, a Apex tem a **regra de consistência**: nenhum único dia pode representar uma fatia grande demais do seu lucro total (tipicamente 30%). É pra provar que você é consistente, não sortudo." },
          { type: "h", text: "Na prática" },
          { type: "p", text: "Se sua meta de lucro é US$ 3.000, nenhum dia pode ter lucrado mais que 30% disso ≈ US$ 900. Se num dia você fez US$ 1.500, você 'travou' aquele dia e precisará de mais lucro total pra diluir aquele dia abaixo dos 30%." },
          { type: "tip", text: "Estratégia: quando bater perto do limite diário de consistência, **pare de operar naquele dia**. Continuar só atrapalha o cumprimento da regra." },
          { type: "tip", text: "O Guardian tem um **checker de consistência** que detecta quando um dia está violando os 30% — então você sabe a hora exata de parar." },
          { type: "key", text: "Regra de consistência: nenhum dia pode ser >30% do lucro total. Quando bater o limite do dia, pare. O Guardian te avisa a hora." },
        ],
      },
      {
        id: "5-5",
        title: "Estratégia para passar na avaliação",
        duration: "7 min de leitura",
        blocks: [
          { type: "p", text: "Passar na Apex não é sobre fazer muito dinheiro rápido — é sobre fazer pouco, de forma consistente, sem quebrar regra. Quem trata a avaliação como sprint reprova; quem trata como maratona passa." },
          { type: "h", text: "Plano realista" },
          { type: "list", items: [
            "Defina uma **meta diária pequena** (ex: 1-1,5% da meta total) e pare ao atingir.",
            "Defina um **limite de perda diário** rígido e pare ao atingir — mesmo cedo.",
            "Respeite a regra de consistência: não faça um dia gigante.",
            "Opere só nos horários de maior probabilidade (abertura de NY).",
            "Use os micros (MNQ/MES) pra controlar o risco com precisão.",
          ] },
          { type: "warn", text: "Não tente passar em 2 dias. Pressa = sizing grande = drawdown estourado. A avaliação não tem prazo curto justamente pra você ir devagar." },
          { type: "tip", text: "Combine: **Planner** (meta e limite do dia) + **Guardian** (drawdown e consistência) + **Journal** (revisar execução). Esse tripé é seu sistema de aprovação." },
          { type: "key", text: "Avaliação é maratona: metas diárias pequenas, limite de perda rígido, sem dias gigantes, horário de probabilidade. Devagar passa, com pressa reprova." },
        ],
      },
      {
        id: "5-6",
        title: "Da avaliação à conta PA (payout)",
        duration: "5 min de leitura",
        blocks: [
          { type: "p", text: "Passar na avaliação é o começo, não o fim. Agora você está numa conta **PA (financiada)**, operando capital da firma — e o objetivo vira sacar lucro (payout)." },
          { type: "h", text: "O que muda" },
          { type: "list", items: [
            "Continuam valendo o trailing drawdown e a disciplina — perder a PA significa começar de novo.",
            "Há regras de **payout** (mínimo de dias, saldo mínimo, etc.) pra liberar seus saques.",
            "A consistência continua sendo rei: a firma quer um trader durável, não um apostador sortudo.",
          ] },
          { type: "warn", text: "Muita gente passa na avaliação e quebra a PA na primeira semana por relaxar no risco. A conta financiada exige a MESMA disciplina — ou mais." },
          { type: "key", text: "Conta PA = capital real da firma + objetivo de payout. As mesmas regras de risco continuam. Disciplina não tem fim de jogo." },
        ],
      },
      {
        id: "5-7",
        title: "Usando o Guardian na prática",
        duration: "6 min de leitura",
        blocks: [
          { type: "p", text: "Toda a teoria deste módulo vira ação no **Guardian** do MeuTrade. Ele transforma as regras abstratas da Apex em números claros, em tempo real." },
          { type: "h", text: "O que o Guardian faz por você" },
          { type: "list", items: [
            "Você seleciona o **tamanho da conta** (PA 25K a 250K) e ele carrega as regras reais.",
            "**Calculadora de trailing drawdown**: mostra o piso atual, sua margem e um semáforo de risco.",
            "**Checker de consistência**: detecta violação dos 30% por dia.",
            "**Scaling plan**: quantos contratos você pode operar conforme o lucro acumulado.",
          ] },
          { type: "h", text: "Rotina sugerida" },
          { type: "list", items: [
            "Antes da sessão: abra o Guardian, veja sua margem de drawdown e defina o limite do dia.",
            "Durante: se o semáforo ficar amarelo/vermelho, reduza ou pare.",
            "Depois: registre os trades no Journal e revise no Analytics.",
          ] },
          { type: "tip", text: "O Guardian é 100% client-side e instantâneo — sem espera, sem chamada de banco. É a sua rede de proteção pra não quebrar a conta por um descuido." },
          { type: "key", text: "O Guardian operacionaliza as regras da Apex: drawdown, consistência e scaling em tempo real. Use antes, durante e depois de cada sessão." },
        ],
      },
    ],
  },
]

// Helpers ─────────────────────────────────────────────────────────────
export function getModule(idOrSlug: string | number): TrilhaModule | undefined {
  return TRILHA.find(
    (m) => m.id === Number(idOrSlug) || m.slug === String(idOrSlug)
  )
}

export function totalLessons(): number {
  return TRILHA.reduce((acc, m) => acc + m.lessons.length, 0)
}

export const ALL_LESSON_IDS: string[] = TRILHA.flatMap((m) =>
  m.lessons.map((l) => l.id)
)
