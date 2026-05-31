"use client"

import { useState } from "react"
import { Copy, Check, Trash2, Plus, ChevronDown, ChevronUp, Zap, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

interface ApiKey {
  id: string
  name: string
  key: string
  lastUsed: string | null
  createdAt: string
}

interface Props {
  initialKeys: ApiKey[]
}

const NINJA_SCRIPT = `#region Using declarations
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Net;
using System.Net.Http;
using System.ComponentModel.DataAnnotations;
using System.Threading.Tasks;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

namespace NinjaTrader.NinjaScript.Indicators
{
    public class TraderOSSync : Indicator
    {
        private HttpClient _client;
        private Dictionary<string, double[]> _entries;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name                     = "TraderOS Sync";
                Description              = "Sincroniza trades com o TraderOS automaticamente";
                Calculate                = Calculate.OnBarClose;
                IsOverlay                = true;
                DisplayInDataBox         = false;
                DrawOnPricePanel         = false;
                PaintPriceMarkers        = false;
                IsSuspendedWhileInactive = false;
                ApiKey                   = "";
                ServerUrl                = "https://trader-os-ashy.vercel.app";
            }
            else if (State == State.Configure)
            {
                // Força TLS 1.2 — necessário para conexão com Vercel
                ServicePointManager.SecurityProtocol =
                    SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
                _client  = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                _entries = new Dictionary<string, double[]>();
            }
            else if (State == State.Active)
            {
                Print("[TraderOS] Indicador ativo. Inscrevendo em contas...");
                lock (Account.All)
                    foreach (Account a in Account.All)
                    {
                        Print("[TraderOS] Conta encontrada: " + a.Name);
                        a.ExecutionUpdate += OnExecution;
                    }
                Account.All.CollectionChanged += OnAccountsChanged;
                Print("[TraderOS] Pronto — aguardando execucoes.");
            }
            else if (State == State.Terminated)
            {
                Account.All.CollectionChanged -= OnAccountsChanged;
                lock (Account.All)
                    foreach (Account a in Account.All)
                        a.ExecutionUpdate -= OnExecution;
                if (_client != null) { _client.Dispose(); _client = null; }
            }
        }

        private void OnAccountsChanged(object sender, NotifyCollectionChangedEventArgs e)
        {
            if (e.NewItems == null) return;
            foreach (Account a in e.NewItems)
            {
                Print("[TraderOS] Nova conta conectada: " + a.Name);
                a.ExecutionUpdate += OnExecution;
            }
        }

        private void OnExecution(object sender, ExecutionEventArgs e)
        {
            var ex = e.Execution;
            if (ex == null || ex.Instrument == null) return;

            Print("[TraderOS] Execucao: " + ex.Instrument.FullName
                + " IsEntry=" + ex.IsEntry + " IsExit=" + ex.IsExit
                + " Qty=" + ex.Quantity + " Price=" + ex.Price);

            if (string.IsNullOrEmpty(ApiKey))
            {
                Print("[TraderOS] ERRO: API Key nao configurada. Abra as propriedades do indicador.");
                return;
            }

            string acct   = ex.Account != null ? ex.Account.Name : string.Empty;
            string mapKey = acct + "|" + ex.Instrument.FullName;

            if (ex.IsEntry)
            {
                double dir = ex.MarketPosition == MarketPosition.Long ? 1.0 : 0.0;
                _entries[mapKey] = new double[] { ex.Price, (double)ex.Quantity, (double)ex.Time.Ticks, dir };
                Print("[TraderOS] Entry salvo: " + mapKey);
                return;
            }

            if (!ex.IsExit) return;

            double[] entry;
            if (!_entries.TryGetValue(mapKey, out entry))
            {
                Print("[TraderOS] Exit sem entry para: " + mapKey + " — ignorado.");
                return;
            }
            _entries.Remove(mapKey);

            bool   isLong    = entry[3] > 0;
            double pv        = ex.Instrument.MasterInstrument != null
                               ? ex.Instrument.MasterInstrument.PointValue : 20.0;
            double pnlPts    = isLong ? ex.Price - entry[0] : entry[0] - ex.Price;
            double pnl       = Math.Round(pnlPts * pv * entry[1] - ex.Commission, 2);
            string inst      = ex.Instrument.MasterInstrument != null
                               ? ex.Instrument.MasterInstrument.Name : ex.Instrument.FullName;
            var    ic        = System.Globalization.CultureInfo.InvariantCulture;

            Print("[TraderOS] Trade fechado — " + inst + " PnL=$" + pnl + " | Enviando...");

            // Captura tudo ANTES do Task.Run (acesso cross-thread ao NT8 é proibido dentro da Task)
            string keyCopy      = ApiKey;
            string urlCopy      = ServerUrl.TrimEnd('/') + "/api/sync/ninjatrader";
            string exId         = "NT_" + ex.ExecutionId;
            string direction    = isLong ? "LONG" : "SHORT";
            string entryTimeStr = new DateTime((long)entry[2]).ToString("o");
            string exitTimeStr  = ex.Time.ToString("o");
            double entryPx      = entry[0];
            double exitPx       = ex.Price;
            int    qty          = (int)entry[1];
            double comm         = ex.Commission;
            double pnlCopy      = pnl;
            double pnlPtsCopy   = Math.Round(pnlPts, 4);
            string acctCopy     = acct;
            HttpClient cli      = _client;

            Task.Run(async () =>
            {
                try
                {
                    var form = new List<KeyValuePair<string, string>>
                    {
                        new KeyValuePair<string, string>("instrument",  inst),
                        new KeyValuePair<string, string>("direction",   direction),
                        new KeyValuePair<string, string>("entryPrice",  entryPx.ToString("G17", ic)),
                        new KeyValuePair<string, string>("exitPrice",   exitPx.ToString("G17", ic)),
                        new KeyValuePair<string, string>("quantity",    qty.ToString()),
                        new KeyValuePair<string, string>("pnl",        pnlCopy.ToString("G17", ic)),
                        new KeyValuePair<string, string>("pnlPoints",  pnlPtsCopy.ToString("G17", ic)),
                        new KeyValuePair<string, string>("commission",  comm.ToString("G17", ic)),
                        new KeyValuePair<string, string>("entryTime",   entryTimeStr),
                        new KeyValuePair<string, string>("exitTime",    exitTimeStr),
                        new KeyValuePair<string, string>("accountName", acctCopy),
                        new KeyValuePair<string, string>("externalId",  exId),
                    };

                    var req = new HttpRequestMessage(HttpMethod.Post, urlCopy);
                    req.Headers.Add("X-API-Key", keyCopy);
                    req.Content = new FormUrlEncodedContent(form);

                    var resp = await cli.SendAsync(req).ConfigureAwait(false);
                    string body = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);

                    // Dentro da Task não podemos chamar Print() — usar Debug.WriteLine
                    System.Diagnostics.Debug.WriteLine(
                        "[TraderOS] HTTP " + (int)resp.StatusCode + " | " + body);
                }
                catch (Exception err)
                {
                    System.Diagnostics.Debug.WriteLine("[TraderOS] Erro ao enviar: " + err.Message);
                }
            });
        }

        protected override void OnBarUpdate() { }

        [NinjaScriptProperty]
        [Display(Name = "API Key TraderOS", Order = 1, GroupName = "TraderOS")]
        public string ApiKey { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Servidor", Order = 2, GroupName = "TraderOS")]
        public string ServerUrl { get; set; }
    }
}`

export function IntegrationSection({ initialKeys }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)

  async function generate() {
    setLoading(true)
    try {
      const res = await fetch("/api/integrations/apikeys", { method: "POST" })
      const data = await res.json()
      if (!res.ok) { alert(data.error); return }
      setKeys((prev) => [data, ...prev])
      setTutorialOpen(true)
    } finally {
      setLoading(false)
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revogar esta API Key? O NinjaTrader vai parar de sincronizar até você configurar uma nova.")) return
    await fetch(`/api/integrations/apikeys/${id}`, { method: "DELETE" })
    setKeys((prev) => prev.filter((k) => k.id !== id))
  }

  function copyKey(key: string, id: string) {
    navigator.clipboard.writeText(key)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  function copyCode() {
    navigator.clipboard.writeText(NINJA_SCRIPT)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  const lastSync = keys.find((k) => k.lastUsed)?.lastUsed
  const hasKeys = keys.length > 0

  return (
    <div className="space-y-4">
      {/* Status + ação */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasKeys && lastSync ? (
            <>
              <span className="w-2 h-2 rounded-full bg-profit animate-pulse" />
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Último sync: {new Date(lastSync).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </>
          ) : hasKeys ? (
            <>
              <span className="w-2 h-2 rounded-full bg-teal" />
              <span className="text-xs text-teal">Pronto para sincronizar</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-muted-foreground" />
              <span className="text-xs text-muted-foreground">Não configurado</span>
            </>
          )}
        </div>

        {keys.length < 3 && (
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal text-teal-foreground rounded-lg text-xs font-medium hover:bg-teal/90 transition-colors disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {loading ? "Gerando..." : "Gerar API Key"}
          </button>
        )}
      </div>

      {/* Lista de keys */}
      {keys.map((k) => (
        <div key={k.id} className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg border border-border">
          <code className="flex-1 text-xs font-mono text-foreground truncate">
            {k.key.slice(0, 24)}••••••••••••••••
          </code>
          <button
            onClick={() => copyKey(k.key, k.id)}
            title="Copiar chave completa"
            className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
          >
            {copied === k.id ? <Check className="w-3.5 h-3.5 text-profit" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => revoke(k.id)}
            title="Revogar chave"
            className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {keys.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-3">
          Gere uma API Key para começar a sincronizar seus trades automaticamente.
        </p>
      )}

      {/* Tutorial colapsável */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setTutorialOpen(!tutorialOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-sm font-medium text-foreground"
        >
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-teal" />
            Como configurar — Tutorial passo a passo
          </span>
          {tutorialOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {tutorialOpen && (
          <div className="px-5 py-5 space-y-5 text-sm">

            {/* Passo 1 */}
            <Step n={1} title="Copie sua API Key">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Clique no ícone <Copy className="w-3 h-3 inline" /> ao lado da sua chave acima para copiar a API Key completa.
                Se ainda não gerou, clique em <strong className="text-foreground">"Gerar API Key"</strong>.
              </p>
            </Step>

            {/* Passo 2 */}
            <Step n={2} title="Abra o NinjaScript Editor">
              <p className="text-muted-foreground text-xs leading-relaxed">
                No NinjaTrader 8, vá em <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">New</kbd> →{" "}
                <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">NinjaScript Editor</kbd>
              </p>
              <div className="mt-2 p-3 bg-muted/30 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                💡 Atalho rápido: pressione <kbd className="bg-muted px-1 py-0.5 rounded font-mono">Ctrl+Shift+N</kbd> no NinjaTrader
              </div>
            </Step>

            {/* Passo 3 */}
            <Step n={3} title="Crie um novo Indicator">
              <p className="text-muted-foreground text-xs leading-relaxed">
                No editor, clique em <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">File</kbd> →{" "}
                <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">New</kbd> →{" "}
                <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">Indicator</kbd>.
                Um arquivo em branco vai aparecer.
              </p>
              <div className="mt-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <p className="text-xs text-amber-400 font-medium mb-0.5">⚠️ Importante — verifique a Output Window</p>
                <p className="text-xs text-muted-foreground">
                  Após adicionar o indicador, abra <strong className="text-foreground">View → Output Window</strong> no NinjaTrader.
                  Você deve ver mensagens <span className="font-mono text-green-400 text-[10px]">[TraderOS] Indicador ativo...</span> confirmando que está funcionando.
                </p>
              </div>
            </Step>

            {/* Passo 4 */}
            <Step n={4} title="Cole o código abaixo">
              <p className="text-muted-foreground text-xs leading-relaxed mb-3">
                Selecione <strong className="text-foreground">todo o conteúdo</strong> do arquivo com{" "}
                <kbd className="bg-muted px-1 py-0.5 rounded font-mono text-[10px]">Ctrl+A</kbd> e substitua pelo código abaixo:
              </p>
              <div className="relative">
                <pre className="bg-[#0a0f1a] border border-border rounded-lg p-4 text-[10px] font-mono text-green-400 overflow-x-auto max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                  {NINJA_SCRIPT.slice(0, 400)}...
                </pre>
                <button
                  onClick={copyCode}
                  className={cn(
                    "absolute top-2 right-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors",
                    codeCopied
                      ? "bg-profit/20 text-profit"
                      : "bg-muted/80 text-foreground hover:bg-muted"
                  )}
                >
                  {codeCopied ? <><Check className="w-3 h-3" /> Copiado!</> : <><Copy className="w-3 h-3" /> Copiar código</>}
                </button>
              </div>
            </Step>

            {/* Passo 5 */}
            <Step n={5} title="Compile o indicador">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Pressione <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">F5</kbd> ou clique no botão{" "}
                <strong className="text-foreground">Compile</strong> no menu do editor.
                Deve aparecer a mensagem <span className="text-profit font-mono text-[10px]">Compilation succeeded</span>.
              </p>
            </Step>

            {/* Passo 6 */}
            <Step n={6} title="Adicione o indicador em qualquer gráfico">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Abra qualquer gráfico no NinjaTrader (ex: NQ 1 minuto). Clique com botão direito no gráfico →{" "}
                <strong className="text-foreground">Indicators</strong> → procure por{" "}
                <span className="text-teal font-mono">TraderOS Sync</span> → clique em{" "}
                <strong className="text-foreground">Add</strong>.
              </p>
              <div className="mt-2 p-3 bg-teal/5 border border-teal/20 rounded-lg">
                <p className="text-xs text-teal font-medium mb-1">⚙️ Configure a propriedade &quot;API Key TraderOS&quot;</p>
                <p className="text-xs text-muted-foreground">
                  Cole sua API Key copiada no passo 1. O campo <strong className="text-foreground">Servidor</strong> já vem preenchido.
                  Clique em <strong className="text-foreground">OK</strong>.
                </p>
              </div>
            </Step>

            {/* Concluído */}
            <div className="flex items-start gap-3 p-4 bg-profit/5 border border-profit/20 rounded-lg">
              <span className="text-xl shrink-0">✅</span>
              <div>
                <p className="text-sm font-semibold text-foreground">Pronto! Tudo configurado.</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  A partir de agora, todo trade fechado no NinjaTrader aparece automaticamente no seu Journal do TraderOS.
                  Você não precisa fazer mais nada — o indicador roda em segundo plano enquanto o NinjaTrader estiver aberto.
                </p>
              </div>
            </div>

            {/* FAQ */}
            <div className="space-y-2 pt-2 border-t border-border">
              <p className="text-xs font-semibold text-foreground">Dúvidas frequentes</p>
              <Faq q="Preciso deixar o NinjaTrader aberto?">
                Sim — o indicador só funciona enquanto o NinjaTrader está aberto. Trades executados com NT fechado não são capturados (use o import CSV como alternativa).
              </Faq>
              <Faq q="Funciona com conta Apex?">
                Sim! A Apex usa o NinjaTrader como plataforma. O indicador captura automaticamente trades de todas as contas conectadas.
              </Faq>
              <Faq q="Posso revogar a API Key?">
                Sim, clique no ícone de lixeira ao lado da chave. O sync para imediatamente e você pode gerar uma nova chave.
              </Faq>
              <Faq q="O indicador afeta minha performance de trading?">
                Não. O envio de dados é feito em segundo plano (async) e nunca bloqueia a thread de ordens do NinjaTrader.
              </Faq>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-teal/10 border border-teal/30 flex items-center justify-center text-teal text-[10px] font-bold shrink-0 mt-0.5">
        {n}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground mb-1.5">{title}</p>
        {children}
      </div>
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-xs text-foreground font-medium">{q}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1">
          <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>
        </div>
      )}
    </div>
  )
}
