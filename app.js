const STORAGE_TABS = "splitdiff.tabs";
const STORAGE_ACTIVE = "splitdiff.activeTab";
const STORAGE_PREFIX = "splitdiff.tab.";

const state = {
  left: { text: "", name: "Left", lang: "auto", detectedLang: "plaintext" },
  right: { text: "", name: "Right", lang: "auto", detectedLang: "plaintext" },
};

let tabs = [];
let activeTabId = null;

const elements = {
  left: {
    file: document.getElementById("left-file"),
    lang: document.getElementById("left-lang"),
    name: document.getElementById("left-name"),
    view: document.getElementById("left-view"),
    hint: document.getElementById("left-hint"),
    lines: document.getElementById("left-lines"),
  },
  right: {
    file: document.getElementById("right-file"),
    lang: document.getElementById("right-lang"),
    name: document.getElementById("right-name"),
    view: document.getElementById("right-view"),
    hint: document.getElementById("right-hint"),
    lines: document.getElementById("right-lines"),
  },
  wrapToggle: document.getElementById("wrapToggle"),
  syncToggle: document.getElementById("syncToggle"),
  swapBtn: document.getElementById("swapBtn"),
  clearBtn: document.getElementById("clearBtn"),
  summary: document.getElementById("summary"),
  hScrollbar: document.getElementById("h-scrollbar"),
  hScrollbarInner: document.getElementById("h-scrollbar-inner"),
  tabs: document.getElementById("tabs"),
  newTabBtn: document.getElementById("newTabBtn"),
  closeAllBtn: document.getElementById("closeAllBtn"),
  modalBackdrop: document.getElementById("modal-backdrop"),
  modalClose: document.getElementById("modal-close"),
  modalCancel: document.getElementById("modal-cancel"),
  modalConfirm: document.getElementById("modal-confirm"),
};

const extensionMap = {
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  html: "xml",
  htm: "xml",
  cs: "csharp",
  py: "python",
  ps1: "powershell",
  ps: "powershell",
  md: "markdown",
  markdown: "markdown",
  txt: "plaintext",
};

function normalize(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  return text.replace(/[&<>]/g, (c) => map[c]);
}

function detectLangByExtension(name) {
  if (!name) return "plaintext";
  const parts = name.split(".");
  if (parts.length < 2) return "plaintext";
  const ext = parts.pop().toLowerCase();
  return extensionMap[ext] || "plaintext";
}

function detectLangByContent(text) {
  if (!window.hljs || text.length > 200000) return "plaintext";
  const firstLine = text.split("\n", 1)[0] || "";
  if (/^#!.*\b(bash|sh|zsh)\b/.test(firstLine)) return "bash";
  if (/^#!.*\b(pwsh|powershell)\b/.test(firstLine)) return "powershell";
  try {
    const result = hljs.highlightAuto(text, [
      "bash",
      "typescript",
      "javascript",
      "xml",
      "csharp",
      "python",
      "powershell",
      "markdown",
    ]);
    return result.language || "plaintext";
  } catch {
    return "plaintext";
  }
}

function setSideText(side, text, name) {
  const normalized = normalize(text);
  state[side].text = normalized;
  if (name) state[side].name = name;

  const extLang = detectLangByExtension(name);
  state[side].detectedLang = extLang !== "plaintext" ? extLang : detectLangByContent(normalized);

  updateHints();
  updateDiff();
  persistActiveTab();
}

function updateHints() {
  ["left", "right"].forEach((side) => {
    const hasText = state[side].text.length > 0;
    elements[side].hint.classList.toggle("hidden", hasText);
    elements[side].name.textContent = state[side].name || (side === "left" ? "Left" : "Right");
  });
}

function highlightLine(line, lang) {
  if (!line) return "&nbsp;";
  if (window.hljs && lang && lang !== "plaintext") {
    try {
      return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value || escapeHtml(line);
    } catch {
      return escapeHtml(line);
    }
  }
  return escapeHtml(line);
}

function safeParse(json, fallback) {
  try {
    const parsed = JSON.parse(json);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadTabsMeta() {
  const data = safeParse(localStorage.getItem(STORAGE_TABS), []);
  return Array.isArray(data) ? data : [];
}

function saveTabsMeta(data) {
  localStorage.setItem(STORAGE_TABS, JSON.stringify(data));
}

function loadTabContent(id) {
  return safeParse(localStorage.getItem(`${STORAGE_PREFIX}${id}`), null);
}

function saveTabContent(id, content) {
  localStorage.setItem(`${STORAGE_PREFIX}${id}`, JSON.stringify(content));
}

function removeTabContent(id) {
  localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
}

function shortName(name) {
  if (!name) return "";
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] || name;
}

function tabLabel(tab) {
  const left = shortName(tab.leftName);
  const right = shortName(tab.rightName);
  if (left && right && left !== "Left" && right !== "Right") {
    return `${left} <-> ${right}`;
  }
  if (left && left !== "Left") return left;
  if (right && right !== "Right") return right;
  return "Untitled";
}

function persistActiveTab() {
  if (!activeTabId) return;
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  if (index === -1) return;

  tabs[index] = {
    ...tabs[index],
    leftName: state.left.name,
    rightName: state.right.name,
    leftLang: state.left.lang,
    rightLang: state.right.lang,
    updatedAt: Date.now(),
  };

  saveTabsMeta(tabs);
  saveTabContent(activeTabId, {
    left: { text: state.left.text, name: state.left.name, lang: state.left.lang },
    right: { text: state.right.text, name: state.right.name, lang: state.right.lang },
  });
  renderTabs();
}

function createTab() {
  const id = createId();
  const tab = {
    id,
    leftName: "Left",
    rightName: "Right",
    leftLang: "auto",
    rightLang: "auto",
    updatedAt: Date.now(),
  };
  tabs.push(tab);
  saveTabsMeta(tabs);
  saveTabContent(id, {
    left: { text: "", name: "Left", lang: "auto" },
    right: { text: "", name: "Right", lang: "auto" },
  });
  return id;
}

function buildSideState(sideData, fallbackName) {
  const text = normalize(sideData?.text || "");
  const name = sideData?.name || fallbackName;
  const lang = sideData?.lang || "auto";
  const extLang = detectLangByExtension(name);
  const detectedLang = extLang !== "plaintext" ? extLang : detectLangByContent(text);
  return { text, name, lang, detectedLang };
}

function applyTabContent(tabContent) {
  const leftData = tabContent?.left || { text: "", name: "Left", lang: "auto" };
  const rightData = tabContent?.right || { text: "", name: "Right", lang: "auto" };

  state.left = buildSideState(leftData, "Left");
  state.right = buildSideState(rightData, "Right");

  elements.left.lang.value = state.left.lang;
  elements.right.lang.value = state.right.lang;

  updateHints();
  updateDiff();
}

function setActiveTab(id, options = {}) {
  if (!id) return;
  if (!options.skipSave) persistActiveTab();
  activeTabId = id;
  localStorage.setItem(STORAGE_ACTIVE, id);
  const content = loadTabContent(id) || {
    left: { text: "", name: "Left", lang: "auto" },
    right: { text: "", name: "Right", lang: "auto" },
  };
  applyTabContent(content);
  renderTabs();
}

function renderTabs() {
  if (!elements.tabs) return;
  const addButton = elements.newTabBtn;
  elements.tabs.innerHTML = "";
  if (addButton) elements.tabs.append(addButton);
  const fragment = document.createDocumentFragment();

  tabs.forEach((tab) => {
    const tabEl = document.createElement("div");
    tabEl.className = `tab${tab.id === activeTabId ? " active" : ""}`;
    tabEl.setAttribute("role", "button");
    tabEl.setAttribute("tabindex", "0");
    tabEl.dataset.id = tab.id;

    const label = document.createElement("span");
    label.textContent = tabLabel(tab);

    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.textContent = "x";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    });

    tabEl.append(label, close);
    tabEl.addEventListener("click", () => setActiveTab(tab.id));
    tabEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActiveTab(tab.id);
      }
    });

    fragment.append(tabEl);
  });

  elements.tabs.append(fragment);
}

function closeTab(id) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  const wasActive = id === activeTabId;
  tabs.splice(index, 1);
  removeTabContent(id);
  saveTabsMeta(tabs);

  if (!tabs.length) {
    const newId = createTab();
    setActiveTab(newId, { skipSave: true });
    return;
  }

  if (wasActive) {
    const next = tabs[index] || tabs[index - 1] || tabs[0];
    setActiveTab(next.id, { skipSave: true });
  } else {
    renderTabs();
  }
}

function closeAllTabs() {
  tabs.forEach((tab) => removeTabContent(tab.id));
  tabs = [];
  saveTabsMeta(tabs);
  localStorage.removeItem(STORAGE_ACTIVE);

  const newId = createTab();
  setActiveTab(newId, { skipSave: true });
}

function openModal() {
  elements.modalBackdrop.classList.remove("hidden");
  elements.modalConfirm.focus();
}

function closeModal() {
  elements.modalBackdrop.classList.add("hidden");
  elements.closeAllBtn.focus();
}

function initTabs() {
  tabs = loadTabsMeta();
  if (!tabs.length) {
    const id = createTab();
    setActiveTab(id, { skipSave: true });
    return;
  }

  const storedActive = localStorage.getItem(STORAGE_ACTIVE);
  const fallbackId = tabs[0]?.id;
  const activeId = tabs.some((tab) => tab.id === storedActive) ? storedActive : fallbackId;
  setActiveTab(activeId, { skipSave: true });
}

function lcsDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: "equal", line: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "delete", line: a[i - 1] });
      i--;
    } else {
      ops.push({ type: "insert", line: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: "delete", line: a[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ type: "insert", line: b[j - 1] });
    j--;
  }

  return ops.reverse();
}

function alignOps(ops) {
  const left = [];
  const right = [];
  let leftLine = 0;
  let rightLine = 0;
  let i = 0;

  while (i < ops.length) {
    if (ops[i].type === "equal") {
      left.push({ type: "equal", text: ops[i].line, ln: ++leftLine });
      right.push({ type: "equal", text: ops[i].line, ln: ++rightLine });
      i++;
      continue;
    }

    const dels = [];
    const ins = [];
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "delete") {
        dels.push(ops[i].line);
      } else {
        ins.push(ops[i].line);
      }
      i++;
    }

    const max = Math.max(dels.length, ins.length);
    for (let k = 0; k < max; k++) {
      if (k < dels.length) {
        left.push({ type: "delete", text: dels[k], ln: ++leftLine });
      } else {
        left.push({ type: "empty", text: "", ln: null });
      }

      if (k < ins.length) {
        right.push({ type: "insert", text: ins[k], ln: ++rightLine });
      } else {
        right.push({ type: "empty", text: "", ln: null });
      }
    }
  }

  return { left, right };
}

function render(side, lines, lang) {
  const container = elements[side].lines;
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();

  lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = `line ${line.type}`;

    const ln = document.createElement("div");
    ln.className = "ln";
    ln.textContent = line.ln ?? "";

    const code = document.createElement("div");
    code.className = "code";
    code.innerHTML = highlightLine(line.text, lang);

    row.append(ln, code);
    fragment.append(row);
  });

  container.append(fragment);
}

function updateDiff() {
  const leftLines = state.left.text ? state.left.text.split("\n") : [];
  const rightLines = state.right.text ? state.right.text.split("\n") : [];

  if (!leftLines.length && !rightLines.length) {
    elements.summary.textContent = "Drop files on either side to get started.";
    elements.left.lines.innerHTML = "";
    elements.right.lines.innerHTML = "";
    updateHorizontalScrollbar();
    return;
  }

  const ops = lcsDiff(leftLines, rightLines);
  const aligned = alignOps(ops);

  const leftLang = state.left.lang === "auto" ? state.left.detectedLang : state.left.lang;
  const rightLang = state.right.lang === "auto" ? state.right.detectedLang : state.right.lang;

  render("left", aligned.left, leftLang);
  render("right", aligned.right, rightLang);

  const inserts = aligned.right.filter((line) => line.type === "insert").length;
  const deletes = aligned.left.filter((line) => line.type === "delete").length;
  const total = Math.max(leftLines.length, rightLines.length);

  elements.summary.textContent = `Lines: ${total} · +${inserts} added · -${deletes} removed`;
  updateHorizontalScrollbar();
}

function updateHorizontalScrollbar() {
  const leftWidth = elements.left.lines.scrollWidth;
  const rightWidth = elements.right.lines.scrollWidth;
  const viewportWidth = Math.max(elements.left.view.clientWidth, elements.right.view.clientWidth);
  const maxWidth = Math.max(leftWidth, rightWidth, viewportWidth);

  elements.hScrollbarInner.style.width = `${maxWidth}px`;

  const shouldHide =
    elements.wrapToggle.checked || maxWidth <= viewportWidth + 1;

  elements.hScrollbar.classList.toggle("hidden", shouldHide);
}

function handleFileInput(side, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setSideText(side, reader.result, file.name);
  reader.readAsText(file);
}

function handleDrop(side, event) {
  event.preventDefault();
  event.stopPropagation();
  elements[side].view.classList.remove("drag");

  const files = event.dataTransfer.files;
  if (files && files.length > 0) {
    handleFileInput(side, files[0]);
    return;
  }

  const text = event.dataTransfer.getData("text/plain");
  if (text) {
    setSideText(side, text, "Dropped text");
  }
}

function setupDropZone(side) {
  const view = elements[side].view;

  view.addEventListener("dragover", (event) => {
    event.preventDefault();
    view.classList.add("drag");
  });

  view.addEventListener("dragleave", () => view.classList.remove("drag"));
  view.addEventListener("drop", (event) => handleDrop(side, event));

  view.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    setSideText(side, text, "Pasted text");
  });
}

function swapSides() {
  const left = { ...state.left };
  const right = { ...state.right };
  state.left = right;
  state.right = left;

  elements.left.lang.value = state.left.lang;
  elements.right.lang.value = state.right.lang;

  updateHints();
  updateDiff();
  persistActiveTab();
}

function clearAll() {
  state.left = { text: "", name: "Left", lang: elements.left.lang.value, detectedLang: "plaintext" };
  state.right = { text: "", name: "Right", lang: elements.right.lang.value, detectedLang: "plaintext" };
  updateHints();
  updateDiff();
  persistActiveTab();
}

function setupScrollSync() {
  let syncing = false;
  const leftView = elements.left.view;
  const rightView = elements.right.view;
  const hScrollbar = elements.hScrollbar;

  function syncScroll(source, target) {
    if (!elements.syncToggle.checked || syncing) return;
    syncing = true;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => (syncing = false));
  }

  function syncHorizontalFromPane(source) {
    if (syncing) return;
    syncing = true;
    const left = elements.left.view;
    const right = elements.right.view;
    const scrollLeft = source.scrollLeft;
    left.scrollLeft = scrollLeft;
    right.scrollLeft = scrollLeft;
    hScrollbar.scrollLeft = scrollLeft;
    requestAnimationFrame(() => (syncing = false));
  }

  function syncHorizontalFromBar() {
    if (syncing) return;
    syncing = true;
    const scrollLeft = hScrollbar.scrollLeft;
    elements.left.view.scrollLeft = scrollLeft;
    elements.right.view.scrollLeft = scrollLeft;
    requestAnimationFrame(() => (syncing = false));
  }

  leftView.addEventListener("scroll", () => {
    syncScroll(leftView, rightView);
    syncHorizontalFromPane(leftView);
  });
  rightView.addEventListener("scroll", () => {
    syncScroll(rightView, leftView);
    syncHorizontalFromPane(rightView);
  });
  hScrollbar.addEventListener("scroll", syncHorizontalFromBar);
}

function setupEvents() {
  elements.left.file.addEventListener("change", (event) => {
    handleFileInput("left", event.target.files[0]);
  });
  elements.right.file.addEventListener("change", (event) => {
    handleFileInput("right", event.target.files[0]);
  });

  elements.left.lang.addEventListener("change", (event) => {
    state.left.lang = event.target.value;
    updateDiff();
    persistActiveTab();
  });
  elements.right.lang.addEventListener("change", (event) => {
    state.right.lang = event.target.value;
    updateDiff();
    persistActiveTab();
  });

  elements.wrapToggle.addEventListener("change", (event) => {
    elements.left.view.classList.toggle("wrap", event.target.checked);
    elements.right.view.classList.toggle("wrap", event.target.checked);
    updateHorizontalScrollbar();
  });

  elements.swapBtn.addEventListener("click", swapSides);
  elements.clearBtn.addEventListener("click", clearAll);
  elements.newTabBtn.addEventListener("click", () => {
    persistActiveTab();
    const id = createTab();
    setActiveTab(id, { skipSave: true });
  });
  elements.closeAllBtn.addEventListener("click", openModal);
  elements.modalClose.addEventListener("click", closeModal);
  elements.modalCancel.addEventListener("click", closeModal);
  elements.modalConfirm.addEventListener("click", () => {
    closeModal();
    closeAllTabs();
  });
  elements.modalBackdrop.addEventListener("click", (event) => {
    if (event.target === elements.modalBackdrop) closeModal();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.modalBackdrop.classList.contains("hidden")) {
      closeModal();
    }
  });

  setupDropZone("left");
  setupDropZone("right");
  setupScrollSync();
  window.addEventListener("resize", updateHorizontalScrollbar);
  initTabs();
}

setupEvents();
