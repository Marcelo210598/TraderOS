import type { Metadata } from "next"
import { LegalPage } from "@/components/legal/legal-page"

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Como o MeuTrade coleta, usa e protege seus dados pessoais.",
}

export default function PrivacidadePage() {
  return (
    <LegalPage title="Política de Privacidade" updatedAt="16 de setembro de 2026">
      <section>
        <p>
          Esta Política de Privacidade explica como o MeuTrade (<strong>meutrade.app</strong>),
          operado por <strong>Marcelo Di Foggia Junior</strong> (&quot;controlador&quot;), coleta,
          usa, compartilha e protege seus dados pessoais, em conformidade com a Lei Geral de
          Proteção de Dados (LGPD, Lei 13.709/2018).
        </p>
      </section>

      <section>
        <h2>1. Quais dados coletamos</h2>
        <p><strong>Dados de cadastro:</strong> nome, e-mail, senha (armazenada com hash, nunca em texto puro) ou identificador do login Google.</p>
        <p><strong>Dados de uso do produto:</strong> trades registrados (instrumento, preço, horário, resultado), notas do journal, respostas de check-in emocional, planos de trade, setups cadastrados, screenshots que você anexa.</p>
        <p><strong>Dados de pagamento:</strong> quando você assina um plano pago, seu CPF/CNPJ é coletado e processado diretamente pela <strong>Asaas</strong> (nosso processador de pagamentos) — não armazenamos dados completos de cartão de crédito em nossos servidores.</p>
        <p><strong>Dados técnicos:</strong> endereço IP, tipo de dispositivo e navegador, cookies de sessão, dados de uso coletados por ferramentas de analytics (Google Analytics, Meta Pixel, Vercel Analytics).</p>
      </section>

      <section>
        <h2>2. Para que usamos seus dados</h2>
        <ul>
          <li>Prestar o serviço: autenticação, exibição do seu journal e métricas, sincronização de trades;</li>
          <li>Gerar as análises da Vega IA a partir do seu próprio histórico de trades;</li>
          <li>Processar pagamentos e gerenciar sua assinatura;</li>
          <li>Enviar e-mails transacionais (boas-vindas, resumo semanal, avisos de cobrança);</li>
          <li>Prevenir fraude e abuso (ex.: rate limiting de login, detecção de atividade suspeita);</li>
          <li>Medir performance de marketing e origem de tráfego (com ferramentas de analytics).</li>
        </ul>
      </section>

      <section>
        <h2>3. Com quem compartilhamos dados</h2>
        <p>Compartilhamos apenas o necessário para operar o serviço, com os seguintes prestadores:</p>
        <ul>
          <li><strong>Asaas</strong> — processamento de pagamentos (recebe CPF/CNPJ, dados da cobrança);</li>
          <li><strong>Anthropic (Claude)</strong> — geração das análises da Vega IA (recebe os dados de trades enviados na sua pergunta, não o cadastro completo);</li>
          <li><strong>Resend</strong> — envio de e-mails transacionais;</li>
          <li><strong>UploadThing</strong> — armazenamento de screenshots que você anexa aos seus trades;</li>
          <li><strong>Google</strong> — login via OAuth (se você optar por essa forma de login) e Google Analytics;</li>
          <li><strong>Meta</strong> — Pixel de conversão para medição de campanhas de anúncios;</li>
          <li><strong>Vercel</strong> — hospedagem da aplicação e banco de dados.</li>
        </ul>
        <p>
          Não vendemos seus dados pessoais a terceiros. Alguns desses prestadores podem processar
          dados em servidores fora do Brasil (transferência internacional de dados), sempre sob
          contratos que exigem padrões de proteção compatíveis com a LGPD.
        </p>
      </section>

      <section>
        <h2>4. Cookies</h2>
        <p>
          Usamos cookies essenciais (sessão de login) e cookies de terceiros para analytics (Google
          Analytics, Meta Pixel) e melhoria de performance (Vercel Analytics). Você pode bloquear
          cookies de terceiros nas configurações do seu navegador; isso não impede o uso do
          MeuTrade, mas pode afetar funcionalidades de personalização.
        </p>
      </section>

      <section>
        <h2>5. Retenção e exclusão de dados</h2>
        <p>
          Mantemos seus dados enquanto sua conta estiver ativa. Ao excluir sua conta, apagamos seus
          dados pessoais e de trading em até 30 dias, exceto informações que precisamos reter por
          obrigação legal ou fiscal (ex.: histórico de cobranças, por prazo definido em lei).
        </p>
      </section>

      <section>
        <h2>6. Segurança</h2>
        <p>
          Senhas são armazenadas com hash (bcrypt), toda comunicação é criptografada via HTTPS,
          aplicamos limitação de tentativas de login (rate limiting) e política de segurança de
          conteúdo (CSP) contra scripts maliciosos. Nenhum sistema é 100% imune a incidentes, e nos
          comprometemos a notificar você e a Autoridade Nacional de Proteção de Dados (ANPD) em
          caso de incidente relevante, conforme exigido pela LGPD.
        </p>
      </section>

      <section>
        <h2>7. Seus direitos como titular de dados</h2>
        <p>Nos termos do Art. 18 da LGPD, você pode solicitar a qualquer momento:</p>
        <ul>
          <li>Confirmação da existência de tratamento dos seus dados;</li>
          <li>Acesso aos dados que temos sobre você;</li>
          <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>Anonimização, bloqueio ou eliminação de dados desnecessários;</li>
          <li>Portabilidade dos seus dados a outro fornecedor;</li>
          <li>Eliminação dos dados tratados com seu consentimento;</li>
          <li>Revogação do consentimento a qualquer momento;</li>
          <li>Informação sobre com quem compartilhamos seus dados.</li>
        </ul>
        <p>
          Para exercer qualquer desses direitos, entre em contato pelo e-mail abaixo. Respondemos
          em até 15 dias.
        </p>
      </section>

      <section>
        <h2>8. Menores de idade</h2>
        <p>
          O MeuTrade não é destinado a menores de 18 anos e não coletamos intencionalmente dados de
          menores. Se identificarmos uma conta de menor de idade, ela será encerrada.
        </p>
      </section>

      <section>
        <h2>9. Alterações nesta Política</h2>
        <p>
          Podemos atualizar esta Política periodicamente. Mudanças relevantes serão comunicadas por
          e-mail ou aviso no aplicativo, com a data de atualização revisada no topo desta página.
        </p>
      </section>

      <section>
        <h2>10. Contato</h2>
        <p>
          Para dúvidas sobre esta Política ou para exercer seus direitos como titular de dados:{" "}
          <a href="mailto:traderos.oficial@gmail.com">traderos.oficial@gmail.com</a>
        </p>
      </section>
    </LegalPage>
  )
}
