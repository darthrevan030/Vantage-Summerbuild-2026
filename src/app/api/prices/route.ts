const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin",
  SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin",
};
const GOLD_TICKERS = new Set(["GOLD", "XAU", "GLD"]);

export async function POST(req: Request) {
  const { tickers }: { tickers: string[] } = await req.json();
  const prices: Record<string, number> = {};

  const crypto = tickers.filter((t) => CRYPTO_IDS[t]);
  const gold = tickers.filter((t) => GOLD_TICKERS.has(t));
  const equities = tickers.filter((t) => !CRYPTO_IDS[t] && !GOLD_TICKERS.has(t));

  await Promise.all([
    crypto.length > 0 && (async () => {
      const ids = crypto.map((t) => CRYPTO_IDS[t]).join(",");
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
      );
      if (res.ok) {
        const json = await res.json();
        for (const t of crypto) {
          prices[t] = json[CRYPTO_IDS[t]]?.usd ?? 0;
        }
      }
    })(),

    gold.length > 0 && process.env.GOLDAPI_KEY && (async () => {
      const res = await fetch("https://www.goldapi.io/api/XAU/USD", {
        headers: { "x-access-token": process.env.GOLDAPI_KEY! },
      });
      if (res.ok) {
        const json = await res.json();
        for (const t of gold) prices[t] = json.price ?? 0;
      }
    })(),

    equities.length > 0 && process.env.EODHD_API_KEY && (async () => {
      await Promise.all(
        equities.map(async (ticker) => {
          const res = await fetch(
            `https://eodhd.com/api/real-time/${ticker}.US?api_token=${process.env.EODHD_API_KEY}&fmt=json`
          );
          if (res.ok) {
            const json = await res.json();
            prices[ticker] = json.close ?? 0;
          }
        })
      );
    })(),
  ]);

  return Response.json(prices);
}
