"use client"

import { useState } from "react"
import { Copy, Check, Trash2, Plus, ChevronDown, ChevronUp, Zap, Clock, Download } from "lucide-react"
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
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

// === TraderOS Sync (AddOn) ===
// Roda automaticamente quando o NinjaTrader abre. Nao precisa de grafico.
// Configure a API Key no arquivo:  Documentos\\NinjaTrader 8\\traderos_config.txt
namespace NinjaTrader.NinjaScript.AddOns
{
    public class TraderOSSync : NinjaTrader.NinjaScript.AddOnBase
    {
        private HttpClient                  _client;
        private FileSystemWatcher           _watcher;
        private Dictionary<string, Pos>     _positions;
        private HashSet<string>             _seen;
        private string                      _configPath;
        private string                      _logPath;
        private string                      _apiKey    = "";
        private string                      _serverUrl = "https://trader-os-ashy.vercel.app";
        private readonly object             _lock = new object();

        // Estado da posicao aberta por conta|instrumento (round-trip)
        private class Pos
        {
            public int    Dir;         // +1 long, -1 short
            public int    Net;         // quantidade liquida com sinal
            public double AvgEntry;    // preco medio de entrada
            public long   EntryTicks;  // horario da 1a entrada
            public double ExitValue;   // soma (preco * qtd) das saidas
            public int    ExitQty;     // qtd total fechada
            public double Commission;  // comissao acumulada do round-trip
        }

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name        = "TraderOS Sync";
                Description = "Sincroniza automaticamente seus trades com o TraderOS.";
            }
            else if (State == State.Configure)
            {
                // Vercel exige TLS 1.2
                ServicePointManager.SecurityProtocol =
                    SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;

                _client    = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
                _positions = new Dictionary<string, Pos>();
                _seen      = new HashSet<string>();

                string docs = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "NinjaTrader 8");
                _configPath = Path.Combine(docs, "traderos_config.txt");
                _logPath    = Path.Combine(docs, "traderos_log.txt");

                LoadConfig(true);
                StartWatcher(docs);
            }
            else if (State == State.Active)
            {
                lock (Account.All)
                    foreach (Account a in Account.All)
                        a.ExecutionUpdate += OnExecution;

                Account.All.CollectionChanged += OnAccountsChanged;
                Print("[TraderOS] Ativo. Monitorando " + Account.All.Count + " conta(s). Aguardando execucoes.");
            }
            else if (State == State.Terminated)
            {
                if (Account.All != null)
                {
                    Account.All.CollectionChanged -= OnAccountsChanged;
                    lock (Account.All)
                        foreach (Account a in Account.All)
                            a.ExecutionUpdate -= OnExecution;
                }
                if (_watcher != null) { _watcher.Dispose(); _watcher = null; }
                if (_client  != null) { _client.Dispose();  _client  = null; }
            }
        }

        private void OnAccountsChanged(object sender, NotifyCollectionChangedEventArgs e)
        {
            if (e.NewItems == null) return;
            foreach (Account a in e.NewItems)
                a.ExecutionUpdate += OnExecution;
        }

        // ===== Configuracao por arquivo (reload automatico ao salvar) =====
        private void LoadConfig(bool createIfMissing)
        {
            try
            {
                if (!File.Exists(_configPath))
                {
                    if (createIfMissing)
                    {
                        File.WriteAllText(_configPath, ConfigTemplate());
                        Print("[TraderOS] Arquivo de configuracao criado em:");
                        Print("[TraderOS]   " + _configPath);
                        Print("[TraderOS] Abra esse arquivo, cole sua API Key e salve. Nao precisa reiniciar.");
                    }
                    return;
                }

                string apiKey = "", server = "";
                foreach (string line in File.ReadAllLines(_configPath))
                {
                    string l = line.Trim();
                    if (l.Length == 0 || l.StartsWith("#")) continue;
                    int eq = l.IndexOf('=');
                    if (eq < 0) continue;
                    string k = l.Substring(0, eq).Trim().ToLowerInvariant();
                    string v = l.Substring(eq + 1).Trim();
                    if (k == "apikey") apiKey = v;
                    else if (k == "server" && v.Length > 0) server = v;
                }

                _apiKey = apiKey;
                if (server.Length > 0) _serverUrl = server.TrimEnd('/');

                if (string.IsNullOrEmpty(_apiKey) || _apiKey == "COLE_SUA_API_KEY_AQUI")
                    Print("[TraderOS] API Key ainda nao configurada. Edite: " + _configPath);
                else
                    Print("[TraderOS] Config carregada. Pronto para sincronizar.");
            }
            catch (Exception ex) { Print("[TraderOS] Erro ao ler config: " + ex.Message); }
        }

        private void StartWatcher(string dir)
        {
            try
            {
                _watcher = new FileSystemWatcher(dir, "traderos_config.txt");
                _watcher.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size;
                _watcher.Changed += (s, e) =>
                {
                    try { System.Threading.Thread.Sleep(300); LoadConfig(false); Print("[TraderOS] Config recarregada."); }
                    catch { }
                };
                _watcher.EnableRaisingEvents = true;
            }
            catch (Exception ex) { Print("[TraderOS] Watcher desativado: " + ex.Message); }
        }

        private string ConfigTemplate()
        {
            return string.Join(Environment.NewLine, new string[]
            {
                "# === Configuracao TraderOS ===",
                "# 1) Cole sua API Key do TraderOS abaixo.",
                "#    (No site: Configuracoes > Integracoes > Copiar chave)",
                "# 2) Salve este arquivo. Nao precisa reiniciar o NinjaTrader.",
                "",
                "apikey=COLE_SUA_API_KEY_AQUI",
                "server=https://trader-os-ashy.vercel.app"
            });
        }

        // ===== Captura de execucoes e montagem do trade (round-trip) =====
        private void OnExecution(object sender, ExecutionEventArgs e)
        {
            try
            {
                Execution ex = e.Execution;
                if (ex == null || ex.Instrument == null || ex.Quantity <= 0) return;

                // Evita reprocessar a mesma execucao dentro desta sessao do AddOn
                string exId = ex.ExecutionId;
                if (string.IsNullOrEmpty(exId)) return;

                string acct = ex.Account != null ? ex.Account.Name : "";
                string key  = acct + "|" + ex.Instrument.FullName;
                int    side = ex.MarketPosition == MarketPosition.Long ? 1 : -1;
                int    q    = ex.Quantity;
                double px   = ex.Price;

                lock (_lock)
                {
                    if (!_seen.Add(exId)) return;

                    Pos p;
                    if (!_positions.TryGetValue(key, out p) || p.Net == 0)
                    {
                        // Abre nova posicao
                        _positions[key] = new Pos
                        {
                            Dir = side, Net = side * q, AvgEntry = px,
                            EntryTicks = ex.Time.Ticks, Commission = ex.Commission,
                            ExitValue = 0, ExitQty = 0
                        };
                        return;
                    }

                    if (Math.Sign(p.Net) == side)
                    {
                        // Aumenta posicao (scaling in) — recalcula preco medio
                        int absPrev = Math.Abs(p.Net);
                        p.AvgEntry  = (p.AvgEntry * absPrev + px * q) / (absPrev + q);
                        p.Net      += side * q;
                        p.Commission += ex.Commission;
                        return;
                    }

                    // Reduz / fecha / inverte
                    int absPrev2 = Math.Abs(p.Net);
                    int closing  = Math.Min(q, absPrev2);
                    p.ExitValue += px * closing;
                    p.ExitQty   += closing;
                    p.Commission += ex.Commission;
                    p.Net       += side * q;

                    if (absPrev2 <= q)
                    {
                        // Fechou o round-trip (pode ter invertido)
                        double avgExit = p.ExitValue / p.ExitQty;
                        ReportTrade(ex, p, avgExit);

                        int remainder = q - absPrev2;
                        if (remainder > 0)
                            _positions[key] = new Pos
                            {
                                Dir = side, Net = side * remainder, AvgEntry = px,
                                EntryTicks = ex.Time.Ticks, Commission = 0,
                                ExitValue = 0, ExitQty = 0
                            };
                        else
                            _positions.Remove(key);
                    }
                    // Reducao parcial: posicao segue aberta, nao reporta ainda
                }
            }
            catch (Exception err) { Print("[TraderOS] Erro OnExecution: " + err.Message); }
        }

        private void ReportTrade(Execution ex, Pos p, double avgExit)
        {
            if (string.IsNullOrEmpty(_apiKey) || _apiKey == "COLE_SUA_API_KEY_AQUI")
            {
                Print("[TraderOS] Trade detectado, mas API Key nao configurada — nao enviado.");
                return;
            }

            bool        isLong = p.Dir > 0;
            int         qty    = p.ExitQty;
            double      pv     = ex.Instrument.MasterInstrument != null ? ex.Instrument.MasterInstrument.PointValue : 20.0;
            double      pts    = isLong ? avgExit - p.AvgEntry : p.AvgEntry - avgExit;
            double      pnl    = Math.Round(pts * pv * qty - p.Commission, 2);
            string      inst   = ex.Instrument.MasterInstrument != null ? ex.Instrument.MasterInstrument.Name : ex.Instrument.FullName;
            CultureInfo ic     = CultureInfo.InvariantCulture;

            Print("[TraderOS] Trade fechado: " + inst + " " + (isLong ? "LONG" : "SHORT") + " x" + qty + " | PnL=$" + pnl + " — enviando...");

            // Snapshot ANTES do Task.Run (acesso cross-thread ao NT8 e proibido)
            string urlCopy   = _serverUrl.TrimEnd('/') + "/api/sync/ninjatrader";
            string keyCopy   = _apiKey;
            string logPath   = _logPath;
            string extId     = "NT_" + ex.ExecutionId;
            string direction = isLong ? "LONG" : "SHORT";
            string entryTime = new DateTime(p.EntryTicks).ToString("o", ic);
            string exitTime  = ex.Time.ToString("o", ic);
            string acctName  = ex.Account != null ? ex.Account.Name : "";
            double entryPx   = p.AvgEntry;
            double exitPx    = avgExit;
            double comm      = p.Commission;
            double pnlPts    = Math.Round(pts, 4);
            HttpClient cli   = _client;

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
                        new KeyValuePair<string, string>("pnl",         pnl.ToString("G17", ic)),
                        new KeyValuePair<string, string>("pnlPoints",   pnlPts.ToString("G17", ic)),
                        new KeyValuePair<string, string>("commission",  comm.ToString("G17", ic)),
                        new KeyValuePair<string, string>("entryTime",   entryTime),
                        new KeyValuePair<string, string>("exitTime",    exitTime),
                        new KeyValuePair<string, string>("accountName", acctName),
                        new KeyValuePair<string, string>("externalId",  extId),
                    };

                    var req = new HttpRequestMessage(HttpMethod.Post, urlCopy);
                    req.Headers.Add("X-API-Key", keyCopy);
                    req.Content = new FormUrlEncodedContent(form);

                    var    resp = await cli.SendAsync(req).ConfigureAwait(false);
                    string body = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                    WriteLog(logPath, "HTTP " + (int)resp.StatusCode + " " + direction + " " + inst + " PnL=" + pnl + " | " + body);
                }
                catch (Exception err)
                {
                    WriteLog(logPath, "ERRO ao enviar: " + err.Message);
                }
            });
        }

        private static void WriteLog(string path, string msg)
        {
            try { File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + Environment.NewLine); }
            catch { }
        }
    }
}`

export function IntegrationSection({ initialKeys }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

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

  async function downloadAddon() {
    setDownloading(true)
    try {
      const res = await fetch("/api/integrations/ninjatrader-addon/download")
      if (!res.ok) { alert("Erro ao gerar o arquivo. Tente novamente."); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = "TraderOSSync.zip"
      a.click()
      URL.revokeObjectURL(url)
      // Recarrega as keys caso uma nova tenha sido gerada automaticamente
      const keysRes = await fetch("/api/integrations/apikeys")
      if (keysRes.ok) setKeys(await keysRes.json())
      setTutorialOpen(true)
    } finally {
      setDownloading(false)
    }
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

      {/* Botão principal de download */}
      <button
        onClick={downloadAddon}
        disabled={downloading}
        className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-teal text-teal-foreground rounded-xl text-sm font-semibold hover:bg-teal/90 transition-colors disabled:opacity-50 shadow-sm"
      >
        <Download className="w-4 h-4" />
        {downloading ? "Gerando arquivo..." : "Baixar AddOn para NinjaTrader (.zip)"}
      </button>
      <p className="text-[11px] text-muted-foreground text-center -mt-2">
        Arquivo pré-configurado com sua API Key — pronto para importar em 2 cliques
      </p>

      {/* Tutorial de instalação */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setTutorialOpen(!tutorialOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-sm font-medium text-foreground"
        >
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-teal" />
            Como instalar — 3 passos
          </span>
          {tutorialOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {tutorialOpen && (
          <div className="px-5 py-5 space-y-5 text-sm">

            <Step n={1} title='Clique em "Baixar AddOn" acima'>
              <p className="text-muted-foreground text-xs leading-relaxed">
                O arquivo <span className="font-mono text-teal text-[10px]">TraderOSSync.zip</span> vai ser baixado
                com sua API Key já configurada. Salve em qualquer lugar do computador.
              </p>
            </Step>

            <Step n={2} title="Importe no NinjaTrader">
              <p className="text-muted-foreground text-xs leading-relaxed mb-2">
                No NinjaTrader 8, vá em:
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">Ferramentas</kbd>
                <span className="text-muted-foreground text-xs">→</span>
                <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">Importar</kbd>
                <span className="text-muted-foreground text-xs">→</span>
                <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">NinjaScript Add-On</kbd>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed mt-2">
                Selecione o arquivo <span className="font-mono text-[10px]">TraderOSSync.zip</span> baixado.
                O NinjaTrader compila e instala automaticamente.
              </p>
            </Step>

            <Step n={3} title="Confirme que está ativo">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Vá em <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">Novo</kbd> →{" "}
                <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">Saída NinjaScript</kbd>.
                Deve aparecer:
              </p>
              <div className="mt-2 p-2.5 bg-[#0a0f1a] rounded-lg border border-border">
                <p className="font-mono text-[10px] text-green-400">[TraderOS] Ativo. Monitorando X conta(s). Aguardando execucoes.</p>
              </div>
            </Step>

            <div className="flex items-start gap-3 p-4 bg-profit/5 border border-profit/20 rounded-lg">
              <span className="text-xl shrink-0">✅</span>
              <div>
                <p className="text-sm font-semibold text-foreground">Pronto! Configura uma vez e esquece.</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Todo trade fechado no NinjaTrader aparece automaticamente no seu Journal.
                  O AddOn liga sozinho toda vez que você abre o NT — sem gráfico, sem configuração extra.
                </p>
              </div>
            </div>

            {/* FAQ */}
            <div className="space-y-2 pt-2 border-t border-border">
              <p className="text-xs font-semibold text-foreground">Dúvidas frequentes</p>
              <Faq q="Preciso deixar algum gráfico aberto?">
                Não. O AddOn roda em segundo plano assim que o NinjaTrader abre. Pode fechar todos os gráficos.
              </Faq>
              <Faq q="Funciona com conta Apex?">
                Sim! A Apex usa o NinjaTrader. O AddOn captura trades de todas as contas conectadas (Eval e PA).
              </Faq>
              <Faq q="Trades antigos vão duplicar?">
                Não. Cada trade tem um ID único — se já foi enviado, o TraderOS ignora automaticamente.
              </Faq>
              <Faq q="Posso revogar a API Key?">
                Sim. Clique no ícone de lixeira ao lado da chave. O sync para imediatamente. Baixe um novo arquivo após gerar uma nova chave.
              </Faq>
              <Faq q="O AddOn afeta minha performance de trading?">
                Não. O envio é assíncrono e nunca bloqueia a thread de ordens do NinjaTrader.
              </Faq>
            </div>

          </div>
        )}
      </div>

      {/* Método manual (avançado) */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setManualOpen(!manualOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors text-xs text-muted-foreground"
        >
          <span>Método manual (avançado)</span>
          {manualOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {manualOpen && (
          <div className="px-5 pb-5 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Copie o código abaixo, crie um <strong className="text-foreground">New AddOn</strong> no NinjaScript Editor,
              cole com <kbd className="bg-muted px-1 py-0.5 rounded font-mono text-[10px]">Ctrl+A</kbd> e compile com{" "}
              <kbd className="bg-muted px-1 py-0.5 rounded font-mono text-[10px]">F5</kbd>.
              Após compilar, edite o arquivo <span className="font-mono text-teal text-[10px]">traderos_config.txt</span>{" "}
              em <span className="font-mono text-[10px]">Documentos\NinjaTrader 8\</span> com sua API Key.
            </p>
            <div className="relative">
              <pre className="bg-[#0a0f1a] border border-border rounded-lg p-4 text-[10px] font-mono text-green-400 overflow-x-auto max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                {NINJA_SCRIPT.slice(0, 400)}...
              </pre>
              <button
                onClick={copyCode}
                className={cn(
                  "absolute top-2 right-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors",
                  codeCopied ? "bg-profit/20 text-profit" : "bg-muted/80 text-foreground hover:bg-muted"
                )}
              >
                {codeCopied ? <><Check className="w-3 h-3" /> Copiado!</> : <><Copy className="w-3 h-3" /> Copiar código</>}
              </button>
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
