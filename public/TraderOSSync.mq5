//+------------------------------------------------------------------+
//|                                              TraderOSSync.mq5     |
//|   Sincroniza trades do MetaTrader 5 com o TraderOS               |
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
//  Funciona em conta NETTING e HEDGING. Captura cada posição FECHADA e envia
//  pro TraderOS. O servidor deduplica pelo position_id, então não duplica.
//
//+------------------------------------------------------------------+
#property copyright "TraderOS"
#property link      "https://trader-os-ashy.vercel.app"
#property version   "1.00"
#property strict

//--- Parâmetros (preenchidos pelo usuário ao anexar o EA)
input string ApiKey    = "";                                   // API Key (Configurações > Integrações)
input string ServerUrl = "https://trader-os-ashy.vercel.app";  // URL do TraderOS (não mude)
input bool   EnviarHistoricoAoIniciar = false;                 // Enviar trades fechados hoje ao iniciar
input int    MaxTentativas = 4;                                // Tentativas de reenvio se falhar

//--- Estado
string g_endpoint;

//+------------------------------------------------------------------+
//| Inicialização                                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   g_endpoint = ServerUrl + "/api/sync/mt5";

   if(StringLen(ApiKey) < 10)
   {
      Print("[TraderOS] ⚠️ API Key não preenchida. Abra os parâmetros do EA e cole sua key.");
      Comment("TraderOS: API Key faltando — veja os parâmetros do EA");
      return(INIT_FAILED);
   }

   Print("[TraderOS] EA conectado. Endpoint: ", g_endpoint);
   Comment("TraderOS: sincronizando trades desta conta ✅");

   if(EnviarHistoricoAoIniciar)
      EnviarFechadosHoje();

   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { Comment(""); }

//+------------------------------------------------------------------+
//| Evento de transação — dispara quando um deal é adicionado        |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   // Só nos interessa quando um DEAL é adicionado ao histórico
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;

   ulong dealTicket = trans.deal;
   if(dealTicket == 0) return;

   if(!HistoryDealSelect(dealTicket)) return;

   // Só deals de SAÍDA (fecham posição) ou IN/OUT (reversão) viram trade no journal
   long entry = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT) return;

   EnviarTradePorDealDeSaida(dealTicket);
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

   // Busca o deal de ENTRADA da mesma posição → preço de entrada + direção
   double entryPrice = 0.0;
   datetime entryTime = exitTime;
   string direction = "LONG";
   if(HistorySelectByPosition(positionId))
   {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
      {
         ulong d = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN)
         {
            entryPrice = HistoryDealGetDouble(d, DEAL_PRICE);
            entryTime  = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
            // Posição comprada = deal de entrada do tipo BUY
            long dt = HistoryDealGetInteger(d, DEAL_TYPE);
            direction = (dt == DEAL_TYPE_BUY) ? "LONG" : "SHORT";
            break;
         }
      }
   }
   if(entryPrice <= 0.0) entryPrice = exitPrice; // fallback defensivo

   // Variação em pontos do símbolo (sinal conforme direção)
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0.0) point = 0.00001;
   double dirSign = (direction == "LONG") ? 1.0 : -1.0;
   double pnlPoints = ((exitPrice - entryPrice) * dirSign) / point;

   string accountType = (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO) ? "DEMO" : "REAL";

   // Monta o corpo form-encoded
   string body = StringFormat(
      "symbol=%s&direction=%s&entryPrice=%s&exitPrice=%s&volume=%s&pnl=%s&pnlPoints=%s&commission=%s&swap=%s&entryTime=%s&exitTime=%s&accountType=%s&externalId=MT5_%I64u",
      symbol,
      direction,
      DoubleToString(entryPrice, _Digits),
      DoubleToString(exitPrice, _Digits),
      DoubleToString(volume, 2),
      DoubleToString(profit, 2),
      DoubleToString(pnlPoints, 1),
      DoubleToString(commission, 2),
      DoubleToString(swap, 2),
      TimeToIso(entryTime),
      TimeToIso(exitTime),
      accountType,
      positionId
   );

   PostComRetry(body, symbol, profit);
}

//+------------------------------------------------------------------+
//| POST com retry (WebRequest é síncrono)                           |
//+------------------------------------------------------------------+
void PostComRetry(string body, string symbol, double profit)
{
   char   post[];
   char   resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/x-www-form-urlencoded\r\nx-api-key: " + ApiKey + "\r\n";

   StringToCharArray(body, post, 0, StringLen(body));
   // remove o '\0' final que StringToCharArray adiciona
   int len = ArraySize(post);
   if(len > 0 && post[len-1] == 0) ArrayResize(post, len-1);

   for(int tentativa = 1; tentativa <= MaxTentativas; tentativa++)
   {
      ResetLastError();
      int status = WebRequest("POST", g_endpoint, headers, 15000, post, resultData, resultHeaders);

      if(status == 201 || status == 200)
      {
         Print(StringFormat("[TraderOS] ✅ %s PnL=%.2f enviado (HTTP %d)", symbol, profit, status));
         return;
      }
      if(status == -1)
      {
         int err = GetLastError();
         if(err == 4060 || err == 4014) // URL não permitida
         {
            Print("[TraderOS] ❌ URL não autorizada. Tools > Options > Expert Advisors > Allow WebRequest e adicione: ", ServerUrl);
            return; // não adianta retry
         }
         Print(StringFormat("[TraderOS] ⚠️ falha de rede (err %d), tentativa %d/%d", err, tentativa, MaxTentativas));
      }
      else if(status >= 400 && status < 500 && status != 429)
      {
         // Erro do cliente (key inválida, payload ruim) — não retenta
         Print(StringFormat("[TraderOS] ❌ rejeitado (HTTP %d): %s", status, CharArrayToString(resultData)));
         return;
      }
      else
      {
         Print(StringFormat("[TraderOS] ⚠️ HTTP %d, tentativa %d/%d", status, tentativa, MaxTentativas));
      }

      Sleep(1000 * tentativa); // backoff
   }
   Print("[TraderOS] ❌ desistiu após ", MaxTentativas, " tentativas: ", symbol);
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
      ulong d = HistoryDealGetTicket(i);
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT)
         EnviarTradePorDealDeSaida(d);
   }
}

//+------------------------------------------------------------------+
//| Converte datetime para ISO 8601 UTC (ex: 2026-06-18T14:05:00Z)   |
//+------------------------------------------------------------------+
string TimeToIso(datetime t)
{
   MqlDateTime st;
   TimeToStruct(t, st);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       st.year, st.mon, st.day, st.hour, st.min, st.sec);
}
//+------------------------------------------------------------------+
