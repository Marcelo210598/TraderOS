"use client"

import { useState } from "react"
import Image from "next/image"
import { Copy, Check, Trash2, Plus, ChevronDown, ChevronUp, Download, Clock, Terminal, FolderOpen, Zap, TrendingUp } from "lucide-react"
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
        private HttpClient              _client;
        private FileSystemWatcher       _watcher;
        private Dictionary<string, Pos> _positions;
        private HashSet<string>         _seen;
        private string                  _configPath;
        private string                  _logPath;
        private string                  _apiKey    = "";
        private string                  _serverUrl = "https://trader-os-ashy.vercel.app";
        private readonly object         _lock = new object();

        private class Pos
        {
            public int    Dir;
            public int    Net;
            public double AvgEntry;
            public long   EntryTicks;
            public double ExitValue;
            public int    ExitQty;
            public double Commission;
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
                foreach (Account a in Account.All)
                    a.ExecutionUpdate += OnExecution;
                Print("[TraderOS] Ativo. Monitorando " + Account.All.Count + " conta(s). Aguardando execucoes.");
            }
            else if (State == State.Terminated)
            {
                foreach (Account a in Account.All)
                    a.ExecutionUpdate -= OnExecution;
                if (_watcher != null) { _watcher.Dispose(); _watcher = null; }
                if (_client  != null) { _client.Dispose();  _client  = null; }
            }
        }

        private void LoadConfig(bool createIfMissing)
        {
            try
            {
                if (!File.Exists(_configPath))
                {
                    if (createIfMissing)
                    {
                        File.WriteAllText(_configPath, "apikey=COLE_SUA_API_KEY_AQUI\\nserver=https://trader-os-ashy.vercel.app");
                        Print("[TraderOS] Config criada em: " + _configPath);
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
                    Print("[TraderOS] API Key nao configurada. Edite: " + _configPath);
                else
                    Print("[TraderOS] Config carregada. Pronto para sincronizar.");
            }
            catch (Exception ex) { Print("[TraderOS] Erro config: " + ex.Message); }
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

        private void OnExecution(object sender, ExecutionEventArgs e)
        {
            try
            {
                Execution ex = e.Execution;
                if (ex == null || ex.Instrument == null || ex.Quantity <= 0) return;
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
                        _positions[key] = new Pos { Dir = side, Net = side * q, AvgEntry = px, EntryTicks = ex.Time.Ticks, Commission = ex.Commission, ExitValue = 0, ExitQty = 0 };
                        return;
                    }
                    if (Math.Sign(p.Net) == side)
                    {
                        int absPrev = Math.Abs(p.Net);
                        p.AvgEntry   = (p.AvgEntry * absPrev + px * q) / (absPrev + q);
                        p.Net       += side * q;
                        p.Commission += ex.Commission;
                        return;
                    }
                    int absPrev2 = Math.Abs(p.Net);
                    int closing  = Math.Min(q, absPrev2);
                    p.ExitValue  += px * closing;
                    p.ExitQty    += closing;
                    p.Commission += ex.Commission;
                    p.Net        += side * q;
                    if (absPrev2 <= q)
                    {
                        double avgExit = p.ExitValue / p.ExitQty;
                        ReportTrade(ex, p, avgExit);
                        int remainder = q - absPrev2;
                        if (remainder > 0)
                            _positions[key] = new Pos { Dir = side, Net = side * remainder, AvgEntry = px, EntryTicks = ex.Time.Ticks, Commission = 0, ExitValue = 0, ExitQty = 0 };
                        else
                            _positions.Remove(key);
                    }
                }
            }
            catch (Exception err) { Print("[TraderOS] Erro OnExecution: " + err.Message); }
        }

        private void ReportTrade(Execution ex, Pos p, double avgExit)
        {
            bool isLong = p.Dir > 0;
            int qty = p.ExitQty;
            double pv = ex.Instrument.MasterInstrument != null ? ex.Instrument.MasterInstrument.PointValue : 20.0;
            double pts = isLong ? avgExit - p.AvgEntry : p.AvgEntry - avgExit;
            double pnl = Math.Round(pts * pv * qty - p.Commission, 2);
            string inst = ex.Instrument.MasterInstrument != null ? ex.Instrument.MasterInstrument.Name : ex.Instrument.FullName;
            CultureInfo ic = CultureInfo.InvariantCulture;
            Print("[TraderOS] Trade: " + inst + " " + (isLong ? "LONG" : "SHORT") + " x" + qty + " | PnL=$" + pnl + " — enviando...");
            string urlCopy = _serverUrl + "/api/sync/ninjatrader";
            string keyCopy = _apiKey; string logPath = _logPath;
            string extId = "NT_" + ex.ExecutionId; string direction = isLong ? "LONG" : "SHORT";
            string entryTime = new DateTime(p.EntryTicks).ToString("o", ic); string exitTime = ex.Time.ToString("o", ic);
            string acctName = ex.Account != null ? ex.Account.Name : "";
            double entryPx = p.AvgEntry; double exitPx = avgExit; double comm = p.Commission; double pnlPts = Math.Round(pts, 4);
            HttpClient cli = _client;
            Task.Run(async () =>
            {
                try
                {
                    var form = new List<KeyValuePair<string, string>>
                    {
                        new KeyValuePair<string, string>("instrument", inst),
                        new KeyValuePair<string, string>("direction", direction),
                        new KeyValuePair<string, string>("entryPrice", entryPx.ToString("G17", ic)),
                        new KeyValuePair<string, string>("exitPrice", exitPx.ToString("G17", ic)),
                        new KeyValuePair<string, string>("quantity", qty.ToString()),
                        new KeyValuePair<string, string>("pnl", pnl.ToString("G17", ic)),
                        new KeyValuePair<string, string>("pnlPoints", pnlPts.ToString("G17", ic)),
                        new KeyValuePair<string, string>("commission", comm.ToString("G17", ic)),
                        new KeyValuePair<string, string>("entryTime", entryTime),
                        new KeyValuePair<string, string>("exitTime", exitTime),
                        new KeyValuePair<string, string>("accountName", acctName),
                        new KeyValuePair<string, string>("externalId", extId),
                    };
                    var req = new HttpRequestMessage(HttpMethod.Post, urlCopy);
                    req.Headers.Add("X-API-Key", keyCopy);
                    req.Content = new FormUrlEncodedContent(form);
                    var resp = await cli.SendAsync(req).ConfigureAwait(false);
                    string body = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                    File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  HTTP " + (int)resp.StatusCode + " " + direction + " " + inst + " PnL=" + pnl + " | " + body + Environment.NewLine);
                }
                catch (Exception err) { File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  ERRO: " + err.Message + Environment.NewLine); }
            });
        }
    }
}`

// Plataformas disponíveis
const PLATFORMS = [
  { id: "ninjatrader", label: "NinjaTrader 8", short: "NT", active: true, description: "Sincronização automática de trades" },
  { id: "rithmic",     label: "Rithmic",        short: "R",  active: false, description: "Em breve — Q3 2026" },
  { id: "tradestation",label: "TradeStation",   short: "TS", active: false, description: "Em breve — Q4 2026" },
  { id: "ibkr",        label: "Interactive Brokers", short: "IB", active: false, description: "Em breve — 2027" },
]

export function IntegrationSection({ initialKeys }: Props) {
  const [platform, setPlatform]     = useState("ninjatrader")
  const [keys, setKeys]             = useState<ApiKey[]>(initialKeys)
  const [loading, setLoading]       = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [copied, setCopied]         = useState<string | null>(null)
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
    } finally { setLoading(false) }
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
      a.download = "TraderOSSync.cs"
      a.click()
      URL.revokeObjectURL(url)
      const keysRes = await fetch("/api/integrations/apikeys")
      if (keysRes.ok) setKeys(await keysRes.json())
      setTutorialOpen(true)
    } finally { setDownloading(false) }
  }

  const lastSync = keys.find((k) => k.lastUsed)?.lastUsed
  const hasKeys  = keys.length > 0
  const selected = PLATFORMS.find((p) => p.id === platform)!

  return (
    <div className="space-y-5">

      {/* Seletor de plataformas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPlatform(p.id)}
            className={cn(
              "relative flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all",
              platform === p.id
                ? "border-teal bg-teal/5 text-foreground"
                : "border-border bg-muted/10 text-muted-foreground hover:border-border/80 hover:bg-muted/20",
              !p.active && "opacity-60"
            )}
          >
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold",
              platform === p.id ? "bg-teal text-teal-foreground" : "bg-muted text-muted-foreground"
            )}>
              {p.short}
            </div>
            <span className="text-[10px] font-medium leading-tight">{p.label}</span>
            {p.active ? (
              <span className="text-[9px] text-teal font-medium">● Disponível</span>
            ) : (
              <span className="text-[9px] text-muted-foreground">Em breve</span>
            )}
          </button>
        ))}
      </div>

      {/* Conteúdo por plataforma */}
      {platform === "ninjatrader" ? (
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
              <button onClick={() => copyKey(k.key, k.id)} title="Copiar chave completa"
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0">
                {copied === k.id ? <Check className="w-3.5 h-3.5 text-profit" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => revoke(k.id)} title="Revogar chave"
                className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {keys.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              Gere uma API Key para começar a sincronizar seus trades automaticamente.
            </p>
          )}

          {/* Botão de download */}
          <button
            onClick={downloadAddon}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-teal text-teal-foreground rounded-xl text-sm font-semibold hover:bg-teal/90 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Download className="w-4 h-4" />
            {downloading ? "Gerando arquivo..." : "Baixar AddOn para NinjaTrader (.cs)"}
          </button>
          <p className="text-[11px] text-muted-foreground text-center -mt-2">
            Arquivo pré-configurado com sua API Key — cole na pasta do NinjaTrader e compile
          </p>

          {/* Tutorial passo a passo */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setTutorialOpen(!tutorialOpen)}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-sm font-medium text-foreground"
            >
              <span className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-teal" />
                Como instalar — Tutorial passo a passo
              </span>
              {tutorialOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {tutorialOpen && (
              <div className="divide-y divide-border">

                {/* Passo 1 */}
                <TutorialStep n={1} title='Acesse Configurações → Integrações e baixe o AddOn' icon={<Download className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Na barra lateral do TraderOS, clique em <strong className="text-foreground">Configurações</strong> e role até a seção
                    <strong className="text-foreground"> NinjaTrader 8</strong>. Clique no botão{" "}
                    <span className="text-teal font-medium">Baixar AddOn (.cs)</span>. O arquivo{" "}
                    <span className="font-mono text-[10px] text-teal">TraderOSSync.cs</span> já vem com sua API Key incluída — sem precisar configurar nada manualmente.
                  </p>
                  <div className="rounded-xl overflow-hidden border border-border">
                    <Image
                      src="/tutorial/step1-settings.png"
                      alt="TraderOS — Configurações → Integrações com botão de download"
                      width={900}
                      height={500}
                      className="w-full object-cover"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5 text-center italic">
                    Tela de Configurações → Integrações com o botão de download do AddOn
                  </p>
                </TutorialStep>

                {/* Passo 2 */}
                <TutorialStep n={2} title="Mova o arquivo para a pasta do NinjaTrader" icon={<FolderOpen className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Após o download, mova o arquivo <span className="font-mono text-[10px] text-teal">TraderOSSync.cs</span> para a pasta de AddOns do NinjaTrader.
                    Use o atalho abaixo para abrir a pasta direto:
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-lg border border-border">
                      <kbd className="px-2 py-1 bg-muted rounded text-[10px] font-mono text-foreground shrink-0">Win+R</kbd>
                      <span className="text-xs text-muted-foreground">→ cole o caminho abaixo → Enter</span>
                    </div>
                    <div className="p-3 bg-[#0a0f1a] rounded-lg border border-border flex items-center justify-between gap-2">
                      <code className="text-[11px] font-mono text-teal break-all">
                        %USERPROFILE%\Documents\NinjaTrader 8\bin\Custom\AddOns
                      </code>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      A pasta <span className="font-mono text-[10px]">AddOns</span> abre no Windows Explorer. Arraste ou cole o arquivo <span className="font-mono text-[10px]">TraderOSSync.cs</span> para dentro dela.
                    </p>
                  </div>
                </TutorialStep>

                {/* Passo 3 */}
                <TutorialStep n={3} title="Compile o AddOn no NinjaScript Editor" icon={<Terminal className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    No NinjaTrader 8, abra o Editor NinjaScript e compile o arquivo:
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 flex-wrap p-3 bg-muted/20 rounded-lg border border-border">
                      <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono">Novo</kbd>
                      <span className="text-muted-foreground text-xs">→</span>
                      <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono">Editor NinjaScript</kbd>
                      <span className="text-muted-foreground text-xs">→</span>
                      <span className="text-xs text-muted-foreground">painel esquerdo</span>
                      <span className="text-muted-foreground text-xs">→</span>
                      <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono">AddOns</kbd>
                      <span className="text-muted-foreground text-xs">→</span>
                      <kbd className="bg-teal/10 border border-teal/30 text-teal px-2 py-1 rounded text-[10px] font-mono">TraderOSSync</kbd>
                      <span className="text-muted-foreground text-xs">→</span>
                      <kbd className="bg-muted px-2 py-1 rounded text-[10px] font-mono font-bold">F5</kbd>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      O arquivo aparece automaticamente na pasta <span className="font-mono text-[10px]">AddOns</span> no painel do editor.
                      Dê duplo clique para abrir e pressione <kbd className="bg-muted px-1 rounded font-mono text-[10px]">F5</kbd> para compilar.
                    </p>
                  </div>
                </TutorialStep>

                {/* Passo 4 */}
                <TutorialStep n={4} title="Confirme que o AddOn está ativo" icon={<Zap className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    Abra a janela de saída do NinjaTrader:
                    <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono mx-1">Novo</kbd>→
                    <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono mx-1">Saída NinjaScript</kbd>.
                    Você verá as mensagens confirmando que a integração está funcionando:
                  </p>
                  <div className="p-4 bg-[#0a0f1a] rounded-xl border border-border font-mono text-[11px] space-y-1">
                    <p className="text-green-400">[TraderOS] Config carregada. Pronto para sincronizar.</p>
                    <p className="text-green-400">[TraderOS] Ativo. Monitorando 4 conta(s). Aguardando execucoes.</p>
                    <p className="text-green-300/60 mt-2">— após fechar um trade —</p>
                    <p className="text-teal">[TraderOS] Trade: NQ LONG x1 | PnL=$+75 — enviando...</p>
                    <p className="text-teal">[TraderOS] HTTP 201 OK</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Se aparecer <span className="text-profit font-mono text-[10px]">Ativo. Monitorando</span>, a integração está pronta.
                  </p>
                </TutorialStep>

                {/* Passo 5 */}
                <TutorialStep n={5} title="Pronto! Trades sincronizados automaticamente" icon={<TrendingUp className="w-4 h-4" />}>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    A partir de agora, cada trade fechado no NinjaTrader aparece automaticamente no Journal do TraderOS em poucos segundos.
                    Sem copiar dados, sem importar CSV — tudo em tempo real.
                  </p>
                  <div className="space-y-2">
                    {[
                      { dir: "LONG",  inst: "NQ", entry: "30440.00", exit: "30441.50", pnl: "+$30",  pts: "+1.50 pts", win: true },
                      { dir: "SHORT", inst: "NQ", entry: "30491.25", exit: "30487.75", pnl: "+$70",  pts: "+3.50 pts", win: true },
                      { dir: "LONG",  inst: "NQ", entry: "30456.75", exit: "30454.50", pnl: "-$45",  pts: "-2.25 pts", win: false },
                    ].map((t, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2.5 bg-muted/20 rounded-lg border border-border">
                        <div className="flex items-center gap-2.5">
                          <div className={cn("w-1.5 h-1.5 rounded-full", t.win ? "bg-profit" : "bg-loss")} />
                          <span className="text-xs font-medium text-foreground">{t.inst}</span>
                          <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold", t.dir === "LONG" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss")}>
                            {t.dir}
                          </span>
                          <span className="text-[10px] text-muted-foreground">E: {t.entry} → S: {t.exit}</span>
                        </div>
                        <div className="text-right">
                          <p className={cn("text-sm font-bold", t.win ? "text-profit" : "text-loss")}>{t.pnl}</p>
                          <p className="text-[9px] text-muted-foreground">{t.pts}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 p-3 bg-profit/5 border border-profit/20 rounded-lg">
                    <p className="text-xs font-semibold text-foreground mb-0.5">Configura uma vez, funciona para sempre.</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      O AddOn liga sozinho toda vez que o NinjaTrader abre — sem precisar de gráfico aberto nem de nenhuma configuração adicional. Funciona com todas as contas Apex (Eval e PA).
                    </p>
                  </div>
                </TutorialStep>

                {/* FAQ */}
                <div className="px-5 py-4 space-y-2">
                  <p className="text-xs font-semibold text-foreground mb-3">Dúvidas frequentes</p>
                  <Faq q="Preciso deixar algum gráfico aberto?">
                    Não. O AddOn roda em segundo plano assim que o NinjaTrader abre. Pode fechar todos os gráficos.
                  </Faq>
                  <Faq q="Funciona com conta Apex?">
                    Sim! A Apex usa o NinjaTrader. O AddOn captura trades de todas as contas conectadas (Eval e PA).
                  </Faq>
                  <Faq q="Trades antigos vão duplicar?">
                    Não. Cada trade tem um ID único. Se já foi enviado, o TraderOS ignora automaticamente.
                  </Faq>
                  <Faq q="Posso revogar a API Key?">
                    Sim. Clique no ícone de lixeira. O sync para imediatamente. Baixe um novo .cs após gerar nova chave.
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
                  Copie o código, crie um <strong className="text-foreground">New AddOn</strong> no NinjaScript Editor,
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
      ) : (
        /* Plataforma em breve */
        <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-muted/30 border border-border flex items-center justify-center text-xl font-bold text-muted-foreground">
            {selected.short}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{selected.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{selected.description}</p>
          </div>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            Estamos trabalhando na integração com {selected.label}. Deixe seu email para ser notificado quando estiver disponível.
          </p>
          <button className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
            Me avisar quando estiver disponível
          </button>
        </div>
      )}

    </div>
  )
}

function TutorialStep({ n, title, icon, children }: { n: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-5 py-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-teal/10 border border-teal/30 flex items-center justify-center text-teal text-sm font-bold shrink-0">
          {n}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-teal">{icon}</span>
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
      </div>
      <div className="ml-11">
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
