const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

export function toMinorUnits(value, decimals = 2) {
  const text = String(value ?? "").trim();
  if (!DECIMAL_PATTERN.test(text)) throw new Error("Money values must be non-negative exact decimals.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new Error(`Money values may have at most ${decimals} decimal places.`);
  }
  const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(padded || "0");
}

export function fromMinorUnits(value, decimals = 2) {
  const minor = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = minor / scale;
  const fraction = String(minor % scale).padStart(decimals, "0");
  return `${whole}.${fraction}`;
}

export function assertBalanced(entries) {
  if (!Array.isArray(entries) || entries.length < 2) throw new Error("A ledger transaction needs at least two entries.");
  const debits = entries.filter((entry) => entry.direction === "DEBIT").reduce((sum, entry) => sum + BigInt(entry.amountMinor), 0n);
  const credits = entries.filter((entry) => entry.direction === "CREDIT").reduce((sum, entry) => sum + BigInt(entry.amountMinor), 0n);
  if (debits <= 0n || credits <= 0n || debits !== credits) throw new Error("Ledger transaction is not balanced.");
  return { debits, credits };
}

export function makeBalancedTransaction({ id, type, currency, entries, reference, createdAt = new Date().toISOString() }) {
  const normalized = entries.map((entry) => ({ ...entry, amountMinor: BigInt(entry.amountMinor).toString(), currency }));
  const totals = assertBalanced(normalized);
  return Object.freeze({ id, type, currency, reference, createdAt, entries: normalized, debitsMinor: totals.debits.toString(), creditsMinor: totals.credits.toString() });
}

export function calculateSharedPoolPayout({ grossPoolMinor, commissionMinor = 0n, winnerIds }) {
  const winners = [...new Set(winnerIds ?? [])];
  if (!winners.length) throw new Error("A payout requires at least one winner.");
  const net = BigInt(grossPoolMinor) - BigInt(commissionMinor);
  if (net < 0n) throw new Error("Commission cannot exceed the gross pool.");
  const base = net / BigInt(winners.length);
  let remainder = net % BigInt(winners.length);
  const payouts = winners.map((userId) => {
    const amount = base + (remainder > 0n ? 1n : 0n);
    if (remainder > 0n) remainder -= 1n;
    return { userId, amountMinor: amount.toString() };
  });
  return Object.freeze({ netMinor: net.toString(), payouts });
}
