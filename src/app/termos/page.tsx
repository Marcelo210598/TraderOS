import type { Metadata } from "next"
import Link from "next/link"
import { LegalPage } from "@/components/legal/legal-page"

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: "Termos de Uso do MeuTrade.",
}

export default function TermosPage() {
  return (
    <LegalPage title="Termos de Uso" updatedAt="16 de setembro de 2026">
      <section>
        <p>
          Estes Termos de Uso regulam o acesso e uso do MeuTrade (<strong>meutrade.app</strong>),
          um aplicativo de journal, análise e evolução para traders, operado por{" "}
          <strong>Marcelo Di Foggia Junior</strong> (&quot;nós&quot;, &quot;MeuTrade&quot;). Ao criar
          uma conta ou usar o serviço, você (&quot;usuário&quot;) concorda com estes termos. Se não
          concordar, não utilize o MeuTrade.
        </p>
      </section>

      <section>
        <h2>1. O que é o MeuTrade</h2>
        <p>
          O MeuTrade é uma ferramenta de apoio operacional para traders: diário de operações
          (journal), métricas de performance, check-in emocional, biblioteca de setups,
          gamificação, sincronização automática de trades via NinjaTrader/MetaTrader 5, e um
          assistente de análise com inteligência artificial (Vega IA).
        </p>
        <p>
          O MeuTrade é oferecido em diferentes planos (Free, Starter, Pro), com limites de uso
          descritos na página de <Link href="/planos">Planos</Link> a cada momento. Podemos alterar
          features, limites e preços dos planos a qualquer momento, mediante aviso razoável para
          assinantes ativos.
        </p>
      </section>

      <section>
        <h2>2. Cadastro e conta</h2>
        <ul>
          <li>Você precisa ter no mínimo 18 anos para criar uma conta.</li>
          <li>Você é responsável por manter a confidencialidade da sua senha e por todas as atividades realizadas na sua conta.</li>
          <li>As informações de cadastro devem ser verdadeiras e mantidas atualizadas.</li>
          <li>Não é permitido compartilhar uma mesma conta entre múltiplas pessoas nem revender acesso.</li>
        </ul>
      </section>

      <section>
        <h2>3. Planos, pagamento e cancelamento</h2>
        <p>
          Os planos pagos (Starter e Pro) são cobrados por assinatura recorrente (mensal ou anual,
          conforme escolhido), processados pela <strong>Asaas</strong>, instituição de pagamento
          terceirizada. O MeuTrade não armazena dados completos de cartão de crédito.
        </p>
        <ul>
          <li>Você pode cancelar sua assinatura a qualquer momento, sem multa ou fidelidade, mantendo acesso ao plano pago até o fim do ciclo já pago.</li>
          <li>Não há reembolso proporcional de período já iniciado, salvo exigência legal (ex.: arrependimento em até 7 dias da primeira contratação, conforme Art. 49 do Código de Defesa do Consumidor).</li>
          <li>Falha de pagamento (cartão recusado, boleto vencido) pode resultar em rebaixamento automático para o plano Free após o período de tolerância.</li>
        </ul>
      </section>

      <section>
        <h2>4. Aviso importante sobre trading e investimentos</h2>
        <p>
          <strong>O MeuTrade não é uma consultoria de investimentos, corretora, gestora de
          recursos ou prop firm.</strong> Não recomendamos a compra, venda ou manutenção de
          nenhum ativo financeiro. As métricas, análises e sugestões geradas pelo aplicativo — incluindo
          as respostas da Vega IA — são baseadas exclusivamente no seu próprio histórico de
          operações, têm caráter educacional e informativo, e{" "}
          <strong>não constituem recomendação de investimento</strong> nos termos da
          regulamentação da CVM.
        </p>
        <p>
          Operações com futuros, forex e outros derivativos envolvem risco significativo de perda,
          podendo essa perda exceder o capital investido. Resultados passados não garantem
          resultados futuros. Toda decisão de operar é de responsabilidade exclusiva do usuário.
          O MeuTrade não se responsabiliza por perdas financeiras decorrentes do uso do
          aplicativo ou de decisões tomadas com base nas informações nele apresentadas.
        </p>
        <p>
          O MeuTrade também não possui vínculo, parceria ou afiliação com nenhuma mesa
          proprietária (prop firm) específica. Referências a regras de avaliação, trailing
          drawdown ou consistency rule de mesas proprietárias têm caráter educacional geral —
          consulte sempre o regulamento oficial da sua própria firm.
        </p>
      </section>

      <section>
        <h2>5. Integrações de terceiros</h2>
        <p>
          O MeuTrade permite sincronizar dados com plataformas de terceiros (NinjaTrader 8,
          MetaTrader 5) por meio de conectores próprios (AddOn/EA). Não temos controle sobre a
          disponibilidade, estabilidade ou exatidão dessas plataformas de terceiros, e não nos
          responsabilizamos por falhas de sincronização originadas nelas.
        </p>
      </section>

      <section>
        <h2>6. Vega IA</h2>
        <p>
          A Vega IA utiliza modelos de inteligência artificial de terceiros (Anthropic Claude)
          para gerar análises com base nos dados que você registrou no MeuTrade. As respostas são
          geradas automaticamente e podem conter imprecisões — sempre use seu próprio julgamento
          antes de agir com base nelas.
        </p>
      </section>

      <section>
        <h2>7. Uso aceitável</h2>
        <p>Você concorda em não:</p>
        <ul>
          <li>Usar o MeuTrade para fins ilegais ou fraudulentos;</li>
          <li>Tentar acessar contas de outros usuários ou áreas administrativas sem autorização;</li>
          <li>Fazer engenharia reversa, copiar ou redistribuir o código-fonte do aplicativo;</li>
          <li>Sobrecarregar deliberadamente a infraestrutura do serviço (ex.: automação abusiva de requisições).</li>
        </ul>
      </section>

      <section>
        <h2>8. Propriedade intelectual</h2>
        <p>
          A marca MeuTrade, seu layout, código e conteúdo educacional (Trilha de Aprendizado) são
          de propriedade do MeuTrade. Os dados de trading que você insere (trades, notas, planos)
          continuam sendo seus — você pode exportá-los ou solicitar exclusão a qualquer momento.
        </p>
      </section>

      <section>
        <h2>9. Encerramento de conta</h2>
        <p>
          Você pode encerrar sua conta a qualquer momento pelas configurações do app ou
          solicitando pelo contato abaixo. Podemos suspender ou encerrar contas que violem estes
          Termos, mediante aviso quando possível.
        </p>
      </section>

      <section>
        <h2>10. Limitação de responsabilidade</h2>
        <p>
          O MeuTrade é fornecido &quot;como está&quot;, sem garantia de disponibilidade
          ininterrupta ou ausência total de erros. Na máxima extensão permitida pela lei, não nos
          responsabilizamos por danos indiretos, lucros cessantes ou perdas financeiras
          decorrentes do uso do aplicativo.
        </p>
      </section>

      <section>
        <h2>11. Alterações nestes Termos</h2>
        <p>
          Podemos atualizar estes Termos periodicamente. Mudanças relevantes serão comunicadas por
          e-mail ou aviso no aplicativo. O uso continuado após a alteração significa concordância
          com os novos termos.
        </p>
      </section>

      <section>
        <h2>12. Lei aplicável</h2>
        <p>
          Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o
          foro da comarca de Caraguatatuba - SP para dirimir eventuais controvérsias, salvo
          disposição legal em contrário aplicável a relações de consumo.
        </p>
      </section>

      <section>
        <h2>13. Contato</h2>
        <p>
          Dúvidas sobre estes Termos: <a href="mailto:traderos.oficial@gmail.com">traderos.oficial@gmail.com</a>
        </p>
      </section>
    </LegalPage>
  )
}
