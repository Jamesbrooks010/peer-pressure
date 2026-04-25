const authClient = (() => {
  const config = window.PEER_PRESSURE_SUPABASE || {};
  if (!config.url || !config.anonKey || !window.supabase) return null;
  return window.supabase.createClient(config.url, config.anonKey);
})();

const signupForm = document.querySelector("#signupForm");
const signinForm = document.querySelector("#signinForm");
const statusLine = document.querySelector("#connectionStatus");

if (!authClient) setStatus("Account system is not connected yet.", "error");

signupForm && signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authClient) return;

  const username = valueOf("signupUsername");
  const email = valueOf("signupEmail").toLowerCase();
  const password = valueOf("signupPassword");

  const { data, error } = await authClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}${window.location.pathname.replace("signup.html", "auth.html")}`,
      data: { username }
    }
  });

  if (error) {
    setStatus(error.message, "error");
    return;
  }

  const user = data && data.user;
  if (user) await saveProfile(user.id, username, email);

  localStorage.setItem("peerPressureCurrentUser", username);
  setStatus("Account created. Check your email to verify, then sign in.", "live");
  signupForm.reset();
});

signinForm && signinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authClient) return;

  const email = valueOf("signinEmail").toLowerCase();
  const password = valueOf("signinPassword");

  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error) {
    setStatus(error.message, "error");
    return;
  }

  const user = data && data.user;
  const username = user ? await loadUsername(user) : email;
  localStorage.setItem("peerPressureCurrentUser", username);
  setStatus("Signed in. Taking you back to Peer Pressure...", "live");
  window.location.href = "index.html";
});

async function saveProfile(id, username, email) {
  const { error } = await authClient.from("profiles").upsert({
    id,
    username,
    email
  });

  if (error) setStatus(error.message, "error");
}

async function loadUsername(user) {
  const { data } = await authClient
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  return (data && data.username) || (user.user_metadata && user.user_metadata.username) || user.email || "Friend";
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
