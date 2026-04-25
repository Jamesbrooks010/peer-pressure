const authClient = (() => {
  const config = window.PEER_PRESSURE_SUPABASE || {};
  if (!config.url || !config.anonKey || !window.supabase) return null;
  return window.supabase.createClient(config.url, config.anonKey);
})();

const pendingSignupKey = "peerPressurePendingSignup";

const signupForm = document.querySelector("#signupForm");
const verifyForm = document.querySelector("#verifyForm");
const signinForm = document.querySelector("#signinForm");
const statusLine = document.querySelector("#connectionStatus");

if (!authClient) setStatus("Account system is not connected yet.", "error");

signupForm && signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authClient) return;

  const username = valueOf("signupUsername");
  const phone = normalisePhone(valueOf("signupPhone"));
  const password = valueOf("signupPassword");

  const { error } = await authClient.auth.signUp({
    phone,
    password,
    options: {
      channel: "sms",
      data: { username }
    }
  });

  if (error) {
    setStatus(error.message, "error");
    return;
  }

  localStorage.setItem(pendingSignupKey, JSON.stringify({ username, phone }));
  document.querySelector("#verifyPhone").value = phone;
  setStatus("Code sent. Enter the SMS code to finish setup.", "live");
});

verifyForm && verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authClient) return;

  const phone = normalisePhone(valueOf("verifyPhone"));
  const token = valueOf("verifyCode");
  const pending = readPendingSignup(phone);

  const { data, error } = await authClient.auth.verifyOtp({
    phone,
    token,
    type: "sms"
  });

  if (error) {
    setStatus(error.message, "error");
    return;
  }

  const user = data && data.user;
  if (user && pending.username) {
    await saveProfile(user.id, pending.username, phone);
  }

  localStorage.setItem("peerPressureCurrentUser", pending.username || phone);
  localStorage.removeItem(pendingSignupKey);
  setStatus("Account verified. Taking you back to Peer Pressure...", "live");
  window.location.href = "index.html";
});

signinForm && signinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authClient) return;

  const phone = normalisePhone(valueOf("signinPhone"));
  const password = valueOf("signinPassword");

  const { data, error } = await authClient.auth.signInWithPassword({ phone, password });
  if (error) {
    setStatus(error.message, "error");
    return;
  }

  const user = data && data.user;
  const username = user ? await loadUsername(user) : phone;
  localStorage.setItem("peerPressureCurrentUser", username);
  setStatus("Signed in. Taking you back to Peer Pressure...", "live");
  window.location.href = "index.html";
});

async function saveProfile(id, username, phone) {
  const { error } = await authClient.from("profiles").upsert({
    id,
    username,
    phone
  });

  if (error) setStatus(error.message, "error");
}

async function loadUsername(user) {
  const { data } = await authClient
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  return (data && data.username) || (user.user_metadata && user.user_metadata.username) || user.phone || "Friend";
}

function readPendingSignup(phone) {
  try {
    const pending = JSON.parse(localStorage.getItem(pendingSignupKey) || "{}");
    return pending.phone === phone ? pending : { phone };
  } catch {
    return { phone };
  }
}

function normalisePhone(phone) {
  return phone.replace(/\s+/g, "");
}

function valueOf(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function setStatus(message, state) {
  if (!statusLine) return;
  statusLine.textContent = message;
  statusLine.classList.toggle("live", state === "live");
  statusLine.classList.toggle("error", state === "error");
}
