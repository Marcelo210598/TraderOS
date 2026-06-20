//+------------------------------------------------------------------+
//|                                              TraderOSSync.mq5     |
//|   Sincroniza trades, SALDO e depósitos/saques do MT5 com TraderOS|
//|   https://trader-os-ashy.vercel.app                              |
//+------------------------------------------------------------------+
//
//  COMO USAR:
//  1. Copie este arquivo para MQL5/Experts/ (no MetaEditor: File > Open Data Folder)
//  2. Compile (F7) no MetaEditor
//  3. No TraderOS: Configurações > Integrações > MetaTrader 5 > gere sua API Key
//  4. No MT5: Tools > Options > Expert Advisors > marque "Allow WebRequest for
//     listed URL" e ADICIONE: https://trader-os-ashy.vercel.app
//  5. Arraste o EA "TraderOSSync" para QUALQUER gráfico, cole a API Key nos
//     parâmetros e habilite o Auto-Trading (botão verde no topo).
//
//  v2.00: além dos trades, envia o SALDO REAL da conta (a cada trade e a cada
//  N minutos) e captura DEPÓSITOS/SAQUES — a Carteira do TraderOS fica completa.
//  Funciona em conta NETTING e HEDGING. O servidor deduplica, não duplica.
//
//+------------------------------------------------------------------+
#property copyright "TraderOS"
#property link      "https://trader-os-ashy.vercel.app"
#property version   "2.00"
#property strict

//--- Parâmetros (preenchidos pelo usuário ao anexar o EA)
input string ApiKey    = "";                                   // API Key (Configurações > Integrações)
input string ServerUrl = "https://trader-os-ashy.vercel.app";  // URL do TraderOS (não mude)
input bool   EnviarSaldo = true;                               // Enviar saldo real da conta (Carteira)
input int    IntervaloSaldoSegundos = 600;                     // De quanto em quanto envia o saldo (seg)
input bool   EnviarHistoricoAoIniciar = false;                 // Enviar trades fechados hoje ao iniciar
input int    MaxTentativas = 4;                                // Tentativas de reenvio se falhar

//--- Estado
string g_epTrade, g_epSaldo, g_epTx;

//+------------------------------------------------------------------+
//| Inicialização                                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   g_epTrade = ServerUrl + "/api/sync/mt5";
   g_epSaldo = ServerUrl + "/api/sync/mt5/balance";
   g_epTx    = ServerUrl + "/api/sync/mt5/transaction";

   if(StringLen(ApiKey) < 10)
   {
      Print("[TraderOS] ⚠️ API Key não preenchida. Abra os parâmetros do EA e cole sua key.");
      Comment("TraderOS: API Key faltando — veja os parâmetros do EA");
      return(INIT_FAILED);
   }

   Print("[TraderOS] EA conectado. Endpoint: ", g_epTrade);
   Comment("TraderOS: sincronizando trades e saldo desta conta ✅");

   if(EnviarSaldo)
   {
      EnviarSaldoConta();
      int seg = IntervaloSaldoSegundos < 60 ? 60 : IntervaloSaldoSegundos;
      EventSetTimer(seg);
   }
   if(EnviarHistoricoAoIniciar)
      EnviarFechadosHoje();

   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

//+------------------------------------------------------------------+
//| Timer — envia o saldo periodicamente                             |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(EnviarSaldo) EnviarSaldoConta();
}

//+------------------------------------------------------------------+
//| Evento de transação — dispara quando um deal é adicionado        |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;

   ulong dealTicket = trans.deal;
   if(dealTicket == 0) return;
   if(!HistoryDealSelect(dealTicket)) return;

   long dealType = HistoryDealGetInteger(dealTicket, DEAL_TYPE);

   // Depósito / saque / ajuste de saldo
   if(dealType == DEAL_TYPE_BALANCE || dealType == DEAL_TYPE_CREDIT ||
      dealType == DEAL_TYPE_CORRECTION || dealType == DEAL_TYPE_BONUS)
   {
      EnviarTransacaoSaldo(dealTicket, dealType);
      if(EnviarSaldo) EnviarSaldoConta();
      return;
   }

   // Trade (posição fechada): só deals de SAÍDA / IN-OUT
   long entry = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT) return;

   EnviarTradePorDealDeSaida(dealTicket);
   if(EnviarSaldo) EnviarSaldoConta();  // atualiza o saldo logo após o trade
}

//+------------------------------------------------------------------+
//| Tipo de conta (REAL / DEMO)                                      |
//+------------------------------------------------------------------+
string TipoConta()
{
   return (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO) ? "DEMO" : "REAL";
}

//+------------------------------------------------------------------+
//| Envia o saldo/equity real da conta                               |
//+------------------------------------------------------------------+
void EnviarSaldoConta()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   string moeda   = AccountInfoString(ACCOUNT_CURRENCY);
   if(StringLen(moeda) == 0) moeda = "USD";

   string body = StringFormat("balance=%s&equity=%s&currency=%s&accountType=%s",
                              DoubleToString(balance, 2), DoubleToString(equity, 2), moeda, TipoConta());
   Post(g_epSaldo, body, false);  // saldo: silencioso, sem retry agressivo
}

//+------------------------------------------------------------------+
//| Envia um depósito/saque/ajuste                                   |
//+------------------------------------------------------------------+
void EnviarTransacaoSaldo(ulong deal, long dealType)
{
   double amount = HistoryDealGetDouble(deal, DEAL_PROFIT);  // +entra / -sai
   datetime t    = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
   string tipo   = (dealType == DEAL_TYPE_BALANCE)
                     ? (amount >= 0 ? "DEPOSIT" : "WITHDRAWAL")
                     : "ADJUSTMENT";

   string body = StringFormat("type=%s&amount=%s&date=%s&accountType=%s&externalId=MT5TX_%I64u",
                              tipo, DoubleToString(amount, 2), TimeToIso(t), TipoConta(), deal);
   Post(g_epTx, body, true);
}

//+------------------------------------------------------------------+
//| Monta e envia o trade a partir do deal de SAÍDA                  |
//+------------------------------------------------------------------+
void EnviarTradePorDealDeSaida(ulong outDeal)
{
   long   positionId = HistoryDealGetInteger(outDeal, DEAL_POSITION_ID);
   string symbol     = HistoryDealGetString(outDeal, DEAL_SYMBOL);
   double volume     = HistoryDealGetDouble(outDeal, DEAL_VOLUME);
   double exitPrice  = HistoryDealGetDouble(outDeal, DEAL_PRICE);
   double profit     = HistoryDealGetDouble(outDeal, DEAL_PROFIT);
   double commission = HistoryDealGetDouble(outDeal, DEAL_COMMISSION);
   double swap       = HistoryDealGetDouble(outDeal, DEAL_SWAP);
   datetime exitTime = (datetime)HistoryDealGetInteger(outDeal, DEAL_TIME);

   double entryPrice = 0.0;
   datetime entryTime = exitTime;
   string direction = "LONG";
   if(HistorySelectByPosition(positionId))
   {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
      {
         ulong dd = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(dd, DEAL_ENTRY) == DEAL_ENTRY_IN)
         {
            entryPrice = HistoryDealGetDouble(dd, DEAL_PRICE);
            entryTime  = (datetime)HistoryDealGetInteger(dd, DEAL_TIME);
            long dt = HistoryDealGetInteger(dd, DEAL_TYPE);
            direction = (dt == DEAL_TYPE_BUY) ? "LONG" : "SHORT";
            break;
         }
      }
   }
   if(entryPrice <= 0.0) entryPrice = exitPrice;

   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0.0) point = 0.00001;
   double dirSign = (direction == "LONG") ? 1.0 : -1.0;
   double pnlPoints = ((exitPrice - entryPrice) * dirSign) / point;

   string body = StringFormat(
      "symbol=%s&direction=%s&entryPrice=%s&exitPrice=%s&volume=%s&pnl=%s&pnlPoints=%s&commission=%s&swap=%s&entryTime=%s&exitTime=%s&accountType=%s&externalId=MT5_%I64u",
      symbol, direction,
      DoubleToString(entryPrice, _Digits), DoubleToString(exitPrice, _Digits),
      DoubleToString(volume, 2), DoubleToString(profit, 2), DoubleToString(pnlPoints, 1),
      DoubleToString(commission, 2), DoubleToString(swap, 2),
      TimeToIso(entryTime), TimeToIso(exitTime), TipoConta(), positionId);

   Post(g_epTrade, body, true);
   Print(StringFormat("[TraderOS] %s PnL=%.2f enviado", symbol, profit));
}

//+------------------------------------------------------------------+
//| POST genérico (WebRequest síncrono) com retry opcional           |
//+------------------------------------------------------------------+
void Post(string endpoint, string body, bool comRetry)
{
   char post[]; char resp[]; string respHeaders;
   string headers = "Content-Type: application/x-www-form-urlencoded\r\nx-api-key: " + ApiKey + "\r\n";
   StringToCharArray(body, post, 0, StringLen(body));
   int len = ArraySize(post);
   if(len > 0 && post[len-1] == 0) ArrayResize(post, len-1);

   int maxT = comRetry ? MaxTentativas : 1;
   for(int tentativa = 1; tentativa <= maxT; tentativa++)
   {
      ResetLastError();
      int status = WebRequest("POST", endpoint, headers, 15000, post, resp, respHeaders);

      if(status == 201 || status == 200) return;
      if(status == -1)
      {
         int err = GetLastError();
         if(err == 4060 || err == 4014)
         {
            Print("[TraderOS] ❌ URL não autorizada. Tools > Options > Expert Advisors > Allow WebRequest: ", ServerUrl);
            return;
         }
      }
      else if(status >= 400 && status < 500 && status != 429)
      {
         Print(StringFormat("[TraderOS] ❌ rejeitado (HTTP %d): %s", status, CharArrayToString(resp)));
         return;
      }
      if(comRetry && tentativa < maxT) Sleep(1000 * tentativa);
   }
}

//+------------------------------------------------------------------+
//| Envia os trades já fechados HOJE (opcional, ao iniciar)          |
//+------------------------------------------------------------------+
void EnviarFechadosHoje()
{
   datetime hoje = (datetime)(TimeCurrent() - (TimeCurrent() % 86400));
   if(!HistorySelect(hoje, TimeCurrent())) return;
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong dd = HistoryDealGetTicket(i);
      long entry = HistoryDealGetInteger(dd, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT)
         EnviarTradePorDealDeSaida(dd);
   }
}

//+------------------------------------------------------------------+
//| datetime -> ISO 8601 UTC                                         |
//+------------------------------------------------------------------+
string TimeToIso(datetime t)
{
   MqlDateTime st; TimeToStruct(t, st);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", st.year, st.mon, st.day, st.hour, st.min, st.sec);
}
//+------------------------------------------------------------------+
