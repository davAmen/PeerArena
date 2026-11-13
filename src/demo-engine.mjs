import { randomUUID } from "node:crypto";

export const DEMO_CURRENCY = "DEMO";
export const MAX_DEMO_STAKE = 1000;

export const CHALLENGE_STATES = Object.freeze([
  "CREATED",
  "AWAITING_ACCEPTANCE",
  "MATCHED",
  "FUNDS_CONFIRMED",
  "ACTIVE",
  "SUSPENDED",
  "AWAITING_VERIFICATION",
  "SETTLED",
  "VOIDED",
  "REFUNDED",
  "DISPUTED",
  "CLOSED"
]);

const SUPPORTED_MARKETS = Object.freeze({
  Football: ["Match result", "Total goals", "Both teams to score", "Next goal"],
  Basketball: ["Match result", "Total points"],
  Tennis: ["Match result", "Total games"]
});

const nowIso = (timestamp) => new Date(timestamp).toISOString();
const id = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;

export function getSupportedMarkets(sport) {
  return SUPPORTED_MARKETS[sport] ? [...SUPPORTED_MARKETS[sport]] : [];
}
export function getPredictionChoices(event, market) {
  if (!event || !market) return [];
  if (market === "Total goals") return ["Over 2.5", "Under 2.5"];
  if (market === "Total points") return ["Over 215.5", "Under 215.5"];
  if (market === "Total games") return ["Over 22.5", "Under 22.5"];
  if (market === "Both teams to score") return ["Yes", "No"];
  if (market === "Next goal") return [event.home, event.away];
  if (market === "Match result") return [event.home, event.away];
  return [];
}

export function oppositePrediction(event, market, prediction) {
  const choices = getPredictionChoices(event, market);
  return choices.find((choice) => choice !== prediction) ?? "Opposing prediction";
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function amount(value) {
  const parsed = Number(value);
  ensure(Number.isFinite(parsed) && parsed > 0, "Stake must be greater than zero.");
  ensure(parsed <= MAX_DEMO_STAKE, `Demo stakes are capped at ${MAX_DEMO_STAKE} DEMO credits.`);
  return Math.round(parsed * 100) / 100;
}

function challengeFor(state, challengeId) {
  const challenge = state.challenges.find((item) => item.id === challengeId);
  ensure(challenge, "Challenge not found.");
  return challenge;
}

function addAudit(state, action, details, timestamp) {
  state.auditLog.unshift({
    id: id("audit"),
    action,
    actorId: state.user.id,
    actorName: state.user.username,
    timestamp: nowIso(timestamp),
    details
  });
}

function addTransaction(state, type, signedAmount, description, metadata, timestamp) {
  state.transactions.unshift({
    id: id("txn"),
    type,
    amount: Math.round(signedAmount * 100) / 100,
    currency: DEMO_CURRENCY,
    description,
    status: "POSTED",
    createdAt: nowIso(timestamp),
    metadata
  });
}

function eventFor(state, eventId) {
  const event = state.events.find((item) => item.id === eventId);
  ensure(event, "Event not found.");
  return event;
}

export function createInitialState(timestamp = Date.now()) {
  const firstKickoff = timestamp + 2 * 60 * 60 * 1000;
  const events = [
    {
      id: "evt_hearts_kotoko",
      sport: "Football",
      league: "Ghana Premier League",
      home: "Hearts of Oak",
      away: "Asante Kotoko",
      venue: "Accra Sports Stadium",
      kickoffAt: nowIso(firstKickoff),
      status: "SCHEDULED",
      dataSource: "Synthetic event feed",
      dataConfidence: "DEMO"
    },
    {
      id: "evt_arsenal_city",
      sport: "Football",
      league: "Premier League",
      home: "Arsenal",
      away: "Manchester City",
      venue: "Emirates Stadium",
      kickoffAt: nowIso(timestamp + 6 * 60 * 60 * 1000),
      status: "SCHEDULED",
      dataSource: "Synthetic event feed",
      dataConfidence: "DEMO"
    },
    {
      id: "evt_lakers_celtics",
      sport: "Basketball",
      league: "NBA",
      home: "Boston Celtics",
      away: "Los Angeles Lakers",
      venue: "TD Garden",
      kickoffAt: nowIso(timestamp + 24 * 60 * 60 * 1000),
      status: "SCHEDULED",
      dataSource: "Synthetic event feed",
      dataConfidence: "DEMO"
    },
    {
      id: "evt_sinner_medvedev",
      sport: "Tennis",
      league: "ATP Tour",
      home: "Jannik Sinner",
      away: "Daniil Medvedev",
      venue: "Centre Court",
      kickoffAt: nowIso(timestamp + 30 * 60 * 60 * 1000),
      status: "SCHEDULED",
      dataSource: "Synthetic event feed",
      dataConfidence: "DEMO"
    }
  ];

  const userId = "u_demo";
  const challenges = [
    {
      id: "ch_open_hearts",
      eventId: "evt_hearts_kotoko",
      title: "Hearts of Oak vs Asante Kotoko",
      market: "Total goals",
      creatorId: "u_nana",
      creatorName: "NanaBall",
      creatorPrediction: "Over 2.5",
      challengerId: null,
      challengerName: null,
      challengerPrediction: "Under 2.5",
      stake: 50,
      grossPool: 0,
      accessFee: 0,
      winningCommission: 0,
      visibility: "PUBLIC",
      status: "AWAITING_ACCEPTANCE",
      createdAt: nowIso(timestamp - 35 * 60 * 1000),
      expiresAt: nowIso(timestamp + 70 * 60 * 1000),
      settlement: null
    },
    {
      id: "ch_open_arsenal",
      eventId: "evt_arsenal_city",
      title: "Arsenal vs Manchester City",
      market: "Match result",
      creatorId: "u_accra_gunner",
      creatorName: "AccraGunner",
      creatorPrediction: "Arsenal",
      challengerId: null,
      challengerName: null,
      challengerPrediction: "Manchester City",
      stake: 100,
      grossPool: 0,
      accessFee: 0,
      winningCommission: 0,
      visibility: "PUBLIC",
      status: "AWAITING_ACCEPTANCE",
      createdAt: nowIso(timestamp - 18 * 60 * 1000),
      expiresAt: nowIso(timestamp + 3 * 60 * 60 * 1000),
      settlement: null
    },
    {
      id: "ch_my_active",
      eventId: "evt_lakers_celtics",
      title: "Celtics vs Lakers",
      market: "Total points",
      creatorId: userId,
      creatorName: "KwamePredicts",
      creatorPrediction: "Over 215.5",
      challengerId: "u_ama",
      challengerName: "AmaHoops",
      challengerPrediction: "Under 215.5",
      stake: 25,
      grossPool: 50,
      accessFee: 0,
      winningCommission: 0,
      visibility: "PRIVATE",
      status: "ACTIVE",
      createdAt: nowIso(timestamp - 45 * 60 * 1000),
      acceptedAt: nowIso(timestamp - 40 * 60 * 1000),
      expiresAt: nowIso(timestamp + 20 * 60 * 60 * 1000),
      settlement: null
    },
    {
      id: "ch_my_settled",
      eventId: "evt_sinner_medvedev",
      title: "Sinner vs Medvedev",
      market: "Match result",
      creatorId: userId,
      creatorName: "KwamePredicts",
      creatorPrediction: "Jannik Sinner",
      challengerId: "u_kofi",
      challengerName: "KofiSets",
      challengerPrediction: "Daniil Medvedev",
      stake: 40,
      grossPool: 80,
      accessFee: 0,
      winningCommission: 0,
      visibility: "PUBLIC",
      status: "SETTLED",
      createdAt: nowIso(timestamp - 3 * 24 * 60 * 60 * 1000),
      acceptedAt: nowIso(timestamp - 3 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000),
      expiresAt: nowIso(timestamp - 2 * 24 * 60 * 60 * 1000),
      settlement: {
        outcome: "CREATOR_WINS",
        winnerId: userId,
        winnerName: "KwamePredicts",
        grossPool: 80,
        commission: 0,
        payout: 80,
        reference: "SET-DEMO-0007",
        verifiedAt: nowIso(timestamp - 2 * 24 * 60 * 60 * 1000)
      }
    }
  ];

  return {
    demoMode: true,
    realMoneyEnabled: false,
    settlementMode: "SYNTHETIC_ONLY",
    version: 1,
    platform: {
      name: "PeerArena",
      market: "Ghana pilot · demonstration only",
      currency: DEMO_CURRENCY,
      defaultCommissionRate: 0,
      regulatedLaunchGate: "BLOCKED_PENDING_LICENCE_AND_PROVIDER_APPROVAL"
    },
    user: {
      id: userId,
      username: "KwamePredicts",
      displayName: "Kwame Mensah",
      country: "Ghana",
      verificationStatus: "DEMO_VERIFIED",
      balance: 1250,
      stats: { wins: 7, losses: 5, pushes: 1, winRate: 58 },
      responsible: {
        selfExcluded: false,
        depositLimit: null,
        lossLimit: null,
        timeOutUntil: null,
        sessionReminderMinutes: 30
      }
    },
    events,
    challenges,
    transactions: [
      {
        id: "txn_settlement_0007",
        type: "DEMO_PAYOUT",
        amount: 80,
        currency: DEMO_CURRENCY,
        description: "Sinner vs Medvedev · winning payout",
        status: "POSTED",
        createdAt: nowIso(timestamp - 2 * 24 * 60 * 60 * 1000),
        metadata: { challengeId: "ch_my_settled", reference: "SET-DEMO-0007" }
      },
      {
        id: "txn_stake_0004",
        type: "DEMO_STAKE_RESERVED",
        amount: -25,
        currency: DEMO_CURRENCY,
        description: "Celtics vs Lakers · stake reserved",
        status: "POSTED",
        createdAt: nowIso(timestamp - 45 * 60 * 1000),
        metadata: { challengeId: "ch_my_active" }
      },
      {
        id: "txn_credit_0001",
        type: "DEMO_CREDIT",
        amount: 1250,
        currency: DEMO_CURRENCY,
        description: "Synthetic demonstration balance",
        status: "POSTED",
        createdAt: nowIso(timestamp - 7 * 24 * 60 * 60 * 1000),
        metadata: { source: "seed" }
      }
    ],
    auditLog: [
      {
        id: "audit_seed",
        action: "DEMO_STATE_INITIALIZED",
        actorId: "system",
        actorName: "Demo system",
        timestamp: nowIso(timestamp),
        details: { realMoneyEnabled: false }
      }
    ]
  };
}

export function createChallenge(state, input, timestamp = Date.now()) {
  ensure(state.demoMode && !state.realMoneyEnabled, "Real-money mode is disabled in this demonstration.");
  ensure(!state.user.responsible.selfExcluded, "This demo account is self-excluded.");

  const event = eventFor(state, input.eventId);
  ensure(event.status === "SCHEDULED", "Only scheduled events can accept a new demo challenge.");
  const market = String(input.market ?? "");
  const prediction = String(input.prediction ?? "");
  ensure(getSupportedMarkets(event.sport).includes(market), "That market is not enabled for this demo event.");
  ensure(getPredictionChoices(event, market).includes(prediction), "Select a valid binary prediction.");

  const stake = amount(input.stake);
  ensure(state.user.balance >= stake, "Insufficient demo credits.");
  const expiryHours = Math.min(Math.max(Number(input.expiryHours) || 24, 1), 72);
  const challenge = {
    id: id("ch"),
    eventId: event.id,
    title: `${event.home} vs ${event.away}`,
    market,
    creatorId: state.user.id,
    creatorName: state.user.username,
    creatorPrediction: prediction,
    challengerId: null,
    challengerName: null,
    challengerPrediction: oppositePrediction(event, market, prediction),
    stake,
    grossPool: 0,
    accessFee: 0,
    winningCommission: 0,
    visibility: input.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
    status: "AWAITING_ACCEPTANCE",
    createdAt: nowIso(timestamp),
    expiresAt: nowIso(timestamp + expiryHours * 60 * 60 * 1000),
    settlement: null
  };

  state.user.balance = Math.round((state.user.balance - stake) * 100) / 100;
  state.challenges.unshift(challenge);
  addTransaction(state, "DEMO_STAKE_RESERVED", -stake, `${challenge.title} · stake reserved`, { challengeId: challenge.id }, timestamp);
  addAudit(state, "CHALLENGE_CREATED", { challengeId: challenge.id, visibility: challenge.visibility, stake }, timestamp);
  return challenge;
}

export function acceptChallenge(state, challengeId, timestamp = Date.now()) {
  ensure(state.demoMode && !state.realMoneyEnabled, "Real-money mode is disabled in this demonstration.");
  ensure(!state.user.responsible.selfExcluded, "This demo account is self-excluded.");
  const challenge = challengeFor(state, challengeId);
  ensure(challenge.status === "AWAITING_ACCEPTANCE", "This challenge is no longer open for acceptance.");
  ensure(challenge.creatorId !== state.user.id, "You cannot accept your own challenge.");
  ensure(new Date(challenge.expiresAt).getTime() > timestamp, "This challenge has expired.");
  ensure(state.user.balance >= challenge.stake, "Insufficient demo credits to accept this challenge.");

  state.user.balance = Math.round((state.user.balance - challenge.stake) * 100) / 100;
  challenge.challengerId = state.user.id;
  challenge.challengerName = state.user.username;
  challenge.grossPool = Math.round(challenge.stake * 2 * 100) / 100;
  challenge.acceptedAt = nowIso(timestamp);
  challenge.status = "FUNDS_CONFIRMED";
  addTransaction(state, "DEMO_STAKE_RESERVED", -challenge.stake, `${challenge.title} · matching stake reserved`, { challengeId: challenge.id }, timestamp);
  addAudit(state, "CHALLENGE_ACCEPTED", { challengeId: challenge.id, grossPool: challenge.grossPool }, timestamp);
  return challenge;
}

export function settleChallenge(state, challengeId, outcome, timestamp = Date.now()) {
  const challenge = challengeFor(state, challengeId);
  ensure(["ACTIVE", "FUNDS_CONFIRMED", "MATCHED", "AWAITING_VERIFICATION", "SUSPENDED"].includes(challenge.status), "Only matched demo challenges can be settled.");
  ensure(challenge.challengerId, "A second participant is required before settlement.");
  ensure(["CREATOR_WINS", "CHALLENGER_WINS", "VOID"].includes(outcome), "Settlement outcome is invalid.");

  challenge.status = "AWAITING_VERIFICATION";
  const verifiedAt = nowIso(timestamp);
  if (outcome === "VOID") {
    challenge.status = "VOIDED";
    const refunds = [
      [challenge.creatorId, challenge.creatorName],
      [challenge.challengerId, challenge.challengerName]
    ];
    for (const [participantId] of refunds) {
      if (participantId === state.user.id) {
        state.user.balance = Math.round((state.user.balance + challenge.stake) * 100) / 100;
        addTransaction(state, "DEMO_REFUND", challenge.stake, `${challenge.title} · voided market refund`, { challengeId: challenge.id }, timestamp);
      }
    }
    challenge.settlement = {
      outcome,
      winnerId: null,
      winnerName: null,
      grossPool: challenge.grossPool,
      commission: 0,
      payout: 0,
      reference: `VOID-DEMO-${challenge.id.slice(-4).toUpperCase()}`,
      verifiedAt
    };
    addAudit(state, "CHALLENGE_VOIDED", { challengeId: challenge.id, reason: "Synthetic operator resolution" }, timestamp);
    return challenge;
  }

  const creatorWins = outcome === "CREATOR_WINS";
  const winnerId = creatorWins ? challenge.creatorId : challenge.challengerId;
  const winnerName = creatorWins ? challenge.creatorName : challenge.challengerName;
  const commission = 0;
  const payout = Math.round((challenge.grossPool - commission) * 100) / 100;
  challenge.status = "SETTLED";
  challenge.winningCommission = commission;
  challenge.payout = payout;
  challenge.settlement = {
    outcome,
    winnerId,
    winnerName,
    grossPool: challenge.grossPool,
    commission,
    payout,
    reference: `SET-DEMO-${challenge.id.slice(-6).toUpperCase()}`,
    verifiedAt
  };
  if (winnerId === state.user.id) {
    state.user.balance = Math.round((state.user.balance + payout) * 100) / 100;
    addTransaction(state, "DEMO_PAYOUT", payout, `${challenge.title} · winning payout`, { challengeId: challenge.id, reference: challenge.settlement.reference }, timestamp);
    state.user.stats.wins += 1;
  } else if (challenge.creatorId === state.user.id || challenge.challengerId === state.user.id) {
    state.user.stats.losses += 1;
  }
  const totalDecisions = state.user.stats.wins + state.user.stats.losses;
  state.user.stats.winRate = totalDecisions ? Math.round((state.user.stats.wins / totalDecisions) * 100) : 0;
  addAudit(state, "CHALLENGE_SETTLED", { challengeId: challenge.id, winnerId, payout, reference: challenge.settlement.reference }, timestamp);
  return challenge;
}

export function setSelfExclusion(state, enabled, timestamp = Date.now()) {
  state.user.responsible.selfExcluded = Boolean(enabled);
  addAudit(state, enabled ? "SELF_EXCLUSION_ENABLED" : "SELF_EXCLUSION_DISABLED", { scope: "demo account" }, timestamp);
  return state.user.responsible;
}

export function getAdminOverview(state) {
  const totalChallenges = state.challenges.length;
  const activeChallenges = state.challenges.filter((challenge) => ["ACTIVE", "FUNDS_CONFIRMED", "AWAITING_ACCEPTANCE"].includes(challenge.status)).length;
  const matchedChallenges = state.challenges.filter((challenge) => challenge.challengerId).length;
  const settledChallenges = state.challenges.filter((challenge) => challenge.status === "SETTLED").length;
  const syntheticVolume = state.challenges.reduce((sum, challenge) => sum + (challenge.grossPool || 0), 0);
  return {
    totalUsers: 4,
    verifiedUsers: 3,
    totalChallenges,
    activeChallenges,
    matchedChallenges,
    settledChallenges,
    syntheticVolume,
    platformFees: 0,
    outstandingDemoLiability: state.user.balance,
    dataFeed: "Synthetic feed · healthy",
    paymentRail: "Disabled · no provider connected",
    realMoneyGate: "BLOCKED"
  };
}
