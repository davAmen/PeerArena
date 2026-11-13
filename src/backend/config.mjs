const asBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

export function readRuntimeConfig(env = process.env) {
  const publicSupabaseKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Object.freeze({
    appEnv: env.APP_ENV ?? "demo",
    authMode: env.AUTH_MODE ?? "demo",
    paymentMode: env.PAYMENT_MODE ?? "mock",
    realMoneyEnabled: asBoolean(env.REAL_MONEY_ENABLED, false),
    mockPaymentsEnabled: asBoolean(env.MOCK_PAYMENTS_ENABLED, true),
    googleAuthEnabled: asBoolean(env.GOOGLE_AUTH_ENABLED, false),
    supabaseConfigured: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && publicSupabaseKey),
    supabasePersistenceConfigured: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)),
    productionAuthorization: env.REAL_MONEY_OPERATIONAL_AUTHORIZATION ?? "",
    paymentProviderApproved: asBoolean(env.PAYMENT_PROVIDER_APPROVED, false),
    gamingAuthorizationVerified: asBoolean(env.GAMING_AUTHORIZATION_VERIFIED, false),
    safeguardingVerified: asBoolean(env.SAFEGUARDING_VERIFIED, false),
    securityReviewVerified: asBoolean(env.SECURITY_REVIEW_VERIFIED, false)
  });
}

export function realMoneyGate(config = readRuntimeConfig()) {
  const blockers = [];
  if (!config.realMoneyEnabled) blockers.push("REAL_MONEY_ENABLED is false");
  if (config.appEnv !== "production") blockers.push("APP_ENV is not production");
  if (config.productionAuthorization !== "VERIFIED") blockers.push("operational authorization is not verified");
  if (!config.gamingAuthorizationVerified) blockers.push("gaming authorization is not verified");
  if (!config.paymentProviderApproved) blockers.push("payment-provider approval is not verified");
  if (!config.safeguardingVerified) blockers.push("customer-funds safeguarding is not verified");
  if (!config.securityReviewVerified) blockers.push("independent security review is not verified");
  return Object.freeze({ enabled: blockers.length === 0, blockers });
}

export function assertDemoOnly(config = readRuntimeConfig()) {
  if (realMoneyGate(config).enabled) throw new Error("Demo-only mode cannot run after the production activation gate is cleared.");
  return true;
}
