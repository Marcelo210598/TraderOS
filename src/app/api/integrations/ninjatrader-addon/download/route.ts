import { NextResponse } from "next/server"
import { auth } from "@/auth"
import fs from "fs"
import path from "path"

const CS_TEMPLATE = `#region Using declarations
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

// === MeuTrade Sync (AddOn) ===
// Roda automaticamente quando o NinjaTrader abre. Nao precisa de grafico.
// Lê a API Key do arquivo: Documentos\\NinjaTrader 8\\traderos_config.txt
namespace NinjaTrader.NinjaScript.AddOns
{
    public class TraderOSSync : NinjaTrader.NinjaScript.AddOnBase
    {
        private HttpClient              _client;
        private Dictionary<string, Pos> _positions;
        private HashSet<string>         _seen;
        private string                  _apiKey    = "";
        private readonly string         _serverUrl = "https://trader-os-ashy.vercel.app";
        private readonly object         _lock      = new object();

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
                Name        = "MeuTrade Sync";
                Description = "Sincroniza automaticamente seus trades com o MeuTrade.";
            }
            else if (State == State.Configure)
            {
                ServicePointManager.SecurityProtocol =
                    SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
                _client    = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
                _positions = new Dictionary<string, Pos>();
                _seen      = new HashSet<string>();

                string configPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                    "NinjaTrader 8", "traderos_config.txt"
                );
                if (File.Exists(configPath))
                {
                    _apiKey = File.ReadAllText(configPath).Trim();
                    Print("[MeuTrade] Config carregada. Pronto para sincronizar.");
                }
                else
                {
                    Print("[MeuTrade] AVISO: traderos_config.txt nao encontrado em " + configPath);
                    Print("[MeuTrade] Baixe em: https://trader-os-ashy.vercel.app/configuracoes");
                }
            }
            else if (State == State.Active)
            {
                foreach (Account a in Account.All)
                    a.ExecutionUpdate += OnExecution;
                Print("[MeuTrade] Ativo. Monitorando " + Account.All.Count + " conta(s). Aguardando execucoes.");
            }
            else if (State == State.Terminated)
            {
                foreach (Account a in Account.All)
                    a.ExecutionUpdate -= OnExecution;
                if (_client != null) { _client.Dispose(); _client = null; }
            }
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
            catch (Exception err) { Print("[MeuTrade] Erro OnExecution: " + err.Message); }
        }

        private void ReportTrade(Execution ex, Pos p, double avgExit)
        {
            bool        isLong = p.Dir > 0;
            int         qty    = p.ExitQty;
            double      pv     = ex.Instrument.MasterInstrument != null ? ex.Instrument.MasterInstrument.PointValue : 20.0;
            double      pts    = isLong ? avgExit - p.AvgEntry : p.AvgEntry - avgExit;
            double      pnl    = Math.Round(pts * pv * qty - p.Commission, 2);
            string      inst   = ex.Instrument.MasterInstrument != null ? ex.Instrument.MasterInstrument.Name : ex.Instrument.FullName;
            CultureInfo ic     = CultureInfo.InvariantCulture;

            Print("[MeuTrade] Trade: " + inst + " " + (isLong ? "LONG" : "SHORT") + " x" + qty + " PnL=$" + pnl + " — enviando...");

            string urlCopy   = _serverUrl + "/api/sync/ninjatrader";
            string keyCopy   = _apiKey;
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

                    var resp = await cli.SendAsync(req).ConfigureAwait(false);
                    Print("[MeuTrade] HTTP " + (int)resp.StatusCode + (resp.IsSuccessStatusCode ? " OK" : " Erro"));
                }
                catch (Exception err)
                {
                    Print("[MeuTrade] Erro ao enviar: " + err.Message);
                }
            });
        }
    }
}
`

function crc32(buf: Buffer): number {
  const table: number[] = []
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF]
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function makeZip(filename: string, content: Buffer): Buffer {
  const name = Buffer.from(filename, "utf8")
  const crc  = crc32(content)
  const size = content.length

  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt16LE(0, 10)
  local.writeUInt16LE(0, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(size, 18)
  local.writeUInt32LE(size, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  name.copy(local, 30)

  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt16LE(0, 12)
  central.writeUInt16LE(0, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(size, 20)
  central.writeUInt32LE(size, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt16LE(0, 34)
  central.writeUInt16LE(0, 36)
  central.writeUInt32LE(0, 38)
  central.writeUInt32LE(0, 42)
  name.copy(central, 46)

  const centralOffset = local.length + size
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([local, content, central, eocd])
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const zipPath = path.join(process.cwd(), "public", "TraderOSSync.zip")
  const zipBuf  = fs.readFileSync(zipPath)

  return new NextResponse(new Uint8Array(zipBuf), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="TraderOSSync.zip"',
      "Content-Length": zipBuf.length.toString(),
    },
  })
}
