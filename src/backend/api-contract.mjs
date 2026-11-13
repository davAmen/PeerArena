export const API_CONTRACT = Object.freeze({
  auth: ["POST /api/auth/register", "POST /api/auth/logout", "GET /api/auth/session", "POST /api/auth/recovery"],
  users: ["GET /api/users/me", "PATCH /api/users/me", "GET /api/users/me/challenges", "GET /api/users/me/transactions", "POST /api/users/me/payout-destination"],
  sports: ["GET /api/sports", "GET /api/events", "GET /api/events/live", "GET /api/events/{id}", "GET /api/events/{id}/markets"],
  challenges: ["POST /api/challenges", "GET /api/challenges", "GET /api/challenges/{id}", "POST /api/challenges/{id}/accept", "POST /api/challenges/{id}/cancel", "GET /api/challenges/{id}/participants"],
  payments: ["POST /api/payments/checkout", "GET /api/payments/{id}", "POST /api/webhooks/seevplus", "POST /api/webhooks/paystack"],
  payouts: ["GET /api/payouts", "GET /api/payouts/{id}"],
  admin: ["GET /api/admin/overview", "GET /api/admin/users", "GET /api/admin/challenges", "GET /api/admin/transactions", "GET /api/admin/settlements", "GET /api/admin/security"]
});
