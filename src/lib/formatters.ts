const NF = (n: number, d = 0): string =>
  Math.abs(n).toLocaleString("en-SG", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

const sgd = (n: number, d = 0): string => "S$" + NF(n, d);

// U+2212 minus sign, not ASCII hyphen
const sgdSigned = (n: number, d = 0): string =>
  (n < 0 ? "−" : "+") + "S$" + NF(n, d);

const pct = (n: number, d = 2): string =>
  (n < 0 ? "−" : "+") + NF(n, d) + "%";

const rate = (n: number): string => NF(n, 4);

export { NF, sgd, sgdSigned, pct, rate };
