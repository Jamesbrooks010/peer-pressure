const STORAGE_KEY = "peerPressurePrototype";
const USER_KEY = "peerPressureCurrentUser";
const FOLLOW_KEY = "peerPressureFollowedMarkets";
const INVITE_KEY = "peerPressureInviteCodes";
const HIDDEN_PLATFORM_FEE = 2;

const defaultMarkets = [
  {
    id: crypto.randomUUID(),
    question: "Will Sam call us today?",
    deadline: "2026-04-25T23:59",
    cutoff: "2026-04-25T20:00",
    umpire: "Alex",
    minStake: 5,
    platformFee: HIDDEN_PLATFORM_FEE,
    oddsRake: 3,
    visibility: "PUBLIC",
    inviteCode: "",
    terms: "Counts only if the call is received before midnight. Missed calls count. Texts do not.",
    status: "OPEN",
    outcome: "",
    entries: [
      { id: crypto.randomUUID(), person: "You", side: "YES", amount: 10 },
      { id: crypto.randomUUID(), person: "Jordan", side: "NO", amount: 10 },
      { id: crypto.randomUUID(), person: "Taylor", side: "YES", amount: 5 }
    ]
  },
  {
    id: crypto.randomUUID(),
    question: "Will the group dinner happen this Friday?",
    deadline: "2026-05-01T21:00",
    cutoff: "2026-05-01T12:00",
    umpire: "Mia",
    minStake: 5,
    platformFee: HIDDEN_PLATFORM_FEE,
    oddsRake: 3,
    visibility: "PUBLIC",
    inviteCode: "",
    terms: "Dinner counts if at least four people attend and food is ordered by 9pm.",
    status: "OPEN",
    outcome: "",
    entries: [
      { id: crypto.randomUUID(), person: "You", side: "NO", amount: 20 },
      { id: crypto.randomUUID(), person: "Mia", side: "YES", amount: 15 }
    ]
  }
];

let markets = [];
let activeFilter = "all";
let dbClient = null;
let realtimeChannel = null;
let isSharedMode = false;

const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0
});

const currentUserInput = document.querySelector("#currentUser");
const marketForm = document.querySelector("#marketForm");
const marketList = document.querySelector("#marketList");
const template = document.querySelector("#marketCardTemplate");
const connectionStatus = document.querySelector("#connectionStatus");
const createView = document.querySelector("#createView");
const marketView = document.querySelector("#marketView");
const showCreateButton = document.querySelector("#showCreateButton");
const cancelCreateButton = document.querySelector("#cancelCreateButton");
const inviteForm = document.querySelector("#inviteForm");

currentUserInput.value = localStorage.getItem(USER_KEY) || "You";
currentUserInput.addEventListener("input", () => {
  localStorage.setItem(USER_KEY, currentUserInput.value.trim() || "You");
  render();
});

marketForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const visibility = document.querySelector("input[name='visibility']:checked").value;

  const market = {
    id: crypto.randomUUID(),
    question: valueOf("question"),
    deadline: valueOf("deadline"),
    cutoff: valueOf("cutoff"),
    umpire: valueOf("umpire"),
    minStake: numberOf("minStake"),
    platformFee: HIDDEN_PLATFORM_FEE,
    oddsRake: numberOf("oddsRake"),
    visibility,
    inviteCode: visibility === "INVITE_ONLY" ? createInviteCode() : "",
    terms: valueOf("terms") || "No extra terms added.",
    status: "OPEN",
    outcome: "",
    entries: []
  };

  if (isSharedMode) {
    await createSharedMarket(market);
  } else {
    markets.unshift(market);
    saveLocalMarkets();
    render();
  }

  marketForm.reset();
  document.querySelector("input[name='visibility'][value='PUBLIC']").checked = true;
  document.querySelector("#minStake").value = 5;
  document.querySelector("#oddsRake").value = 3;
  showMarketView();
});

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    render();
  });
});

showCreateButton.addEventListener("click", showCreateView);
cancelCreateButton.addEventListener("click", showMarketView);

inviteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = valueOf("inviteCode").toUpperCase();
  if (!code) return;

  saveInviteCode(code);
  document.querySelector("#inviteCode").value = "";
  render();
});

boot();

async function boot() {
  dbClient = createDatabaseClient();
  isSharedMode = Boolean(dbClient);

  if (isSharedMode) {
    setConnection("Connecting to shared markets...", "live");
    await loadSharedMarkets();
    subscribeToSharedChanges();
  } else {
    markets = loadLocalMarkets();
    setConnection("Demo mode: bets are saved on this device.", "");
    render();
  }
}

function createDatabaseClient() {
  const config = window.PEER_PRESSURE_SUPABASE || {};
  const hasConfig = config.url && config.anonKey;
  const hasLibrary = window.supabase && window.supabase.createClient;

  if (!hasConfig || !hasLibrary) return null;
  return window.supabase.createClient(config.url, config.anonKey);
}

async function loadSharedMarkets() {
  const { data, error } = await dbClient
    .from("markets")
    .select("*, entries(*)")
    .order("created_at", { ascending: false });

  if (error) {
    setConnection(`Supabase error: ${error.message}`, "error");
    markets = loadLocalMarkets();
    isSharedMode = false;
  } else {
    markets = data.map(fromDatabaseMarket);
    setConnection("Shared mode: markets sync through Supabase.", "live");
  }

  render();
}

function subscribeToSharedChanges() {
  if (realtimeChannel) dbClient.removeChannel(realtimeChannel);

  realtimeChannel = dbClient
    .channel("peer-pressure-shared-markets")
    .on("postgres_changes", { event: "*", schema: "public", table: "markets" }, loadSharedMarkets)
    .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, loadSharedMarkets)
    .subscribe();
}

async function createSharedMarket(market) {
  const { error } = await dbClient.from("markets").insert(toDatabaseMarket(market));

  if (error) {
    setConnection(`Could not create bet: ${error.message}`, "error");
    return;
  }

  await loadSharedMarkets();
}

async function createSharedEntry(market, entry) {
  const { error } = await dbClient.from("entries").insert({
    market_id: market.id,
    person: entry.person,
    side: entry.side,
    amount: entry.amount
  });

  if (error) {
    setConnection(`Could not join bet: ${error.message}`, "error");
    return;
  }

  await loadSharedMarkets();
}

async function resolveSharedMarket(market, outcome) {
  const { error } = await dbClient
    .from("markets")
    .update({ status: "SETTLED", outcome })
    .eq("id", market.id);

  if (error) {
    setConnection(`Could not resolve bet: ${error.message}`, "error");
    return;
  }

  await loadSharedMarkets();
}

function fromDatabaseMarket(row) {
  return {
    id: row.id,
    question: row.question,
    deadline: toLocalInputDate(row.deadline),
    cutoff: toLocalInputDate(row.cutoff),
    umpire: row.umpire,
    minStake: Number(row.min_stake),
    platformFee: Number(row.platform_fee || HIDDEN_PLATFORM_FEE),
    oddsRake: Number(row.odds_rake),
    visibility: row.visibility || "PUBLIC",
    inviteCode: row.invite_code || "",
    terms: row.terms,
    status: row.status,
    outcome: row.outcome,
    entries: (row.entries || []).map((entry) => ({
      id: entry.id,
      person: entry.person,
      side: entry.side,
      amount: Number(entry.amount)
    }))
  };
}

function toDatabaseMarket(market) {
  return {
    question: market.question,
    deadline: new Date(market.deadline).toISOString(),
    cutoff: new Date(market.cutoff).toISOString(),
    umpire: market.umpire,
    min_stake: market.minStake,
    platform_fee: market.platformFee,
    odds_rake: market.oddsRake,
    visibility: market.visibility,
    invite_code: market.inviteCode,
    terms: market.terms,
    status: market.status,
    outcome: market.outcome
  };
}

function loadLocalMarkets() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultMarkets;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : defaultMarkets;
  } catch {
    return defaultMarkets;
  }
}

function saveLocalMarkets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(markets));
}

function loadFollowedMarketIds() {
  const raw = localStorage.getItem(FOLLOW_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadInviteCodes() {
  const raw = localStorage.getItem(INVITE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveInviteCode(code) {
  const codes = new Set(loadInviteCodes());
  codes.add(code);
  localStorage.setItem(INVITE_KEY, JSON.stringify([...codes]));
}

function hasInviteAccess(market) {
  if (market.visibility !== "INVITE_ONLY") return true;
  return loadInviteCodes().includes(market.inviteCode) || isFollowing(market);
}

function isFollowing(market) {
  return loadFollowedMarketIds().includes(market.id);
}

function toggleFollow(market) {
  const followed = new Set(loadFollowedMarketIds());
  if (followed.has(market.id)) {
    followed.delete(market.id);
  } else {
    followed.add(market.id);
  }
  localStorage.setItem(FOLLOW_KEY, JSON.stringify([...followed]));
}

function valueOf(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function numberOf(id) {
  return Number(document.querySelector(`#${id}`).value || 0);
}

function getPools(market) {
  const yes = market.entries
    .filter((entry) => entry.side === "YES")
    .reduce((sum, entry) => sum + Number(entry.amount), 0);
  const no = market.entries
    .filter((entry) => entry.side === "NO")
    .reduce((sum, entry) => sum + Number(entry.amount), 0);
  const gross = yes + no;
  const feeRate = (Number(market.platformFee) + Number(market.oddsRake)) / 100;
  const net = market.outcome === "VOID" ? gross : gross * (1 - feeRate);

  return { yes, no, gross, net, feeRate };
}

function getOdds(market) {
  const pools = getPools(market);
  return {
    yesOdds: pools.yes > 0 ? pools.net / pools.yes : 0,
    noOdds: pools.no > 0 ? pools.net / pools.no : 0,
    yesShare: pools.gross > 0 ? pools.yes / pools.gross : 0,
    noShare: pools.gross > 0 ? pools.no / pools.gross : 0
  };
}

function getPayout(market, entry) {
  const pools = getPools(market);
  if (!market.outcome) return null;
  if (market.outcome === "VOID") return entry.amount;
  if (entry.side !== market.outcome) return 0;

  const winningPool = market.outcome === "YES" ? pools.yes : pools.no;
  return winningPool > 0 ? (entry.amount / winningPool) * pools.net : 0;
}

function filteredMarkets() {
  return markets.filter((market) => {
    if (!hasInviteAccess(market)) return false;
    if (activeFilter === "followed") return isFollowing(market);
    if (activeFilter === "open") return market.status === "OPEN";
    if (activeFilter === "settled") return market.status === "SETTLED";
    return true;
  });
}

function render() {
  renderStats();
  renderMarkets();
}

function renderStats() {
  const visible = markets.filter(hasInviteAccess);
  const active = visible.filter((market) => market.status === "OPEN").length;
  const followed = visible.filter(isFollowing).length;
  const totalPool = visible.reduce((sum, market) => sum + getPools(market).gross, 0);
  const settled = visible.filter((market) => market.status === "SETTLED").length;

  document.querySelector("#activeCount").textContent = active;
  document.querySelector("#followedCount").textContent = followed;
  document.querySelector("#totalPool").textContent = money.format(totalPool);
  document.querySelector("#settledCount").textContent = settled;
}

function renderMarkets() {
  marketList.replaceChildren();
  const visibleMarkets = filteredMarkets();

  if (visibleMarkets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No bets match this view yet.";
    marketList.append(empty);
    return;
  }

  visibleMarkets.forEach((market) => {
    const card = template.content.firstElementChild.cloneNode(true);
    const pools = getPools(market);
    const odds = getOdds(market);
    const statusPill = card.querySelector(".status-pill");
    const visibilityPill = card.querySelector(".visibility-pill");
    const followButton = card.querySelector(".follow-button");
    const entryForm = card.querySelector(".entry-form");

    card.querySelector("h3").textContent = market.question;
    card.querySelector(".umpire").textContent = market.umpire;
    card.querySelector(".cutoff").textContent = formatDate(market.cutoff);
    card.querySelector(".deadline").textContent = formatDate(market.deadline);
    card.querySelector(".fee").textContent = `${market.oddsRake}%`;
    card.querySelector(".terms").textContent = market.terms;
    renderInviteRead(card, market);
    card.querySelector(".yes-pool").textContent = money.format(pools.yes);
    card.querySelector(".no-pool").textContent = money.format(pools.no);
    card.querySelector(".yes-odds").textContent = formatOdds(odds.yesOdds, odds.yesShare);
    card.querySelector(".no-odds").textContent = formatOdds(odds.noOdds, odds.noShare);
    card.querySelector(".payout-read").textContent = payoutRead(market);

    statusPill.textContent = market.outcome ? `${market.outcome} resolved` : market.status;
    statusPill.classList.toggle("void", market.outcome === "VOID");
    statusPill.classList.toggle("settled", market.status === "SETTLED" && market.outcome !== "VOID");
    visibilityPill.textContent = market.visibility === "INVITE_ONLY" ? "Invite only" : "Public";

    followButton.textContent = isFollowing(market) ? "Following" : "Follow";
    followButton.classList.toggle("following", isFollowing(market));
    followButton.addEventListener("click", () => {
      toggleFollow(market);
      render();
    });

    const personInput = card.querySelector(".person-input");
    const amountInput = card.querySelector(".amount-input");
    personInput.value = currentUserInput.value;
    amountInput.min = market.minStake;
    amountInput.placeholder = `$${market.minStake}+`;

    entryForm.hidden = market.status !== "OPEN";
    entryForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const amount = Number(amountInput.value);
      if (amount < market.minStake) return;

      const entry = {
        id: crypto.randomUUID(),
        person: personInput.value.trim() || currentUserInput.value || "Friend",
        side: card.querySelector(".side-select").value,
        amount
      };

      if (isSharedMode) {
        await createSharedEntry(market, entry);
      } else {
        market.entries.push(entry);
        saveLocalMarkets();
        render();
      }
    });

    card.querySelectorAll("[data-outcome]").forEach((button) => {
      button.disabled = market.status !== "OPEN";
      button.addEventListener("click", async () => {
        if (isSharedMode) {
          await resolveSharedMarket(market, button.dataset.outcome);
        } else {
          market.status = "SETTLED";
          market.outcome = button.dataset.outcome;
          saveLocalMarkets();
          render();
        }
      });
    });

    renderLedger(card.querySelector(".ledger-body"), market);
    marketList.append(card);
  });
}

function renderLedger(container, market) {
  container.replaceChildren();

  if (market.entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "terms";
    empty.textContent = "No entries yet.";
    container.append(empty);
    return;
  }

  market.entries.forEach((entry) => {
    const payout = getPayout(market, entry);
    const row = document.createElement("div");
    row.className = "ledger-row";
    row.innerHTML = `
      <strong>${escapeHtml(entry.person)}</strong>
      <span>${entry.side}</span>
      <span>${money.format(entry.amount)}</span>
      <span>${payout === null ? "Open" : `${money.format(payout)} payout`}</span>
    `;
    container.append(row);
  });
}

function formatDate(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function toLocalInputDate(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatOdds(decimalOdds, share) {
  if (!decimalOdds) return "No pool yet";
  return `${decimalOdds.toFixed(2)}x payout | ${(share * 100).toFixed(0)}% of pool`;
}

function renderInviteRead(card, market) {
  const inviteRead = card.querySelector(".invite-read");
  if (market.visibility !== "INVITE_ONLY") {
    inviteRead.classList.remove("visible");
    inviteRead.textContent = "";
    return;
  }

  inviteRead.classList.add("visible");
  inviteRead.textContent = `Invite code: ${market.inviteCode}`;
}

function showCreateView() {
  createView.hidden = false;
  marketView.hidden = true;
  showCreateButton.hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMarketView() {
  createView.hidden = true;
  marketView.hidden = false;
  showCreateButton.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function createInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  saveInviteCode(code);
  return code;
}

function payoutRead(market) {
  const pools = getPools(market);
  if (market.outcome === "VOID") return "Void: all stakes return.";
  if (market.outcome) return `${market.outcome} wins from a ${money.format(pools.net)} net pot.`;
  return `${money.format(pools.net)} net pot after fees and rake.`;
}

function setConnection(message, state) {
  connectionStatus.textContent = message;
  connectionStatus.classList.toggle("live", state === "live");
  connectionStatus.classList.toggle("error", state === "error");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character];
  });
}
