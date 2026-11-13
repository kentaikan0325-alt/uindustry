
"use strict";

/* Data loads first; everything below runs once the catalogue is in. */
fetch("assets/elements.json")
  .then((res) => {
    if (!res.ok) throw new Error("elements.json: HTTP " + res.status);
    return res.json();
  })
  .then((ELEMENTS) => {

/* Uindustry — UI element archive.
   Data: assets/elements.json, fetched at startup. Each element previews inside a Shadow DOM host so its
   CSS never touches the page CSS. */

const BY_ID = new Map(ELEMENTS.map((el) => [el.id, el]));

const GROUND = { light: "#DCDCD6", dark: "#141414" };
const CATEGORY_JA = {
  "Buttons": "ボタン", "Cards": "カード", "Loaders": "ローダー ローディング 読み込み",
  "Toggle switches": "トグル スイッチ", "Checkboxes": "チェックボックス",
  "Inputs": "入力 インプット テキスト", "Forms": "フォーム", "Radio buttons": "ラジオボタン",
  "Tooltips": "ツールチップ", "Notifications": "通知 トースト"
};
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Scroll-in reveal for cards (disabled under reduced motion). */
const revealObserver = ("IntersectionObserver" in window) && !REDUCED_MOTION
  ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        revealObserver.unobserve(entry.target);
      }
    }, { rootMargin: "120px" })
  : null;

const state = {
  category: "All",
  query: "",
  visible: ELEMENTS,   // current filter result, in order
  current: null,       // element shown in the modal
  tab: "html",         // "html" | "css"
  ground: null,        // preview ground override in the modal
  opener: null         // element to refocus when the modal closes
};

const $ = (id) => document.getElementById(id);
const els = {
  chips: $("chips"), search: $("searchInput"), grid: $("grid"),
  count: $("countLabel"), empty: $("emptyLabel"),
  modal: $("modal"), modalCategory: $("modalCategory"), modalTitle: $("modalTitle"),
  modalPreview: $("modalPreview"), modalClose: $("modalClose"),
  modalPrev: $("modalPrev"), modalNext: $("modalNext"), groundToggle: $("groundToggle"),
  tabHtml: $("tabHtml"), tabCss: $("tabCss"), copyBtn: $("copyBtn"),
  codeBlock: $("codeBlock"), codeText: $("codeText"), copyNote: $("copyNote"),
  licenseText: $("licenseText"),
  codeReveal: $("codeReveal"), codeArea: $("codeArea"), licenseCta: $("licenseCta")
};

/* ---------- previews ---------- */

/* Rewrite document-level selectors so element CSS works inside a shadow
   tree: :root / html / body become :host. */
function scopeCss(css) {
  return css
    .replace(/:root\b/g, ":host")
    .replace(/(^|[,>+~\s}])(html|body)(?=$|[\s,>+~.:#\[{])/gm, "$1:host");
}

const BASE_CSS =
  ":host{font-family:\"Helvetica Neue\",Arial,\"Hiragino Kaku Gothic ProN\",\"Yu Gothic\",sans-serif;"
  + "font-size:16px;line-height:normal;color:#0B0B0B;}"
  + ":host(.on-dark){color:#ECECE6;}"
  + ".sc-wrap{position:relative;flex:none;display:flex;align-items:center;justify-content:center;}"
  + ":host(.is-paused) *,:host(.is-paused) *::before,:host(.is-paused) *::after"
  + "{animation-play-state:paused !important;}";

function makePreview(el, interactive, ground) {
  const host = document.createElement("div");
  const g = ground || el.bg;
  host.className = "preview-host" + (g === "dark" ? " on-dark" : "");
  host.style.background = GROUND[g] || GROUND.light;
  const wrap = document.createElement("div");
  wrap.className = "sc-wrap";
  wrap.innerHTML = el.html;
  if (!host.attachShadow) {   // very old engines: unstyled inline fallback
    host.appendChild(wrap);
    return host;
  }
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = BASE_CSS + scopeCss(el.css);
  shadow.append(style, wrap);
  if (interactive) {
    /* samples must never navigate or submit */
    shadow.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (a) e.preventDefault();
    });
    shadow.addEventListener("submit", (e) => e.preventDefault());
  } else {
    host.inert = true;
    host.setAttribute("aria-hidden", "true");
    host.style.pointerEvents = "none";
  }
  host._wrap = wrap;
  return host;
}

/* Scale a preview down when the element is larger than its frame. */
function fitPreview(host) {
  const wrap = host._wrap;
  if (!wrap || !host.isConnected) return;
  wrap.style.transform = "";
  const pad = 28;
  const w = Math.max(wrap.offsetWidth, wrap.scrollWidth);
  const h = Math.max(wrap.offsetHeight, wrap.scrollHeight);
  if (!w || !h) return;
  const scale = Math.min(1, (host.clientWidth - pad) / w, (host.clientHeight - pad) / h);
  if (scale < 1 && scale > 0) wrap.style.transform = "scale(" + scale.toFixed(3) + ")";
}

/* With hundreds of elements, building every preview up front is too heavy.
   Each card starts as a tinted placeholder; the preview is built when the
   card nears the viewport, and its animations only run while on screen. */
const HAS_IO = "IntersectionObserver" in window;

const buildObserver = HAS_IO ? new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const ph = entry.target;
    buildObserver.unobserve(ph);
    mountPreview(ph);
  }
}, { rootMargin: "400px" }) : null;

const playObserver = HAS_IO ? new IntersectionObserver((entries) => {
  for (const entry of entries) {
    entry.target.classList.toggle("is-paused", REDUCED_MOTION || !entry.isIntersecting);
  }
}) : null;

function mountPreview(ph) {
  const host = makePreview(ph._element, false);
  host.classList.add("is-paused");
  ph.replaceWith(host);
  requestAnimationFrame(() => fitPreview(host));
  if (playObserver) playObserver.observe(host);
}

function makePlaceholder(el) {
  const ph = document.createElement("div");
  ph.className = "preview-host";
  ph.style.background = GROUND[el.bg] || GROUND.light;
  ph._element = el;
  return ph;
}

/* ---------- filter chips ---------- */

function buildChips() {
  const hasOwn = ELEMENTS.some((e) => e.origin === "own");
  const hasOss = ELEMENTS.some((e) => e.origin !== "own");
  const categories = ["All", ...(hasOwn && hasOss ? ["Original"] : []),
    ...new Set(ELEMENTS.map((e) => e.category))];
  for (const cat of categories) {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = cat;
    b.dataset.category = cat;
    b.setAttribute("aria-pressed", String(cat === state.category));
    b.addEventListener("click", () => setCategory(cat));
    els.chips.appendChild(b);
  }
}

function setCategory(cat) {
  state.category = cat;
  for (const b of els.chips.children) {
    b.setAttribute("aria-pressed", String(b.dataset.category === cat));
  }
  applyFilter();
}

/* ---------- grid ---------- */

function displayCode(id) { return id.replace("-", "—"); }

function buildGrid() {
  const frag = document.createDocumentFragment();
  let cardIndex = 0;
  if (revealObserver) els.grid.classList.add("reveal-on");
  for (const el of ELEMENTS) {
    const card = document.createElement("article");
    card.className = "card";

    const preview = document.createElement("div");
    preview.className = "card-preview";
    const ph = makePlaceholder(el);
    preview.appendChild(ph);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const cat = document.createElement("p");
    cat.className = "card-category label";
    cat.textContent = el.category;
    if (el.origin === "own") {
      const tag = document.createElement("span");
      tag.className = "tag-own";
      tag.textContent = " · Original";
      cat.appendChild(tag);
    }
    const open = document.createElement("button");
    open.className = "card-open";
    open.type = "button";
    open.textContent = displayCode(el.id);
    open.setAttribute("aria-label", el.category + " " + el.id + " のコードを見る");
    open.addEventListener("click", () => openModal(el, open));
    meta.append(cat, open);

    card.append(preview, meta);
    el._card = card;
    el._search = (el.id + " " + el.id.replace("-", "") + " " + el.category + " "
      + (CATEGORY_JA[el.category] || "")
      + (el.origin === "own" ? " original オリジナル" : "")).toLowerCase();
    frag.appendChild(card);
    if (revealObserver) {
      card.style.setProperty("--rvd", ((cardIndex % 9) * 45) + "ms");
      revealObserver.observe(card);
    }
    cardIndex++;
    if (buildObserver) buildObserver.observe(ph); else mountPreview(ph);
  }
  els.grid.appendChild(frag);
}

function applyFilter() {
  if (applyFilter._lastCategory !== state.category) {
    if (applyFilter._lastCategory !== undefined && !REDUCED_MOTION && els.grid.animate) {
      els.grid.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
    }
    applyFilter._lastCategory = state.category;
  }
  const terms = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = [];
  for (const el of ELEMENTS) {
    const inCategory = state.category === "All"
      || (state.category === "Original" ? el.origin === "own" : el.category === state.category);
    const ok = inCategory
      && terms.every((t) => el._search.includes(t));
    el._card.hidden = !ok;
    if (ok) list.push(el);
  }
  state.visible = list;
  els.empty.hidden = list.length > 0;
  els.grid.hidden = list.length === 0;
  els.count.textContent = list.length + " / " + ELEMENTS.length + " ELEMENTS";
}

/* ---------- modal ---------- */

function showCode() {
  if (!state.current) return;
  const isHtml = state.tab === "html";
  els.codeText.textContent = isHtml ? state.current.html : state.current.css;
  els.codeBlock.scrollTop = 0;
  els.codeBlock.scrollLeft = 0;
  els.codeBlock.setAttribute("aria-labelledby", isHtml ? "tabHtml" : "tabCss");
  els.tabHtml.setAttribute("aria-selected", String(isHtml));
  els.tabCss.setAttribute("aria-selected", String(!isHtml));
  els.tabHtml.tabIndex = isHtml ? 0 : -1;
  els.tabCss.tabIndex = isHtml ? -1 : 0;
  els.copyBtn.textContent = "クレジット付きでコピー（" + state.tab.toUpperCase() + "）";
  els.copyNote.textContent = "";
}

function showPreview() {
  const el = state.current;
  const ground = state.ground || el.bg;
  const old = els.modalPreview.querySelector(".preview-host");
  if (old) old.remove();
  const host = makePreview(el, true, ground);
  els.modalPreview.prepend(host);
  els.groundToggle.textContent = ground === "dark" ? "GROUND — DARK" : "GROUND — LIGHT";
  requestAnimationFrame(() => fitPreview(host));
}

function showElement(el) {
  state.current = el;
  state.ground = null;
  els.codeArea.hidden = true;
  els.codeReveal.setAttribute("aria-expanded", "false");
  els.codeReveal.textContent = "コードを表示";
  els.licenseCta.hidden = el.origin !== "own";
  els.modalCategory.textContent = el.category + (el.origin === "own" ? " · Original" : "");
  els.licenseText.textContent = el.origin === "own"
    ? "Uindustry オリジナル。コード内のクレジットを残せば無料で使える。外すには有料ライセンスが必要。"
    : "MIT License の部品。条文はページ下部にある。";
  els.modalTitle.textContent = displayCode(el.id);
  showPreview();
  showCode();
  const i = state.visible.indexOf(el);
  els.modalPrev.disabled = els.modalNext.disabled = state.visible.length < 2 || i < 0;
  if (location.hash.slice(1) !== el.id) history.replaceState(null, "", "#" + el.id);
}

function openModal(el, opener) {
  state.opener = opener || null;
  state.tab = "html";
  showElement(el);
  if (!els.modal.open) {
    if (els.modal.showModal) els.modal.showModal(); else els.modal.setAttribute("open", "");
  }
  els.modal.scrollTop = 0;
}

function closeModal() {
  if (els.modal.open) {
    if (els.modal.close) els.modal.close(); else els.modal.removeAttribute("open");
  }
}

function step(delta) {
  const list = state.visible;
  const i = list.indexOf(state.current);
  if (i < 0 || list.length < 2) return;
  showElement(list[(i + delta + list.length) % list.length]);
}

/* ---------- copy ---------- */

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  els.modal.appendChild(ta);   // inside the dialog: outside it is inert
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("copy failed");
}

/* ---------- events ---------- */

let searchTimer = 0;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = els.search.value;
    applyFilter();
  }, 120);
});

function selectTab(tab, focus) {
  state.tab = tab;
  showCode();
  if (focus) (tab === "html" ? els.tabHtml : els.tabCss).focus();
}
els.tabHtml.addEventListener("click", () => selectTab("html"));
els.tabCss.addEventListener("click", () => selectTab("css"));
for (const t of [els.tabHtml, els.tabCss]) {
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    selectTab(state.tab === "html" ? "css" : "html", true);
  });
}

const COPY_LIMIT = 20;
const COPY_WINDOW_MS = 10 * 60 * 1000;
function copyAllowed() {
  let log = [];
  try { log = JSON.parse(localStorage.getItem("uind-copy-log") || "[]"); } catch (e) { log = []; }
  const now = Date.now();
  log = log.filter((t) => now - t < COPY_WINDOW_MS);
  if (log.length >= COPY_LIMIT) {
    try { localStorage.setItem("uind-copy-log", JSON.stringify(log)); } catch (e) {}
    return false;
  }
  log.push(now);
  try { localStorage.setItem("uind-copy-log", JSON.stringify(log)); } catch (e) {}
  return true;
}

let copyTimer = 0;
els.copyBtn.addEventListener("click", async () => {
  if (!state.current) return;
  if (!copyAllowed()) {
    els.copyNote.textContent = "短時間に多くのコピーが行われました。一括取得は利用規約で禁止されています。少し時間をおいてからお試しください。";
    return;
  }
  const text = state.tab === "html" ? state.current.html : state.current.css;
  try {
    await copyText(text);
    els.copyBtn.textContent = "コピーした";
    els.copyNote.textContent = state.current.origin === "own"
      ? state.tab.toUpperCase() + " をコピーしました（クレジット付き）。クレジットを外して使うには有料ライセンスが必要です。"
      : state.tab.toUpperCase() + " をコピーしました。";
  } catch (err) {
    els.copyNote.textContent = "コピーできなかった。コードを選択してコピーしてください。";
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    els.copyBtn.textContent = "クレジット付きでコピー（" + state.tab.toUpperCase() + "）";
  }, 1600);
});

els.codeReveal.addEventListener("click", () => {
  const show = els.codeArea.hidden;
  els.codeArea.hidden = !show;
  els.codeReveal.setAttribute("aria-expanded", String(show));
  els.codeReveal.textContent = show ? "コードを閉じる" : "コードを表示";
});

els.groundToggle.addEventListener("click", () => {
  const now = state.ground || state.current.bg;
  state.ground = now === "dark" ? "light" : "dark";
  showPreview();
});

els.modalPrev.addEventListener("click", () => step(-1));
els.modalNext.addEventListener("click", () => step(1));
els.modalClose.addEventListener("click", closeModal);

/* click on the dimmed area closes */
els.modal.addEventListener("click", (e) => { if (e.target === els.modal) closeModal(); });

els.modal.addEventListener("close", () => {
  const old = els.modalPreview.querySelector(".preview-host");
  if (old) old.remove();
  state.current = null;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  if (state.opener && state.opener.isConnected) state.opener.focus();
  state.opener = null;
});

els.modal.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  /* arrows belong to the sample or the code block while focus is there */
  const t = e.target;
  if (t.closest && (t.closest(".modal-preview") || t.closest(".code"))) return;
  e.preventDefault();
  step(e.key === "ArrowLeft" ? -1 : 1);
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    document.querySelectorAll(".preview-host").forEach(fitPreview);
  }, 150);
});

function openFromHash() {
  const el = BY_ID.get(decodeURIComponent(location.hash.slice(1)).toUpperCase());
  if (el) openModal(el, el._card.querySelector(".card-open"));
}
window.addEventListener("hashchange", openFromHash);

/* ---------- init ---------- */

const tickerText = "UINDUSTRY \u2014 UI ELEMENTS ARCHIVE \u2014 " + ELEMENTS.length + " PIECES \u2014 "
  + ELEMENTS.filter((e) => e.origin === "own").length + " ORIGINALS BY SATO'S COMPANY \u2014 COPY, PASTE, SHIP \u2014 ";
document.querySelectorAll(".ticker-text").forEach((s) => { s.textContent = tickerText; });

buildChips();
buildGrid();
applyFilter();
openFromHash();

  })
  .catch((err) => {
    console.error(err);
    const label = document.getElementById("emptyLabel");
    if (label) {
      label.hidden = false;
      label.textContent = "データの読み込みに失敗しました。ページを再読み込みしてください。";
    }
  });
