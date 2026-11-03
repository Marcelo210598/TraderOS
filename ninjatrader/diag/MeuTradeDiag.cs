#region Using declarations
using System;
using System.Globalization;
using System.Text;
using System.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

// MeuTrade Diag v6 — SO IMPRIME (nao envia nada, nao altera nada).
// Cola POR CIMA do MeuTradeDiag existente (mesmo nome de classe) e aperta F5.
// Prints:
//   [D6-INV]  inventario de Account.Executions por conta (teste de REINICIO do NT8)
//   [D6-FILL] cada fill: MarketPosition, PositionStrategy, Order nulo?, OrderAction, OrderType, OrderState
//   [D6-POS]  foto das posicoes abertas da conta no momento do fill (teste: Position e por instrumento?)
namespace NinjaTrader.NinjaScript.AddOns
{
    public class MeuTradeDiag : NinjaTrader.NinjaScript.AddOnBase
    {
        private Timer t30;
        private Timer t90;
        private Timer t150;
        private Timer t240;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults) { Name = "MeuTrade Diag"; }
            else if (State == State.Active)
            {
                foreach (Account a in Account.All) a.ExecutionUpdate += OnExec;
                Print("[D6] v6 ativo em " + Account.All.Count + " conta(s) | agora=" + DateTime.Now.ToString("o", CultureInfo.InvariantCulture));
                Inventario("start");
                t30 = new Timer(delegate { Inventario("+30s"); }, null, 30000, Timeout.Infinite);
                t90 = new Timer(delegate { Inventario("+90s"); }, null, 90000, Timeout.Infinite);
                t150 = new Timer(delegate { Inventario("+150s"); }, null, 150000, Timeout.Infinite);
                t240 = new Timer(delegate { Inventario("+240s"); }, null, 240000, Timeout.Infinite);
            }
            else if (State == State.Terminated)
            {
                foreach (Account a in Account.All) a.ExecutionUpdate -= OnExec;
                if (t30 != null) t30.Dispose();
                if (t90 != null) t90.Dispose();
                if (t150 != null) t150.Dispose();
                if (t240 != null) t240.Dispose();
            }
        }

        private void Inventario(string quando)
        {
            try
            {
                CultureInfo ic = CultureInfo.InvariantCulture;
                foreach (Account a in Account.All)
                {
                    int n = 0;
                    StringBuilder cm = new StringBuilder();
                    double cmTot = 0;
                    DateTime? primeiro = null;
                    DateTime? ultimo = null;
                    foreach (Execution ex in a.Executions)
                    {
                        n++;
                        cm.Append(ex.Commission.ToString("G6", ic) + " ");
                        cmTot += ex.Commission;
                        if (primeiro == null || ex.Time < primeiro.Value) primeiro = ex.Time;
                        if (ultimo == null || ex.Time > ultimo.Value) ultimo = ex.Time;
                    }
                    Print("[D6-INV] " + quando + " | agora=" + DateTime.Now.ToString("HH:mm:ss", ic) + " | Acct=" + a.Name + " | Status=" + a.ConnectionStatus
                        + " | Execs=" + n + " | CommTotal=" + cmTot.ToString("G6", ic) + " | CommPorExec=[" + cm.ToString().Trim() + "]"
                        + " | Primeiro=" + (primeiro == null ? "-" : primeiro.Value.ToString("o", ic))
                        + " | Ultimo=" + (ultimo == null ? "-" : ultimo.Value.ToString("o", ic)));
                }
            }
            catch (Exception err) { Print("[D6-INV] erro: " + err.Message); }
        }

        private void OnExec(object sender, ExecutionEventArgs e)
        {
            try
            {
                Execution ex = e.Execution;
                if (ex == null) return;
                CultureInfo ic = CultureInfo.InvariantCulture;

                Order o = ex.Order;
                string ordInfo = o == null
                    ? "Order=NULL"
                    : "Order=ok | Action=" + o.OrderAction + " | Type=" + o.OrderType + " | State=" + o.OrderState + " | OName=" + o.Name;

                Print("[D6-FILL] t=" + ex.Time.ToString("HH:mm:ss.fff", ic)
                    + " | ExId=" + ex.ExecutionId
                    + " | Acct=" + (ex.Account != null ? ex.Account.Name : "null")
                    + " | Inst=" + (ex.Instrument != null ? ex.Instrument.FullName : "null")
                    + " | MktPos=" + ex.MarketPosition
                    + " | Qty=" + ex.Quantity
                    + " | Price=" + ex.Price.ToString("G17", ic)
                    + " | PosConta=" + ex.Position
                    + " | PosStrat=" + ex.PositionStrategy
                    + " | Name=" + ex.Name
                    + " | " + ordInfo);

                if (ex.Account != null)
                {
                    StringBuilder sb = new StringBuilder();
                    int cnt = 0;
                    foreach (Position p in ex.Account.Positions)
                    {
                        cnt++;
                        sb.Append(" [" + p.Instrument.FullName + " " + p.MarketPosition + " x" + p.Quantity + "]");
                    }
                    Print("[D6-POS] Acct=" + ex.Account.Name + " | PosicoesAbertas=" + cnt + sb.ToString());
                }
            }
            catch (Exception err) { Print("[D6] erro: " + err.Message); }
        }
    }
}
