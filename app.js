const CATEGORIES = [
  "Comida fuera",
  "Mercado y Oxxo",
  "Farmacia",
  "Transporte",
  "Hogar",
  "Ocio",
  "Fijo",
  "Otro",
];
const PAYMENTS = ["Nu", "Davivienda", "Efectivo", "Otra"];
const CAPS = { day: 35000, week: 245000, month: 1050000 };
const DATA_KEY = "mis-gastos-data";
const GITHUB_KEY = "mis-gastos-github";

const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const state = loadData();
let github = loadGithub();
let syncing = false;
let syncQueued = false;

const amountInput = document.querySelector("#amount");
const descriptionInput = document.querySelector("#description");
const dateInput = document.querySelector("#date");
const paymentInput = document.querySelector("#payment");
const monthInput = document.querySelector("#month");
const categoryBox = document.querySelector("#categories");
const formMessage = document.querySelector("#form-message");
const settingsMessage = document.querySelector("#settings-message");
const syncStatus = document.querySelector("#sync-status");
const tokenInput = document.querySelector("#token");
const repoInput = document.querySelector("#repo");
const disconnectButton = document.querySelector("#disconnect");

let selectedCategory = CATEGORIES[0];

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DATA_KEY) || "{}");
    return {
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
    };
  } catch {
    return { expenses: [], deletedIds: [] };
  }
}

function loadGithub() {
  try {
    return JSON.parse(localStorage.getItem(GITHUB_KEY) || "null");
  } catch {
    return null;
  }
}

function saveData() {
  localStorage.setItem(DATA_KEY, JSON.stringify(state));
}

function saveGithub() {
  if (github) localStorage.setItem(GITHUB_KEY, JSON.stringify(github));
  else localStorage.removeItem(GITHUB_KEY);
}

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function parseAmount(value) {
  const clean = value.trim().replace(/\s/g, "");
  if (!clean) return 0;
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean.replace(/\./g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function weekStart(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function variableExpenses(items) {
  return items.filter((expense) => expense.category !== "Fijo");
}

function sum(items) {
  return items.reduce((total, expense) => total + expense.amount, 0);
}

function setStatus(text) {
  syncStatus.textContent = text;
}

function renderChoices() {
  categoryBox.innerHTML = "";
  for (const category of CATEGORIES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${category === selectedCategory ? " selected" : ""}`;
    button.textContent = category;
    button.addEventListener("click", () => {
      selectedCategory = category;
      renderChoices();
    });
    categoryBox.appendChild(button);
  }
  paymentInput.innerHTML = PAYMENTS.map(
    (payment) => `<option value="${payment}">${payment}</option>`
  ).join("");
}

function renderMeter(valueId, barId, spent, cap) {
  const ratio = cap === 0 ? 0 : spent / cap;
  document.querySelector(valueId).textContent = `${money.format(spent)} / ${money.format(cap)}`;
  const bar = document.querySelector(barId);
  bar.className = `bar${ratio > 1 ? " over" : ratio > 0.8 ? " warn" : ""}`;
  bar.querySelector("i").style.width = `${Math.min(ratio, 1) * 100}%`;
}

function renderMonth() {
  const month = monthInput.value;
  const today = todayIso();
  const start = weekStart(today);
  const end = addDays(start, 6);
  const monthItems = state.expenses.filter((expense) => expense.date.startsWith(month));
  const todayItems = variableExpenses(state.expenses.filter((expense) => expense.date === today));
  const weekItems = variableExpenses(
    state.expenses.filter((expense) => expense.date >= start && expense.date <= end)
  );
  renderMeter("#today-value", "#today-bar", sum(todayItems), CAPS.day);
  renderMeter("#week-value", "#week-bar", sum(weekItems), CAPS.week);
  renderMeter("#month-value", "#month-bar", sum(variableExpenses(monthItems)), CAPS.month);

  const list = document.querySelector("#expense-list");
  list.innerHTML = "";
  const sorted = [...monthItems].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  let lastDate = "";
  if (sorted.length === 0) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = "Este mes todavía no tiene gastos.";
    list.appendChild(empty);
    return;
  }
  for (const expense of sorted) {
    if (expense.date !== lastDate) {
      lastDate = expense.date;
      const label = document.createElement("p");
      label.className = "day-label";
      label.textContent = new Date(`${expense.date}T12:00:00`).toLocaleDateString("es-CO", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      list.appendChild(label);
    }
    const row = document.createElement("article");
    row.className = "expense";
    row.innerHTML = `<div><strong></strong><small></small></div><button class="ghost" type="button">Eliminar</button>`;
    row.querySelector("strong").textContent = expense.description;
    row.querySelector("small").textContent = `${expense.category} · ${expense.payment} · ${money.format(expense.amount)}`;
    row.querySelector("button").addEventListener("click", () => removeExpense(expense.id));
    list.appendChild(row);
  }
}

function upsertExpense(expense) {
  state.expenses.push(expense);
  saveData();
  renderMonth();
  scheduleSync();
}

function removeExpense(id) {
  state.expenses = state.expenses.filter((expense) => expense.id !== id);
  if (!state.deletedIds.includes(id)) state.deletedIds.push(id);
  saveData();
  renderMonth();
  scheduleSync();
}

document.querySelector("#expense-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const amount = parseAmount(amountInput.value);
  const description = descriptionInput.value.trim();
  if (!description || amount <= 0) {
    formMessage.textContent = "Escribe una descripción y un valor mayor que cero.";
    return;
  }
  upsertExpense({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: dateInput.value,
    description,
    category: selectedCategory,
    amount: Math.round(amount),
    payment: paymentInput.value,
    updatedAt: Date.now(),
  });
  amountInput.value = "";
  descriptionInput.value = "";
  formMessage.textContent = "Gasto guardado.";
  amountInput.focus();
});

document.querySelectorAll(".nav button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#view-${button.dataset.view}`).classList.add("active");
    if (button.dataset.view === "month") renderMonth();
  });
});

monthInput.addEventListener("change", renderMonth);

function encodeContent(data) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

function decodeContent(content) {
  return JSON.parse(decodeURIComponent(escape(atob(content.replace(/\n/g, "")))));
}

async function githubRequest(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${github.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 404 && (options.method || "GET") === "GET") return null;
  if (!response.ok) {
    const error = new Error(`GitHub respondió ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function canonical(data) {
  return JSON.stringify({
    expenses: [...data.expenses].sort((a, b) => a.id.localeCompare(b.id)),
    deletedIds: [...data.deletedIds].sort(),
  });
}

function mergeData(local, remote) {
  const deleted = new Set([...(local.deletedIds || []), ...(remote.deletedIds || [])]);
  const byId = new Map();
  for (const expense of [...(remote.expenses || []), ...(local.expenses || [])]) {
    if (deleted.has(expense.id)) continue;
    const current = byId.get(expense.id);
    if (!current || (expense.updatedAt || 0) >= (current.updatedAt || 0)) byId.set(expense.id, expense);
  }
  return { expenses: [...byId.values()], deletedIds: [...deleted] };
}

async function pushData() {
  const payload = {
    message: "Actualizar registro de gastos",
    content: encodeContent(state),
  };
  if (github.sha) payload.sha = github.sha;
  const result = await githubRequest(`/repos/${github.owner}/${github.repo}/contents/gastos.json`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  github.sha = result.content.sha;
  saveGithub();
  setStatus(`Sincronizado con ${github.owner}/${github.repo}`);
}

async function pullAndMerge() {
  const remoteFile = await githubRequest(`/repos/${github.owner}/${github.repo}/contents/gastos.json`);
  if (!remoteFile) {
    await pushData();
    return;
  }
  github.sha = remoteFile.sha;
  const remote = decodeContent(remoteFile.content);
  const merged = mergeData(state, remote);
  const changed = canonical(merged) !== canonical(state);
  state.expenses = merged.expenses;
  state.deletedIds = merged.deletedIds;
  saveData();
  renderMonth();
  if (changed || canonical(merged) !== canonical(remote)) await pushData();
  else {
    saveGithub();
    setStatus(`Sincronizado con ${github.owner}/${github.repo}`);
  }
}

async function scheduleSync() {
  if (!github?.token || !github.owner || !github.repo) {
    setStatus("Guardado en este celular");
    return false;
  }
  if (syncing) {
    syncQueued = true;
    return false;
  }
  syncing = true;
  setStatus("Sincronizando con GitHub…");
  try {
    await pullAndMerge();
    return true;
  } catch (error) {
    setStatus(error.status === 401 ? "El token de GitHub no es válido" : "Sin sincronizar. Se reintenta al guardar de nuevo");
    return false;
  } finally {
    syncing = false;
    if (syncQueued) {
      syncQueued = false;
      scheduleSync();
    }
  }
}

function showGithubForm() {
  repoInput.value = github?.repo || "mis-gastos-datos";
  tokenInput.value = "";
  disconnectButton.classList.toggle("hidden", !github?.token);
  if (github?.owner) settingsMessage.textContent = `Conectado como ${github.owner}.`;
}

document.querySelector("#github-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  const repo = repoInput.value.trim();
  if (!token || !repo) {
    settingsMessage.textContent = "Escribe el token y el nombre del repositorio.";
    return;
  }
  github = { token, repo, owner: "", sha: "" };
  settingsMessage.textContent = "Comprobando el token…";
  try {
    const user = await githubRequest("/user");
    github.owner = user.login;
    const existing = await githubRequest(`/repos/${github.owner}/${github.repo}`);
    if (!existing) {
      await githubRequest("/user/repos", {
        method: "POST",
        body: JSON.stringify({
          name: github.repo,
          private: true,
          description: "Registro privado de Mis Gastos",
        }),
      });
    }
    saveGithub();
    showGithubForm();
    const synced = await scheduleSync();
    settingsMessage.textContent = synced
      ? `Listo. Los gastos se guardan en ${github.owner}/${github.repo}.`
      : "La cuenta conectó, pero el archivo todavía no se sincronizó. Revisa el permiso Contents del token.";
  } catch (error) {
    github = null;
    saveGithub();
    settingsMessage.textContent = error.status === 404
      ? "No pude crear el repositorio. Créalo privado y vacío en GitHub, y vuelve a conectar."
      : "No pude conectar. Revisa que el token tenga acceso de escritura a ese repositorio.";
    setStatus("Guardado en este celular");
  }
});

disconnectButton.addEventListener("click", () => {
  github = null;
  saveGithub();
  showGithubForm();
  settingsMessage.textContent = "Token eliminado de este celular. Los gastos locales siguen aquí.";
  setStatus("Guardado en este celular");
});

function boot() {
  dateInput.value = todayIso();
  monthInput.value = todayIso().slice(0, 7);
  renderChoices();
  renderMonth();
  showGithubForm();
  if (github?.token) scheduleSync();
  else setStatus("Guardado en este celular");
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
