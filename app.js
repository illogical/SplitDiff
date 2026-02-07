const STORAGE_TABS = "splitdiff.tabs";
const STORAGE_ACTIVE = "splitdiff.activeTab";
const STORAGE_PREFIX = "splitdiff.tab.";

const state = {
  left: { text: "", name: "Left", lang: "auto", detectedLang: "plaintext" },
  right: { text: "", name: "Right", lang: "auto", detectedLang: "plaintext" },
};

const diffUi = {
  ignoreWhitespace: false,
  collapseUnchanged: false,
  hunks: [],
  hunkByRaw: [],
  activeHunkIndex: -1,
  activeHunkId: null,
  reviewed: new Set(),
  expandedBlocks: new Set(),
  search: { query: "", rows: [], activeIndex: -1 },
  display: { left: [], right: [] },
  displayIndexByRaw: [],
  summaryText: "",
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
  prevFileBtn: document.getElementById("prevFileBtn"),
  nextFileBtn: document.getElementById("nextFileBtn"),
  firstChangeBtn: document.getElementById("firstChangeBtn"),
  prevChangeBtn: document.getElementById("prevChangeBtn"),
  nextChangeBtn: document.getElementById("nextChangeBtn"),
  lastChangeBtn: document.getElementById("lastChangeBtn"),
  whitespaceToggle: document.getElementById("whitespaceToggle"),
  collapseToggle: document.getElementById("collapseToggle"),
  searchInput: document.getElementById("searchInput"),
  searchPrevBtn: document.getElementById("searchPrevBtn"),
  searchNextBtn: document.getElementById("searchNextBtn"),
  searchCount: document.getElementById("searchCount"),
  markReviewedBtn: document.getElementById("markReviewedBtn"),
  hunkStatus: document.getElementById("hunkStatus"),
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
  leftCopyBtn: document.getElementById("left-copy"),
  rightCopyBtn: document.getElementById("right-copy"),
  hintActions: document.querySelectorAll(".hint-action"),
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

const COLLAPSE_CONTEXT = 2;
const COLLAPSE_MIN = COLLAPSE_CONTEXT * 2 + 4;

function normalize(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeForCompare(line) {
  if (!diffUi.ignoreWhitespace) return line;
  return line.replace(/\s+/g, "");
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

  diffUi.expandedBlocks.clear();
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
    reviewed: Array.from(diffUi.reviewed),
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
    reviewed: [],
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
  diffUi.reviewed = new Set(tabContent?.reviewed || []);
  diffUi.expandedBlocks.clear();
  diffUi.activeHunkIndex = -1;
  diffUi.activeHunkId = null;

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

function lcsDiff(aRaw, bRaw, aCmp = aRaw, bCmp = bRaw) {
  const n = aCmp.length;
  const m = bCmp.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (aCmp[i - 1] === bCmp[j - 1]) {
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
    if (aCmp[i - 1] === bCmp[j - 1]) {
      ops.push({ type: "equal", left: aRaw[i - 1], right: bRaw[j - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "delete", left: aRaw[i - 1] });
      i--;
    } else {
      ops.push({ type: "insert", right: bRaw[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: "delete", left: aRaw[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ type: "insert", right: bRaw[j - 1] });
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
      left.push({ type: "equal", text: ops[i].left, ln: ++leftLine });
      right.push({ type: "equal", text: ops[i].right, ln: ++rightLine });
      i++;
      continue;
    }

    const dels = [];
    const ins = [];
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "delete") {
        dels.push(ops[i].left);
      } else {
        ins.push(ops[i].right);
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

function firstLineNumber(lines, start, end) {
  for (let i = start; i <= end; i++) {
    if (lines[i].ln !== null && lines[i].ln !== undefined) return lines[i].ln;
  }
  return null;
}

function buildHunks(aligned) {
  const hunks = [];
  const left = aligned.left;
  const right = aligned.right;
  let i = 0;

  while (i < left.length) {
    const isEqual = left[i].type === "equal" && right[i].type === "equal";
    if (isEqual) {
      i++;
      continue;
    }

    const start = i;
    while (i < left.length) {
      const equal = left[i].type === "equal" && right[i].type === "equal";
      if (equal) break;
      i++;
    }
    const end = i - 1;
    const leftStartLine = firstLineNumber(left, start, end);
    const rightStartLine = firstLineNumber(right, start, end);
    const id = `h-${leftStartLine ?? "n"}-${rightStartLine ?? "n"}-${start}-${end}`;

    hunks.push({ id, start, end, leftStartLine, rightStartLine });
  }

  return hunks;
}

function buildHunkMap(length, hunks) {
  const map = new Array(length).fill(null);
  hunks.forEach((hunk) => {
    for (let i = hunk.start; i <= hunk.end; i++) {
      map[i] = hunk.id;
    }
  });
  return map;
}

function buildDisplay(aligned) {
  const leftDisplay = [];
  const rightDisplay = [];
  const indexMap = new Array(aligned.left.length).fill(null);

  let i = 0;
  while (i < aligned.left.length) {
    const isEqual = aligned.left[i].type === "equal" && aligned.right[i].type === "equal";
    if (!diffUi.collapseUnchanged || !isEqual) {
      const leftLine = { ...aligned.left[i], rawIndex: i };
      const rightLine = { ...aligned.right[i], rawIndex: i };
      indexMap[i] = leftDisplay.length;
      leftDisplay.push(leftLine);
      rightDisplay.push(rightLine);
      i++;
      continue;
    }

    const start = i;
    while (i < aligned.left.length) {
      const equal = aligned.left[i].type === "equal" && aligned.right[i].type === "equal";
      if (!equal) break;
      i++;
    }
    const end = i - 1;
    const length = end - start + 1;
    const blockId = `block-${start}-${end}`;

    if (length <= COLLAPSE_MIN || diffUi.expandedBlocks.has(blockId)) {
      for (let k = start; k <= end; k++) {
        const leftLine = { ...aligned.left[k], rawIndex: k };
        const rightLine = { ...aligned.right[k], rawIndex: k };
        indexMap[k] = leftDisplay.length;
        leftDisplay.push(leftLine);
        rightDisplay.push(rightLine);
      }
      continue;
    }

    const headEnd = start + COLLAPSE_CONTEXT - 1;
    const tailStart = end - COLLAPSE_CONTEXT + 1;
    for (let k = start; k <= headEnd; k++) {
      const leftLine = { ...aligned.left[k], rawIndex: k };
      const rightLine = { ...aligned.right[k], rawIndex: k };
      indexMap[k] = leftDisplay.length;
      leftDisplay.push(leftLine);
      rightDisplay.push(rightLine);
    }

    const hiddenCount = tailStart - headEnd - 1;
    const message = `... ${hiddenCount} unchanged line${hiddenCount === 1 ? "" : "s"} (click to expand)`;
    const collapsedLine = {
      type: "collapsed",
      text: message,
      ln: "",
      rawIndex: headEnd + 1,
      blockId,
      rawStart: headEnd + 1,
      rawEnd: tailStart - 1,
    };
    const collapsedIndex = leftDisplay.length;
    leftDisplay.push(collapsedLine);
    rightDisplay.push({ ...collapsedLine });
    for (let k = headEnd + 1; k <= tailStart - 1; k++) {
      indexMap[k] = collapsedIndex;
    }

    for (let k = tailStart; k <= end; k++) {
      const leftLine = { ...aligned.left[k], rawIndex: k };
      const rightLine = { ...aligned.right[k], rawIndex: k };
      indexMap[k] = leftDisplay.length;
      leftDisplay.push(leftLine);
      rightDisplay.push(rightLine);
    }
  }

  return { left: leftDisplay, right: rightDisplay, indexMap };
}

function render(side, lines, lang) {
  const container = elements[side].lines;
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();

  lines.forEach((line, index) => {
    const row = document.createElement("div");
    row.className = `line ${line.type}`;
    row.dataset.index = index;
    if (line.rawIndex !== undefined && line.rawIndex !== null) {
      row.dataset.rawIndex = line.rawIndex;
    }
    if (line.blockId) {
      row.dataset.blockId = line.blockId;
      row.dataset.rawStart = line.rawStart;
      row.dataset.rawEnd = line.rawEnd;
    }

    const ln = document.createElement("div");
    ln.className = "ln";
    ln.textContent = line.ln ?? "";

    const code = document.createElement("div");
    code.className = "code";
    if (line.type === "collapsed") {
      code.textContent = line.text;
    } else {
      code.innerHTML = highlightLine(line.text, lang);
    }

    row.append(ln, code);
    fragment.append(row);
  });

  container.append(fragment);
}

let summaryTimeout = null;

function flashSummary(message, duration = 2000) {
  if (!elements.summary) return;
  window.clearTimeout(summaryTimeout);
  elements.summary.textContent = message;
  summaryTimeout = window.setTimeout(() => {
    elements.summary.textContent = diffUi.summaryText || elements.summary.textContent;
  }, duration);
}

function updateHunkStatus() {
  if (!elements.hunkStatus || !elements.markReviewedBtn) return;
  if (!diffUi.hunks.length) {
    elements.hunkStatus.textContent = "No changes";
    elements.markReviewedBtn.textContent = "Mark Reviewed";
    elements.markReviewedBtn.disabled = true;
    return;
  }

  const index = diffUi.activeHunkIndex < 0 ? 0 : diffUi.activeHunkIndex;
  const hunk = diffUi.hunks[index];
  const reviewed = diffUi.reviewed.has(hunk.id);
  elements.hunkStatus.textContent = `Hunk ${index + 1}/${diffUi.hunks.length} · ${reviewed ? "Reviewed" : "Unreviewed"}`;
  elements.markReviewedBtn.textContent = reviewed ? "Mark Unreviewed" : "Mark Reviewed";
  elements.markReviewedBtn.disabled = false;
}

function updateSearchUI() {
  if (!elements.searchCount) return;
  const total = diffUi.search.rows.length;
  const current = total ? diffUi.search.activeIndex + 1 : 0;
  elements.searchCount.textContent = `${current}/${total}`;
}

function updateSearchMatches({ keepActive = false } = {}) {
  const query = diffUi.search.query.trim().toLowerCase();
  const rows = [];

  if (query) {
    for (let i = 0; i < diffUi.display.left.length; i++) {
      const leftLine = diffUi.display.left[i];
      const rightLine = diffUi.display.right[i];
      if (leftLine?.type === "collapsed" || rightLine?.type === "collapsed") continue;
      const leftMatch = leftLine?.text?.toLowerCase().includes(query);
      const rightMatch = rightLine?.text?.toLowerCase().includes(query);
      if (leftMatch || rightMatch) rows.push(i);
    }
  }

  diffUi.search.rows = rows;
  if (!keepActive) {
    diffUi.search.activeIndex = rows.length ? 0 : -1;
  } else if (diffUi.search.activeIndex >= rows.length) {
    diffUi.search.activeIndex = rows.length ? 0 : -1;
  }
  updateSearchUI();
}

function clearSearchMarks(container) {
  if (!container) return;
  const marks = container.querySelectorAll("mark.search-mark");
  marks.forEach((mark) => {
    const textNode = document.createTextNode(mark.textContent);
    mark.replaceWith(textNode);
  });
  container.normalize();
}

function highlightMatchesInElement(element, queryLower) {
  if (!element || !queryLower) return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach((node) => {
    const text = node.nodeValue;
    if (!text) return;
    const lower = text.toLowerCase();
    let idx = lower.indexOf(queryLower);
    if (idx === -1) return;

    const frag = document.createDocumentFragment();
    let last = 0;
    while (idx !== -1) {
      if (idx > last) {
        frag.append(document.createTextNode(text.slice(last, idx)));
      }
      const mark = document.createElement("mark");
      mark.className = "search-mark";
      mark.textContent = text.slice(idx, idx + queryLower.length);
      frag.append(mark);
      last = idx + queryLower.length;
      idx = lower.indexOf(queryLower, last);
    }
    if (last < text.length) {
      frag.append(document.createTextNode(text.slice(last)));
    }
    node.parentNode.replaceChild(frag, node);
  });
}

function updateSearchHighlights() {
  const query = diffUi.search.query.trim();
  clearSearchMarks(elements.left.lines);
  clearSearchMarks(elements.right.lines);
  if (!query) return;
  const queryLower = query.toLowerCase();

  diffUi.search.rows.forEach((index) => {
    const leftRow = elements.left.lines.querySelector(`.line[data-index="${index}"]`);
    const rightRow = elements.right.lines.querySelector(`.line[data-index="${index}"]`);
    if (leftRow && !leftRow.classList.contains("collapsed")) {
      highlightMatchesInElement(leftRow.querySelector(".code"), queryLower);
    }
    if (rightRow && !rightRow.classList.contains("collapsed")) {
      highlightMatchesInElement(rightRow.querySelector(".code"), queryLower);
    }
  });
}

function applyDecorations() {
  const searchRows = new Set(diffUi.search.rows);
  const activeSearchRow = diffUi.search.rows[diffUi.search.activeIndex];
  const activeHunkId = diffUi.activeHunkId;

  ["left", "right"].forEach((side) => {
    const rows = elements[side].lines.children;
    Array.from(rows).forEach((row) => {
      const index = Number(row.dataset.index);
      const rawIndex = Number(row.dataset.rawIndex);
      const hunkId = Number.isNaN(rawIndex) ? null : diffUi.hunkByRaw[rawIndex];

      row.classList.toggle("search-hit", searchRows.has(index));
      row.classList.toggle("search-active", index === activeSearchRow);
      row.classList.toggle("hunk-active", hunkId && hunkId === activeHunkId);
      row.classList.toggle("hunk-reviewed", hunkId && diffUi.reviewed.has(hunkId));
    });
  });
}

function setActiveHunk(index, { scroll = false } = {}) {
  if (!diffUi.hunks.length) return;
  const clamped = Math.max(0, Math.min(index, diffUi.hunks.length - 1));
  diffUi.activeHunkIndex = clamped;
  diffUi.activeHunkId = diffUi.hunks[clamped].id;
  updateHunkStatus();
  applyDecorations();
  if (scroll) scrollToHunk(clamped);
}

function scrollToRowIndex(rowIndex) {
  if (rowIndex === null || rowIndex === undefined) return;
  const leftRow = elements.left.lines.querySelector(`.line[data-index="${rowIndex}"]`);
  const rightRow = elements.right.lines.querySelector(`.line[data-index="${rowIndex}"]`);
  if (leftRow) leftRow.scrollIntoView({ block: "center" });
  if (!elements.syncToggle.checked && rightRow) {
    rightRow.scrollIntoView({ block: "center" });
  }
}

function scrollToHunk(index) {
  const hunk = diffUi.hunks[index];
  if (!hunk) return;
  let targetIndex = null;
  for (let i = hunk.start; i <= hunk.end; i++) {
    const displayIndex = diffUi.displayIndexByRaw?.[i];
    if (displayIndex !== null && displayIndex !== undefined) {
      targetIndex = displayIndex;
      break;
    }
  }
  scrollToRowIndex(targetIndex);
}

async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const success = document.execCommand("copy");
  textarea.remove();
  return success;
}

async function copySideToClipboard(side) {
  const text = state[side].text;
  if (!text) {
    flashSummary(`Nothing to copy on ${side === "left" ? "left" : "right"}.`);
    return;
  }
  try {
    await copyToClipboard(text);
    flashSummary(`${state[side].name || side} copied to clipboard.`);
  } catch {
    flashSummary("Copy failed.");
  }
}

function hasChangesFromText(leftText, rightText) {
  if (!leftText && !rightText) return false;
  const leftLines = (leftText || "").split("\n").map(normalizeForCompare);
  const rightLines = (rightText || "").split("\n").map(normalizeForCompare);
  if (leftLines.length !== rightLines.length) return true;
  for (let i = 0; i < leftLines.length; i++) {
    if (leftLines[i] !== rightLines[i]) return true;
  }
  return false;
}

function tabHasChanges(tab) {
  const content = loadTabContent(tab.id);
  if (!content) return false;
  return hasChangesFromText(content.left?.text || "", content.right?.text || "");
}

function goToAdjacentTabWithChanges(direction) {
  if (!tabs.length) return;
  persistActiveTab();
  const startIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const total = tabs.length;
  for (let step = 1; step <= total; step++) {
    const index = (startIndex + direction * step + total) % total;
    const tab = tabs[index];
    if (tabHasChanges(tab)) {
      setActiveTab(tab.id);
      return;
    }
  }
  flashSummary("No other tabs with changes.");
}

function handleLineClick(side, event) {
  const row = event.target.closest(".line");
  if (!row) return;

  if (row.classList.contains("collapsed") && row.dataset.blockId) {
    diffUi.expandedBlocks.add(row.dataset.blockId);
    updateDiff();
    return;
  }

  const index = Number(row.dataset.index);
  if (Number.isNaN(index)) return;
  const otherSide = side === "left" ? "right" : "left";
  const otherRow = elements[otherSide].lines.querySelector(`.line[data-index="${index}"]`);
  if (otherRow) {
    otherRow.scrollIntoView({ block: "center" });
  }

  const rawIndex = Number(row.dataset.rawIndex);
  if (!Number.isNaN(rawIndex)) {
    const hunkId = diffUi.hunkByRaw[rawIndex];
    if (hunkId) {
      const hunkIndex = diffUi.hunks.findIndex((hunk) => hunk.id === hunkId);
      if (hunkIndex !== -1) {
        setActiveHunk(hunkIndex);
      }
    }
  }
}

function updateDiff() {
  const leftLines = state.left.text ? state.left.text.split("\n") : [];
  const rightLines = state.right.text ? state.right.text.split("\n") : [];

  if (!leftLines.length && !rightLines.length) {
    elements.summary.textContent = "Drop files on either side to get started.";
    diffUi.summaryText = elements.summary.textContent;
    elements.left.lines.innerHTML = "";
    elements.right.lines.innerHTML = "";
    diffUi.display = { left: [], right: [] };
    diffUi.displayIndexByRaw = [];
    diffUi.hunks = [];
    diffUi.hunkByRaw = [];
    diffUi.activeHunkIndex = -1;
    diffUi.activeHunkId = null;
    updateHunkStatus();
  updateSearchMatches({ keepActive: false });
  applyDecorations();
  updateSearchHighlights();
  updateHorizontalScrollbar();
  return;
}

  const leftCompare = leftLines.map(normalizeForCompare);
  const rightCompare = rightLines.map(normalizeForCompare);
  const ops = lcsDiff(leftLines, rightLines, leftCompare, rightCompare);
  const aligned = alignOps(ops);
  const display = buildDisplay(aligned);
  diffUi.display = { left: display.left, right: display.right };
  diffUi.displayIndexByRaw = display.indexMap;
  diffUi.hunks = buildHunks(aligned);
  diffUi.hunkByRaw = buildHunkMap(aligned.left.length, diffUi.hunks);

  const hunkIds = new Set(diffUi.hunks.map((hunk) => hunk.id));
  diffUi.reviewed = new Set(Array.from(diffUi.reviewed).filter((id) => hunkIds.has(id)));
  if (!diffUi.hunks.length) {
    diffUi.activeHunkIndex = -1;
    diffUi.activeHunkId = null;
  } else {
    const desiredIndex = diffUi.activeHunkId
      ? diffUi.hunks.findIndex((hunk) => hunk.id === diffUi.activeHunkId)
      : diffUi.activeHunkIndex;
    diffUi.activeHunkIndex = desiredIndex >= 0 ? desiredIndex : 0;
    diffUi.activeHunkId = diffUi.hunks[diffUi.activeHunkIndex]?.id || null;
  }

  const leftLang = state.left.lang === "auto" ? state.left.detectedLang : state.left.lang;
  const rightLang = state.right.lang === "auto" ? state.right.detectedLang : state.right.lang;

  render("left", display.left, leftLang);
  render("right", display.right, rightLang);

  const inserts = aligned.right.filter((line) => line.type === "insert").length;
  const deletes = aligned.left.filter((line) => line.type === "delete").length;
  const total = Math.max(leftLines.length, rightLines.length);

  diffUi.summaryText = `Lines: ${total} · +${inserts} added · -${deletes} removed`;
  elements.summary.textContent = diffUi.summaryText;
  updateHunkStatus();
  updateSearchMatches({ keepActive: true });
  applyDecorations();
  updateSearchHighlights();
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
  diffUi.expandedBlocks.clear();

  elements.left.lang.value = state.left.lang;
  elements.right.lang.value = state.right.lang;

  updateHints();
  updateDiff();
  persistActiveTab();
}

function clearAll() {
  state.left = { text: "", name: "Left", lang: elements.left.lang.value, detectedLang: "plaintext" };
  state.right = { text: "", name: "Right", lang: elements.right.lang.value, detectedLang: "plaintext" };
  diffUi.reviewed.clear();
  diffUi.expandedBlocks.clear();
  diffUi.activeHunkIndex = -1;
  diffUi.activeHunkId = null;
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
  elements.leftCopyBtn.addEventListener("click", () => copySideToClipboard("left"));
  elements.rightCopyBtn.addEventListener("click", () => copySideToClipboard("right"));
  elements.hintActions.forEach((button) => {
    button.addEventListener("click", () => {
      const side = button.dataset.side;
      if (!side) return;
      elements[side].file.click();
    });
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
  elements.whitespaceToggle.addEventListener("change", (event) => {
    diffUi.ignoreWhitespace = event.target.checked;
    updateDiff();
  });
  elements.collapseToggle.addEventListener("change", (event) => {
    diffUi.collapseUnchanged = event.target.checked;
    if (!diffUi.collapseUnchanged) diffUi.expandedBlocks.clear();
    updateDiff();
  });

  elements.swapBtn.addEventListener("click", swapSides);
  elements.clearBtn.addEventListener("click", clearAll);
  elements.prevFileBtn.addEventListener("click", () => goToAdjacentTabWithChanges(-1));
  elements.nextFileBtn.addEventListener("click", () => goToAdjacentTabWithChanges(1));
  elements.firstChangeBtn.addEventListener("click", () => setActiveHunk(0, { scroll: true }));
  elements.lastChangeBtn.addEventListener("click", () => setActiveHunk(diffUi.hunks.length - 1, { scroll: true }));
  elements.prevChangeBtn.addEventListener("click", () =>
    setActiveHunk(diffUi.activeHunkIndex - 1, { scroll: true })
  );
  elements.nextChangeBtn.addEventListener("click", () =>
    setActiveHunk(diffUi.activeHunkIndex + 1, { scroll: true })
  );
  elements.markReviewedBtn.addEventListener("click", () => {
    const hunk = diffUi.hunks[diffUi.activeHunkIndex];
    if (!hunk) return;
    if (diffUi.reviewed.has(hunk.id)) {
      diffUi.reviewed.delete(hunk.id);
    } else {
      diffUi.reviewed.add(hunk.id);
    }
    persistActiveTab();
    updateHunkStatus();
    applyDecorations();
  });
  elements.searchInput.addEventListener("input", (event) => {
    diffUi.search.query = event.target.value;
    updateSearchMatches({ keepActive: false });
    applyDecorations();
    updateSearchHighlights();
  });
  elements.searchPrevBtn.addEventListener("click", () => {
    if (!diffUi.search.rows.length) return;
    diffUi.search.activeIndex =
      (diffUi.search.activeIndex - 1 + diffUi.search.rows.length) % diffUi.search.rows.length;
    updateSearchUI();
    applyDecorations();
    updateSearchHighlights();
    scrollToRowIndex(diffUi.search.rows[diffUi.search.activeIndex]);
  });
  elements.searchNextBtn.addEventListener("click", () => {
    if (!diffUi.search.rows.length) return;
    diffUi.search.activeIndex =
      (diffUi.search.activeIndex + 1) % diffUi.search.rows.length;
    updateSearchUI();
    applyDecorations();
    updateSearchHighlights();
    scrollToRowIndex(diffUi.search.rows[diffUi.search.activeIndex]);
  });
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
  elements.left.lines.addEventListener("click", (event) => handleLineClick("left", event));
  elements.right.lines.addEventListener("click", (event) => handleLineClick("right", event));
  setupScrollSync();
  window.addEventListener("resize", updateHorizontalScrollbar);
  initTabs();
}

setupEvents();
