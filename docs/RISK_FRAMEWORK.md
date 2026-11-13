# Risk management framework

## Method

Risks are rated using likelihood and impact on a 1–5 scale. The initial score is `likelihood × impact`. Critical/high risks block real-money launch until the owner provides evidence that the residual risk is acceptable to the board, counsel and the relevant regulator/partner.

| Score | Rating | Treatment |
| --- | --- | --- |
| 1–4 | Low | Monitor and maintain control |
| 5–9 | Medium | Mitigate, test and review quarterly |
| 10–16 | High | Mitigate before launch; executive acceptance only with evidence |
| 17–25 | Critical | Block launch or stop affected activity |

## Risk register

| ID | Risk | L | I | Score | Control / test | Owner |
| --- | --- | ---: | ---: | ---: | --- | --- |
| R-01 | Product operates without correct licence/classification | 3 | 5 | 15 | Written opinion, Commission route and launch gate | Legal |
| R-02 | Customer funds are mishandled or commingled | 3 | 5 | 15 | Authorized PSP/safeguarding, double-entry reconciliation | Finance |
| R-03 | Under-age or prohibited-jurisdiction access | 3 | 5 | 15 | KYC/age/geo checks, denial tests, exclusion list | Compliance |
| R-04 | P2P collusion, manipulation or money laundering | 4 | 5 | 20 | CDD/EDD, graph monitoring, cases, human review | MLRO |
| R-05 | Incorrect or stale result settles a market | 3 | 5 | 15 | Licensed feed, freshness/quorum, suspension and void rule | Trading |
| R-06 | Duplicate payout or ledger imbalance | 3 | 5 | 15 | Idempotency, locks, balanced transactions, reconciliation tests | CTO |
| R-07 | Self-exclusion is bypassed with a duplicate account | 3 | 5 | 15 | Identity matching, linked-account controls, support review | Responsible play |
| R-08 | Identity or payment data breach | 3 | 5 | 15 | Minimize, encrypt, isolate, pen test, incident response | DPO/CISO |
| R-09 | Misleading advertising or vulnerable-user targeting | 3 | 4 | 12 | Marketing approval checklist and monitoring | Marketing |
| R-10 | Provider outage or contradictory event data | 4 | 4 | 16 | Suspend, queue, fallback evidence and dispute policy | Operations |
| R-11 | Admin abuses fee/rule/settlement authority | 2 | 5 | 10 | RBAC, MFA, maker-checker, immutable audit | COO |
| R-12 | Tax/reporting obligations are missed | 3 | 4 | 12 | Tax opinion, reporting calendar, reconciliation | Finance |
| R-13 | Model or AI invents a result or pressures play | 2 | 5 | 10 | Narrow permissions, human review, prompt/output tests | Product |
| R-14 | Service outage causes inconsistent customer state | 3 | 4 | 12 | HA design, backups, RPO/RTO, restore test | SRE |

## Risk acceptance

Every high/critical risk needs a named control owner, due date, test case, evidence link, residual score and approving authority. Risk acceptance cannot turn on real-money mode without the legal and licensing gates being satisfied.

## Key indicators

Monitor reconciliation breaks, unmatched/late settlements, provider freshness, duplicate-account matches, self-exclusion blocks, suspicious cases, chargebacks, payout failures, complaints, support wait time, limit changes and security incidents. Set thresholds and escalation paths before launch.
