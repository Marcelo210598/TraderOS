#region Using declarations
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

// === TraderOS Sync (AddOn) — v2 ===
// Roda em segundo plano quando o NinjaTrader abre. Nao precisa de grafico.
//
// MUDANCAS v2 (15/06/2026):
//  1) A API key NAO fica mais chumbada no codigo. Ela e lida do arquivo
//     "traderos_config.txt" na pasta Documentos. Assim cada usuario usa a
//     PROPRIA key e ninguem manda trade pra conta do outro por engano.
//  2) Envio dos trades passa por UMA fila com 1 worker sequencial + retry com
//     backoff. Acaba o "A task was canceled": antes 33 trades disparavam POSTs
//     simultaneos e estouravam o timeout; agora vao um de cada vez, com 4
//     tentativas cada. A rota e idempotente (dedup por externalId), entao
//     reenviar nunca duplica.
namespace NinjaTrader.NinjaScript.AddOns
{
    public class TraderOSSync : NinjaTrader.NinjaScript.AddOnBase
    {
        private HttpClient              _client;
        private Dictionary<string, Pos> _positions;
        private HashSet<string>         _seen;
        private readonly string         _serverUrl = "https://trader-os-ashy.vercel.app";
        private readonly object         _lock      = new object();

        // ── Fila de envio (1 worker sequencial + retry) ──
        private BlockingCollection<Job> _queue;
        private Thread                  _worker;
        private string                  _apiKey;          // lida do config.txt — NUNCA chumbada
        private const int               MaxRetries  = 4;  // 4 tentativas por trade
        private const int               GapMs       = 150; // folga entre envios (alivia o serverless)

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

        private class Job
        {
            public List<KeyValuePair<string, string>> Form;
            public string Label;
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
                _client    = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
                _positions = new Dictionary<string, Pos>();
                _seen      = new HashSet<string>();
                _apiKey    = LoadApiKey();

                _queue  = new BlockingCollection<Job>();
                _worker = new Thread(ProcessQueue) { IsBackground = true, Name = "TraderOSSyncWorker" };
                _worker.Start();
            }
            else if (State == State.Active)
            {
                if (string.IsNullOrEmpty(_apiKey))
                    Print("[TraderOS] AVISO: API key nao encontrada. Crie o arquivo "
                          + "'traderos_config.txt' na pasta Documentos com a SUA key (linha "
                          + "comecando com 'traderos_'). Sync DESATIVADO ate isso.");

                foreach (Account a in Account.All)
                    a.ExecutionUpdate += OnExecution;
                Print("[TraderOS] Ativo. Monitorando " + Account.All.Count + " conta(s). Aguardando execucoes.");
            }
            else if (State == State.Terminated)
            {
                foreach (Account a in Account.All)
                    a.ExecutionUpdate -= OnExecution;

                // Drena a fila: para de aceitar novos e espera o worker terminar o que falta.
                if (_queue != null) _queue.CompleteAdding();
                if (_worker != null && _worker.IsAlive) _worker.Join(TimeSpan.FromSeconds(15));
                if (_client != null) { _client.Dispose(); _client = null; }
            }
        }

        // Le a API key do traderos_config.txt. Procura (nesta ordem):
        //   1) Documentos\NinjaTrader 8\traderos_config.txt  (padrao do tutorial)
        //   2) Documentos\traderos_config.txt                (fallback)
        // Aceita arquivo so com a key OU com comentarios (#) — pega a 1a linha
        // que comeca com "traderos_".
        private string LoadApiKey()
        {
            string docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            string[] candidates =
            {
                Path.Combine(docs, "NinjaTrader 8", "traderos_config.txt"),
                Path.Combine(docs, "traderos_config.txt"),
            };

            foreach (string path in candidates)
            {
                try
                {
                    if (!File.Exists(path)) continue;
                    foreach (string line in File.ReadAllLines(path))
                    {
                        string t = line.Trim();
                        if (t.Length == 0 || t.StartsWith("#")) continue;
                        if (t.StartsWith("traderos_"))
                        {
                            Print("[TraderOS] Config carregada de: " + path);
                            return t;
                        }
                    }
                    Print("[TraderOS] config em " + path + " sem key valida (precisa comecar com 'traderos_').");
                }
                catch (Exception e) { Print("[TraderOS] Erro lendo " + path + ": " + e.Message); }
            }

            Print("[TraderOS] traderos_config.txt nao encontrado em Documentos\\NinjaTrader 8\\ nem em Documentos\\.");
            return null;
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
                        int absPrev  = Math.Abs(p.Net);
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
                            _positions[key] = new Pos
                            {
                                Dir = side, Net = side * remainder, AvgEntry = px,
                                EntryTicks = ex.Time.Ticks, Commission = 0,
                                ExitValue = 0, ExitQty = 0
                            };
                        else
                            _positions.Remove(key);
                    }
                }
            }
            catch (Exception err) { Print("[TraderOS] Erro OnExecution: " + err.Message); }
        }

        // Monta o payload do trade e ENFILEIRA (nao envia direto — quem envia e o worker)
        private void ReportTrade(Execution ex, Pos p, double avgExit)
        {
            bool        isLong = p.Dir > 0;
            int         qty    = p.ExitQty;
            double      pv     = ex.Instrument.MasterInstrument != null ? ex.Instrument.MasterInstrument.PointValue : 20.0;
            double      pts    = isLong ? avgExit - p.AvgEntry : p.AvgEntry - avgExit;
            double      pnl    = Math.Round(pts * pv * qty - p.Commission, 2);
            string      inst   = ex.Instrument.MasterInstrument != null ? ex.Instrument.MasterInstrument.Name : ex.Instrument.FullName;
            CultureInfo ic     = CultureInfo.InvariantCulture;

            string direction = isLong ? "LONG" : "SHORT";
            string entryTime = new DateTime(p.EntryTicks).ToString("o", ic);
            string exitTime  = ex.Time.ToString("o", ic);
            string acctName  = ex.Account != null ? ex.Account.Name : "";
            double pnlPts    = Math.Round(pts, 4);

            var form = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("instrument",  inst),
                new KeyValuePair<string, string>("direction",   direction),
                new KeyValuePair<string, string>("entryPrice",  p.AvgEntry.ToString("G17", ic)),
                new KeyValuePair<string, string>("exitPrice",   avgExit.ToString("G17", ic)),
                new KeyValuePair<string, string>("quantity",    qty.ToString()),
                new KeyValuePair<string, string>("pnl",         pnl.ToString("G17", ic)),
                new KeyValuePair<string, string>("pnlPoints",   pnlPts.ToString("G17", ic)),
                new KeyValuePair<string, string>("commission",  p.Commission.ToString("G17", ic)),
                new KeyValuePair<string, string>("entryTime",   entryTime),
                new KeyValuePair<string, string>("exitTime",    exitTime),
                new KeyValuePair<string, string>("accountName", acctName),
                new KeyValuePair<string, string>("externalId",  "NT_" + ex.ExecutionId),
            };

            string label = inst + " " + direction + " x" + qty + " PnL=$" + pnl;
            Print("[TraderOS] Trade: " + label + " — enfileirado.");

            try
            {
                if (_queue != null && !_queue.IsAddingCompleted)
                    _queue.Add(new Job { Form = form, Label = label });
            }
            catch (Exception err) { Print("[TraderOS] Erro ao enfileirar: " + err.Message); }
        }

        // Worker unico: processa a fila SEQUENCIALMENTE com retry + backoff.
        private void ProcessQueue()
        {
            foreach (Job job in _queue.GetConsumingEnumerable())
            {
                if (string.IsNullOrEmpty(_apiKey))
                {
                    Print("[TraderOS] " + job.Label + " descartado (sem API key no config.txt).");
                    continue;
                }

                bool ok = false;
                for (int attempt = 1; attempt <= MaxRetries && !ok; attempt++)
                {
                    try
                    {
                        var req = new HttpRequestMessage(HttpMethod.Post, _serverUrl + "/api/sync/ninjatrader");
                        req.Headers.Add("X-API-Key", _apiKey);
                        req.Content = new FormUrlEncodedContent(job.Form);

                        var resp = _client.SendAsync(req).GetAwaiter().GetResult();
                        int code = (int)resp.StatusCode;

                        if (resp.IsSuccessStatusCode)
                        {
                            ok = true;
                            Print("[TraderOS] " + job.Label + " -> HTTP " + code + " OK");
                        }
                        else if (code >= 400 && code < 500 && code != 429)
                        {
                            // Erro do cliente (key invalida, payload ruido). Retry nao resolve.
                            Print("[TraderOS] " + job.Label + " -> HTTP " + code + " (sem retry): " + resp.ReasonPhrase);
                            break;
                        }
                        else
                        {
                            Print("[TraderOS] " + job.Label + " -> HTTP " + code
                                  + " tentativa " + attempt + "/" + MaxRetries);
                        }
                    }
                    catch (Exception err)
                    {
                        Print("[TraderOS] " + job.Label + " falhou tentativa "
                              + attempt + "/" + MaxRetries + ": " + err.Message);
                    }

                    if (!ok && attempt < MaxRetries)
                        Thread.Sleep(1000 * attempt * attempt); // backoff: 1s, 4s, 9s
                }

                if (!ok)
                    Print("[TraderOS] " + job.Label + " DESISTIU apos " + MaxRetries + " tentativas.");

                Thread.Sleep(GapMs); // espacamento entre envios
            }
        }
    }
}
