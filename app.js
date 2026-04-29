const STORAGE_KEY = "peerPressurePrototype";
const USER_KEY = "peerPressureCurrentUser";
const FOLLOW_KEY = "peerPressureFollowedMarkets";
const INVITE_KEY = "peerPressureInviteCodes";
const HIDDEN_PLATFORM_FEE = 2;
const HIDDEN_ODDS_RAKE = 3;

const pageParams = new URLSearchParams(window.location.search);
const detailMarketId = pageParams.get("id") || "";
const isDetailPage = Boolean(detailMarketId);

const defaultMarkets = [
  {
    id: crypto.randomUUID(),
    question: "Will Sam call us today?",
    deadline: "2026-04-25T23:59",
    cutoff: "2026-04-25T20:00",
    umpire: "Alex",
    minStake: 5,
    platformFee: HIDDEN_PLATFORM_FEE,
    oddsRake: HIDDEN_ODDS_RAKE,
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
    oddsRake: HIDDEN_ODDS_RAKE,
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
let currentUserId = "";

const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0
});

const marketForm = document.querySelector("#marketForm");
const marketList = document.querySelector("#marketList");
const template = document.querySelector("#marketCardTemplate");
const connectionStatus = document.querySelector("#connectionStatus");
const inviteForm = document.querySelector("#inviteForm");

document.body.classList.toggle("detail-mode", isDetailPage);
document.body.classList.toggle("list-mode", !isDetailPage);
window.addEventListener("peerpressure:userchange", render);

if (marketForm) {
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
      oddsRake: HIDDEN_ODDS_RAKE,
      visibility,
      inviteCode: visibility === "INVITE_ONLY" ? createInviteCode() : "",
      terms: valueOf("terms") || "No extra terms added.",
      status: "OPEN",
      outcome: "",
      entries: []
    };

    let created = true;
    if (isSharedMode) {
      created = await createSharedMarket(market);
    } else {
      markets.unshift(market);
      saveLocalMarkets();
      render();
    }

    if (created) {
      window.location.href = "index.html";
    }
  });
}

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    render();
  });
});

if (inviteForm) {
  inviteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = valueOf("inviteCode").toUpperCase();
    if (!code) return;

    if (isSharedMode) {
      await joinSharedInvite(code);
    } else {
      saveInviteCode(code);
      render();
    }

    document.querySelector("#inviteCode").value = "";
  });
}

boot();

async function boot() {
  dbClient = createDatabaseClient();
  isSharedMode = Boolean(dbClient);

  if (isSharedMode) {
    setConnection("Connecting to shared markets...", "live");
    const user = await getSignedInUser();
    currentUserId = user ? user.id : "";
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

async function getSignedInUser() {
  if (!dbClient) return null;
  const { data } = await dbClient.auth.getUser();
  return data && data.user ? data.user : null;
}

async function loadSharedMarkets() {
  const { data, error } = await dbClient
    .from("markets")
    .select("*, entries(*)")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    setConnection(`Supabase error: ${error.message}`, "error");
    markets = loadLocalMarkets();
    isSharedMode = false;
  } else {
    markets = data.map(fromDatabaseMarket);
    setConnection(isDetailPage ? "Shared mode: bet detail syncs through Supabase." : "Shared mode: markets sync through Supabase.", "live");
  }

  render();
}

function subscribeToSharedChanges() {
  if (realtimeChannel) dbClient.removeChannel(realtimeChannel);

  realtimeChannel = dbClient
    .channel("peer-pressure-shared-markets")
    .on("postgres_changes", { event: "*", schema: "public", table: "markets" }, loadSharedMarkets)
    .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, loadSharedMarkets)
    .on("postgres_changes", { event: "*", schema: "public", table: "market_participants" }, loadSharedMarkets)
    .subscribe();
}

async function createSharedMarket(market) {
  const user = await getSignedInUser();

  if (!user) {
    setConnection("Please sign in before creating a bet.", "error");
    return false;
  }

  currentUserId = user.id;
  const payload = toDatabaseMarket(market);
  payload.owner_id = user.id;

  const { error } = await dbClient.from("markets").insert(payload);

  if (error) {
    setConnection(`Could not create bet: ${error.message}`, "error");
    return false;
  }

  return true;
}

async function createSharedEntry(market, entry) {
  const user = await getSignedInUser();

  if (!user) {
    setConnection("Please sign in before joining a bet.", "error");
    return;
  }

  currentUserId = user.id;
  const person = currentDisplayName();
  const existingSide = sideForCurrentUser(market, person, user.id);
  if (existingSide && existingSide !== entry.side) {
    setConnection(`You are already on ${existingSide}. You can add more there, but you cannot switch sides.`, "error");
    return;
  }

  const { error } = await dbClient.from("entries").insert({
    market_id: market.id,
    user_id: user.id,
    person,
    side: entry.side,
    amount: entry.amount
  });

  if (error) {
    setConnection(`Could not join bet: ${error.message}`, "error");
    return;
  }

  await loadSharedMarkets();
}

async function joinSharedInvite(code) {
  const { data, error } = await dbClient.rpc("join_market_by_invite", { invite: code });

  if (error) {
    setConnection(`Could not open invite: ${error.message}`, "error");
    return;
  }

  saveInviteCode(code);
  setConnection("Invite opened. Private bet added to your markets.", "live");
  await loadSharedMarkets();
  if (data) window.location.href = `detail.html?id=${data}`;
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
      userId: entry.user_id || "",
      person: entry.person,
      side: entry.side,
      amount: Number(entry.amount),
      lockedProfit: Number(entry.locked_profit || 0),
      lockedPayout: Number(entry.locked_payout || 0)
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
  if (isSharedMode) return true;
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

function currentDisplayName() {
  return localStorage.getItem(USER_KEY) || "You";
}

function valueOf(id) {
  const field = document.querySelector(`#${id}`);
  return field ? field.value.trim() : "";
}

function numberOf(id) {
  const field = document.querySelector(`#${id}`);
  return Number((field && field.value) || 0);
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
  if (!market.outcome) return null;
  if (market.outcome === "VOID") return entry.amount;
  if (entry.side !== market.outcome) return 0;
  if (entry.lockedPayout > 0) return entry.lockedPayout;

  const pools = getPools(market);
  const winningPool = market.outcome === "YES" ? pools.yes : pools.no;
  return winningPool > 0 ? entry.amount + (entry.amount / winningPool) * losingPoolForSide(market, entry.side) * (1 - pools.feeRate) : entry.amount;
}

function quoteLockedPayout(market, side, amount) {
  const pools = getPools(market);
  const samePool = side === "YES" ? pools.yes : pools.no;
  const oppositePool = side === "YES" ? pools.no : pools.yes;
  const profit = oppositePool > 0 ? (amount / (samePool + amount)) * oppositePool * (1 - pools.feeRate) : 0;
  return amount + profit;
}

function quoteRead(market, side, amount) {
  if (!amount || amount < market.minStake) return `Min stake ${money.format(market.minStake)}`;
  const payout = quoteLockedPayout(market, side, amount);
  const profit = Math.max(0, payout - amount);
  return `Pays ${money.format(payout)} if ${side} wins (${money.format(profit)} profit)`;
}

function losingPoolForSide(market, side) {
  const pools = getPools(market);
  return side === "YES" ? pools.no : pools.yes;
}

function sideForCurrentUser(market, fallbackName = currentDisplayName(), userId = currentUserId) {
  const matched = market.entries.find((entry) => {
    if (userId && entry.userId) return entry.userId === userId;
    return entry.person.trim().toLowerCase() === fallbackName.trim().toLowerCase();
  });

  return matched ? matched.side : "";
}

function filteredMarkets() {
  return markets.filter((market) => {
    if (!hasInviteAccess(market)) return false;
    if (isDetailPage) return market.id === detailMarketId;
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
  const activeCount = document.querySelector("#activeCount");
  const followedCount = document.querySelector("#followedCount");
  const settledCount = document.querySelector("#settledCount");
  if (!activeCount || !followedCount || !settledCount) return;

  const visible = markets.filter(hasInviteAccess);
  const active = visible.filter((market) => market.status === "OPEN").length;
  const followed = visible.filter(isFollowing).length;
  const settled = visible.filter((market) => market.status === "SETTLED").length;

  activeCount.textContent = active;
  followedCount.textContent = followed;
  settledCount.textContent = settled;
}

function renderMarkets() {
  if (!marketList || !template) return;

  marketList.replaceChildren();
  const visibleMarkets = filteredMarkets();

  if (visibleMarkets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = isDetailPage ? "This bet is not available, or you do not have access yet." : "No bets match this view yet.";
    marketList.append(empty);
    return;
  }

  visibleMarkets.forEach((market) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.classList.toggle("market-card-summary", !isDetailPage);

    const pools = getPools(market);
    const odds = getOdds(market);
    const statusPill = card.querySelector(".status-pill");
    const visibilityPill = card.querySelector(".visibility-pill");
    const followButton = card.querySelector(".follow-button");
    const entryForm = card.querySelector(".entry-form");
    const sideSelect = card.querySelector(".side-select");
    const amountInput = card.querySelector(".amount-input");
    const quoteOutput = card.querySelector(".quote-read");

    card.querySelector("h3").textContent = market.question;
    card.querySelector(".cutoff").textContent = formatDate(market.cutoff);
    card.querySelector(".deadline").textContent = formatDate(market.deadline);
    card.querySelector(".terms").textContent = market.terms;
    renderInviteRead(card, market);
    card.querySelector(".yes-pool").textContent = money.format(pools.yes);
    card.querySelector(".no-pool").textContent = money.format(pools.no);
    card.querySelector(".yes-odds").textContent = `YES pool | ${formatProbability(odds.yesShare)} implied`;
    card.querySelector(".no-odds").textContent = `NO pool | ${formatProbability(odds.noShare)} implied`;
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

    if (!isDetailPage) {
      const detailLink = document.createElement("a");
      detailLink.className = "primary-button action-link compact-button detail-link";
      detailLink.href = `detail.html?id=${market.id}`;
      detailLink.textContent = "View Bet";
      card.querySelector(".card-topline").append(detailLink);
    }

    amountInput.min = market.minStake;
    amountInput.placeholder = `$${market.minStake}+`;

    const updateQuote = () => {
      quoteOutput.textContent = quoteRead(market, sideSelect.value, Number(amountInput.value));
    };

    const existingSide = sideForCurrentUser(market);
    if (existingSide) {
      sideSelect.value = existingSide;
      sideSelect.disabled = true;
    }
    updateQuote();
    sideSelect.addEventListener("change", updateQuote);
    amountInput.addEventListener("input", updateQuote);

    entryForm.hidden = market.status !== "OPEN";
    entryForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const amount = Number(amountInput.value);
      if (amount < market.minStake) return;

      const entry = {
        id: crypto.randomUUID(),
        person: currentDisplayName(),
        side: sideSelect.value,
        amount
      };

      const existingEntrySide = sideForCurrentUser(market, entry.person);
      if (existingEntrySide && existingEntrySide !== entry.side) {
        setConnection(`You are already on ${existingEntrySide}. You can add more there, but you cannot switch sides.`, "error");
        return;
      }

      if (isSharedMode) {
        await createSharedEntry(market, entry);
      } else {
        entry.lockedPayout = quoteLockedPayout(market, entry.side, entry.amount);
        entry.lockedProfit = entry.lockedPayout - entry.amount;
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
    const lockedPayout = entry.lockedPayout || quoteLockedPayout(market, entry.side, entry.amount);
    const row = document.createElement("div");
    row.className = "ledger-row";
    row.innerHTML = `
      <strong>${escapeHtml(entry.person)}</strong>
      <span>${entry.side}</span>
      <span>${money.format(entry.amount)}</span>
      <span>${payout === null ? `Locked ${money.format(lockedPayout)} if wins` : `${money.format(payout)} payout`}</span>
    `;
    container.append(row);
  });
}

function formatDate(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function toLocalInputDate(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatProbability(share) {
  if (!Number.isFinite(share) || share <= 0) return "No line";
  return `${Math.round(share * 100)}%`;
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
  const odds = getOdds(market);
  if (market.outcome === "VOID") return "Void: all stakes return.";
  if (market.outcome) return `${market.outcome} resolved. Winning entries pay at their locked payout.`;
  if (!pools.gross) return "Market line will appear once friends join.";
  return `Pools: YES ${money.format(pools.yes)} / NO ${money.format(pools.no)}. Line: YES ${formatProbability(odds.yesShare)} / NO ${formatProbability(odds.noShare)} implied.`;
}

function setConnection(message, state) {
  if (!connectionStatus) return;
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
