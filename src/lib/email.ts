import { Resend } from "resend"

export async function sendWelcomeEmail(to: string, name: string) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const FROM = process.env.RESEND_FROM_EMAIL ?? "TraderOS <noreply@traderos.app>"
  const firstName = name.split(" ")[0]
  await resend.emails.send({
    from: FROM as string,
    to,
    subject: "Bem-vindo ao TraderOS 🚀",
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#080C14;font-family:ui-sans-serif,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080C14;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0F1623;border:1px solid #1E293B;border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#00C2A820,#818CF810);padding:32px 40px;border-bottom:1px solid #1E293B;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#F1F5F9;letter-spacing:-0.5px;">
              ⚡ <span style="color:#00C2A8;">Trader</span>OS
            </p>
            <p style="margin:8px 0 0;font-size:13px;color:#64748B;">Sistema operacional para traders</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#F1F5F9;">
              Bem-vindo, ${firstName}! 👋
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#94A3B8;line-height:1.6;">
              Sua conta foi criada com sucesso. Agora você tem acesso ao seu painel de controle para traders de futuros americanos.
            </p>

            <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
              ${[
                ["📓", "Journal de Trades", "Registre cada operação com PnL automático e análise detalhada."],
                ["🏆", "Sistema de Progresso", "Ganhe XP, suba de nível e desbloqueie conquistas a cada trade."],
                ["🛡️", "Guardian Apex", "Calcule trailing drawdown, consistency rule e scaling plan em tempo real."],
                ["🧠", "Check-in Emocional", "Avalie seu estado mental antes de operar para evitar revenge trades."],
              ].map(([icon, title, desc]) => `
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #1E293B;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:20px;width:36px;vertical-align:top;padding-top:2px;">${icon}</td>
                      <td style="padding-left:12px;">
                        <p style="margin:0;font-size:14px;font-weight:600;color:#F1F5F9;">${title}</p>
                        <p style="margin:4px 0 0;font-size:13px;color:#64748B;">${desc}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`).join("")}
            </table>

            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center">
                  <a href="${process.env.AUTH_URL ?? "https://traderos.app"}/dashboard"
                     style="display:inline-block;padding:14px 32px;background:#00C2A8;color:#080C14;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:-0.2px;">
                    Acessar meu painel →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #1E293B;">
            <p style="margin:0;font-size:12px;color:#475569;line-height:1.5;">
              Você recebeu este email porque criou uma conta no TraderOS.<br>
              Se não foi você, ignore este email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}
