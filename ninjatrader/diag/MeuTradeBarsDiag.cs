#region Using declarations
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using NinjaTrader.Cbi;
using NinjaTrader.Data;
using NinjaTrader.NinjaScript;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
    public class MeuTradeBarsDiag : NinjaTrader.NinjaScript.AddOnBase
    {
        private readonly List<BarsRequest> _reqs = new List<BarsRequest>();

        // Trades ATM da Sim101 (comprado, 2 lotes de 1; hora local da VM)
        // T1 13:54-13:55: entrada 2 ctr em 28343.5; saidas 13:55:14.542 (28346) e 13:55:28.608 (28345 alvo)
        private static readonly DateTime T1E  = new DateTime(2026, 11, 3, 13, 54, 52, 930);
        private static readonly DateTime T1X1 = new DateTime(2026, 11, 3, 13, 55, 14, 542);
        private static readonly DateTime T1X2 = new DateTime(2026, 11, 3, 13, 55, 28, 608);
        // T2 13:58: entrada 2 ctr em 28367; stops 13:58:57.447 e .581 (28361.5)
        private static readonly DateTime T2E  = new DateTime(2026, 11, 3, 13, 58, 29, 150);
        private static readonly DateTime T2X1 = new DateTime(2026, 11, 3, 13, 58, 57, 447);
        private static readonly DateTime T2X2 = new DateTime(2026, 11, 3, 13, 58, 57, 581);

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults) { Name = "MeuTrade Bars Diag"; }
            else if (State == State.Active)
            {
                Print("[BARS v6] extremos dos trades ATM Sim101 (T1 e T2), com horario de cada extremo");
                Instrument inst = Instrument.GetInstrument("MNQ 12-26");
                if (inst == null) { Print("[BARS v6] instrumento MNQ 12-26 nao encontrado"); return; }

                BarsRequest req = new BarsRequest(inst, 300000);
                req.BarsPeriod = new BarsPeriod { BarsPeriodType = BarsPeriodType.Tick, Value = 1 };
                req.TradingHours = TradingHours.Get("Default 24 x 7");
                lock (_reqs) { _reqs.Add(req); }
                Stopwatch sw = Stopwatch.StartNew();
                req.Request(new Action<BarsRequest, ErrorCode, string>((br, errorCode, errorMessage) =>
                {
                    try
                    {
                        if (errorCode != ErrorCode.NoError) { Print("[BARS v6] ERRO: " + errorCode + " | " + errorMessage); return; }
                        int n = br.Bars.Count;
                        CultureInfo ic = CultureInfo.InvariantCulture;
                        Print("[BARS v6] " + sw.ElapsedMilliseconds + " ms | total=" + n + " ("
                            + br.Bars.GetTime(0).ToString("HH:mm:ss.fff", ic) + " -> "
                            + br.Bars.GetTime(n - 1).ToString("HH:mm:ss.fff", ic) + ")");
                        Win("T1 A trade todo [E -> X2]", br, n, T1E, T1X2);
                        Win("T1 B ate 1a saida [E -> X1]", br, n, T1E, T1X1);
                        Win("T2 A trade todo [E -> X2]", br, n, T2E, T2X2);
                        Win("T2 B ate 1a saida [E -> X1]", br, n, T2E, T2X1);
                        Print("[BARS v6] fim");
                    }
                    catch (Exception err) { Print("[BARS v6] erro no callback: " + err.Message); }
                }));
            }
            else if (State == State.Terminated)
            {
                lock (_reqs)
                {
                    foreach (BarsRequest r in _reqs) r.Dispose();
                    _reqs.Clear();
                }
            }
        }

        private void Win(string label, BarsRequest br, int n, DateTime from, DateTime to)
        {
            double hi = double.MinValue, lo = double.MaxValue;
            DateTime hiT = DateTime.MinValue, loT = DateTime.MinValue;
            int inWin = 0;
            for (int i = 0; i < n; i++)
            {
                DateTime t = br.Bars.GetTime(i);
                if (t < from || t > to) continue;
                inWin++;
                double h = br.Bars.GetHigh(i), l = br.Bars.GetLow(i);
                if (h > hi) { hi = h; hiT = t; }
                if (l < lo) { lo = l; loT = t; }
            }
            CultureInfo ic = CultureInfo.InvariantCulture;
            if (inWin == 0) { Print("      " + label + " -> fora da cobertura"); return; }
            Print("      " + label + " -> n=" + inWin
                + " | max=" + hi.ToString("0.00", ic) + " @ " + hiT.ToString("HH:mm:ss.fff", ic)
                + " | min=" + lo.ToString("0.00", ic) + " @ " + loT.ToString("HH:mm:ss.fff", ic));
        }
    }
}
