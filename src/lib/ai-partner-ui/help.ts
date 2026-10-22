// Tela do AI Partner: texto que ensina a usar (o chat não tem memória entre perguntas, não dá conselho e só lê o CSV). Só dados de TEXTO, sem HTML; puro.
import type { AnswerView } from "./view.ts"

/** Perguntas de exemplo (todas dentro do que o motor responde; nenhuma pede conselho). */
export const SUGGESTIONS: readonly string[] = Object.freeze([
  "Qual foi meu resultado e minha taxa de acerto?",
  "Qual conta foi melhor?",
  "Como estão minhas saídas por motivo?",
  "Quantos trades fiz por hora do dia?",
])

export interface HelpItem { readonly title: string; readonly text: string }
export const HELP_ITEMS: readonly HelpItem[] = Object.freeze([
  { title: "Lembro das 3 últimas perguntas", text: "Dentro da conversa, lembro das 3 últimas perguntas (só as consultas, não os números), então dá para perguntar “e a outra conta?”. Em “Nova conversa” eu começo do zero. Se mudar de assunto, diga o período, a conta ou o ativo." },
  { title: "O que eu respondo", text: "Resultado, taxa de acerto, médias, sequências e drawdown; por dia, hora, dia da semana, conta, estratégia, ativo ou motivo de saída; comparação entre dois períodos ou duas contas; ranking de grupos." },
  { title: "O que eu não faço", text: "Não dou conselho, não prevejo o mercado, não sugiro comprar ou vender e não explico o “porquê” de um resultado. Eu só leio o arquivo que você enviou." },
  { title: "“Trade” é um ciclo de posição", text: "Um trade vai da entrada até a posição zerar. Por isso um arquivo com 27 linhas pode virar 15 trades, e a taxa de acerto é calculada sobre os trades, não sobre as linhas." },
  { title: "Como ler os selos", text: "“Verificado” quer dizer que o valor foi recalculado de forma independente a partir do seu arquivo. Se algo não puder ser conferido, a resposta avisa em vez de mostrar o número." },
])

/** Resposta sem nenhum valor nem selo (recusa/fora de escopo/interrompida): a tela oferece as perguntas de exemplo logo abaixo. Puro. */
export const isNoDataReply = (view: AnswerView): boolean => view.banner === null && view.blocks.every((b) => b.kind === "text")
