#property copyright "AlgoVault Trading Platform"
#property link      "https://algovault.com"
#property version   "1.3.0"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>
#include <Trade\AccountInfo.mqh>

//+------------------------------------------------------------------+
//| Inputs                                                           |
//+------------------------------------------------------------------+

input string GatewayToken         = "";
input string PlatformURL          = "https://algovault.com";

input int    HeartbeatInterval    = 15;
input int    SnapshotInterval     = 30;
input int    CommandPollInterval  = 5;

input int    MagicNumber          = 999888;

// When enabled, positions/orders from EVERY magic number (and market
// comments) are reported so Custom / Legacy EAs linked through the
// AlgoVault bot registry can also be monitored. When DISABLED (default) the
// EA keeps reporting only its own MagicNumber — existing behaviour is
// unchanged. Magic + comment are always sent so the server can attribute
// activity to the right bot.
input bool   ReportAllMagic       = false;

input bool   DebugMode            = false;


//+------------------------------------------------------------------+
//| Global objects                                                   |
//+------------------------------------------------------------------+

CTrade        trade;
CPositionInfo posInfo;
COrderInfo    ordInfo;
CAccountInfo  accInfo;


//+------------------------------------------------------------------+
//| Runtime configuration                                            |
//+------------------------------------------------------------------+

string RuntimeGatewayToken = "";
string RuntimePlatformURL  = "";


//+------------------------------------------------------------------+
//| Runtime state                                                    |
//+------------------------------------------------------------------+

datetime lastHeartbeat   = 0;
datetime lastSnapshot    = 0;
datetime lastCommandPoll = 0;
datetime lastConnectTime = 0;

bool isRegistered = false;
bool isConnected  = false;

int consecutiveFails = 0;
int pendingCommands  = 0;


//+------------------------------------------------------------------+
//| Chart UI                                                         |
//+------------------------------------------------------------------+

const string UI_BACKGROUND = "AV_Background";
const string UI_TITLE      = "AV_Title";
const string UI_STATUS     = "AV_Status";
const string UI_ACCOUNT    = "AV_Account";
const string UI_BALANCE    = "AV_Balance";
const string UI_EQUITY     = "AV_Equity";
const string UI_POSITIONS  = "AV_Positions";
const string UI_ORDERS     = "AV_Orders";
const string UI_LAST_SYNC  = "AV_LastSync";
const string UI_COMMANDS   = "AV_Commands";
const string UI_SERVER     = "AV_Server";

const int LABEL_X      = 10;
const int LABEL_Y_STEP = 20;

int labelY = 30;


//+------------------------------------------------------------------+
//| Forward declarations                                             |
//+------------------------------------------------------------------+

void   UpdateChartDisplay();
void   CreateChartDisplay();
void   DeleteChartDisplay();

bool   RegisterGateway();
bool   SendHeartbeat();
bool   SendSnapshot();
bool   PollCommands();
bool   ReportExecution(string commandId,
                       string action,
                       MqlTradeResult &result,
                       bool success,
                       string errorMessage = "");

bool   SendDisconnectNotification();

bool   SendHTTPRequest(string method,
                       string url,
                       string body,
                       string &response,
                       int &httpCode,
                       string &responseHeaders);

bool   ExecuteCommand(string commandJson);

bool   ExecuteMarketBuy(string symbol,
                        double volume,
                        double sl,
                        double tp,
                        MqlTradeResult &result);

bool   ExecuteMarketSell(string symbol,
                         double volume,
                         double sl,
                         double tp,
                         MqlTradeResult &result);

bool   ExecuteBuyLimit(string symbol,
                       double volume,
                       double price,
                       double sl,
                       double tp,
                       MqlTradeResult &result);

bool   ExecuteSellLimit(string symbol,
                        double volume,
                        double price,
                        double sl,
                        double tp,
                        MqlTradeResult &result);

bool   ExecuteBuyStop(string symbol,
                      double volume,
                      double price,
                      double sl,
                      double tp,
                      MqlTradeResult &result);

bool   ExecuteSellStop(string symbol,
                       double volume,
                       double price,
                       double sl,
                       double tp,
                       MqlTradeResult &result);

bool   ExecuteModifyPosition(ulong ticket,
                             double sl,
                             double tp,
                             MqlTradeResult &result);

bool   ExecuteClosePosition(ulong ticket,
                            double volume,
                            MqlTradeResult &result);

bool   ExecuteCancelOrder(ulong ticket,
                          MqlTradeResult &result);

ulong  FindPositionTicket(string symbol);
ulong  FindOrderTicket(string symbol);

string BuildAccountJson();
string BuildPositionsJson();
string BuildOrdersJson();

string JsonEscape(string value);
string JsonGetString(string json, string key, string defaultValue = "");
double JsonGetDouble(string json, string key, double defaultValue = 0.0);
long   JsonGetLong(string json, string key, long defaultValue = 0);
bool   JsonGetBool(string json, string key, bool defaultValue = false);

int    JsonArrayCount(string json);
string JsonArrayGet(string json, int index);

string TrimString(string value);
string NormalizeBaseURL(string value);

void   CopyTradeResult(MqlTradeResult &result);

bool   IsTradeSuccess(MqlTradeResult &result);

string RetcodeToString(uint retcode);

void   DebugPrint(string message);

int    CountManagedPositions();
int    CountManagedOrders();


//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+

int OnInit()
{
   Print("==========================================");
   Print("AlgoVault Trade Gateway v1.2.0");
   Print("Initializing...");
   Print("==========================================");

   // Runtime copies.
   // IMPORTANT:
   // MQL5 input variables are constants and cannot be modified.
   RuntimeGatewayToken = TrimString(GatewayToken);
   RuntimePlatformURL  = NormalizeBaseURL(PlatformURL);

   // Validate configuration.
   if(StringLen(RuntimeGatewayToken) == 0)
   {
      Print("ERROR: GatewayToken is empty.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(StringLen(RuntimePlatformURL) == 0)
   {
      Print("ERROR: PlatformURL is empty.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(HeartbeatInterval < 1)
   {
      Print("ERROR: HeartbeatInterval must be >= 1.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(SnapshotInterval < 1)
   {
      Print("ERROR: SnapshotInterval must be >= 1.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(CommandPollInterval < 1)
   {
      Print("ERROR: CommandPollInterval must be >= 1.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   // Configure trade object.
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(50);
   trade.SetAsyncMode(false);

   // Create chart UI.
   CreateChartDisplay();

   // Register terminal.
   if(!RegisterGateway())
   {
      Print("WARNING: Gateway registration failed.");
      Print("The EA will continue running and retry through heartbeat.");
   }

   // Start 1-second timer.
   EventSetTimer(1);

   lastHeartbeat   = 0;
   lastSnapshot    = 0;
   lastCommandPoll = 0;

   UpdateChartDisplay();

   Print("AlgoVault Gateway initialized.");
   Print("Platform: ", RuntimePlatformURL);
   Print("Account: ", IntegerToString((long)accInfo.Login()));
   Print("Server: ", AccountInfoString(ACCOUNT_SERVER));

   return(INIT_SUCCEEDED);
}


//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+

void OnDeinit(const int reason)
{
   Print("AlgoVault Gateway shutting down. Reason: ", reason);

   EventKillTimer();

   if(isRegistered)
   {
      SendDisconnectNotification();
   }

   DeleteChartDisplay();
}


//+------------------------------------------------------------------+
//| Timer                                                            |
//+------------------------------------------------------------------+

void OnTimer()
{
   datetime now = TimeCurrent();

   // Registration retry.
   if(!isRegistered)
   {
      RegisterGateway();
   }

   // Heartbeat.
   if(lastHeartbeat == 0 ||
      (now - lastHeartbeat) >= HeartbeatInterval)
   {
      SendHeartbeat();
   }

   // Snapshot.
   if(lastSnapshot == 0 ||
      (now - lastSnapshot) >= SnapshotInterval)
   {
      SendSnapshot();
   }

   // Commands.
   if(lastCommandPoll == 0 ||
      (now - lastCommandPoll) >= CommandPollInterval)
   {
      PollCommands();
   }

   UpdateChartDisplay();
}


//+------------------------------------------------------------------+
//| Tick                                                             |
//+------------------------------------------------------------------+

void OnTick()
{
   // Gateway is timer-driven.
   // No trading strategy is executed here.
}


//+------------------------------------------------------------------+
//| String trimming                                                  |
//+------------------------------------------------------------------+

string TrimString(string value)
{
   StringTrimLeft(value);
   StringTrimRight(value);

   return value;
}


//+------------------------------------------------------------------+
//| Normalize URL                                                    |
//+------------------------------------------------------------------+

string NormalizeBaseURL(string value)
{
   string result = TrimString(value);

   while(StringLen(result) > 0)
   {
      int lastIndex = StringLen(result) - 1;

      if(StringGetCharacter(result, lastIndex) != '/')
         break;

      result = StringSubstr(result, 0, lastIndex);
   }

   return result;
}


//+------------------------------------------------------------------+
//| Debug helper                                                     |
//+------------------------------------------------------------------+

void DebugPrint(string message)
{
   if(DebugMode)
      Print("[AlgoVault DEBUG] ", message);
}


//+------------------------------------------------------------------+
//| JSON escape                                                      |
//+------------------------------------------------------------------+

string JsonEscape(string value)
{
   string output = value;

   StringReplace(output, "\\", "\\\\");
   StringReplace(output, "\"", "\\\"");
   StringReplace(output, "\n", "\\n");
   StringReplace(output, "\r", "\\r");
   StringReplace(output, "\t", "\\t");

   return output;
}


//+------------------------------------------------------------------+
//| JSON string getter                                               |
//+------------------------------------------------------------------+

string JsonGetString(string json,
                     string key,
                     string defaultValue = "")
{
   string search = "\"" + key + "\"";

   int keyPos = StringFind(json, search);

   if(keyPos < 0)
      return defaultValue;

   int colonPos = StringFind(json, ":", keyPos + StringLen(search));

   if(colonPos < 0)
      return defaultValue;

   int pos = colonPos + 1;
   int length = StringLen(json);

   while(pos < length)
   {
      ushort ch = StringGetCharacter(json, pos);

      if(ch == ' ' ||
         ch == '\t' ||
         ch == '\r' ||
         ch == '\n')
      {
         pos++;
         continue;
      }

      break;
   }

   if(pos >= length)
      return defaultValue;

   if(StringGetCharacter(json, pos) != '"')
      return defaultValue;

   pos++;

   string output = "";

   while(pos < length)
   {
      ushort ch = StringGetCharacter(json, pos);

      if(ch == '\\' && pos + 1 < length)
      {
         ushort next = StringGetCharacter(json, pos + 1);

         switch(next)
         {
            case '"':
               output += "\"";
               break;

            case '\\':
               output += "\\";
               break;

            case 'n':
               output += "\n";
               break;

            case 'r':
               output += "\r";
               break;

            case 't':
               output += "\t";
               break;

            default:
               output += StringSubstr(json, pos + 1, 1);
               break;
         }

         pos += 2;
         continue;
      }

      if(ch == '"')
         break;

      output += StringSubstr(json, pos, 1);
      pos++;
   }

   return output;
}


//+------------------------------------------------------------------+
//| JSON double getter                                               |
//+------------------------------------------------------------------+

double JsonGetDouble(string json,
                     string key,
                     double defaultValue = 0.0)
{
   string search = "\"" + key + "\"";

   int keyPos = StringFind(json, search);

   if(keyPos < 0)
      return defaultValue;

   int colonPos = StringFind(json, ":", keyPos + StringLen(search));

   if(colonPos < 0)
      return defaultValue;

   int pos = colonPos + 1;
   int length = StringLen(json);

   while(pos < length)
   {
      ushort ch = StringGetCharacter(json, pos);

      if(ch == ' ' ||
         ch == '\t' ||
         ch == '\r' ||
         ch == '\n')
      {
         pos++;
         continue;
      }

      break;
   }

   int end = pos;

   while(end < length)
   {
      ushort ch = StringGetCharacter(json, end);

      if(ch == ',' ||
         ch == '}' ||
         ch == ']' ||
         ch == ' ' ||
         ch == '\r' ||
         ch == '\n' ||
         ch == '\t')
      {
         break;
      }

      end++;
   }

   string value = StringSubstr(json, pos, end - pos);

   value = TrimString(value);

   if(value == "" ||
      value == "null")
   {
      return defaultValue;
   }

   return StringToDouble(value);
}


//+------------------------------------------------------------------+
//| JSON long getter                                                 |
//+------------------------------------------------------------------+

long JsonGetLong(string json,
                 string key,
                 long defaultValue = 0)
{
   double value = JsonGetDouble(json, key, (double)defaultValue);

   return (long)value;
}


//+------------------------------------------------------------------+
//| JSON bool getter                                                 |
//+------------------------------------------------------------------+

bool JsonGetBool(string json,
                 string key,
                 bool defaultValue = false)
{
   string search = "\"" + key + "\"";

   int keyPos = StringFind(json, search);

   if(keyPos < 0)
      return defaultValue;

   int colonPos = StringFind(json, ":", keyPos + StringLen(search));

   if(colonPos < 0)
      return defaultValue;

   int pos = colonPos + 1;
   int length = StringLen(json);

   while(pos < length)
   {
      ushort ch = StringGetCharacter(json, pos);

      if(ch == ' ' ||
         ch == '\t' ||
         ch == '\r' ||
         ch == '\n')
      {
         pos++;
         continue;
      }

      break;
   }

   if(pos + 4 <= length)
   {
      string trueValue = StringSubstr(json, pos, 4);

      if(trueValue == "true")
         return true;
   }

   if(pos + 5 <= length)
   {
      string falseValue = StringSubstr(json, pos, 5);

      if(falseValue == "false")
         return false;
   }

   return defaultValue;
}


//+------------------------------------------------------------------+
//| JSON array count                                                 |
//+------------------------------------------------------------------+

int JsonArrayCount(string json)
{
   int start = StringFind(json, "[");

   if(start < 0)
      return 0;

   int length = StringLen(json);

   int depth = 0;
   int count = 0;

   bool inString = false;
   bool escaped  = false;

   for(int i = start; i < length; i++)
   {
      ushort ch = StringGetCharacter(json, i);

      if(inString)
      {
         if(escaped)
         {
            escaped = false;
            continue;
         }

         if(ch == '\\')
         {
            escaped = true;
            continue;
         }

         if(ch == '"')
            inString = false;

         continue;
      }

      if(ch == '"')
      {
         inString = true;
         continue;
      }

      if(ch == '[')
      {
         depth++;
         continue;
      }

      if(ch == ']')
      {
         depth--;

         if(depth == 0)
            break;

         continue;
      }

      // Count objects directly inside the array.
      if(depth == 1 && ch == '{')
         count++;
   }

   return count;
}


//+------------------------------------------------------------------+
//| Get JSON array object                                            |
//+------------------------------------------------------------------+

string JsonArrayGet(string json, int index)
{
   int start = StringFind(json, "[");

   if(start < 0)
      return "";

   int length = StringLen(json);

   int depth = 0;
   int currentIndex = -1;
   int objectStart = -1;

   bool inString = false;
   bool escaped  = false;

   for(int i = start; i < length; i++)
   {
      ushort ch = StringGetCharacter(json, i);

      if(inString)
      {
         if(escaped)
         {
            escaped = false;
            continue;
         }

         if(ch == '\\')
         {
            escaped = true;
            continue;
         }

         if(ch == '"')
            inString = false;

         continue;
      }

      if(ch == '"')
      {
         inString = true;
         continue;
      }

      if(ch == '[')
      {
         depth++;
         continue;
      }

      if(ch == ']')
      {
         if(objectStart >= 0 && currentIndex == index)
         {
            return StringSubstr(json,
                                objectStart,
                                i - objectStart);
         }

         depth--;
         break;
      }

      if(depth == 1 && ch == '{')
      {
         currentIndex++;

         if(currentIndex == index)
         {
            objectStart = i;
         }

         continue;
      }

      if(depth == 1 && ch == '}' && objectStart >= 0)
      {
         if(currentIndex == index)
         {
            return StringSubstr(json,
                                objectStart,
                                i - objectStart + 1);
         }

         objectStart = -1;
      }
   }

   return "";
}


//+------------------------------------------------------------------+
//| HTTP request                                                     |
//+------------------------------------------------------------------+

bool SendHTTPRequest(string method,
                     string url,
                     string body,
                     string &response,
                     int &httpCode,
                     string &responseHeaders)
{
   response = "";
   responseHeaders = "";
   httpCode = -1;

   string headers =
      "Content-Type: application/json\r\n" +
      "Accept: application/json\r\n" +
      "Authorization: Bearer " + RuntimeGatewayToken + "\r\n" +
      "User-Agent: AlgoVaultGateway/1.2\r\n";

   char data[];
   char result[];

   ArrayResize(data, 0);

   if(body != "")
   {
      int copied =
         StringToCharArray(body,
                           data,
                           0,
                           WHOLE_ARRAY,
                           CP_UTF8);

      // Remove terminating null byte.
      if(copied > 0)
         ArrayResize(data, copied - 1);
   }

   ResetLastError();

   int timeout = 5000;

   int resultSize =
      WebRequest(method,
                 url,
                 headers,
                 timeout,
                 data,
                 result,
                 responseHeaders);

   if(resultSize == -1)
   {
      int errorCode = GetLastError();

      Print("WebRequest failed.");
      Print("Method: ", method);
      Print("URL: ", url);
      Print("Error: ", errorCode);

      consecutiveFails++;

      isConnected = false;

      return false;
   }

   httpCode = resultSize;

   if(ArraySize(result) > 0)
   {
      response =
         CharArrayToString(result,
                           0,
                           ArraySize(result),
                           CP_UTF8);
   }
   else
   {
      response = "";
   }

   if(httpCode >= 200 && httpCode < 300)
   {
      consecutiveFails = 0;
      isConnected = true;

      return true;
   }

   Print("HTTP error: ", httpCode);
   Print("URL: ", url);
   Print("Response: ", response);

   consecutiveFails++;

   if(consecutiveFails >= 3)
      isConnected = false;

   return false;
}


//+------------------------------------------------------------------+
//| Register gateway                                                 |
//+------------------------------------------------------------------+

bool RegisterGateway()
{
   string url =
      RuntimePlatformURL +
      "/api/trading/gateway/register";

   string accountNumber =
      IntegerToString((long)accInfo.Login());

   string accountName =
      AccountInfoString(ACCOUNT_NAME);

   string server =
      AccountInfoString(ACCOUNT_SERVER);

   string company =
      AccountInfoString(ACCOUNT_COMPANY);

   string currency =
      AccountInfoString(ACCOUNT_CURRENCY);

   string payload =
      "{" +
      "\"accountNumber\":\"" +
      JsonEscape(accountNumber) +
      "\"," +

      "\"accountName\":\"" +
      JsonEscape(accountName) +
      "\"," +

      "\"server\":\"" +
      JsonEscape(server) +
      "\"," +

      "\"company\":\"" +
      JsonEscape(company) +
      "\"," +

      "\"currency\":\"" +
      JsonEscape(currency) +
      "\"," +

      "\"platform\":\"MT5\"," +

      "\"terminalBuild\":" +
      IntegerToString(TerminalInfoInteger(TERMINAL_BUILD)) +
      "," +

      "\"magicNumber\":" +
      IntegerToString(MagicNumber) +
      "," +

      "\"eaVersion\":\"1.3.0\"" +

      "}";

   string response;
   string responseHeaders;
   int httpCode = -1;

   DebugPrint("Registering gateway...");

   bool success =
      SendHTTPRequest("POST",
                      url,
                      payload,
                      response,
                      httpCode,
                      responseHeaders);

   if(success)
   {
      isRegistered = true;
      isConnected  = true;
      lastConnectTime = TimeCurrent();

      Print("AlgoVault gateway registered successfully.");
      Print("Account: ", accountNumber);

      return true;
   }

   Print("Gateway registration failed. HTTP: ",
         httpCode);

   return false;
}


//+------------------------------------------------------------------+
//| Heartbeat                                                        |
//+------------------------------------------------------------------+

bool SendHeartbeat()
{
   lastHeartbeat = TimeCurrent();

   if(!isRegistered)
      return false;

   string url =
      RuntimePlatformURL +
      "/api/trading/gateway/heartbeat";

   string accountNumber =
      IntegerToString((long)accInfo.Login());

   string payload =
      "{" +
      "\"accountNumber\":\"" +
      JsonEscape(accountNumber) +
      "\"," +

      "\"timestamp\":" +
      IntegerToString((long)TimeCurrent()) +
      "," +

      "\"balance\":" +
      DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) +
      "," +

      "\"equity\":" +
      DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) +
      "," +

      "\"margin\":" +
      DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2) +
      "," +

      "\"freeMargin\":" +
      DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) +
      "," +

      "\"positions\":" +
      IntegerToString(CountManagedPositions()) +
      "," +

      "\"orders\":" +
      IntegerToString(CountManagedOrders()) +

      "}";

   string response;
   string responseHeaders;
   int httpCode = -1;

   bool success =
      SendHTTPRequest("POST",
                      url,
                      payload,
                      response,
                      httpCode,
                      responseHeaders);

   if(!success)
   {
      DebugPrint("Heartbeat failed.");
   }

   return success;
}


//+------------------------------------------------------------------+
//| Build account JSON                                               |
//+------------------------------------------------------------------+

string BuildAccountJson()
{
   string accountNumber =
      IntegerToString((long)accInfo.Login());

   string json =
      "{" +

      "\"accountNumber\":\"" +
      JsonEscape(accountNumber) +
      "\"," +

      "\"balance\":" +
      DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) +
      "," +

      "\"equity\":" +
      DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) +
      "," +

      "\"margin\":" +
      DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2) +
      "," +

      "\"freeMargin\":" +
      DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) +
      "," +

      "\"profit\":" +
      DoubleToString(AccountInfoDouble(ACCOUNT_PROFIT), 2) +
      "," +

      "\"currency\":\"" +
      JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)) +
      "\"," +

      "\"leverage\":" +
      IntegerToString((long)AccountInfoInteger(ACCOUNT_LEVERAGE)) +

      "}";

   return json;
}


//+------------------------------------------------------------------+
//| Build positions JSON                                             |
//+------------------------------------------------------------------+

string BuildPositionsJson()
{
   string json = "[";

   bool first = true;

   int total = PositionsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket =
         PositionGetTicket(i);

      if(ticket == 0)
         continue;

      if(!PositionSelectByTicket(ticket))
         continue;

      long magic =
         PositionGetInteger(POSITION_MAGIC);

      if(!ReportAllMagic && magic != MagicNumber)
         continue;

      string symbol =
         PositionGetString(POSITION_SYMBOL);

      string comment =
         PositionGetString(POSITION_COMMENT);

      long type =
         PositionGetInteger(POSITION_TYPE);

      double volume =
         PositionGetDouble(POSITION_VOLUME);

      double openPrice =
         PositionGetDouble(POSITION_PRICE_OPEN);

      double sl =
         PositionGetDouble(POSITION_SL);

      double tp =
         PositionGetDouble(POSITION_TP);

      double profit =
         PositionGetDouble(POSITION_PROFIT);

      double swap =
         PositionGetDouble(POSITION_SWAP);

      long time =
         PositionGetInteger(POSITION_TIME);

      string typeString = "UNKNOWN";

      if(type == POSITION_TYPE_BUY)
         typeString = "BUY";
      else if(type == POSITION_TYPE_SELL)
         typeString = "SELL";

      if(!first)
         json += ",";

      first = false;

      json +=
         "{" +

         "\"ticket\":" +
         IntegerToString((long)ticket) +
         "," +

         "\"symbol\":\"" +
         JsonEscape(symbol) +
         "\"," +

         "\"type\":\"" +
         typeString +
         "\"," +

         "\"volume\":" +
         DoubleToString(volume, 8) +
         "," +

         "\"openPrice\":" +
         DoubleToString(openPrice, 10) +
         "," +

         "\"sl\":" +
         DoubleToString(sl, 10) +
         "," +

         "\"tp\":" +
         DoubleToString(tp, 10) +
         "," +

         "\"profit\":" +
         DoubleToString(profit, 2) +
         "," +

         "\"swap\":" +
         DoubleToString(swap, 2) +
         "," +

         "\"time\":" +
         IntegerToString(time) +
         "," +

         "\"magic\":" +
         IntegerToString((long)magic) +
         "," +

         "\"comment\":\"" +
         JsonEscape(comment) +
         "\"" +

         "}";
   }

   json += "]";

   return json;
}


//+------------------------------------------------------------------+
//| Build orders JSON                                                |
//+------------------------------------------------------------------+

string BuildOrdersJson()
{
   string json = "[";

   bool first = true;

   int total = OrdersTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket =
         OrderGetTicket(i);

      if(ticket == 0)
         continue;

      if(!OrderSelect(ticket))
         continue;

      long magic =
         OrderGetInteger(ORDER_MAGIC);

      if(!ReportAllMagic && magic != MagicNumber)
         continue;

      string symbol =
         OrderGetString(ORDER_SYMBOL);

      string comment =
         OrderGetString(ORDER_COMMENT);

      long type =
         OrderGetInteger(ORDER_TYPE);

      double volume =
         OrderGetDouble(ORDER_VOLUME_CURRENT);

      double price =
         OrderGetDouble(ORDER_PRICE_OPEN);

      double sl =
         OrderGetDouble(ORDER_SL);

      double tp =
         OrderGetDouble(ORDER_TP);

      double stopLimit =
         OrderGetDouble(ORDER_PRICE_STOPLIMIT);

      long time =
         OrderGetInteger(ORDER_TIME_SETUP);

      string typeString = "UNKNOWN";

      switch(type)
      {
         case ORDER_TYPE_BUY_LIMIT:
            typeString = "BUY_LIMIT";
            break;

         case ORDER_TYPE_SELL_LIMIT:
            typeString = "SELL_LIMIT";
            break;

         case ORDER_TYPE_BUY_STOP:
            typeString = "BUY_STOP";
            break;

         case ORDER_TYPE_SELL_STOP:
            typeString = "SELL_STOP";
            break;

         case ORDER_TYPE_BUY_STOP_LIMIT:
            typeString = "BUY_STOP_LIMIT";
            break;

         case ORDER_TYPE_SELL_STOP_LIMIT:
            typeString = "SELL_STOP_LIMIT";
            break;
      }

      if(!first)
         json += ",";

      first = false;

      json +=
         "{" +

         "\"ticket\":" +
         IntegerToString((long)ticket) +
         "," +

         "\"symbol\":\"" +
         JsonEscape(symbol) +
         "\"," +

         "\"type\":\"" +
         typeString +
         "\"," +

         "\"volume\":" +
         DoubleToString(volume, 8) +
         "," +

         "\"price\":" +
         DoubleToString(price, 10) +
         "," +

         "\"sl\":" +
         DoubleToString(sl, 10) +
         "," +

         "\"tp\":" +
         DoubleToString(tp, 10) +
         "," +

         "\"stopLimit\":" +
         DoubleToString(stopLimit, 10) +
         "," +

         "\"time\":" +
         IntegerToString(time) +
         "," +

         "\"magic\":" +
         IntegerToString((long)magic) +
         "," +

         "\"comment\":\"" +
         JsonEscape(comment) +
         "\"" +

         "}";
   }

   json += "]";

   return json;
}


//+------------------------------------------------------------------+
//| Send snapshot                                                    |
//+------------------------------------------------------------------+

bool SendSnapshot()
{
   lastSnapshot = TimeCurrent();

   if(!isRegistered)
      return false;

   string url =
      RuntimePlatformURL +
      "/api/trading/gateway/snapshot";

   string accountNumber =
      IntegerToString((long)accInfo.Login());

   string payload =
      "{" +

      "\"accountNumber\":\"" +
      JsonEscape(accountNumber) +
      "\"," +

      "\"timestamp\":" +
      IntegerToString((long)TimeCurrent()) +
      "," +

      "\"account\":" +
      BuildAccountJson() +
      "," +

      "\"positions\":" +
      BuildPositionsJson() +
      "," +

      "\"orders\":" +
      BuildOrdersJson() +

      "}";

   string response;
   string responseHeaders;
   int httpCode = -1;

   bool success =
      SendHTTPRequest("POST",
                      url,
                      payload,
                      response,
                      httpCode,
                      responseHeaders);

   if(!success)
      DebugPrint("Snapshot failed.");

   return success;
}


//+------------------------------------------------------------------+
//| Poll commands                                                    |
//+------------------------------------------------------------------+

bool PollCommands()
{
   lastCommandPoll = TimeCurrent();

   if(!isRegistered)
      return false;

   string url =
      RuntimePlatformURL +
      "/api/trading/gateway/commands" +
      "?accountNumber=" +
      IntegerToString((long)accInfo.Login());

   string response;
   string responseHeaders;
   int httpCode = -1;

   bool success =
      SendHTTPRequest("GET",
                      url,
                      "",
                      response,
                      httpCode,
                      responseHeaders);

   if(!success)
      return false;

   int count = JsonArrayCount(response);

   pendingCommands = count;

   if(count <= 0)
      return true;

   DebugPrint("Commands received: " +
              IntegerToString(count));

   for(int i = 0; i < count; i++)
   {
      string command =
         JsonArrayGet(response, i);

      if(command == "")
         continue;

      ExecuteCommand(command);
   }

   return true;
}


//+------------------------------------------------------------------+
//| Execute command                                                  |
//+------------------------------------------------------------------+

bool ExecuteCommand(string commandJson)
{
   string commandId =
      JsonGetString(commandJson,
                    "id",
                    "");

   if(commandId == "")
   {
      commandId =
         JsonGetString(commandJson,
                       "commandId",
                       "");
   }

   string action =
      JsonGetString(commandJson,
                    "action",
                    "");

   if(action == "")
   {
      action =
         JsonGetString(commandJson,
                       "type",
                       "");
   }

   action = TrimString(action);

   string symbol =
      JsonGetString(commandJson,
                    "symbol",
                    "");

   double volume =
      JsonGetDouble(commandJson,
                    "volume",
                    0.0);

   double price =
      JsonGetDouble(commandJson,
                    "price",
                    0.0);

   double sl =
      JsonGetDouble(commandJson,
                    "sl",
                    0.0);

   double tp =
      JsonGetDouble(commandJson,
                    "tp",
                    0.0);

   long ticketLong =
      JsonGetLong(commandJson,
                  "ticket",
                  0);

   if(ticketLong == 0)
   {
      ticketLong =
         JsonGetLong(commandJson,
                     "positionTicket",
                     0);
   }

   ulong ticket =
      (ulong)ticketLong;

   DebugPrint("Command: " + action +
              " | Symbol: " + symbol +
              " | Volume: " +
              DoubleToString(volume, 4) +
              " | Ticket: " +
              IntegerToString((long)ticket));

   MqlTradeResult result;
   ZeroMemory(result);

   bool success = false;
   string errorMessage = "";

   // ---------------------------------------------------------------
   // BUY
   // ---------------------------------------------------------------

   if(action == "BUY" ||
      action == "buy" ||
      action == "MARKET_BUY" ||
      action == "market_buy")
   {
      if(symbol == "")
         errorMessage = "Missing symbol";
      else if(volume <= 0)
         errorMessage = "Invalid volume";
      else
         success =
            ExecuteMarketBuy(symbol,
                             volume,
                             sl,
                             tp,
                             result);
   }

   // ---------------------------------------------------------------
   // SELL
   // ---------------------------------------------------------------

   else if(action == "SELL" ||
           action == "sell" ||
           action == "MARKET_SELL" ||
           action == "market_sell")
   {
      if(symbol == "")
         errorMessage = "Missing symbol";
      else if(volume <= 0)
         errorMessage = "Invalid volume";
      else
         success =
            ExecuteMarketSell(symbol,
                              volume,
                              sl,
                              tp,
                              result);
   }

   // ---------------------------------------------------------------
   // BUY LIMIT
   // ---------------------------------------------------------------

   else if(action == "BUY_LIMIT" ||
           action == "buy_limit")
   {
      if(symbol == "")
         errorMessage = "Missing symbol";
      else if(volume <= 0)
         errorMessage = "Invalid volume";
      else if(price <= 0)
         errorMessage = "Invalid price";
      else
         success =
            ExecuteBuyLimit(symbol,
                            volume,
                            price,
                            sl,
                            tp,
                            result);
   }

   // ---------------------------------------------------------------
   // SELL LIMIT
   // ---------------------------------------------------------------

   else if(action == "SELL_LIMIT" ||
           action == "sell_limit")
   {
      if(symbol == "")
         errorMessage = "Missing symbol";
      else if(volume <= 0)
         errorMessage = "Invalid volume";
      else if(price <= 0)
         errorMessage = "Invalid price";
      else
         success =
            ExecuteSellLimit(symbol,
                             volume,
                             price,
                             sl,
                             tp,
                             result);
   }

   // ---------------------------------------------------------------
   // BUY STOP
   // ---------------------------------------------------------------

   else if(action == "BUY_STOP" ||
           action == "buy_stop")
   {
      if(symbol == "")
         errorMessage = "Missing symbol";
      else if(volume <= 0)
         errorMessage = "Invalid volume";
      else if(price <= 0)
         errorMessage = "Invalid price";
      else
         success =
            ExecuteBuyStop(symbol,
                           volume,
                           price,
                           sl,
                           tp,
                           result);
   }

   // ---------------------------------------------------------------
   // SELL STOP
   // ---------------------------------------------------------------

   else if(action == "SELL_STOP" ||
           action == "sell_stop")
   {
      if(symbol == "")
         errorMessage = "Missing symbol";
      else if(volume <= 0)
         errorMessage = "Invalid volume";
      else if(price <= 0)
         errorMessage = "Invalid price";
      else
         success =
            ExecuteSellStop(symbol,
                            volume,
                            price,
                            sl,
                            tp,
                            result);
   }

   // ---------------------------------------------------------------
   // MODIFY
   // ---------------------------------------------------------------

   else if(action == "MODIFY" ||
           action == "modify" ||
           action == "MODIFY_POSITION" ||
           action == "modify_position")
   {
      if(ticket == 0 && symbol != "")
         ticket = FindPositionTicket(symbol);

      if(ticket == 0)
      {
         errorMessage = "Position not found";
      }
      else
      {
         success =
            ExecuteModifyPosition(ticket,
                                   sl,
                                   tp,
                                   result);
      }
   }

   // ---------------------------------------------------------------
   // CLOSE
   // ---------------------------------------------------------------

   else if(action == "CLOSE" ||
           action == "close" ||
           action == "CLOSE_POSITION" ||
           action == "close_position")
   {
      if(ticket == 0 && symbol != "")
         ticket = FindPositionTicket(symbol);

      if(ticket == 0)
      {
         errorMessage = "Position not found";
      }
      else
      {
         success =
            ExecuteClosePosition(ticket,
                                  volume,
                                  result);
      }
   }

   // ---------------------------------------------------------------
   // PARTIAL CLOSE
   // ---------------------------------------------------------------

   else if(action == "PARTIAL_CLOSE" ||
           action == "partial_close")
   {
      if(ticket == 0 && symbol != "")
         ticket = FindPositionTicket(symbol);

      if(ticket == 0)
      {
         errorMessage = "Position not found";
      }
      else if(volume <= 0)
      {
         errorMessage = "Invalid partial close volume";
      }
      else
      {
         success =
            ExecuteClosePosition(ticket,
                                  volume,
                                  result);
      }
   }

   // ---------------------------------------------------------------
   // CANCEL
   // ---------------------------------------------------------------

   else if(action == "CANCEL" ||
           action == "cancel" ||
           action == "CANCEL_ORDER" ||
           action == "cancel_order")
   {
      if(ticket == 0 && symbol != "")
         ticket = FindOrderTicket(symbol);

      if(ticket == 0)
      {
         errorMessage = "Order not found";
      }
      else
      {
         success =
            ExecuteCancelOrder(ticket,
                               result);
      }
   }

   // ---------------------------------------------------------------
   // UNKNOWN
   // ---------------------------------------------------------------

   else
   {
      errorMessage = "Unknown action: " + action;

      result.retcode =
         TRADE_RETCODE_INVALID;

      result.comment =
         errorMessage;
   }

   // If validation failed before a trade call.
   if(!success && errorMessage != "")
   {
      if(result.retcode == 0)
         result.retcode =
            TRADE_RETCODE_INVALID;

      if(result.comment == "")
         result.comment = errorMessage;
   }

   // Report execution.
   ReportExecution(commandId,
                   action,
                   result,
                   success,
                   errorMessage);

   return success;
}


//+------------------------------------------------------------------+
//| Market BUY                                                       |
//+------------------------------------------------------------------+

bool ExecuteMarketBuy(string symbol,
                      double volume,
                      double sl,
                      double tp,
                      MqlTradeResult &result)
{
   ZeroMemory(result);

   if(!SymbolSelect(symbol, true))
   {
      result.retcode = TRADE_RETCODE_INVALID;
      result.comment = "Symbol not found";
      return false;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(symbol);

   ResetLastError();

   bool sent =
      trade.Buy(volume,
                symbol,
                0.0,
                sl,
                tp,
                "AlgoVault");

   CopyTradeResult(result);

   if(!sent)
      return false;

   return IsTradeSuccess(result);
}


//+------------------------------------------------------------------+
//| Market SELL                                                      |
//+------------------------------------------------------------------+

bool ExecuteMarketSell(string symbol,
                       double volume,
                       double sl,
                       double tp,
                       MqlTradeResult &result)
{
   ZeroMemory(result);

   if(!SymbolSelect(symbol, true))
   {
      result.retcode = TRADE_RETCODE_INVALID;
      result.comment = "Symbol not found";
      return false;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(symbol);

   ResetLastError();

   bool sent =
      trade.Sell(volume,
                 symbol,
                 0.0,
                 sl,
                 tp,
                 "AlgoVault");

   CopyTradeResult(result);

   if(!sent)
      return false;

   return IsTradeSuccess(result);
}


//+------------------------------------------------------------------+
//| Buy Limit                                                        |
//+------------------------------------------------------------------+

bool ExecuteBuyLimit(string symbol,
                     double volume,
                     double price,
                     double sl,
                     double tp,
                     MqlTradeResult &result)
{
   ZeroMemory(result);

   if(!SymbolSelect(symbol, true))
   {
      result.retcode = TRADE_RETCODE_INVALID;
      result.comment = "Symbol not found";
      return false;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(symbol);

   bool sent =
      trade.BuyLimit(volume,
                     price,
                     symbol,
                     sl,
                     tp,
                     ORDER_TIME_GTC,
                     0,
                     "AlgoVault");

   CopyTradeResult(result);

   if(!sent)
      return false;

   return IsTradeSuccess(result);
}


//+------------------------------------------------------------------+
//| Sell Limit                                                       |
//+------------------------------------------------------------------+

bool ExecuteSellLimit(string symbol,
                      double volume,
                      double price,
                      double sl,
                      double tp,
                      MqlTradeResult &result)
{
   ZeroMemory(result);

   if(!SymbolSelect(symbol, true))
   {
      result.retcode = TRADE_RETCODE_INVALID;
      result.comment = "Symbol not found";
      return false;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(symbol);

   bool sent =
      trade.SellLimit(volume,
                      price,
                      symbol,
                      sl,
                      tp,
                      ORDER_TIME_GTC,
                      0,
                      "AlgoVault");

   CopyTradeResult(result);

   if(!sent)
      return false;

   return IsTradeSuccess(result);
}


//+------------------------------------------------------------------+
//| Buy Stop                                                         |
//+------------------------------------------------------------------+

bool ExecuteBuyStop(string symbol,
                    double volume,
                    double price,
                    double sl,
                    double tp,
                    MqlTradeResult &result)
{
   ZeroMemory(result);

   if(!SymbolSelect(symbol, true))
   {
     result.retcode = TRADE_RETCODE_INVALID;
      result.comment = "Symbol not found";
      return false;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(symbol);

   bool sent =
      trade.BuyStop(volume,
                    price,
                    symbol,
                    sl,
                    tp,
                    ORDER_TIME_GTC,
                    0,
                    "AlgoVault");

   CopyTradeResult(result);

   if(!sent)
      return false;

   return IsTradeSuccess(result);
}


//+------------------------------------------------------------------+
//| Sell Stop                                                        |
//+------------------------------------------------------------------+

bool ExecuteSellStop(string symbol,
                     double volume,
                     double price,
                     double sl,
                     double tp,
                     MqlTradeResult &result)
{
   ZeroMemory(result);

   if(!SymbolSelect(symbol, true))
   {
      result.retcode = TRADE_RETCODE_INVALID;
      result.comment = "Symbol not found";
      return false;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(symbol);

   bool sent =
      trade.SellStop(volume,
                     price,
                     symbol,
                     sl,
                     tp,
                     ORDER_TIME_GTC,
                     0,
                     "AlgoVault");

   CopyTradeResult(result);

   if(!sent)
      return false;

   return IsTradeSuccess(result);
}


//+------------------------------------------------------------------+
//| Modify position                                                  |
//+------------------------------------------------------------------+

bool ExecuteModifyPosition(ulong ticket,
                           double sl,
                           double tp,
                           MqlTradeResult &result)
{
   ZeroMemory(result);

   if(!PositionSelectByTicket(ticket))
   {
      result.retcode = TRADE_RETCODE_POSITION_CLOSED;
      result.comment = "Position not found";
      return false;
   }

   string symbol =
      PositionGetString(POSITION_SYMBOL);

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(symbol);

   bool modified =
      trade.PositionModify(ticket,
                           sl,
                           tp);

   CopyTradeResult(result);

   if(!modified)
      return false;

   return IsTradeSuccess(result);
}


//+------------------------------------------------------------------+
//| Close position / partial close                                   |
//+------------------------------------------------------------------+

bool ExecuteClosePosition(ulong ticket,
                          double volume,
                          MqlTradeResult &result)
{
   ZeroMemory(result);

   if(!PositionSelectByTicket(ticket))
   {
      result.retcode = TRADE_RETCODE_POSITION_CLOSED;
      result.comment = "Position not found";
      return false;
   }

   string symbol =
      PositionGetString(POSITION_SYMBOL);

   double currentVolume =
      PositionGetDouble(POSITION_VOLUME);

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(symbol);

   bool closed = false;

   // Full close.
   if(volume <= 0 ||
      volume >= currentVolume)
   {
      closed =
         trade.PositionClose(ticket);
   }
   else
   {
      // Partial close.
      closed =
         trade.PositionClosePartial(ticket,
                                    volume);
   }

   CopyTradeResult(result);

   if(!closed)
      return false;

   return IsTradeSuccess(result);
}


//+------------------------------------------------------------------+
//| Cancel pending order                                             |
//+------------------------------------------------------------------+

bool ExecuteCancelOrder(ulong ticket,
                        MqlTradeResult &result)
{
   ZeroMemory(result);

   if(!OrderSelect(ticket))
   {
      result.retcode = TRADE_RETCODE_INVALID_ORDER;
      result.comment = "Order not found";
      return false;
   }

   trade.SetExpertMagicNumber(MagicNumber);

   bool deleted =
      trade.OrderDelete(ticket);

   CopyTradeResult(result);

   if(!deleted)
      return false;

   return IsTradeSuccess(result);
}


//+------------------------------------------------------------------+
//| Copy CTrade result                                               |
//+------------------------------------------------------------------+

void CopyTradeResult(MqlTradeResult &result)
{
   ZeroMemory(result);

   result.retcode =
      trade.ResultRetcode();

   result.deal =
      trade.ResultDeal();

   result.order =
      trade.ResultOrder();

   result.volume =
      trade.ResultVolume();

   result.price =
      trade.ResultPrice();

   result.bid =
      trade.ResultBid();

   result.ask =
      trade.ResultAsk();

   result.comment =
      trade.ResultComment();

   result.retcode_external =
      trade.ResultRetcodeExternal();

   // IMPORTANT:
   // CTrade does NOT expose ResultRequestID().
   // request_id remains zero.
}


//+------------------------------------------------------------------+
//| Check trade success                                              |
//+------------------------------------------------------------------+

bool IsTradeSuccess(MqlTradeResult &result)
{
   switch(result.retcode)
   {
      case TRADE_RETCODE_DONE:
      case TRADE_RETCODE_PLACED:
      case TRADE_RETCODE_DONE_PARTIAL:
         return true;
   }

   return false;
}


//+------------------------------------------------------------------+
//| Trade retcode text                                               |
//+------------------------------------------------------------------+

string RetcodeToString(uint retcode)
{
   switch(retcode)
   {
      case TRADE_RETCODE_REQUOTE:
         return "REQUOTE";

      case TRADE_RETCODE_REJECT:
         return "REJECT";

      case TRADE_RETCODE_CANCEL:
         return "CANCEL";

      case TRADE_RETCODE_PLACED:
         return "PLACED";

      case TRADE_RETCODE_DONE:
         return "DONE";

      case TRADE_RETCODE_DONE_PARTIAL:
         return "DONE_PARTIAL";

      case TRADE_RETCODE_ERROR:
         return "ERROR";

      case TRADE_RETCODE_TIMEOUT:
         return "TIMEOUT";

      case TRADE_RETCODE_INVALID:
         return "INVALID";

      case TRADE_RETCODE_INVALID_VOLUME:
         return "INVALID_VOLUME";

      case TRADE_RETCODE_INVALID_PRICE:
         return "INVALID_PRICE";

      case TRADE_RETCODE_INVALID_STOPS:
         return "INVALID_STOPS";

      case TRADE_RETCODE_TRADE_DISABLED:
         return "TRADE_DISABLED";

      case TRADE_RETCODE_MARKET_CLOSED:
         return "MARKET_CLOSED";

      case TRADE_RETCODE_NO_MONEY:
         return "NO_MONEY";

      case TRADE_RETCODE_PRICE_CHANGED:
         return "PRICE_CHANGED";

      case TRADE_RETCODE_PRICE_OFF:
         return "PRICE_OFF";

      case TRADE_RETCODE_POSITION_CLOSED:
         return "POSITION_CLOSED";

      case TRADE_RETCODE_INVALID_FILL:
         return "INVALID_FILL";

      case TRADE_RETCODE_CONNECTION:
         return "CONNECTION";

      case TRADE_RETCODE_TOO_MANY_REQUESTS:
         return "TOO_MANY_REQUESTS";

      case TRADE_RETCODE_NO_CHANGES:
         return "NO_CHANGES";

      case TRADE_RETCODE_SERVER_DISABLES_AT:
         return "SERVER_DISABLES_AT";

      case TRADE_RETCODE_CLIENT_DISABLES_AT:
         return "CLIENT_DISABLES_AT";

      case TRADE_RETCODE_LOCKED:
         return "LOCKED";

      case TRADE_RETCODE_FROZEN:
         return "FROZEN";

      case TRADE_RETCODE_INVALID_EXPIRATION:
         return "INVALID_EXPIRATION";
         
   }

   return "UNKNOWN";
}


//+------------------------------------------------------------------+
//| Report execution                                                 |
//+------------------------------------------------------------------+

bool ReportExecution(string commandId,
                     string action,
                     MqlTradeResult &result,
                     bool success,
                     string errorMessage = "")
{
   if(!isRegistered)
      return false;

   string url =
      RuntimePlatformURL +
      "/api/trading/gateway/execution";

   string accountNumber =
      IntegerToString((long)accInfo.Login());

   string finalComment =
      result.comment;

   if(finalComment == "" &&
      errorMessage != "")
   {
      finalComment = errorMessage;
   }

   string payload =
      "{" +

      "\"commandId\":\"" +
      JsonEscape(commandId) +
      "\"," +

      "\"accountNumber\":\"" +
      JsonEscape(accountNumber) +
      "\"," +

      "\"action\":\"" +
      JsonEscape(action) +
      "\"," +

      "\"success\":" +
      (success ? "true" : "false") +
      "," +

      "\"retcode\":" +
      IntegerToString((long)result.retcode) +
      "," +

      "\"retcodeText\":\"" +
      JsonEscape(RetcodeToString(result.retcode)) +
      "\"," +

      "\"order\":" +
      IntegerToString((long)result.order) +
      "," +

      "\"deal\":" +
      IntegerToString((long)result.deal) +
      "," +

      "\"volume\":" +
      DoubleToString(result.volume, 8) +
      "," +

      "\"price\":" +
      DoubleToString(result.price, 10) +
      "," +

      "\"bid\":" +
      DoubleToString(result.bid, 10) +
      "," +

      "\"ask\":" +
      DoubleToString(result.ask, 10) +
      "," +

      "\"comment\":\"" +
      JsonEscape(finalComment) +
      "\"," +

      "\"timestamp\":" +
      IntegerToString((long)TimeCurrent()) +

      "}";

   string response;
   string responseHeaders;
   int httpCode = -1;

   bool reported =
      SendHTTPRequest("POST",
                      url,
                      payload,
                      response,
                      httpCode,
                      responseHeaders);

   if(!reported)
   {
      Print("Failed to report execution.");
      Print("Command ID: ", commandId);
      Print("HTTP: ", httpCode);
   }

   return reported;
}


//+------------------------------------------------------------------+
//| Disconnect notification                                          |
//+------------------------------------------------------------------+

bool SendDisconnectNotification()
{
   if(!isRegistered)
      return false;

   string url =
      RuntimePlatformURL +
      "/api/trading/gateway/disconnect";

   string accountNumber =
      IntegerToString((long)accInfo.Login());

   string payload =
      "{" +

      "\"accountNumber\":\"" +
      JsonEscape(accountNumber) +
      "\"," +

      "\"timestamp\":" +
      IntegerToString((long)TimeCurrent()) +

      "}";

   string response;
   string responseHeaders;
   int httpCode = -1;

   bool success =
      SendHTTPRequest("POST",
                      url,
                      payload,
                      response,
                      httpCode,
                      responseHeaders);

   return success;
}


//+------------------------------------------------------------------+
//| Find position ticket                                             |
//+------------------------------------------------------------------+

ulong FindPositionTicket(string symbol)
{
   int total = PositionsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket =
         PositionGetTicket(i);

      if(ticket == 0)
         continue;

      if(!PositionSelectByTicket(ticket))
         continue;

      string positionSymbol =
         PositionGetString(POSITION_SYMBOL);

      long magic =
         PositionGetInteger(POSITION_MAGIC);

      if(positionSymbol == symbol &&
         magic == MagicNumber)
      {
         return ticket;
      }
   }

   return 0;
}


//+------------------------------------------------------------------+
//| Find pending order ticket                                        |
//+------------------------------------------------------------------+

ulong FindOrderTicket(string symbol)
{
   int total = OrdersTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket =
         OrderGetTicket(i);

      if(ticket == 0)
         continue;

      if(!OrderSelect(ticket))
         continue;

      string orderSymbol =
         OrderGetString(ORDER_SYMBOL);

      long magic =
         OrderGetInteger(ORDER_MAGIC);

      if(orderSymbol == symbol &&
         magic == MagicNumber)
      {
         return ticket;
      }
   }

   return 0;
}


//+------------------------------------------------------------------+
//| Count managed positions                                          |
//+------------------------------------------------------------------+

int CountManagedPositions()
{
   int count = 0;

   int total = PositionsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket =
         PositionGetTicket(i);

      if(ticket == 0)
         continue;

      if(!PositionSelectByTicket(ticket))
         continue;

      long magic =
         PositionGetInteger(POSITION_MAGIC);

      if(magic == MagicNumber)
         count++;
   }

   return count;
}


//+------------------------------------------------------------------+
//| Count managed orders                                             |
//+------------------------------------------------------------------+

int CountManagedOrders()
{
   int count = 0;

   int total = OrdersTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket =
         OrderGetTicket(i);

      if(ticket == 0)
         continue;

      if(!OrderSelect(ticket))
         continue;

      long magic =
         OrderGetInteger(ORDER_MAGIC);

      if(magic == MagicNumber)
         count++;
   }

   return count;
}


//+------------------------------------------------------------------+
//| Create chart display                                             |
//+------------------------------------------------------------------+

void CreateChartDisplay()
{
   labelY = 30;

   // ---------------------------------------------------------------
   // Background
   // ---------------------------------------------------------------

   if(ObjectFind(0, UI_BACKGROUND) < 0)
   {
      ObjectCreate(0,
                   UI_BACKGROUND,
                   OBJ_RECTANGLE_LABEL,
                   0,
                   0,
                   0);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_CORNER,
                       CORNER_LEFT_UPPER);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_XDISTANCE,
                       5);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_YDISTANCE,
                       5);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_XSIZE,
                       280);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_YSIZE,
                       230);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_BGCOLOR,
                       clrBlack);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_BORDER_COLOR,
                       clrDimGray);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_BACK,
                       false);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_SELECTABLE,
                       false);

      ObjectSetInteger(0,
                       UI_BACKGROUND,
                       OBJPROP_HIDDEN,
                       true);
   }

   // ---------------------------------------------------------------
   // Title
   // ---------------------------------------------------------------

   CreateLabel(UI_TITLE,
               "AlgoVault Trade Gateway",
               10,
               10,
               11);

   CreateLabel(UI_STATUS,
               "Status: Connecting...",
               10,
               35,
               10);

   CreateLabel(UI_ACCOUNT,
               "Account: -",
               10,
               55,
               10);

   CreateLabel(UI_BALANCE,
               "Balance: -",
               10,
               75,
               10);

   CreateLabel(UI_EQUITY,
               "Equity: -",
               10,
               95,
               10);

   CreateLabel(UI_POSITIONS,
               "Positions: 0",
               10,
               115,
               10);

   CreateLabel(UI_ORDERS,
               "Orders: 0",
               10,
               135,
               10);

   CreateLabel(UI_COMMANDS,
               "Commands: 0",
               10,
               155,
               10);

   CreateLabel(UI_SERVER,
               "Server: -",
               10,
               175,
               10);

   CreateLabel(UI_LAST_SYNC,
               "Last sync: -",
               10,
               195,
               10);
}


//+------------------------------------------------------------------+
//| Create label                                                     |
//+------------------------------------------------------------------+

void CreateLabel(string name,
                 string text,
                 int x,
                 int y,
                 int fontSize)
{
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0,
                   name,
                   OBJ_LABEL,
                   0,
                   0,
                   0);

      ObjectSetInteger(0,
                       name,
                       OBJPROP_CORNER,
                       CORNER_LEFT_UPPER);

      ObjectSetInteger(0,
                       name,
                       OBJPROP_XDISTANCE,
                       x);

      ObjectSetInteger(0,
                       name,
                       OBJPROP_YDISTANCE,
                       y);

      ObjectSetInteger(0,
                       name,
                       OBJPROP_FONTSIZE,
                       fontSize);

      ObjectSetString(0,
                      name,
                      OBJPROP_FONT,
                      "Arial");

      ObjectSetInteger(0,
                       name,
                       OBJPROP_COLOR,
                       clrWhite);

      ObjectSetInteger(0,
                       name,
                       OBJPROP_SELECTABLE,
                       false);

      ObjectSetInteger(0,
                       name,
                       OBJPROP_HIDDEN,
                       true);
   }

   ObjectSetString(0,
                   name,
                   OBJPROP_TEXT,
                   text);
}


//+------------------------------------------------------------------+
//| Update chart display                                             |
//+------------------------------------------------------------------+

void UpdateChartDisplay()
{
   if(ObjectFind(0, UI_STATUS) >= 0)
   {
      string status;

      if(isConnected && isRegistered)
         status = "Status: CONNECTED";
      else if(isRegistered)
         status = "Status: DISCONNECTED";
      else
         status = "Status: REGISTERING...";

      ObjectSetString(0,
                      UI_STATUS,
                      OBJPROP_TEXT,
                      status);
   }

   if(ObjectFind(0, UI_ACCOUNT) >= 0)
   {
      ObjectSetString(
         0,
         UI_ACCOUNT,
         OBJPROP_TEXT,
         "Account: " +
         IntegerToString((long)accInfo.Login())
      );
   }

   if(ObjectFind(0, UI_BALANCE) >= 0)
   {
      ObjectSetString(
         0,
         UI_BALANCE,
         OBJPROP_TEXT,
         "Balance: " +
         DoubleToString(
            AccountInfoDouble(ACCOUNT_BALANCE),
            2
         )
      );
   }

   if(ObjectFind(0, UI_EQUITY) >= 0)
   {
      ObjectSetString(
         0,
         UI_EQUITY,
         OBJPROP_TEXT,
         "Equity: " +
         DoubleToString(
            AccountInfoDouble(ACCOUNT_EQUITY),
            2
         )
      );
   }

   if(ObjectFind(0, UI_POSITIONS) >= 0)
   {
      ObjectSetString(
         0,
         UI_POSITIONS,
         OBJPROP_TEXT,
         "Positions: " +
         IntegerToString(
            CountManagedPositions()
         )
      );
   }

   if(ObjectFind(0, UI_ORDERS) >= 0)
   {
      ObjectSetString(
         0,
         UI_ORDERS,
         OBJPROP_TEXT,
         "Orders: " +
         IntegerToString(
            CountManagedOrders()
         )
      );
   }

   if(ObjectFind(0, UI_COMMANDS) >= 0)
   {
      ObjectSetString(
         0,
         UI_COMMANDS,
         OBJPROP_TEXT,
         "Commands: " +
         IntegerToString(
            pendingCommands
         )
      );
   }

   if(ObjectFind(0, UI_SERVER) >= 0)
   {
      ObjectSetString(
         0,
         UI_SERVER,
         OBJPROP_TEXT,
         "Server: " +
         AccountInfoString(ACCOUNT_SERVER)
      );
   }

   if(ObjectFind(0, UI_LAST_SYNC) >= 0)
   {
      string syncText = "Last sync: -";

      if(lastHeartbeat > 0)
      {
         syncText =
            "Last sync: " +
            TimeToString(
               lastHeartbeat,
               TIME_SECONDS
            );
      }

      ObjectSetString(
         0,
         UI_LAST_SYNC,
         OBJPROP_TEXT,
         syncText
      );
   }

   ChartRedraw();
}


//+------------------------------------------------------------------+
//| Delete chart display                                             |
//+------------------------------------------------------------------+

void DeleteChartDisplay()
{
   ObjectDelete(0, UI_BACKGROUND);
   ObjectDelete(0, UI_TITLE);
   ObjectDelete(0, UI_STATUS);
   ObjectDelete(0, UI_ACCOUNT);
   ObjectDelete(0, UI_BALANCE);
   ObjectDelete(0, UI_EQUITY);
   ObjectDelete(0, UI_POSITIONS);
   ObjectDelete(0, UI_ORDERS);
   ObjectDelete(0, UI_COMMANDS);
   ObjectDelete(0, UI_SERVER);
   ObjectDelete(0, UI_LAST_SYNC);

   ChartRedraw();
}