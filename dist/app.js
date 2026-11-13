const app = document.querySelector("#app");
const filters = { search: "", sport: "All sports" };
let state = null;
let offline = false;
let selectedChallengeId = null;
let selectedCreateEventId = null;
let selectedCreateMarket = null;
let toastTimer = null;

const marketCatalog = {
  Football: ["Match result", "Total goals", "Both teams to score", "Next goal"],
  Basketball: ["Match result", "Total points"],
  Tennis: ["Match result", "Total games"]
};

const iconPaths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z"/><path d="M8 21h8"/>',
  pulse: '<path d="M3 12h4l2-7 5 14 2-7h5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  receipt: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-4 2-4-2-3 2V4a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  shield: '<path d="M12 3 20 6v5c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
  user: '<circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m4.9 4.9 1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 3v2M12 19v2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 4.2 1.6c-1 1-1.9 1.4-1.9 2.9M12 17h.01"/>',
  arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  external: '<path d="M14 3h7v7M21 3l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="M10.3 4.6 2.7 18a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  chart: '<path d="M4 19V5M4 19h16"/><path d="m7 15 3-4 3 2 4-6"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M21 19V5a2 2 0 0 0-2-2h-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
};

function icon(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] ?? iconPaths.help}</svg>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatAmount(value) {
  return `${Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DEMO`;
}

function formatDate(value, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GH", {
    day: "numeric",
    month: "short",
    hour: withTime ? "numeric" : undefined,
    minute: withTime ? "2-digit" : undefined
  }).format(new Date(value));
}

function relativeTime(value) {
  const difference = new Date(value).getTime() - Date.now();
  const minutes = Math.round(Math.abs(difference) / 60000);
  if (minutes < 1) return "now";
  const unit = minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
  return difference >= 0 ? `in ${unit}` : `${unit} ago`;
}

function route() {
  return (location.hash.replace(/^#/, "") || "home").split("?")[0];
}

function eventFor(eventId) {
  return state.events.find((event) => event.id === eventId);
}

function challengeFor(challengeId) {
  return state.challenges.find((challenge) => challenge.id === challengeId);
}

function statusClass(status) {
  return String(status).toLowerCase().replaceAll("_", "-");
}

function statusLabel(status) {
  return String(status).replaceAll("_", " ");
}

function marketChoices(event, market) {
  if (!event || !market) return [];
  if (["Total goals", "Total points", "Total games"].includes(market)) {
    if (market === "Total points") return ["Over 215.5", "Under 215.5"];
    if (market === "Total games") return ["Over 22.5", "Under 22.5"];
    return ["Over 2.5", "Under 2.5"];
  }
  if (market === "Both teams to score") return ["Yes", "No"];
  return [event.home, event.away];
}

function makeFallbackState() {
  const now = Date.now();
  const events = [
    { id: "offline-1", sport: "Football", league: "Ghana Premier League", home: "Hearts of Oak", away: "Asante Kotoko", venue: "Accra Sports Stadium", kickoffAt: new Date(now + 7200000).toISOString(), status: "SCHEDULED" },
    { id: "offline-2", sport: "Football", league: "Premier League", home: "Arsenal", away: "Manchester City", venue: "Emirates Stadium", kickoffAt: new Date(now + 21600000).toISOString(), status: "SCHEDULED" },
    { id: "offline-3", sport: "Basketball", league: "NBA", home: "Boston Celtics", away: "Los Angeles Lakers", venue: "TD Garden", kickoffAt: new Date(now + 86400000).toISOString(), status: "SCHEDULED" }
  ];
  return {
    demoMode: true,
    realMoneyEnabled: false,
    settlementMode: "SYNTHETIC_ONLY",
    platform: { name: "PeerArena", market: "Ghana pilot · demonstration only", currency: "DEMO", defaultCommissionRate: 0, regulatedLaunchGate: "BLOCKED" },
    user: { id: "u_demo", username: "KwamePredicts", displayName: "Kwame Mensah", country: "Ghana", verificationStatus: "DEMO_VERIFIED", balance: 1250, stats: { wins: 7, losses: 5, pushes: 1, winRate: 58 }, responsible: { selfExcluded: false, sessionReminderMinutes: 30 } },
    events,
    challenges: [
      { id: "offline-ch-1", eventId: "offline-1", title: "Hearts of Oak vs Asante Kotoko", market: "Total goals", creatorId: "u_nana", creatorName: "NanaBall", creatorPrediction: "Over 2.5", challengerId: null, challengerName: null, challengerPrediction: "Under 2.5", stake: 50, grossPool: 0, visibility: "PUBLIC", status: "AWAITING_ACCEPTANCE", expiresAt: new Date(now + 4200000).toISOString() },
      { id: "offline-ch-2", eventId: "offline-2", title: "Arsenal vs Manchester City", market: "Match result", creatorId: "u_accra", creatorName: "AccraGunner", creatorPrediction: "Arsenal", challengerId: null, challengerName: null, challengerPrediction: "Manchester City", stake: 100, grossPool: 0, visibility: "PUBLIC", status: "AWAITING_ACCEPTANCE", expiresAt: new Date(now + 10800000).toISOString() }
    ],
    transactions: [],
    auditLog: []
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The demo service returned an error.");
  return payload;
}

function notify(message, type = "info") {
  const container = document.querySelector("#toast-container");
  if (!container) return;
  clearTimeout(toastTimer);
  container.innerHTML = `<div class="toast toast-${type}">${icon(type === "error" ? "alert" : "check")}<span>${escapeHtml(message)}</span></div>`;
  toastTimer = window.setTimeout(() => { container.innerHTML = ""; }, 4200);
}

async function mutate(path, body, successMessage) {
  if (offline) {
    notify("Start the demo server with npm start to enable this action.", "error");
    return null;
  }
  try {
    const result = await api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
    state = result.state ?? state;
    selectedChallengeId = null;
    render();
    if (successMessage) notify(successMessage, "success");
    return result;
  } catch (error) {
    notify(error.message, "error");
    return null;
  }
}

function navItem(id, label, iconName) {
  const active = route() === id ? "active" : "";
  return `<button class="nav-item ${active}" data-nav="${id}">${icon(iconName)}<span>${label}</span></button>`;
}

function renderShell(content) {
  const initial = state.user.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-lockup">
          <div class="brand-mark"><span></span><span></span><span></span></div>
          <div><div class="brand-name">PeerArena</div><div class="brand-caption">predict together</div></div>
        </div>
        <div class="sidebar-label">Workspace</div>
        <nav class="main-nav" aria-label="Primary navigation">
          ${navItem("home", "Overview", "home")}
          ${navItem("live", "Live events", "pulse")}
          ${navItem("marketplace", "Marketplace", "compass")}
          ${navItem("create", "Create challenge", "plus")}
          ${navItem("my-challenges", "My challenges", "layers")}
          ${navItem("transactions", "Transactions", "receipt")}
        </nav>
        <div class="sidebar-label support-label">Safety & support</div>
        <nav class="main-nav" aria-label="Safety navigation">
          ${navItem("responsible", "Responsible play", "shield")}
          ${navItem("help", "Help center", "help")}
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="side-safety-card">
          <div class="safety-icon">${icon("lock")}</div>
          <div><strong>Demo mode</strong><p>No deposits or withdrawals</p></div>
        </div>
        <button class="profile-mini" data-nav="account"><span class="avatar avatar-small">${initial}</span><span><strong>${escapeHtml(state.user.username)}</strong><small>Demo account</small></span>${icon("chevron")}</button>
      </aside>
      <div class="main-shell">
        <header class="topbar">
          <button class="mobile-menu" aria-label="Open menu">${icon("menu")}</button>
          <div class="crumbs"><span>Workspace</span><span class="crumb-divider">/</span><strong>${escapeHtml(routeLabel(route()))}</strong></div>
          <div class="topbar-actions">
            ${offline ? '<span class="connection-pill offline"><span></span>Offline preview</span>' : '<span class="connection-pill"><span></span>Demo service online</span>'}
            <button class="icon-button" data-nav="help" aria-label="Open help">${icon("help")}</button>
            <button class="profile-pill" data-nav="account"><span class="avatar">${initial}</span><span class="profile-pill-name">${escapeHtml(state.user.username)}</span>${icon("chevron")}</button>
          </div>
        </header>
        <nav class="mobile-nav-bar" aria-label="Compact navigation">
          ${navItem("home", "Overview", "home")}
          ${navItem("live", "Live", "pulse")}
          ${navItem("marketplace", "Marketplace", "compass")}
          ${navItem("create", "Create", "plus")}
          ${navItem("my-challenges", "My challenges", "layers")}
          ${navItem("transactions", "Ledger", "receipt")}
          ${navItem("responsible", "Safety", "shield")}
        </nav>
        <div class="demo-banner"><div class="banner-icon">${icon("shield")}</div><div><strong>DEMO ENVIRONMENT · SIMULATED FUNDS ONLY</strong><span>Balances, stakes and settlements have no monetary value. Real-money betting, payments and withdrawals are disabled.</span></div><button data-nav="responsible">Safety controls ${icon("arrow")}</button></div>
        <main class="page-content">${content}</main>
        <footer class="site-footer"><span>PeerArena demo · Ghana pilot concept</span><span>Build 0.1 · ${offline ? "offline preview" : "local service"}</span></footer>
      </div>
    </div>
    <div id="toast-container"></div>
    ${renderModal()}
  `;
}

function routeLabel(value) {
  return {
    home: "Overview",
    live: "Live events",
    marketplace: "Marketplace",
    create: "Create challenge",
    "my-challenges": "My challenges",
    transactions: "Transactions",
    responsible: "Responsible play",
    help: "Help center",
    account: "Account",
    admin: "Admin console"
  }[value] ?? "Overview";
}

function eyebrow(text) { return `<div class="eyebrow"><span class="eyebrow-dot"></span>${text}</div>`; }

function renderHome() {
  const active = state.challenges.filter((challenge) => ["ACTIVE", "FUNDS_CONFIRMED"].includes(challenge.status)).length;
  const open = state.challenges.filter((challenge) => challenge.status === "AWAITING_ACCEPTANCE").length;
  const settled = state.challenges.filter((challenge) => challenge.status === "SETTLED").length;
  const featuredEvents = state.events.slice(0, 3);
  return `
    <section class="hero-grid">
      <div class="hero-copy">
        ${eyebrow("Your prediction workspace")}
        <h1>Make the call.<br /><em>Own the moment.</em></h1>
        <p class="hero-lede">PeerArena brings people together around clear, verifiable outcomes. Create a challenge, take the other side, and let the rules do the work.</p>
        <div class="hero-actions"><button class="button button-primary" data-nav="marketplace">Explore marketplace ${icon("arrow")}</button><button class="button button-ghost" data-nav="create">Create a challenge ${icon("plus")}</button></div>
        <div class="hero-note">${icon("lock")} Practise with synthetic credits while the regulated product is being assessed.</div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div><div class="hero-orbit orbit-three"></div>
        <div class="hero-center"><div class="hero-center-mark"><span></span><span></span><span></span></div><small>peer to peer</small><strong>MAKE<br />YOUR<br />CALL</strong></div>
        <div class="floating-chip chip-top"><span class="chip-pulse"></span>Live feed <strong>synced</strong></div>
        <div class="floating-chip chip-bottom"><span class="chip-check">${icon("check")}</span><span><small>Last result</small><strong>+80 DEMO</strong></span></div>
      </div>
    </section>
    <section class="metric-grid">
      <div class="metric-card metric-balance"><div class="metric-label">Available demo credits ${icon("help")}</div><strong class="metric-value">${formatAmount(state.user.balance)}</strong><span class="metric-foot"><span class="metric-positive">+12.4%</span> since last week</span><div class="metric-spark spark-gold"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
      <div class="metric-card"><div class="metric-label">Active challenges</div><strong class="metric-value">${active.toString().padStart(2, "0")}</strong><span class="metric-foot">${open} open for you to join</span><div class="metric-icon metric-icon-blue">${icon("pulse")}</div></div>
      <div class="metric-card"><div class="metric-label">Your win rate</div><strong class="metric-value">${state.user.stats.winRate}%</strong><span class="metric-foot"><span class="metric-positive">+4.8%</span> vs last 30 days</span><div class="metric-icon metric-icon-green">${icon("chart")}</div></div>
      <div class="metric-card"><div class="metric-label">Settled challenges</div><strong class="metric-value">${settled.toString().padStart(2, "0")}</strong><span class="metric-foot">${state.user.stats.wins} wins · ${state.user.stats.losses} losses</span><div class="metric-icon metric-icon-purple">${icon("check")}</div></div>
    </section>
    <section class="content-grid two-one">
      <div class="panel panel-events"><div class="panel-heading"><div><div class="section-kicker">Worth a look</div><h2>Upcoming events</h2></div><button class="text-button" data-nav="live">View all ${icon("arrow")}</button></div><div class="event-list">${featuredEvents.map(renderEventRow).join("")}</div></div>
      <div class="panel panel-activity"><div class="panel-heading"><div><div class="section-kicker">Your activity</div><h2>Recent pulse</h2></div><button class="text-button" data-nav="transactions">Ledger ${icon("arrow")}</button></div>${renderActivity()}</div>
    </section>
    <section class="insight-strip"><div class="insight-symbol">${icon("shield")}</div><div><strong>Trust is a product feature.</strong><span>Every demo challenge locks its terms before matching, and every result produces an auditable settlement reference.</span></div><button class="button button-small button-dark" data-nav="admin">See the audit trail ${icon("arrow")}</button></section>
  `;
}

function renderActivity() {
  const items = state.transactions.slice(0, 4);
  if (!items.length) return '<div class="empty-state compact"><div class="empty-icon">' + icon("receipt") + '</div><strong>No activity yet</strong><span>Your demo ledger will appear here.</span></div>';
  return `<div class="activity-list">${items.map((item) => `<div class="activity-item"><div class="activity-icon ${item.amount >= 0 ? "positive" : "negative"}">${icon(item.amount >= 0 ? "arrow" : "layers")}</div><div class="activity-copy"><strong>${escapeHtml(item.description)}</strong><span>${formatDate(item.createdAt)} · ${escapeHtml(item.type.replaceAll("_", " "))}</span></div><strong class="activity-amount ${item.amount >= 0 ? "positive-text" : "negative-text"}">${item.amount >= 0 ? "+" : ""}${formatAmount(item.amount)}</strong></div>`).join("")}</div>`;
}

function renderEventRow(event) {
  const open = state.challenges.filter((challenge) => challenge.eventId === event.id && challenge.status === "AWAITING_ACCEPTANCE").length;
  return `<button class="event-row" data-nav="marketplace"><div class="sport-token ${event.sport.toLowerCase()}">${event.sport === "Football" ? "F" : event.sport === "Basketball" ? "B" : "T"}</div><div class="event-row-main"><div class="event-row-title"><strong>${escapeHtml(event.home)}</strong><span>vs</span><strong>${escapeHtml(event.away)}</strong></div><span>${escapeHtml(event.league)} · ${formatDate(event.kickoffAt)}</span></div><div class="event-row-open"><strong>${open}</strong><span>open</span></div>${icon("chevron")}</button>`;
}

function renderLive() {
  return `<div class="page-heading"><div>${eyebrow("Objective event feed")}<h1>Live events</h1><p>Browse synthetic events and the markets that are currently open for demo challenges.</p></div><div class="heading-actions"><span class="feed-status"><span></span> Feed healthy</span><button class="button button-primary" data-nav="create">Create challenge ${icon("plus")}</button></div></div><div class="filter-bar"><div class="filter-tabs"><button class="filter-tab active">All events</button><button class="filter-tab">Football</button><button class="filter-tab">Basketball</button><button class="filter-tab">Tennis</button></div><span class="filter-note">${state.events.length} synthetic fixtures · no live-money markets</span></div><div class="event-grid">${state.events.map(renderEventCard).join("")}</div>`;
}

function renderEventCard(event) {
  const challenges = state.challenges.filter((challenge) => challenge.eventId === event.id && challenge.status === "AWAITING_ACCEPTANCE");
  return `<article class="event-card"><div class="event-card-top"><span class="sport-label"><span class="sport-dot ${event.sport.toLowerCase()}"></span>${escapeHtml(event.sport)}</span><span class="event-time">${relativeTime(event.kickoffAt)}</span></div><div class="league-label">${escapeHtml(event.league)}</div><div class="matchup"><div><strong>${escapeHtml(event.home)}</strong><small>Home</small></div><span class="versus">VS</span><div class="align-right"><strong>${escapeHtml(event.away)}</strong><small>Away</small></div></div><div class="event-card-bottom"><span>${challenges.length} open challenge${challenges.length === 1 ? "" : "s"}</span><button class="inline-link" data-nav="marketplace">View markets ${icon("arrow")}</button></div></article>`;
}

function renderMarketplace() {
  const open = state.challenges.filter((challenge) => challenge.status === "AWAITING_ACCEPTANCE");
  const filtered = open.filter((challenge) => {
    const event = eventFor(challenge.eventId);
    const text = `${challenge.title} ${challenge.market} ${challenge.creatorName}`.toLowerCase();
    const matchesSearch = !filters.search || text.includes(filters.search.toLowerCase());
    const matchesSport = filters.sport === "All sports" || event?.sport === filters.sport;
    return matchesSearch && matchesSport;
  });
  return `<div class="page-heading"><div>${eyebrow("Take the other side")}<h1>Challenge marketplace</h1><p>Open, binary demo challenges with locked terms and clear settlement rules.</p></div><div class="heading-actions"><div class="pool-stat"><span>Open challenges</span><strong>${open.length.toString().padStart(2, "0")}</strong></div><button class="button button-primary" data-nav="create">Create challenge ${icon("plus")}</button></div></div><div class="market-tools"><label class="search-box">${icon("compass")}<input id="market-search" type="search" placeholder="Search event, market or creator" value="${escapeHtml(filters.search)}" /></label><label class="select-box"><span>Sport</span><select id="sport-filter"><option>All sports</option><option ${filters.sport === "Football" ? "selected" : ""}>Football</option><option ${filters.sport === "Basketball" ? "selected" : ""}>Basketball</option><option ${filters.sport === "Tennis" ? "selected" : ""}>Tennis</option></select></label><span class="market-disclosure">${icon("lock")} Demo stakes · 0% fees</span></div>${filtered.length ? `<div class="challenge-grid">${filtered.map((challenge) => renderChallengeCard(challenge, true)).join("")}</div>` : '<div class="empty-state large"><div class="empty-icon">' + icon("compass") + '</div><strong>No matching challenges</strong><span>Try another filter or create the first challenge for an event.</span><button class="button button-primary" data-nav="create">Create challenge</button></div>'}`;
}

function renderChallengeCard(challenge, showAccept = false) {
  const event = eventFor(challenge.eventId);
  const pool = challenge.grossPool || challenge.stake * 2;
  const own = challenge.creatorId === state.user.id;
  return `<article class="challenge-card ${own ? "own-card" : ""}"><div class="challenge-card-top"><span class="status-pill status-${statusClass(challenge.status)}"><span></span>${escapeHtml(statusLabel(challenge.status))}</span><span class="challenge-visibility">${challenge.visibility === "PRIVATE" ? icon("lock") : "Public"}</span></div><button class="challenge-card-main" data-open-challenge="${challenge.id}"><div class="challenge-event"><span class="mini-sport ${event?.sport.toLowerCase()}">${event?.sport === "Basketball" ? "B" : event?.sport === "Tennis" ? "T" : "F"}</span><span>${escapeHtml(challenge.title)}</span></div><div class="challenge-market"><span>${escapeHtml(challenge.market)}</span><strong>${escapeHtml(challenge.creatorPrediction)}</strong><span class="side-arrow">${icon("arrow")}</span><strong class="opponent-prediction">${escapeHtml(challenge.challengerPrediction)}</strong></div><div class="challenge-meta"><span>Created by <strong>${escapeHtml(challenge.creatorName)}</strong></span><span>Closes ${relativeTime(challenge.expiresAt)}</span></div></button><div class="challenge-card-bottom"><div><small>Each side</small><strong>${formatAmount(challenge.stake)}</strong></div><div><small>Pool if matched</small><strong>${formatAmount(pool)}</strong></div>${showAccept && !own ? `<button class="button button-small button-primary" data-accept="${challenge.id}">Take side ${icon("arrow")}</button>` : `<button class="button button-small button-quiet" data-open-challenge="${challenge.id}">Details ${icon("chevron")}</button>`}</div></article>`;
}

function renderCreate() {
  const event = eventFor(selectedCreateEventId) ?? state.events[0];
  const markets = marketCatalog[event.sport] ?? ["Match result"];
  const market = markets.includes(selectedCreateMarket) ? selectedCreateMarket : markets[0];
  const predictions = marketChoices(event, market);
  selectedCreateEventId = event.id;
  selectedCreateMarket = market;
  return `<div class="page-heading create-heading"><div>${eyebrow("Lock the terms first")}<h1>Create a challenge</h1><p>Set one clear binary question. Your synthetic stake is reserved when you publish.</p></div><div class="create-gate"><div class="gate-icon">${icon("lock")}</div><div><strong>Demo gate active</strong><span>Real-money entry is not available.</span></div></div></div><div class="create-layout"><form class="panel create-form" id="create-form"><div class="form-section"><div class="form-section-title"><span class="form-number">01</span><div><strong>Choose the event</strong><span>Only synthetic fixtures are available in this build.</span></div></div><label class="field-label" for="create-event">Event</label><select class="field-control" id="create-event" name="eventId">${state.events.map((item) => `<option value="${item.id}" ${item.id === event.id ? "selected" : ""}>${escapeHtml(item.home)} vs ${escapeHtml(item.away)} · ${escapeHtml(item.league)}</option>`).join("")}</select></div><div class="form-section"><div class="form-section-title"><span class="form-number">02</span><div><strong>Write the question</strong><span>Binary markets keep the first release easy to verify.</span></div></div><div class="field-grid"><div><label class="field-label" for="create-market">Market</label><select class="field-control" id="create-market" name="market">${markets.map((item) => `<option ${item === market ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></div><div><label class="field-label" for="create-prediction">Your side</label><select class="field-control" id="create-prediction" name="prediction">${predictions.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select></div></div></div><div class="form-section"><div class="form-section-title"><span class="form-number">03</span><div><strong>Set your stake</strong><span>Your stake is reserved from the demo balance.</span></div></div><div class="stake-input-wrap"><span class="currency-prefix">DEMO</span><input class="stake-input" id="create-stake" name="stake" type="number" min="1" max="1000" step="0.01" value="25" required /><span class="stake-hint">Max 1,000</span></div><div class="quick-stakes"><button type="button" data-stake="10">10</button><button type="button" data-stake="25">25</button><button type="button" data-stake="50">50</button><button type="button" data-stake="100">100</button></div></div><div class="form-section last-section"><div class="form-section-title"><span class="form-number">04</span><div><strong>Choose visibility</strong><span>Private links still follow all eligibility rules in a regulated product.</span></div></div><div class="visibility-options"><label class="radio-card selected"><input type="radio" name="visibility" value="PUBLIC" checked /><span>${icon("compass")}</span><strong>Public</strong><small>Show in marketplace</small></label><label class="radio-card"><input type="radio" name="visibility" value="PRIVATE" /><span>${icon("lock")}</span><strong>Private</strong><small>Invite by link</small></label></div></div><div class="form-actions"><button class="button button-primary" type="submit">Publish demo challenge ${icon("arrow")}</button><button class="button button-ghost" type="button" data-nav="marketplace">Cancel</button></div></form><aside class="create-summary"><div class="summary-head"><span>Challenge preview</span><span class="status-pill status-created"><span></span>Draft</span></div><div class="preview-match"><div class="preview-league">${escapeHtml(event.league)}</div><h3>${escapeHtml(event.home)} <span>vs</span> ${escapeHtml(event.away)}</h3><p>${formatDate(event.kickoffAt)} · ${escapeHtml(event.venue)}</p></div><div class="preview-question"><span>${escapeHtml(market)}</span><div><strong>${escapeHtml(predictions[0])}</strong><span>vs</span><strong>${escapeHtml(predictions[1])}</strong></div></div><div class="summary-rows"><div><span>Your stake</span><strong id="preview-stake">25.00 DEMO</strong></div><div><span>Access fee</span><strong>0.00 DEMO</strong></div><div><span>Winning commission</span><strong>0.00 DEMO</strong></div><div class="summary-total"><span>Pool if matched</span><strong id="preview-pool">50.00 DEMO</strong></div></div><div class="summary-disclosure">${icon("shield")} Fees are shown before confirmation. This demonstration uses no money, custody, or external payment rail.</div></aside></div>`;
}

function renderMyChallenges() {
  const mine = state.challenges.filter((challenge) => challenge.creatorId === state.user.id || challenge.challengerId === state.user.id);
  const active = mine.filter((challenge) => !["SETTLED", "VOIDED", "CLOSED"].includes(challenge.status));
  return `<div class="page-heading"><div>${eyebrow("Your calls, in one place")}<h1>My challenges</h1><p>Track every open, matched and settled demo challenge.</p></div><div class="heading-actions"><div class="mini-summary"><span>Active</span><strong>${active.length.toString().padStart(2, "0")}</strong></div><div class="mini-summary"><span>Wins</span><strong>${state.user.stats.wins}</strong></div><button class="button button-primary" data-nav="create">New challenge ${icon("plus")}</button></div></div><div class="tabs-row"><button class="filter-tab active">All <span>${mine.length}</span></button><button class="filter-tab">Active <span>${active.length}</span></button><button class="filter-tab">Settled <span>${mine.filter((challenge) => challenge.status === "SETTLED").length}</span></button></div>${mine.length ? `<div class="challenge-list">${mine.map((challenge) => renderMyChallengeRow(challenge)).join("")}</div>` : '<div class="empty-state large"><div class="empty-icon">' + icon("layers") + '</div><strong>Your challenge history is empty</strong><span>Create a demo challenge to start building your record.</span><button class="button button-primary" data-nav="create">Create challenge</button></div>'}`;
}

function renderMyChallengeRow(challenge) {
  const event = eventFor(challenge.eventId);
  const isWinner = challenge.settlement?.winnerId === state.user.id;
  return `<article class="my-row"><div class="my-row-sport sport-token ${event?.sport.toLowerCase()}">${event?.sport === "Basketball" ? "B" : event?.sport === "Tennis" ? "T" : "F"}</div><div class="my-row-main"><div class="my-row-title"><strong>${escapeHtml(challenge.title)}</strong><span class="status-pill status-${statusClass(challenge.status)}"><span></span>${escapeHtml(statusLabel(challenge.status))}</span></div><span>${escapeHtml(challenge.market)} · ${escapeHtml(challenge.creatorId === state.user.id ? challenge.creatorPrediction : challenge.challengerPrediction)} · ${formatDate(challenge.createdAt)}</span></div><div class="my-row-value"><small>${challenge.status === "SETTLED" ? (isWinner ? "Payout" : "Stake") : "Pool"}</small><strong class="${isWinner ? "positive-text" : ""}">${formatAmount(challenge.status === "SETTLED" ? (isWinner ? challenge.settlement.payout : challenge.stake) : (challenge.grossPool || challenge.stake * 2))}</strong></div><button class="icon-button" data-open-challenge="${challenge.id}" aria-label="View challenge">${icon("chevron")}</button></article>`;
}

function renderTransactions() {
  return `<div class="page-heading"><div>${eyebrow("Transparent by default")}<h1>Demo ledger</h1><p>A read-only view of synthetic credits, reservations and settlement references.</p></div><div class="ledger-balance"><span>Available balance</span><strong>${formatAmount(state.user.balance)}</strong></div></div><div class="ledger-callout"><div>${icon("receipt")}</div><div><strong>This is not a wallet.</strong><span>Demo credits cannot be purchased, transferred, withdrawn, or exchanged for anything of value.</span></div><span class="status-pill status-active"><span></span> Ledger healthy</span></div><div class="panel table-panel"><div class="panel-heading"><div><div class="section-kicker">Double-entry boundary</div><h2>Recent entries</h2></div><span class="table-count">${state.transactions.length} entries</span></div><div class="table-wrap"><table><thead><tr><th>Entry</th><th>Type</th><th>Reference</th><th>Status</th><th class="align-right">Amount</th></tr></thead><tbody>${state.transactions.map((transaction) => `<tr><td><div class="table-primary"><span class="table-icon ${transaction.amount >= 0 ? "positive" : "negative"}">${icon(transaction.amount >= 0 ? "arrow" : "layers")}</span><span><strong>${escapeHtml(transaction.description)}</strong><small>${formatDate(transaction.createdAt)}</small></span></div></td><td><span class="type-label">${escapeHtml(transaction.type.replaceAll("_", " "))}</span></td><td><code>${escapeHtml(transaction.metadata?.reference ?? transaction.metadata?.challengeId ?? "DEMO")}</code></td><td><span class="status-dot-label"><span></span>${escapeHtml(transaction.status)}</span></td><td class="align-right"><strong class="${transaction.amount >= 0 ? "positive-text" : "negative-text"}">${transaction.amount >= 0 ? "+" : ""}${formatAmount(transaction.amount)}</strong></td></tr>`).join("")}</tbody></table></div></div>`;
}

function renderResponsible() {
  const excluded = state.user.responsible.selfExcluded;
  return `<div class="page-heading safety-heading"><div>${eyebrow("Stay in control")}<h1>Responsible play</h1><p>Safety tools are part of the product, not a hidden setting. In a regulated launch, these controls would apply before any stake can be accepted.</p></div><div class="safety-badge">${icon("shield")} Always available</div></div><div class="safety-grid"><section class="panel self-exclusion-card ${excluded ? "enabled" : ""}"><div class="safety-card-icon">${icon("lock")}</div><div class="safety-card-copy"><div class="section-kicker">Immediate control</div><h2>${excluded ? "Self-exclusion is on" : "Self-exclusion"}</h2><p>${excluded ? "New challenge actions are blocked for this demo account. You can leave the setting on while reviewing your history." : "Take a break from creating or accepting challenges. In production, self-exclusion would be permanent or time-bound according to the published policy."}</p><button class="button ${excluded ? "button-dark" : "button-primary"}" data-self-exclusion="${excluded ? "false" : "true"}">${excluded ? "Turn off for demo" : "Enable self-exclusion"}</button></div><span class="toggle-visual ${excluded ? "on" : ""}"><span></span></span></section><section class="panel safety-options"><div class="panel-heading"><div><div class="section-kicker">Guardrails</div><h2>Your controls</h2></div>${icon("settings")}</div><div class="safety-option"><div class="option-icon">${icon("clock")}</div><div><strong>Session reminders</strong><span>See a reminder every ${state.user.responsible.sessionReminderMinutes ?? 30} minutes.</span></div><button class="button button-small button-quiet">${state.user.responsible.sessionReminderMinutes ?? 30} min</button></div><div class="safety-option disabled-option"><div class="option-icon">${icon("layers")}</div><div><strong>Deposit & loss limits</strong><span>Unavailable while only synthetic funds are enabled.</span></div><span class="locked-label">Locked</span></div><div class="safety-option"><div class="option-icon">${icon("help")}</div><div><strong>Need support?</strong><span>Review the help center and escalation path.</span></div><button class="button button-small button-quiet" data-nav="help">Open help ${icon("arrow")}</button></div></section></div><section class="responsible-principles"><div class="section-kicker">Our principles</div><div class="principle-grid"><div><span>01</span><strong>No guaranteed income claims</strong><p>Predictions are uncertain. We never frame participation as an earning strategy.</p></div><div><span>02</span><strong>No pressure loops</strong><p>Notifications and recommendations must not push users to chase losses or raise stakes.</p></div><div><span>03</span><strong>Protection before growth</strong><p>Eligibility, limits, self-exclusion and complaints handling come before monetization.</p></div></div></section>`;
}

function renderAccount() {
  const initials = state.user.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return `<div class="page-heading"><div>${eyebrow("Your identity layer")}<h1>Account</h1><p>Demo profile details and security posture. Production identity verification is intentionally not connected.</p></div><span class="status-pill status-active"><span></span> Demo verified</span></div><div class="account-grid"><section class="panel account-profile"><div class="account-hero"><span class="avatar avatar-large">${initials}</span><div><h2>${escapeHtml(state.user.displayName)}</h2><span>@${escapeHtml(state.user.username)} · ${escapeHtml(state.user.country)}</span></div><button class="button button-small button-quiet">Edit profile</button></div><div class="account-fields"><div><span>Public profile</span><strong>@${escapeHtml(state.user.username)}</strong></div><div><span>Verification status</span><strong class="positive-text">${escapeHtml(state.user.verificationStatus)}</strong></div><div><span>Participation region</span><strong>${escapeHtml(state.user.country)} · demo</strong></div><div><span>Account created</span><strong>13 Nov 2026</strong></div></div></section><section class="panel security-panel"><div class="panel-heading"><div><div class="section-kicker">Protection</div><h2>Security posture</h2></div>${icon("shield")}</div><div class="security-item"><span class="security-ok">${icon("check")}</span><div><strong>Password authentication</strong><span>Demo session only</span></div><span class="security-status">Active</span></div><div class="security-item"><span class="security-ok">${icon("check")}</span><div><strong>Two-factor authentication</strong><span>Required for sensitive actions in production</span></div><span class="security-status">Design ready</span></div><div class="security-item"><span class="security-warn">${icon("alert")}</span><div><strong>Identity verification</strong><span>External KYC provider not connected</span></div><span class="security-status warning">Pending</span></div></section></div><section class="panel account-stats"><div class="panel-heading"><div><div class="section-kicker">Track record</div><h2>Your prediction history</h2></div><button class="text-button" data-nav="my-challenges">View challenges ${icon("arrow")}</button></div><div class="account-stat-grid"><div><span>Wins</span><strong>${state.user.stats.wins}</strong></div><div><span>Losses</span><strong>${state.user.stats.losses}</strong></div><div><span>Pushes / voids</span><strong>${state.user.stats.pushes}</strong></div><div><span>Win rate</span><strong>${state.user.stats.winRate}%</strong></div></div></section>`;
}

function renderHelp() {
  return `<div class="page-heading"><div>${eyebrow("Clear answers, close at hand")}<h1>Help center</h1><p>Understand the demo, challenge lifecycle, settlement rules and the boundaries of the regulated product.</p></div><div class="help-contact"><span>Need a human?</span><strong>support@peerarena.demo</strong></div></div><div class="help-grid"><section class="panel faq-panel"><div class="panel-heading"><div><div class="section-kicker">Frequently asked</div><h2>How the demo works</h2></div>${icon("help")}</div><details open><summary>What can I do in this environment?</summary><p>You can browse synthetic fixtures, create binary challenges, match an open challenge, inspect the ledger, and resolve a matched challenge from the admin console. Every balance is fictional.</p></details><details><summary>Can I deposit or withdraw?</summary><p>No. There is no payment provider, wallet, custody account, or redemption path. The app intentionally blocks those flows until licensing, payment approvals, safeguarding and technical certification are independently confirmed.</p></details><details><summary>How is a challenge settled?</summary><p>A matched challenge moves through a verification step. The demo operator selects creator wins, challenger wins, or void. The engine then posts one auditable payout or refunds both reserved stakes. Settlement is idempotent.</p></details><details><summary>What happens when the feed is unavailable?</summary><p>Production policy should suspend affected markets, preserve the audit trail, and use the published discrepancy and dispute process. The demo uses a synthetic feed and shows the boundary in the admin console.</p></details></section><section class="panel glossary-panel"><div class="panel-heading"><div><div class="section-kicker">Glossary</div><h2>Product language</h2></div></div><div class="glossary-item"><strong>Locked terms</strong><span>Event, market, prediction, stake and expiry are immutable after acceptance.</span></div><div class="glossary-item"><strong>Gross pool</strong><span>The two matched synthetic stakes before any approved deductions.</span></div><div class="glossary-item"><strong>Void</strong><span>A market with no valid winner; reserved stakes are returned according to the published rules.</span></div><div class="glossary-item"><strong>Audit reference</strong><span>A stable settlement identifier used to trace the decision and ledger entry.</span></div><div class="help-link-box"><span>${icon("external")}</span><div><strong>Read the safety documentation</strong><small>The repository includes the requirements, security, risk and legal review drafts.</small></div></div></section></div>`;
}

function renderAdmin() {
  const overview = getLocalOverview();
  const matched = state.challenges.filter((challenge) => challenge.challengerId && ["ACTIVE", "FUNDS_CONFIRMED", "SUSPENDED"].includes(challenge.status));
  return `<div class="page-heading"><div>${eyebrow("Operator control room")}<h1>Admin console</h1><p>Demo-only controls for feed health, challenge operations, responsible play and settlement review.</p></div><div class="heading-actions"><span class="admin-role">${icon("shield")} Operations reviewer</span><button class="button button-small button-quiet" data-reset-demo>Reset demo</button></div></div><div class="admin-warning"><div>${icon("alert")}</div><div><strong>Production gate: blocked</strong><span>Licence, payments, identity, data licensing, safeguarding, security review and legal enforceability are not confirmed. This console cannot activate real-money mode.</span></div></div><section class="admin-metric-grid"><div class="admin-metric"><span>Users</span><strong>${overview.totalUsers}</strong><small>${overview.verifiedUsers} demo verified</small></div><div class="admin-metric"><span>Challenges</span><strong>${overview.totalChallenges}</strong><small>${overview.activeChallenges} active or open</small></div><div class="admin-metric"><span>Synthetic volume</span><strong>${formatAmount(overview.syntheticVolume)}</strong><small>Not customer money</small></div><div class="admin-metric"><span>Platform fees</span><strong>${formatAmount(overview.platformFees)}</strong><small>Fees disabled in demo</small></div></section><div class="admin-grid"><section class="panel operations-panel"><div class="panel-heading"><div><div class="section-kicker">Settlement queue</div><h2>Review matched challenges</h2></div><span class="table-count">${matched.length} awaiting action</span></div>${matched.length ? matched.map((challenge) => `<div class="queue-row"><div class="queue-status"><span class="status-pulse"></span></div><div class="queue-main"><strong>${escapeHtml(challenge.title)}</strong><span>${escapeHtml(challenge.market)} · ${escapeHtml(challenge.creatorName)} vs ${escapeHtml(challenge.challengerName)} · pool ${formatAmount(challenge.grossPool)}</span></div><div class="queue-actions"><button class="button button-small button-quiet" data-settle-id="${challenge.id}" data-outcome="CREATOR_WINS">Creator wins</button><button class="button button-small button-primary" data-settle-id="${challenge.id}" data-outcome="CHALLENGER_WINS">Challenger wins</button><button class="icon-button" data-settle-id="${challenge.id}" data-outcome="VOID" aria-label="Void challenge">${icon("alert")}</button></div></div>`).join("") : '<div class="empty-state compact"><div class="empty-icon">' + icon("check") + '</div><strong>Queue is clear</strong><span>Matched challenges will appear here for a demo operator to resolve.</span></div>'}</section><section class="panel health-panel"><div class="panel-heading"><div><div class="section-kicker">System health</div><h2>Launch gates</h2></div><span class="status-pill status-active"><span></span> Nominal</span></div><div class="health-row"><span class="health-check">${icon("check")}</span><div><strong>Settlement engine</strong><small>Binary matching · idempotent demo flow</small></div><span>Ready</span></div><div class="health-row"><span class="health-check">${icon("check")}</span><div><strong>Audit trail</strong><small>Challenge and operator actions recorded</small></div><span>Ready</span></div><div class="health-row"><span class="health-warn">${icon("alert")}</span><div><strong>Sports data</strong><small>Synthetic feed only</small></div><span class="warning">Blocked</span></div><div class="health-row"><span class="health-warn">${icon("alert")}</span><div><strong>Payments & custody</strong><small>No provider or customer funds connected</small></div><span class="warning">Blocked</span></div><div class="health-row"><span class="health-warn">${icon("alert")}</span><div><strong>Licensing & legal</strong><small>Requires specialist confirmation</small></div><span class="warning">Blocked</span></div></section></div><section class="panel audit-panel"><div class="panel-heading"><div><div class="section-kicker">Immutable-style log</div><h2>Recent audit activity</h2></div><span class="table-count">${state.auditLog.length} events</span></div><div class="audit-list">${state.auditLog.slice(0, 8).map((entry) => `<div class="audit-row"><span class="audit-dot"></span><div><strong>${escapeHtml(entry.action.replaceAll("_", " "))}</strong><span>${escapeHtml(entry.details?.challengeId ?? entry.details?.scope ?? "System event")} · ${formatDate(entry.timestamp)}</span></div><code>${escapeHtml(entry.id)}</code></div>`).join("")}</div></section>`;
}

function getLocalOverview() {
  const activeChallenges = state.challenges.filter((challenge) => ["ACTIVE", "FUNDS_CONFIRMED", "AWAITING_ACCEPTANCE"].includes(challenge.status)).length;
  return { totalUsers: 4, verifiedUsers: 3, totalChallenges: state.challenges.length, activeChallenges, syntheticVolume: state.challenges.reduce((sum, challenge) => sum + (challenge.grossPool || 0), 0), platformFees: 0 };
}

function renderModal() {
  const challenge = selectedChallengeId ? challengeFor(selectedChallengeId) : null;
  if (!challenge) return "";
  const event = eventFor(challenge.eventId);
  const canAccept = challenge.status === "AWAITING_ACCEPTANCE" && challenge.creatorId !== state.user.id;
  const inviteUrl = `${location.origin}${location.pathname}#marketplace?challenge=${encodeURIComponent(challenge.id)}`;
  return `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-close-modal aria-label="Close">×</button><div class="modal-kicker">${escapeHtml(challenge.market)} · ${escapeHtml(statusLabel(challenge.status))}</div><h2 id="modal-title">${escapeHtml(challenge.title)}</h2><p class="modal-subtitle">${escapeHtml(event?.league ?? "Synthetic event")} · ${formatDate(event?.kickoffAt)} · terms are locked on acceptance.</p><div class="modal-sides"><div><span>${escapeHtml(challenge.creatorName)}</span><strong>${escapeHtml(challenge.creatorPrediction)}</strong></div><span class="modal-vs">VS</span><div class="modal-side-right"><span>${challenge.challengerName ? escapeHtml(challenge.challengerName) : "Open challenger"}</span><strong>${escapeHtml(challenge.challengerPrediction)}</strong></div></div><div class="modal-detail-grid"><div><span>Each side</span><strong>${formatAmount(challenge.stake)}</strong></div><div><span>Pool if matched</span><strong>${formatAmount(challenge.grossPool || challenge.stake * 2)}</strong></div><div><span>Access fee</span><strong>0.00 DEMO</strong></div><div><span>Closes</span><strong>${relativeTime(challenge.expiresAt)}</strong></div></div><div class="modal-disclosure">${icon("shield")} No real money, payment, withdrawal or redeemable value is connected to this challenge.</div><div class="modal-actions">${canAccept ? `<button class="button button-primary" data-accept="${challenge.id}">Take ${escapeHtml(challenge.challengerPrediction)} ${icon("arrow")}</button>` : ""}${challenge.visibility === "PRIVATE" && challenge.creatorId === state.user.id ? `<button class="button button-ghost" data-copy-invite="${escapeHtml(inviteUrl)}">${icon("copy")} Copy invite link</button>` : ""}<button class="button button-ghost" data-close-modal>Close</button></div></section></div>`;
}

function render() {
  let content = renderHome();
  if (route() === "live") content = renderLive();
  if (route() === "marketplace") content = renderMarketplace();
  if (route() === "create") content = renderCreate();
  if (route() === "my-challenges") content = renderMyChallenges();
  if (route() === "transactions") content = renderTransactions();
  if (route() === "responsible") content = renderResponsible();
  if (route() === "account") content = renderAccount();
  if (route() === "help") content = renderHelp();
  if (route() === "admin") content = renderAdmin();
  app.innerHTML = renderShell(content);
}

function refreshMarketplaceFilter() {
  const query = filters.search.toLowerCase();
  document.querySelectorAll("[data-market-card]").forEach((card) => {
    card.hidden = Boolean(query && !card.dataset.marketCard.includes(query));
  });
}

app.addEventListener("click", async (event) => {
  const menu = event.target.closest(".mobile-menu");
  if (menu) {
    document.querySelector(".app-shell")?.classList.toggle("menu-open");
    return;
  }
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    event.preventDefault();
    location.hash = nav.dataset.nav;
    return;
  }
  const open = event.target.closest("[data-open-challenge]");
  if (open) {
    selectedChallengeId = open.dataset.openChallenge;
    render();
    return;
  }
  const close = event.target.closest("[data-close-modal]");
  if (close) {
    selectedChallengeId = null;
    render();
    return;
  }
  const accept = event.target.closest("[data-accept]");
  if (accept) {
    event.preventDefault();
    await mutate(`/api/challenges/${encodeURIComponent(accept.dataset.accept)}/accept`, {}, "Challenge accepted. Your synthetic stake is reserved.");
    return;
  }
  const settle = event.target.closest("[data-settle-id]");
  if (settle) {
    event.preventDefault();
    await mutate(`/api/challenges/${encodeURIComponent(settle.dataset.settleId)}/settle`, { outcome: settle.dataset.outcome }, "Settlement recorded in the demo audit trail.");
    return;
  }
  const selfExclusion = event.target.closest("[data-self-exclusion]");
  if (selfExclusion) {
    await mutate("/api/responsible/self-exclusion", { enabled: selfExclusion.dataset.selfExclusion === "true" }, selfExclusion.dataset.selfExclusion === "true" ? "Self-exclusion enabled. New challenge actions are now blocked." : "Self-exclusion disabled for this demo account.");
    return;
  }
  const reset = event.target.closest("[data-reset-demo]");
  if (reset) {
    await mutate("/api/admin/reset", {}, "Demo state reset.");
    return;
  }
  const stake = event.target.closest("[data-stake]");
  if (stake) {
    const input = document.querySelector("#create-stake");
    if (input) input.value = stake.dataset.stake;
    const preview = document.querySelector("#preview-stake");
    const pool = document.querySelector("#preview-pool");
    if (preview) preview.textContent = formatAmount(stake.dataset.stake);
    if (pool) pool.textContent = formatAmount(Number(stake.dataset.stake) * 2);
    return;
  }
  const copy = event.target.closest("[data-copy-invite]");
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copyInvite); notify("Private invite link copied.", "success"); } catch { notify("Copy is unavailable in this browser.", "error"); }
    return;
  }
});

app.addEventListener("submit", async (event) => {
  if (event.target.id !== "create-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  const result = await mutate("/api/challenges", {
    eventId: form.get("eventId"),
    market: form.get("market"),
    prediction: form.get("prediction"),
    stake: form.get("stake"),
    visibility: form.get("visibility"),
    expiryHours: 24
  }, "Challenge published. Your demo stake is reserved.");
  if (result) location.hash = "my-challenges";
});

app.addEventListener("change", (event) => {
  if (event.target.id === "create-event") {
    selectedCreateEventId = event.target.value;
    selectedCreateMarket = null;
    render();
    return;
  }
  if (event.target.id === "create-market") {
    selectedCreateMarket = event.target.value;
    render();
    return;
  }
  if (event.target.id === "sport-filter") {
    filters.sport = event.target.value;
    render();
  }
});

app.addEventListener("input", (event) => {
  if (event.target.id === "market-search") {
    filters.search = event.target.value;
    const cards = document.querySelectorAll(".challenge-card");
    const query = filters.search.toLowerCase();
    cards.forEach((card) => { card.hidden = query && !card.textContent.toLowerCase().includes(query); });
  }
  if (event.target.id === "create-stake") {
    const value = Number(event.target.value || 0);
    const preview = document.querySelector("#preview-stake");
    const pool = document.querySelector("#preview-pool");
    if (preview) preview.textContent = formatAmount(value);
    if (pool) pool.textContent = formatAmount(value * 2);
  }
});

window.addEventListener("hashchange", () => { selectedChallengeId = null; render(); });

async function start() {
  try {
    state = await api("/api/state");
  } catch {
    offline = true;
    state = makeFallbackState();
  }
  render();
}

start();
