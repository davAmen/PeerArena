import { calculateSharedPoolPayout, toMinorUnits } from "./ledger.mjs";

export function determineSettlement({ challenge, verifiedOutcome, rulesVersion = "demo-v2", resultSource = "synthetic" }) {
  const participants = challenge.participants ?? [
    { id: challenge.creatorId, prediction: challenge.creatorPrediction, stake: challenge.stake },
    ...(challenge.challengerId ? [{ id: challenge.challengerId, prediction: challenge.challengerPrediction, stake: challenge.stake }] : [])
  ];
  if (participants.length < 2) throw new Error("A challenge needs at least two funded participants.");
  const grossPoolMinor = participants.reduce((sum, participant) => sum + toMinorUnits(participant.stake), 0n);
  if (verifiedOutcome === "VOID") {
    return Object.freeze({ status: "VOIDED", verifiedOutcome, rulesVersion, resultSource, grossPoolMinor: grossPoolMinor.toString(), commissionMinor: "0", payouts: [] });
  }
  const winners = participants.filter((participant) => participant.prediction === verifiedOutcome).map((participant) => participant.id);
  if (!winners.length) {
    return Object.freeze({ status: "VOIDED", verifiedOutcome: "NO_WINNER", rulesVersion, resultSource, grossPoolMinor: grossPoolMinor.toString(), commissionMinor: "0", payouts: [] });
  }
  const payout = calculateSharedPoolPayout({ grossPoolMinor, commissionMinor: 0n, winnerIds: winners });
  return Object.freeze({ status: "SETTLED", verifiedOutcome, rulesVersion, resultSource, grossPoolMinor: grossPoolMinor.toString(), commissionMinor: "0", payouts: payout.payouts });
}
