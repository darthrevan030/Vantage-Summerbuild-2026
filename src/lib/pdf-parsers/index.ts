import type { ParseResult } from "./types";
import { parseFsmone } from "./fsmone";
import { parseDbsVickers } from "./dbs-vickers";

export type { ParsedTrade, ParseResult } from "./types";

function detectBroker(text: string): string {
  if (/FUNDSUPERMART|FSMOne|iFAST Financial/i.test(text)) return "fsmone";
  if (/DBS Vickers/i.test(text)) return "dbs-vickers";
  if (/UOB Kay Hian/i.test(text)) return "uob";
  if (/OCBC Securities/i.test(text)) return "ocbc";
  if (/Standard Chartered|StanChart/i.test(text)) return "stanchart";
  if (/HSBC/i.test(text)) return "hsbc";
  return "unknown";
}

export function parsePdfText(text: string): ParseResult {
  const broker = detectBroker(text);
  switch (broker) {
    case "fsmone":
      return parseFsmone(text);
    case "dbs-vickers":
      return parseDbsVickers(text);
    default:
      return {
        broker: "Unknown",
        docType: "unknown",
        trades: [],
        warnings: [
          `Broker not recognised. Supported: FSMOne, DBS Vickers. ` +
          `Send a sample statement to add support for your broker.`,
        ],
      };
  }
}
