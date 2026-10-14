// Léxico do validador de TEXTO LIVRE (E6.6-2b). DADO PURO: listas de termos já na forma FLAT (minúsculas, sem acento, palavras separadas por 1 espaço).
// Fonte: scripts/expectations/agent-answer.expected.json → `lexicon` (aprovado em 13/10/2026) + `e66_2b.lexicon_extension` (B3, aprovado) + `e66_2c.ADVICE_add` (14/10/2026). Um teste
// (test-agent-validate-text.mts, L0) compara estas listas com as das expectativas termo a termo: não podem derivar. Sem lógica neste arquivo.
export const LEXICON = {
  /** 108 termos */
  NUM_WORDS: [
    "zero", "dois", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quatorze",
    "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta",
    "noventa", "cem", "cento", "duzentos", "duzentas", "trezentos", "trezentas", "quatrocentos", "quatrocentas", "quinhentos", "quinhentas",
    "seiscentos", "seiscentas", "setecentos", "setecentas", "oitocentos", "oitocentas", "novecentos", "novecentas", "mil", "milhao", "milhoes",
    "bilhao", "bilhoes", "metade", "terco", "dobro", "triplo", "quadruplo", "dezena", "dezenas", "centena", "centenas", "duzia", "duzias",
    "por cento", "ponto percentual", "pontos percentuais", "milhar", "milhares", "cuatro", "siete", "ocho", "nueve", "diez", "cien", "ciento",
    "millon", "mitad", "docena", "veinte", "treinta", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "half", "dozen",
    "double", "triple", "percent",
  ],
  /** 9 termos */
  APPROX: [
    "cerca de", "aproximadamente", "em torno de", "mais ou menos", "algo como", "por volta de", "approximately", "roughly", "circa",
  ],
  /** 47 termos */
  ARITH: [
    "somando", "somados", "somadas", "somado", "somada", "somei", "soma de", "a soma", "subtraindo", "subtraido", "subtraida", "subtrai",
    "multiplicando", "multiplicado", "multiplicada", "multipliquei", "dividindo", "dividido por", "dividida por", "dividi", "em media", "na media",
    "media entre", "arredondando", "arredondado", "arredondada", "arredondei", "arredondamos", "arredondo", "truncando", "truncado", "descontando",
    "acumulando", "vezes mais", "vezes menos", "vezes maior", "vezes menor", "vezes o", "vez e meia", "sum of", "divided by", "multiplied by",
    "subtracting", "rounded", "rounding", "on average", "average of",
  ],
  /** 6 termos */
  ARITH_EXCEPTION_TERMS: [
    "vezes mais", "vezes menos", "vezes maior", "vezes menor", "vezes o", "vez e meia",
  ],
  /** 6 termos */
  ARITH_EXCEPTION_PREV: [
    "as", "muitas", "algumas", "poucas", "outras", "certas",
  ],
  /** 71 termos */
  CAUSAL: [
    "porque", "por que", "pois", "por causa", "por conta de", "devido a", "devido ao", "devido aos", "devido as", "em razao de", "em funcao de",
    "gracas a", "culpa", "culpado", "culpada", "responsavel por", "causou", "causada", "causado", "causando", "causa de", "provocou", "provocado",
    "provocada", "provocando", "resultou de", "resultou em", "levou a", "levou o", "fez com que", "explica", "explicado por", "explicada por",
    "se deve a", "deve se a", "por isso", "consequentemente", "em consequencia", "consequencia de", "ja que", "visto que", "uma vez que",
    "decorrente de", "decorre de", "gerou", "gerado por", "gerada por", "originou", "a razao e", "a razao disso", "o motivo disso",
    "o motivo pelo qual", "motivo pelo qual", "esse e o motivo", "este e o motivo", "o motivo da perda", "o motivo do prejuizo", "o motivo da queda",
    "acontece quando", "ocorre quando", "because", "due to", "caused by", "owing to", "as a result", "that is why", "debido a", "por eso", "ya que",
    "gracias a", "causado por",
  ],
  /** 35 termos */
  SCOPE: [
    "historico inteiro", "historico completo", "todo o historico", "todo o seu historico", "todos os seus trades", "todos os trades",
    "todas as suas operacoes", "toda a sua carreira", "desde sempre", "sempre", "nunca", "jamais", "em todos os casos", "em todas as",
    "invariavelmente", "consistentemente", "de forma consistente", "comprovadamente", "confiavel", "confiaveis", "garantido", "garantida", "garante",
    "garantem", "always", "never", "entire history", "whole history", "all your trades", "guaranteed", "consistently", "proven", "siempre",
    "todo tu historial", "garantizado",
  ],
  /** 22 termos */
  INCONCLUSIVE: [
    "conclusivo", "conclusiva", "conclusivos", "conclusivamente", "definitivo", "definitiva", "definitivamente", "comprova", "comprovado",
    "comprovada", "prova que", "sem duvida", "claramente", "estatisticamente significativo", "estatisticamente significativa", "conclusive",
    "definitely", "clearly", "statistically significant", "without a doubt", "proves", "concluyente",
  ],
  /** 9 termos */
  NEGATION_WORDS: [
    "not", "isnt", "isn", "without", "yet", "nem", "nao", "sem", "ainda",
  ],
  /** 33 termos */
  EXIT_OVERCLAIM: [
    "stop real", "stop de verdade", "stop verdadeiro", "stop de fato", "alvo real", "target real", "alvo de verdade", "target de verdade",
    "tipo real", "tipo da ordem", "tipo de ordem", "ordem de stop", "ordem stop", "ordem de alvo", "ordem alvo", "stopado", "stopada", "stopou",
    "foi stopado", "acionou o stop", "atingiu o stop", "bateu no stop", "bateu o stop", "acionou o alvo", "atingiu o alvo", "bateu no alvo",
    "bateu o alvo", "real stop", "actual stop", "hit the stop", "stopped out", "hit the target", "true stop",
  ],
  /** 178 termos (83 do e66_2b + 95 do e66_2c) */
  ADVICE: [
    "recomendo", "recomenda", "recomendamos", "sugiro", "sugere", "sugerimos", "aconselho", "aconselha", "voce deveria", "voce deve", "voce devia",
    "voce precisa", "deveria", "devia", "o ideal e", "o melhor e", "seria bom", "seria melhor", "e preferivel", "o certo e", "vale a pena", "convem",
    "evite", "evitar", "evitaria", "pare de", "comece a", "tente", "experimente", "considere", "opere mais", "opere menos", "operar mais",
    "operar menos", "aumente", "reduza", "diminua", "mude", "troque", "ajuste seu", "ajuste sua", "foque", "priorize", "deixe de", "nao opere",
    "melhor nao", "dica", "revise", "reveja", "verifique", "confira", "estude", "analise", "observe", "atente", "fique atento", "cuidado",
    "vale revisar", "vale verificar", "vale checar", "vale olhar", "merece atencao", "merece revisao", "o que fazer", "proximo passo",
    "proximos passos", "faca", "recommend", "recommended", "suggest", "should", "you must", "consider", "avoid", "try", "advise", "recomiendo",
    "sugiero", "deberias", "debes", "evita", "considera", "intenta",
    // E6.6-2c (achado #1 do review do Gemini): imperativos de mercado. 95 termos novos.
    // verbos unívocos (soltos)
    "compre", "zere", "alavanque", "desalavanque", "proteja", "aguarde",
    // stop, alvo e lucro
    "suba o stop", "suba o alvo", "mova o stop", "mova o alvo", "baixe o stop", "abaixe o stop", "aperte o stop", "afrouxe o stop", "amplie o stop",
    "remova o stop", "tire o stop", "coloque o stop", "coloque stop", "posicione o stop", "defina o stop", "trave o lucro", "trave lucro",
    // posição
    "feche o trade", "feche a posicao", "feche a operacao", "feche tudo", "feche metade", "feche parcial", "segure a posicao", "segure o trade",
    "segure ate o alvo", "mantenha a posicao", "mantenha o trade", "mantenha o stop", "dobre a mao", "dobre a posicao", "adicione contratos",
    "adicione a posicao", "realize o lucro", "realize lucro", "realize a parcial", "realize parcial", "deixe correr", "deixe o lucro correr",
    "fique de fora", "fique fora", "fique comprado", "fique vendido",
    // homônimos: SÓ em locução composta (nunca venda, entre, corte, saia soltos)
    "venda agora", "venda tudo", "venda metade", "venda no suporte", "venda na resistencia", "venda no topo", "venda no rompimento",
    "venda no pullback", "nao venda", "entre agora", "entre na proxima", "entre no pullback", "entre no rompimento", "nao entre em", "nao entre no",
    "corte o prejuizo", "corte os prejuizos", "corte a perda", "corte as perdas", "corte cedo", "corte a posicao", "saia da posicao",
    "saia do trade", "saia da operacao", "saia do mercado", "saia agora", "saia cedo", "saia antes", "saia na abertura", "saia no alvo",
    "opere pequeno",
    // tamanho de mão
    "opere grande", "opere apenas", "opere somente", "buy now",
    // inglês
    "sell now", "buy the dip", "sell the rally", "close the trade", "close your position", "move your stop", "raise your stop", "lower your stop",
    "stay out", "hold the position", "cut your losses",
  ],
  /** 24 termos */
  TIE: [
    "empate", "empates", "empatado", "empatados", "empatada", "empatadas", "empatou", "empatam", "empataram", "iguais", "igual", "identico",
    "identicos", "identica", "identicas", "mesmo valor", "mesma pontuacao", "tie", "tied", "tying", "equal", "identical", "same value", "iguales",
  ],
  /** 183 termos */
  COMPARISON: [
    "melhor que", "pior que", "melhor do que", "pior do que", "maior que", "menor que", "maior do que", "menor do que", "superior a", "inferior a",
    "supera", "superam", "vence", "vencem", "lidera", "lideram", "portanto", "concluo", "conclusao", "conclui se", "isso mostra", "isso indica",
    "isso significa", "isso prova", "fica claro", "compensa", "melhor", "melhores", "pior", "piores", "maior", "maiores", "menor", "menores",
    "superior", "superiores", "inferior", "inferiores", "mais", "menos", "atras", "lider", "lideres", "venceu", "ganha", "ganham", "ganhou", "perde",
    "perdem", "perdeu", "superou", "bate", "batem", "bateu", "destaca", "destaque", "destacam", "vantagem", "desvantagem", "campea", "campeao",
    "vencedor", "vencedora", "perdedor", "perdedora", "primeiro", "primeira", "ultimo", "ultima", "penultimo", "topo", "podio", "lugar", "bom",
    "boa", "bons", "boas", "otimo", "otima", "excelente", "ruim", "ruins", "pessimo", "pessima", "fraco", "fraca", "forte", "fortes", "saudavel",
    "lucrativo", "lucrativa", "lucrativos", "lucrativas", "rentavel", "rentaveis", "melhora", "melhorou", "melhorando", "piora", "piorou",
    "piorando", "cresce", "cresceu", "crescendo", "cai", "caiu", "caindo", "sobe", "subiu", "subindo", "desce", "desceu", "aumento", "aumentou",
    "aumenta", "diminuiu", "diminui", "evolucao", "evoluiu", "tendencia", "tendencias", "domina", "dominam", "sobressai", "desponta", "versus", "vs",
    "better", "worse", "best", "worst", "outperforms", "outperform", "leads", "leading", "wins", "beats", "beat", "ahead", "behind", "stronger",
    "weaker", "good", "bad", "profitable", "improved", "declined", "therefore", "thus", "hence", "mejor", "peor", "rentable", "bueno", "malo",
    "comparado a", "comparada a", "comparado com", "comparada com", "em comparacao", "em relacao a", "em relacao ao", "a frente de", "na frente de",
    "a frente", "acima de", "abaixo de", "por lo tanto", "compared to", "compared with", "greater than", "less than", "more than", "higher than",
    "lower than", "superior to", "inferior to", "ahead of", "mejor que", "peor que", "mayor que", "menos que", "as a result",
  ],
  /** 12 termos */
  BASIS: [
    "liquido", "liquida", "liquidos", "liquidas", "bruto", "bruta", "brutos", "brutas", "r liquido", "r em pontos", "net", "gross",
  ],
  /** 15 termos */
  SQUEEZE: [
    "conclusivo", "conclusiva", "conclusao", "recomendo", "aconselho", "consequentemente", "estatisticamente", "definitivamente", "comprovadamente",
    "aproximadamente", "invariavelmente", "portanto", "sugiro", "experimente", "considere",
  ],
} as const satisfies Record<string, readonly string[]>
