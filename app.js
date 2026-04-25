const STORAGE_KEY = "peerPressurePrototype";
const USER_KEY = "peerPressureCurrentUser";

const defaultMarkets = [
  {
    id: crypto.randomUUID(),
    question: "Will Sam call us today?",
    deadline: "2026-04-25T23:59",
    cutoff: "2026-04-25T20:00",
    umpire: "Alex",
    minStake: 5,
    platformFee: 2,
    oddsRake: 3,
    terms: "Counts only if the call is received before midnight. Missed calls count. Texts do not.",
    status: "OPEN",
    outcome: "",
    followed: true,
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
    platformFee: 2,
    oddsRake: 3,
    terms: "Dinner counts if at least four people attend and food is ordered by 9pm.",
    status: "OPEN",
    outcome: "",
    followed: false,
    entries: [
      { id: crypto.randomUUID(), person: "You", side: "NO", amount: 20 },
      { id: crypto.randomUUID(), person: "Mia", side: "YES", amount: 15 }
    ]
  }
];

let markets = loadMarkets();
let activeFilter = "all";

const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0
});

const currentUserInput = document.querySelector("#currentUser");
const marketForm = document.querySelector("#marketForm");
const marketList = document.querySelector("#marketList");
const template = document.querySelector("#marketCardTemplate");

currentUserInput.value = localStorage.getItem(USER_KEY) || "You";
currentUserInput.addEventListener("input", () => {
  localStorage.setItem(USER_KEY, currentUserInput.value.trim() || "You");
  render();
});

marketForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const market = {
    id: crypto.randomUUID(),
    question: valueOf("question"),
    deadline: valueOf("deadline"),
    cutoff: valueOf("cutoff"),
    umpire: valueOf("umpire"),
    minStake: numberOf("minStake"),
    platformFee: numberOf("platformFee"),
    oddsRake: numberOf("oddsRake"),
    terms: valueOf("terms") || "No extra terms added.",
    status: "OPEN",
    outcome: "",
    followed: true,
    entries: []
  };

  markets.unshift(market);
  saveMarkets();
  marketForm.reset();
  document.querySelector("#minStake").value = 5;
  document.querySelector("#platformFee").value = 2;
  document.querySelector("#oddsRake").value = 3;
  render();
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

function loadMarkets() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultMarkets;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : defaultMarkets;
  } catch {
    return defaultMarkets;
  }
}

function saveMarkets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(markets));
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
    if (activeFilter === "followed") return market.followed;
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
  const active = markets.filter((market) => market.status === "OPEN").length;
  const followed = markets.filter((market) => market.followed).length;
  const totalPool = markets.reduce((sum, market) => sum + getPools(market).gross, 0);
  const settled = markets.filter((market) => market.status === "SETTLED").length;

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
    const followButton = card.querySelector(".follow-button");
    const entryForm = card.querySelector(".entry-form");

    card.querySelector("h3").textContent = market.question;
    card.querySelector(".umpire").textContent = market.umpire;
    card.querySelector(".cutoff").textContent = formatDate(market.cutoff);
    card.querySelector(".deadline").textContent = formatDate(market.deadline);
    card.querySelector(".fee").textContent = `${market.platformFee}% + ${market.oddsRake}%`;
    card.querySelector(".terms").textContent = market.terms;
    card.querySelector(".yes-pool").textContent = money.format(pools.yes);
    card.querySelector(".no-pool").textContent = money.format(pools.no);
    card.querySelector(".yes-odds").textContent = formatOdds(odds.yesOdds, odds.yesShare);
    card.querySelector(".no-odds").textContent = formatOdds(odds.noOdds, odds.noShare);
    card.querySelector(".payout-read").textContent = payoutRead(market);

    statusPill.textContent = market.outcome ? `${market.outcome} resolved` : market.status;
    statusPill.classList.toggle("void", market.outcome === "VOID");
    statusPill.classList.toggle("settled", market.status === "SETTLED" && market.outcome !== "VOID");

    followButton.textContent = market.followed ? "Following" : "Follow";
    followButton.classList.toggle("following", market.followed);
    followButton.addEventListener("click", () => {
      market.followed = !market.followed;
      saveMarkets();
      render();
    });

    const personInput = card.querySelector(".person-input");
    const amountInput = card.querySelector(".amount-input");
    personInput.value = currentUserInput.value;
    amountInput.min = market.minStake;
    amountInput.placeholder = `$${market.minStake}+`;

    entryForm.hidden = market.status !== "OPEN";
    entryForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const amount = Number(amountInput.value);
      if (amount < market.minStake) return;

      market.entries.push({
        id: crypto.randomUUID(),
        person: personInput.value.trim() || currentUserInput.value || "Friend",
        side: card.querySelector(".side-select").value,
        amount
      });
      saveMarkets();
      render();
    });

    card.querySelectorAll("[data-outcome]").forEach((button) => {
      button.disabled = market.status !== "OPEN";
      button.addEventListener("click", () => {
        market.status = "SETTLED";
        market.outcome = button.dataset.outcome;
        saveMarkets();
        render();
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

function formatOdds(decimalOdds, share) {
  if (!decimalOdds) return "No pool yet";
  return `${decimalOdds.toFixed(2)}x payout | ${(share * 100).toFixed(0)}% of pool`;
}

function payoutRead(market) {
  const pools = getPools(market);
  if (market.outcome === "VOID") return "Void: all stakes return.";
  if (market.outcome) return `${market.outcome} wins from a ${money.format(pools.net)} net pot.`;
  return `${money.format(pools.net)} net pot after fees and rake.`;
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

render();
