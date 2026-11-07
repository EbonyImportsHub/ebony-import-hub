(() => {
  "use strict";
  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById("app");
  const MAX_IMAGES = 4;
  const BUCKET = "product-images";
  const THUMB_MAX = 480;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const naira = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
  const total = (p) => Number(p.price || 0) + Number(p.shipping_fee || 0);
  // small preview for the grid; falls back to the full photo for older products
  const thumbOf = (p) => p.thumb_url || (p.image_urls && p.image_urls[0]) || "";

  let sb = null;
  let session = null;
  let products = [];
  let batches = [];
  let batchesReady = false; // true once batches.sql has been run in Supabase
  let batchSel = null;
  let loadError = "";
  let loaded = false;
  let filterCat = "All";
  let query = "";
  let settings = {};
  // Shop details: use what the owner saved in Settings, otherwise fall back to config.js
  // Business name: what the owner saved in Settings, otherwise the default
  const bizName = () => ((settings.business_name || "").trim() || "Ebony Imports Hub");
  const val = (k) => {
    const v = settings[k.toLowerCase()];
    return v !== undefined && v !== null && String(v).trim() !== "" ? String(v).trim() : cfg[k];
  };

  /* ---------------- Batch helpers ---------------- */

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fmtDate = (s) => {
    if (!s) return "";
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  const ended = (b) => !!b.closes_on && b.closes_on < todayStr();
  const isOpen = (b) => b.status !== "closed" && !ended(b);
  const statusLabel = (b) => (b.status === "ongoing" ? "Ongoing" : b.status === "upcoming" ? "Coming next" : "Closed");
  // batches customers can see: ongoing first, then coming next, earliest closing date first
  const liveBatches = () =>
    batches.filter(isOpen).sort((a, b) =>
      (a.status === b.status ? 0 : a.status === "ongoing" ? -1 : 1) ||
      ((a.closes_on || "9999") < (b.closes_on || "9999") ? -1 : (a.closes_on || "9999") > (b.closes_on || "9999") ? 1 : 0));
  const ensureBatchSel = () => {
    const live = liveBatches();
    if (!live.some((b) => b.id === batchSel)) batchSel = live[0] ? live[0].id : null;
  };
  // open batches this product belongs to (no batch ticked = every batch)
  const productBatches = (p) => {
    const live = liveBatches();
    const valid = (p.batch_ids || []).filter((id) => batches.some((b) => b.id === id));
    return valid.length ? live.filter((b) => valid.includes(b.id)) : live;
  };
  const batchInfo = (b) => {
    if (!b) return "";
    const parts = [];
    if (b.closes_on) parts.push(`Preorders ${b.status === "upcoming" ? "will close" : "close"} on <b>${esc(fmtDate(b.closes_on))}</b>.`);
    if (b.arrival_note) parts.push(`Expected arrival: <b>${esc(b.arrival_note)}</b>.`);
    if (b.note) parts.push(esc(b.note));
    return parts.join(" ") || (b.status === "upcoming" ? "Opening soon." : "");
  };
  function visibleProducts() {
    if (!batches.length) return products;
    ensureBatchSel();
    if (!batchSel) return [];
    return products.filter((p) => productBatches(p).some((b) => b.id === batchSel));
  }

  /* ---------------- Basics ---------------- */

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 3200);
  }

  function setupNeeded() {
    app.innerHTML = `<div class="panel login"><h1>Almost ready</h1>
      <p>This app needs to be connected to its database. Open <b>config.js</b> and fill in your Supabase details, then reload. Steps are in README.md.</p></div>`;
  }

  async function init() {
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR_") || !window.supabase) {
      setupNeeded();
      return;
    }
    // The owner login is kept in sessionStorage, which the browser wipes when the tab or app is closed.
    // So after closing, the password is needed again. (Old "stay logged in" copies are removed.)
    try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (_) {}
    let store;
    try { store = window.sessionStorage; store.getItem("x"); }
    catch (_) { const mem = {}; store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } }; }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { storage: store, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    const { data } = await sb.auth.getSession();
    session = data.session;
    sb.auth.onAuthStateChange((_e, s) => { session = s; });
    window.addEventListener("hashchange", render);
    render();
    await Promise.all([loadProducts(), loadSettings(), loadBatches()]);
    render();
  }

  async function loadProducts() {
    loadError = "";
    const { data, error } = await sb.from("products").select("*").order("created_at", { ascending: false });
    if (error) loadError = error.message;
    else products = data || [];
    loaded = true;
  }

  async function loadSettings() {
    const { data, error } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
    if (!error && data) settings = data; // if the table isn't set up yet, config.js values are used
  }

  async function loadBatches() {
    const { data, error } = await sb.from("batches").select("*").order("created_at", { ascending: false });
    if (error) { batchesReady = false; batches = []; }
    else { batchesReady = true; batches = data || []; }
  }

  const route = () => (location.hash || "#/").slice(1);

  function render() {
    if (!sb) return;
    window.scrollTo(0, 0);
    if (route().startsWith("/owner")) renderOwner();
    else if (route().startsWith("/info")) renderInfo();
    else renderShop();
  }

  /* ---------------- Customer view ---------------- */

  function batchBar() {
    if (!batches.length) return "";
    const live = liveBatches();
    if (!live.length) return `<div class="notice">No preorder batch is open right now. Join our WhatsApp group to hear when the next one opens.</div>`;
    ensureBatchSel();
    const cur = live.find((b) => b.id === batchSel);
    return `<section class="batches" aria-label="Preorder batches">
      <h2 class="b-title">Choose a batch</h2>
      <div class="b-tabs" id="btabs">${live.map((b) => `<button class="b-tab" data-b="${esc(b.id)}" aria-pressed="${b.id === batchSel}"><span class="b-name">${esc(b.name)}</span><span class="b-state ${esc(b.status)}">${statusLabel(b)}</span></button>`).join("")}</div>
      <p class="b-info">${batchInfo(cur)}</p>
    </section>`;
  }

  function renderShop() {
    if (!loaded) { app.innerHTML = `<div class="loading">Loading products…</div>`; return; }
    if (loadError) {
      app.innerHTML = `<div class="empty">Couldn't load products.<br><small>${esc(loadError)}</small><br><br><button class="btn btn-sm" id="retry">Try again</button></div>`;
      document.getElementById("retry").onclick = async () => { loaded = false; render(); await Promise.all([loadProducts(), loadBatches()]); render(); };
      return;
    }
    const vis = visibleProducts();
    const cats = ["All", ...Array.from(new Set(vis.map((p) => p.category).filter(Boolean)))];
    if (!cats.includes(filterCat)) filterCat = "All";
    app.innerHTML = `
      <section class="hero"><h1>Preorder from China</h1>
      <p>Every price below already includes shipping. Tap a product to preorder on WhatsApp.</p>
      ${(settings.rules || "").trim() ? `<p style="margin-top:10px"><a class="btn btn-ghost btn-sm" href="#/info">Shipping rules &amp; how to order</a></p>` : ""}</section>
      ${settings.announcement ? `<div class="notice">${esc(settings.announcement)}</div>` : ""}
      ${batchBar()}
      <div class="tools">
        <input class="search" type="search" id="q" placeholder="Search products" aria-label="Search products" value="${esc(query)}">
        <div class="chips" id="chips">${cats.map((c) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${c === filterCat}">${esc(c)}</button>`).join("")}</div>
      </div>
      <div class="grid" id="grid"></div>
      ${contactSection()}`;
    const tabs = document.getElementById("btabs");
    if (tabs) tabs.onclick = (e) => {
      const b = e.target.closest(".b-tab"); if (!b) return;
      batchSel = b.dataset.b; filterCat = "All";
      renderShop();
    };
    document.getElementById("q").oninput = (e) => { query = e.target.value; drawGrid(); };
    document.getElementById("chips").onclick = (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      filterCat = b.dataset.c;
      document.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x.dataset.c === filterCat));
      drawGrid();
    };
    drawGrid();
  }

  function contactSection() {
    const num = String(val("WHATSAPP_NUMBER") || "").replace(/\D/g, "");
    const chat = `https://wa.me/${num}?text=${encodeURIComponent("Hello " + (bizName()) + ", I have a question.")}`;
    const items = [];
    if (num) items.push(`<a class="btn btn-wa" href="${esc(chat)}" target="_blank" rel="noopener">Chat on WhatsApp${val("PHONE_DISPLAY") ? ` · ${esc(val("PHONE_DISPLAY"))}` : ""}</a>`);
    if (val("WHATSAPP_GROUP")) items.push(`<a class="btn btn-gold" href="${esc(val("WHATSAPP_GROUP"))}" target="_blank" rel="noopener">Join our WhatsApp group</a>`);
    if (val("TIKTOK_HANDLE")) items.push(`<a class="btn btn-ghost" href="https://www.tiktok.com/@${esc(val("TIKTOK_HANDLE"))}" target="_blank" rel="noopener">TikTok @${esc(val("TIKTOK_HANDLE"))}</a>`);
    if (val("EMAIL")) items.push(`<a class="btn btn-ghost" href="mailto:${esc(val("EMAIL"))}">${esc(val("EMAIL"))}</a>`);
    if (!items.length) return "";
    return `<section class="contact panel"><h2>Contact us</h2><p>Questions, or want something that isn't listed? Reach out.</p><div class="contact-links">${items.join("")}</div></section>`;
  }

  function drawGrid() {
    const grid = document.getElementById("grid");
    if (!grid) return;
    const q = query.trim().toLowerCase();
    const vis = visibleProducts();
    const list = vis.filter((p) =>
      (filterCat === "All" || p.category === filterCat) &&
      (!q || (p.name + " " + (p.description || "") + " " + (p.category || "")).toLowerCase().includes(q)));
    if (!list.length) {
      const noBatchOpen = batches.length && !liveBatches().length;
      const msg = noBatchOpen ? "Check back soon for the next batch."
        : vis.length ? "No products match your search."
        : batches.length ? "No products in this batch yet. Please check back soon."
        : "No products yet. Please check back soon.";
      grid.outerHTML = `<div class="empty" id="grid">${msg}</div>`;
      return;
    }
    grid.className = "grid";
    grid.innerHTML = list.map((p) => `
      <button class="card" data-id="${esc(p.id)}" aria-label="${esc(p.name)}, ${naira(total(p))}">
        <div class="thumb">${thumbOf(p) ? `<img src="${esc(thumbOf(p))}" alt="" loading="lazy" decoding="async">` : `<div class="noimg">No photo</div>`}
          ${p.in_stock ? "" : `<span class="badge">Sold out</span>`}</div>
        <div class="card-body">
          <span class="cat">${esc(p.category)}</span>
          <span class="pname">${esc(p.name)}</span>
          <span class="break">${naira(p.price)} + ${naira(p.shipping_fee)} shipping</span>
          <span class="total">${naira(total(p))}<small>total</small></span>
        </div>
      </button>`).join("");
    grid.onclick = (e) => {
      const c = e.target.closest(".card"); if (!c) return;
      const p = products.find((x) => x.id === c.dataset.id);
      if (p) openProduct(p);
    };
  }

  function openProduct(p) {
    const imgs = p.image_urls && p.image_urls.length ? p.image_urls : [];
    const num = String(val("WHATSAPP_NUMBER") || "").replace(/\D/g, "");
    const avail = batches.length ? productBatches(p) : [];
    let chosen = avail.some((b) => b.id === batchSel) ? batchSel : (avail[0] ? avail[0].id : null);

    const waLink = () => {
      const b = avail.find((x) => x.id === chosen);
      const lines = [
        `Hello ${bizName()}, I'd like to preorder:`,
        p.name,
        `Item: ${naira(p.price)}`,
        `Shipping: ${naira(p.shipping_fee)}`,
        `Total: ${naira(total(p))}`,
      ];
      if (b) lines.push(`Batch: ${b.name}` + (b.closes_on ? ` (closes ${fmtDate(b.closes_on)})` : "") + (b.arrival_note ? `, expected arrival: ${b.arrival_note}` : ""));
      return `https://wa.me/${num}?text=${encodeURIComponent(lines.join("\n"))}`;
    };
    const pickHtml = () => {
      if (!avail.length) return "";
      const cur = avail.find((b) => b.id === chosen);
      return `<div class="b-pick"><h3>Preorder batch</h3>
        <div class="b-opts">${avail.map((b) => `<button type="button" class="b-opt" data-b="${esc(b.id)}" aria-pressed="${b.id === chosen}">${esc(b.name)} · ${statusLabel(b)}</button>`).join("")}</div>
        <p class="b-info">${batchInfo(cur)}</p></div>`;
    };

    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
        <button class="close" aria-label="Close">×</button>
        <div class="gallery">${imgs.length ? imgs.map((u) => `<img src="${esc(u)}" alt="${esc(p.name)}" decoding="async">`).join("") : `<div class="noimg">No photo</div>`}</div>
        ${imgs.length > 1 ? `<div class="gal-hint">Swipe for more photos (${imgs.length})</div>` : ""}
        <div class="m-body">
          <span class="cat">${esc(p.category)}</span>
          <h2>${esc(p.name)}</h2>
          ${p.description ? `<p class="m-desc">${esc(p.description)}</p>` : ""}
          <div class="price-box">
            <div class="row"><span>Item price</span><span>${naira(p.price)}</span></div>
            <div class="row"><span>Shipping fee</span><span>${naira(p.shipping_fee)}</span></div>
            <div class="row big"><span>Total</span><span>${naira(total(p))}</span></div>
          </div>
          <div id="bpick">${pickHtml()}</div>
          ${p.in_stock
            ? `<a class="btn btn-wa" id="waBtn" href="${esc(waLink())}" target="_blank" rel="noopener">Preorder on WhatsApp</a>`
            : `<button class="btn" disabled>Sold out</button>`}
        </div>
      </div>`;
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.querySelector(".close").onclick = close;
    ov.querySelector("#bpick").onclick = (e) => {
      const bt = e.target.closest(".b-opt"); if (!bt) return;
      chosen = bt.dataset.b;
      ov.querySelector("#bpick").innerHTML = pickHtml();
      const a = ov.querySelector("#waBtn");
      if (a) a.href = waLink();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    document.body.appendChild(ov);
    ov.querySelector(".close").focus();
  }

  /* ---------------- Shipping rules page ---------------- */

  // Plain text from the owner: "# Heading", "- bullet", blank line between paragraphs.
  function renderRules(text) {
    let html = "", inList = false;
    const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
    for (const raw of String(text).split(/\r?\n/)) {
      const l = raw.trim();
      if (!l) { closeList(); continue; }
      if (l.startsWith("# ")) { closeList(); html += `<h3>${esc(l.slice(2))}</h3>`; }
      else if (/^[-*] /.test(l)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${esc(l.slice(2))}</li>`; }
      else { closeList(); html += `<p>${esc(l)}</p>`; }
    }
    closeList();
    return html;
  }

  function renderInfo() {
    if (!loaded) { app.innerHTML = `<div class="loading">Loading…</div>`; return; }
    const num = String(val("WHATSAPP_NUMBER") || "").replace(/\D/g, "");
    const chat = `https://wa.me/${num}?text=${encodeURIComponent("Hello " + (bizName()) + ", I have a question about shipping.")}`;
    const rules = (settings.rules || "").trim();
    app.innerHTML = `
      <section class="hero"><h1>Shipping rules &amp; how to order</h1>
      <p>Please read this before you preorder.</p></section>
      <div class="panel rules">${rules ? renderRules(rules) : `<p class="muted">Shipping rules will be posted here soon. For now, message us on WhatsApp with any questions.</p>`}</div>
      <div class="actions" style="margin-top:16px"><a class="btn" href="#/">Back to shop</a>${num ? `<a class="btn btn-wa" href="${esc(chat)}" target="_blank" rel="noopener">Ask a question on WhatsApp</a>` : ""}</div>`;
  }

  /* ---------------- Owner area ---------------- */

  function renderOwner() {
    if (!session) return renderLogin();
    renderDashboard();
  }

  function renderLogin(errMsg) {
    app.innerHTML = `
      <form class="panel login" id="loginForm" autocomplete="on">
        <h1>Owner login</h1>
        <p>Enter your owner password to manage products.</p>
        <input class="sr-only" type="email" name="username" autocomplete="username" value="${esc(cfg.OWNER_EMAIL)}" readonly tabindex="-1" aria-hidden="true">
        <div class="field"><label for="pw">Password</label>
          <input id="pw" name="password" type="password" autocomplete="current-password" required></div>
        ${errMsg ? `<p class="error" role="alert">${esc(errMsg)}</p>` : ""}
        <div class="actions"><button class="btn" id="loginBtn" type="submit">Log in</button>
        <a class="btn btn-ghost" href="#/">Back to shop</a></div>
      </form>`;
    document.getElementById("loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById("loginBtn");
      btn.disabled = true; btn.textContent = "Logging in…";
      const { data, error } = await sb.auth.signInWithPassword({ email: cfg.OWNER_EMAIL, password: document.getElementById("pw").value });
      if (error) { renderLogin("Wrong password, or the account isn't set up yet."); return; }
      session = data.session;
      renderDashboard();
    };
  }

  function renderDashboard() {
    app.innerHTML = `
      <div class="owner-bar"><h1>Owner dashboard</h1><button class="btn btn-ghost btn-sm" id="logout">Log out</button></div>
      <div class="actions"><button class="btn btn-gold" id="addBtn">+ Add product</button><button class="btn btn-ghost" id="batchBtn">Batches</button><button class="btn btn-ghost" id="setBtn">Settings</button><a class="btn btn-ghost" href="#/">View shop</a></div>
      <div id="formHost"></div>
      <div class="olist" id="olist"></div>`;
    document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); session = null; renderLogin(); };
    document.getElementById("addBtn").onclick = () => openForm(null);
    document.getElementById("batchBtn").onclick = () => openBatchManager();
    document.getElementById("setBtn").onclick = () => openSettings();
    drawOwnerList();
  }

  const batchText = (p) => {
    if (!batches.length) return "";
    const names = (p.batch_ids || []).map((id) => batches.find((b) => b.id === id)).filter(Boolean).map((b) => b.name);
    return names.length ? names.join(", ") : "All batches";
  };

  function drawOwnerList() {
    const host = document.getElementById("olist");
    if (!host) return;
    if (!products.length) { host.innerHTML = `<div class="empty">No products yet. Tap "Add product" to upload your first one.</div>`; return; }
    host.innerHTML = products.map((p) => `
      <div class="orow" data-id="${esc(p.id)}">
        <div class="t">${thumbOf(p) ? `<img src="${esc(thumbOf(p))}" alt="">` : ""}</div>
        <div class="info"><b>${esc(p.name)}<span class="pill ${p.in_stock ? "ok" : "out"}">${p.in_stock ? "Available" : "Sold out"}</span></b>
          <span>${esc(p.category)} · ${naira(p.price)} + ${naira(p.shipping_fee)} = <b style="display:inline">${naira(total(p))}</b>${batchText(p) ? ` · ${esc(batchText(p))}` : ""}</span></div>
        <div class="acts">
          <button class="btn btn-ghost btn-sm" data-a="edit">Edit</button>
          <button class="btn btn-ghost btn-sm" data-a="toggle">${p.in_stock ? "Mark sold out" : "Mark available"}</button>
          <button class="btn btn-danger btn-sm" data-a="del">Delete</button>
        </div>
      </div>`).join("");
    host.onclick = async (e) => {
      const b = e.target.closest("button[data-a]"); if (!b) return;
      const id = b.closest(".orow").dataset.id;
      const p = products.find((x) => x.id === id); if (!p) return;
      if (b.dataset.a === "edit") openForm(p);
      if (b.dataset.a === "toggle") {
        const { error } = await sb.from("products").update({ in_stock: !p.in_stock }).eq("id", id);
        if (error) return toast(error.message);
        p.in_stock = !p.in_stock; drawOwnerList(); toast("Updated");
      }
      if (b.dataset.a === "del") {
        if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
        const { error } = await sb.from("products").delete().eq("id", id);
        if (error) return toast(error.message);
        await removeImages([...(p.image_urls || []), p.thumb_url].filter(Boolean));
        products = products.filter((x) => x.id !== id); drawOwnerList(); toast("Deleted");
      }
    };
  }

  /* ---------- Owner: batches ---------- */

  function openBatchManager() {
    const host = document.getElementById("formHost");
    const $ = (id) => document.getElementById(id);
    if (!batchesReady) {
      host.innerHTML = `<div class="panel" style="margin-top:16px"><h2 style="margin:0 0 10px;font-size:18px">Batches</h2>
        <p class="error">Batches aren't set up yet. Run batches.sql in Supabase (see README), then reload this page.</p>
        <button class="btn btn-ghost" id="bclose">Close</button></div>`;
      $("bclose").onclick = () => { host.innerHTML = ""; };
      return;
    }
    const dateTxt = (b) => [b.closes_on ? `closes ${fmtDate(b.closes_on)}` : "", b.arrival_note ? `arrives ${b.arrival_note}` : ""].filter(Boolean).join(" · ") || "no dates set";
    const pillCls = (b) => (isOpen(b) ? (b.status === "ongoing" ? "ok" : "soon") : "out");
    const pillTxt = (b) => (b.status !== "closed" && ended(b) ? "Closed (date passed)" : statusLabel(b));

    const draw = () => {
      host.innerHTML = `
        <div class="panel" style="margin-top:16px">
          <div class="owner-bar" style="margin-top:0"><h2 style="margin:0;font-size:18px">Batches</h2>
            <div class="actions"><button class="btn btn-gold btn-sm" id="bnew">+ New batch</button><button class="btn btn-ghost btn-sm" id="bclose">Close</button></div></div>
          <p class="b-info" style="margin:0 0 12px">Customers only see batches that are <b>Ongoing</b> or <b>Coming next</b>. A batch also disappears from the shop on its own after its closing date.</p>
          <div id="bform"></div>
          <div class="olist" id="blist">${batches.length ? batches.map((b) => `
            <div class="orow" data-id="${esc(b.id)}">
              <div class="info"><b>${esc(b.name)}<span class="pill ${pillCls(b)}">${esc(pillTxt(b))}</span></b><span>${esc(dateTxt(b))}</span></div>
              <div class="acts">
                <button class="btn btn-ghost btn-sm" data-a="edit">Edit</button>
                ${b.status !== "closed" ? `<button class="btn btn-ghost btn-sm" data-a="close">Close batch</button>` : ""}
                <button class="btn btn-danger btn-sm" data-a="del">Delete</button>
              </div>
            </div>`).join("") : `<div class="empty">No batches yet. Tap "+ New batch" to create your ongoing batch.</div>`}</div>
        </div>`;
      $("bclose").onclick = () => { host.innerHTML = ""; };
      $("bnew").onclick = () => showForm(null);
      $("blist").onclick = async (e) => {
        const bt = e.target.closest("button[data-a]"); if (!bt) return;
        const id = bt.closest(".orow").dataset.id;
        const b = batches.find((x) => x.id === id); if (!b) return;
        if (bt.dataset.a === "edit") showForm(b);
        if (bt.dataset.a === "close") {
          const { data, error } = await sb.from("batches").update({ status: "closed" }).eq("id", id).select().single();
          if (error) return toast(error.message);
          batches = batches.map((x) => (x.id === id ? data : x)); draw(); drawOwnerList(); toast("Batch closed");
        }
        if (bt.dataset.a === "del") {
          if (!confirm(`Delete "${b.name}"? Products that were only in this batch will then show in every batch. Use "Close batch" instead if you just want to hide it.`)) return;
          const { error } = await sb.from("batches").delete().eq("id", id);
          if (error) return toast(error.message);
          batches = batches.filter((x) => x.id !== id); draw(); drawOwnerList(); toast("Deleted");
        }
      };
    };

    const showForm = (b) => {
      const defStatus = b ? b.status : (liveBatches().length ? "upcoming" : "ongoing");
      $("bform").innerHTML = `
        <form class="panel" id="bf" style="margin:0 0 14px;background:var(--cream)">
          <h3 style="margin:0 0 12px;font-size:16px">${b ? "Edit batch" : "New batch"}</h3>
          <div class="field"><label for="bf-name">Batch name</label>
            <input id="bf-name" type="text" required maxlength="60" placeholder="e.g. Batch 12" value="${esc(b ? b.name : "")}"></div>
          <div class="field"><label for="bf-status">Status</label>
            <select id="bf-status">
              <option value="ongoing" ${defStatus === "ongoing" ? "selected" : ""}>Ongoing (open for preorder now)</option>
              <option value="upcoming" ${defStatus === "upcoming" ? "selected" : ""}>Coming next</option>
              <option value="closed" ${defStatus === "closed" ? "selected" : ""}>Closed (hidden from customers)</option>
            </select></div>
          <div class="field"><label for="bf-close">Last day to preorder (optional)</label>
            <input id="bf-close" type="date" value="${esc(b && b.closes_on ? b.closes_on : "")}">
            <span class="hint">After this day the batch hides itself from the shop.</span></div>
          <div class="field"><label for="bf-arr">Expected arrival (optional)</label>
            <input id="bf-arr" type="text" maxlength="60" placeholder="e.g. Mid-December" value="${esc(b ? b.arrival_note || "" : "")}"></div>
          <div class="field"><label for="bf-note">Note for customers (optional)</label>
            <textarea id="bf-note" maxlength="200">${esc(b ? b.note || "" : "")}</textarea></div>
          <p class="error" id="bferr" role="alert" hidden></p>
          <div class="actions"><button class="btn" type="submit" id="bfSave">Save batch</button>
            <button class="btn btn-ghost" type="button" id="bfCancel">Cancel</button></div>
        </form>`;
      $("bf-name").focus();
      $("bfCancel").onclick = () => { $("bform").innerHTML = ""; };
      $("bf").onsubmit = async (e) => {
        e.preventDefault();
        const btn = $("bfSave"), err = $("bferr");
        err.hidden = true; btn.disabled = true; btn.textContent = "Saving…";
        const row = {
          name: $("bf-name").value.trim(),
          status: $("bf-status").value,
          closes_on: $("bf-close").value || null,
          arrival_note: $("bf-arr").value.trim(),
          note: $("bf-note").value.trim(),
        };
        const res = b ? await sb.from("batches").update(row).eq("id", b.id).select().single()
                      : await sb.from("batches").insert(row).select().single();
        if (res.error) {
          err.textContent = res.error.message; err.hidden = false;
          btn.disabled = false; btn.textContent = "Save batch";
          return;
        }
        if (b) batches = batches.map((x) => (x.id === b.id ? res.data : x));
        else batches.unshift(res.data);
        draw(); drawOwnerList(); toast("Saved");
      };
    };

    draw();
  }

  /* ---------- Owner: settings ---------- */

  function openSettings() {
    const host = document.getElementById("formHost");
    const $ = (id) => document.getElementById(id);
    host.innerHTML = `
      <div class="panel" style="margin-top:16px">
        <h2 style="margin:0 0 14px;font-size:18px">Shop details</h2>
        <form id="sform">
          <div class="field"><label for="s-name">Business name</label>
            <input id="s-name" type="text" maxlength="60" value="${esc(bizName())}"></div>
          <div class="field"><label for="s-wa">WhatsApp number</label>
            <input id="s-wa" type="text" inputmode="tel" maxlength="20" value="${esc(val("PHONE_DISPLAY") || val("WHATSAPP_NUMBER"))}">
            <span class="hint">e.g. 09066944108. Customers' preorder messages go to this number.</span></div>
          <div class="field"><label for="s-email">Email</label>
            <input id="s-email" type="text" inputmode="email" maxlength="120" value="${esc(val("EMAIL"))}"></div>
          <div class="field"><label for="s-tiktok">TikTok handle</label>
            <input id="s-tiktok" type="text" maxlength="60" value="${esc(val("TIKTOK_HANDLE"))}"></div>
          <div class="field"><label for="s-group">WhatsApp group link</label>
            <input id="s-group" type="text" inputmode="url" maxlength="300" value="${esc(val("WHATSAPP_GROUP"))}"></div>
          <div class="field"><label for="s-note">Announcement (shown at the top of the shop)</label>
            <textarea id="s-note" maxlength="200" placeholder="e.g. Next China shipment closes 20 Nov. Preorder now!">${esc(settings.announcement || "")}</textarea>
            <span class="hint">Leave empty to hide the banner.</span></div>
          <p class="error" id="serr" role="alert" hidden></p>
          <div class="actions"><button class="btn" type="submit" id="sBtn">Save details</button></div>
        </form>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2 style="margin:0 0 14px;font-size:18px">Shipping rules page</h2>
        <form id="rform">
          <div class="field"><label for="r-text">Rules and instructions customers will read</label>
            <textarea id="r-text" maxlength="6000" style="min-height:220px" placeholder="# How preorders work&#10;- Write each rule on its own line, starting with a dash&#10;&#10;# Shipping&#10;- Write your shipping rules here">${esc(settings.rules || "")}</textarea>
            <span class="hint">Start a line with "# " for a heading and "- " for a bullet point. Leave a blank line between sections. Customers see a "Shipping rules" button on the shop once this is filled in.</span></div>
          <p class="error" id="rerr" role="alert" hidden></p>
          <div class="actions"><button class="btn" type="submit" id="rBtn">Save rules</button>
            <a class="btn btn-ghost" href="#/info">Preview page</a></div>
        </form>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2 style="margin:0 0 14px;font-size:18px">Change password</h2>
        <form id="pwform">
          <input class="sr-only" type="email" autocomplete="username" value="${esc(cfg.OWNER_EMAIL)}" readonly tabindex="-1" aria-hidden="true">
          <div class="field"><label for="pw1">New password</label>
            <input id="pw1" type="password" autocomplete="new-password" minlength="10" required>
            <span class="hint">At least 10 characters. Longer is safer.</span></div>
          <div class="field"><label for="pw2">Type it again</label>
            <input id="pw2" type="password" autocomplete="new-password" minlength="10" required></div>
          <p class="error" id="perr" role="alert" hidden></p>
          <div class="actions"><button class="btn" type="submit" id="pBtn">Change password</button></div>
        </form>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2 style="margin:0 0 6px;font-size:18px">Security</h2>
        <p style="margin:0 0 14px;color:var(--muted);font-size:14px">Lost a phone or used someone else's device? Sign out of every device, then log in again here.</p>
        <div class="actions"><button class="btn btn-danger" id="signoutAll">Sign out of all devices</button>
          <button class="btn btn-ghost" id="closeSet">Close settings</button></div>
      </div>`;
    host.scrollIntoView({ behavior: "smooth", block: "start" });

    $("closeSet").onclick = () => { host.innerHTML = ""; };

    $("rform").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("rBtn"), err = $("rerr");
      err.hidden = true; btn.disabled = true; btn.textContent = "Saving…";
      const { data, error } = await sb.from("settings")
        .upsert({ id: 1, rules: $("r-text").value.trim(), updated_at: new Date().toISOString() }).select().single();
      btn.disabled = false; btn.textContent = "Save rules";
      if (error) {
        err.textContent = /rules|schema cache|column|does not exist/i.test(error.message)
          ? "The rules page isn't set up yet. Run rules.sql in Supabase (see README), then try again."
          : error.message;
        err.hidden = false;
        return;
      }
      settings = data;
      toast("Saved");
    };

    $("signoutAll").onclick = async () => {
      if (!confirm("Sign out of every device? You will need your password to log in again.")) return;
      await sb.auth.signOut({ scope: "global" });
      session = null;
      renderLogin();
    };

    $("sform").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("sBtn"), err = $("serr");
      err.hidden = true;
      const typed = $("s-wa").value.trim();
      let digits = typed.replace(/\D/g, "");
      if (digits.length === 11 && digits.startsWith("0")) digits = "234" + digits.slice(1);
      const group = $("s-group").value.trim();
      if (group && !/^https:\/\//i.test(group)) {
        err.textContent = "The group link must start with https://";
        err.hidden = false;
        return;
      }
      const tiktok = $("s-tiktok").value.trim()
        .replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, "").replace(/^@/, "").split(/[/?]/)[0];
      const row = {
        id: 1,
        business_name: $("s-name").value.trim(),
        whatsapp_number: digits,
        phone_display: typed,
        email: $("s-email").value.trim(),
        tiktok_handle: tiktok,
        whatsapp_group: group,
        announcement: $("s-note").value.trim(),
        updated_at: new Date().toISOString(),
      };
      btn.disabled = true; btn.textContent = "Saving…";
      const { data, error } = await sb.from("settings").upsert(row).select().single();
      btn.disabled = false; btn.textContent = "Save details";
      if (error) {
        err.textContent = /settings|schema cache|does not exist/i.test(error.message)
          ? "The settings table isn't set up yet. Run settings.sql in Supabase (see README), then try again."
          : error.message;
        err.hidden = false;
        return;
      }
      settings = data;
      toast("Saved");
    };

    $("pwform").onsubmit = async (e) => {
      e.preventDefault();
      const a = $("pw1").value, b = $("pw2").value;
      const btn = $("pBtn"), err = $("perr");
      err.hidden = true;
      if (a.length < 10) { err.textContent = "Use at least 10 characters."; err.hidden = false; return; }
      if (a !== b) { err.textContent = "The two passwords don't match."; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = "Changing…";
      const { error } = await sb.auth.updateUser({ password: a });
      btn.disabled = false; btn.textContent = "Change password";
      if (error) {
        err.textContent = /reauth|recent/i.test(error.message)
          ? "For security, log out, log in again, then change your password."
          : error.message;
        err.hidden = false;
        return;
      }
      e.target.reset();
      toast("Password changed. Use the new password on your other devices.");
    };
  }

  /* ---------- Owner: product form ---------- */

  const pathFromUrl = (u) => { const i = u.indexOf(`/${BUCKET}/`); return i === -1 ? null : decodeURIComponent(u.slice(i + BUCKET.length + 2).split("?")[0]); };
  async function removeImages(urls) {
    const paths = urls.map(pathFromUrl).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  }

  async function compress(src, max = 1100, quality = 0.82) {
    const bmp = await createImageBitmap(src);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, "image/jpeg", quality));
  }

  async function uploadBlob(blob, prefix = "") {
    const path = `${prefix}${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  function openForm(p) {
    const host = document.getElementById("formHost");
    // images: existing {url} or new {file, preview}
    let images = (p && p.image_urls ? p.image_urls : []).map((url) => ({ url }));
    const removed = [];
    const cats = Array.from(new Set(["Clothes", "Shoes", "Bags", "Electronics", "Accessories", "Home & Kitchen", ...products.map((x) => x.category).filter(Boolean)]));
    const batchBoxes = batches.length ? `
        <div class="field"><label>Batches</label>
          ${batches.map((b) => `<label class="check"><input type="checkbox" name="fb" value="${esc(b.id)}" ${p && (p.batch_ids || []).includes(b.id) ? "checked" : ""}> ${esc(b.name)} <span class="pill ${isOpen(b) ? (b.status === "ongoing" ? "ok" : "soon") : "out"}">${esc(isOpen(b) ? statusLabel(b) : "Closed")}</span></label>`).join("")}
          <span class="hint">Tick the batch(es) this product is in. Leave all unticked to show it in every batch.</span></div>` : "";

    host.innerHTML = `
      <form class="panel" id="pform" style="margin-top:16px">
        <h2 style="margin:0 0 14px;font-size:18px">${p ? "Edit product" : "Add product"}</h2>
        <div class="field"><label>Photos (up to ${MAX_IMAGES})</label>
          <div class="imgs" id="imgs"></div>
          <input type="file" id="files" accept="image/*" multiple>
          <span class="hint">The first photo is the main one shown in the shop. Photos are resized automatically so the app stays fast.</span></div>
        <div class="field"><label for="f-name">Product name</label>
          <input id="f-name" type="text" required maxlength="120" value="${esc(p ? p.name : "")}"></div>
        <div class="field"><label for="f-cat">Category</label>
          <input id="f-cat" type="text" list="cats" required maxlength="40" value="${esc(p ? p.category : "")}" placeholder="e.g. Shoes">
          <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
        <div class="two">
          <div class="field"><label for="f-price">Item price (₦)</label>
            <input id="f-price" type="number" inputmode="decimal" min="0" step="any" required value="${p ? esc(p.price) : ""}"></div>
          <div class="field"><label for="f-ship">Shipping fee (₦)</label>
            <input id="f-ship" type="number" inputmode="decimal" min="0" step="any" required value="${p ? esc(p.shipping_fee) : ""}"></div>
        </div>
        <div class="preview-total" id="ptotal"></div>
        ${batchBoxes}
        <div class="field"><label for="f-desc">Description (optional)</label>
          <textarea id="f-desc" maxlength="1000" placeholder="Sizes, colours, delivery time…">${esc(p ? p.description || "" : "")}</textarea></div>
        <label class="check"><input type="checkbox" id="f-stock" ${!p || p.in_stock ? "checked" : ""}> Available for preorder</label>
        <p class="error" id="ferr" role="alert" hidden></p>
        <div class="actions" style="margin-top:12px"><button class="btn" type="submit" id="saveBtn">Save product</button>
          <button class="btn btn-ghost" type="button" id="cancelBtn">Cancel</button></div>
      </form>`;
    host.scrollIntoView({ behavior: "smooth", block: "start" });

    const $ = (id) => document.getElementById(id);
    const drawImgs = () => {
      $("imgs").innerHTML = images.map((im, i) => `<div class="im"><img src="${esc(im.url || im.preview)}" alt="Photo ${i + 1}"><button type="button" data-i="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join("");
    };
    const drawTotal = () => {
      const t = Number($("f-price").value || 0) + Number($("f-ship").value || 0);
      $("ptotal").innerHTML = `Customers will see a total of <b>${naira(t)}</b>`;
    };
    drawImgs(); drawTotal();
    $("f-price").oninput = drawTotal; $("f-ship").oninput = drawTotal;
    $("imgs").onclick = (e) => {
      const b = e.target.closest("button[data-i]"); if (!b) return;
      const [gone] = images.splice(Number(b.dataset.i), 1);
      if (gone.url) removed.push(gone.url);
      drawImgs();
    };
    $("files").onchange = (e) => {
      for (const f of Array.from(e.target.files)) {
        if (images.length >= MAX_IMAGES) { toast(`Maximum ${MAX_IMAGES} photos per product`); break; }
        images.push({ file: f, preview: URL.createObjectURL(f) });
      }
      e.target.value = ""; drawImgs();
    };
    $("cancelBtn").onclick = () => { host.innerHTML = ""; };
    $("pform").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("saveBtn"), err = $("ferr");
      err.hidden = true; btn.disabled = true; btn.textContent = "Saving…";
      try {
        const urls = [];
        for (const im of images) {
          if (im.url) { urls.push(im.url); continue; }
          urls.push(await uploadBlob(await compress(im.file)));
        }
        const row = {
          name: $("f-name").value.trim(),
          category: $("f-cat").value.trim() || "Other",
          price: Number($("f-price").value),
          shipping_fee: Number($("f-ship").value),
          description: $("f-desc").value.trim(),
          in_stock: $("f-stock").checked,
          image_urls: urls,
        };
        // small preview + batches need batches.sql to have been run
        const oldThumb = p ? p.thumb_url || null : null;
        let thumbUrl = oldThumb;
        if (batchesReady) {
          const first = images[0];
          if (!first) thumbUrl = null;
          else if (first.file) thumbUrl = await uploadBlob(await compress(first.file, THUMB_MAX, 0.72), "thumbs/");
          else if (!p || p.image_urls[0] !== first.url || !p.thumb_url) {
            try {
              const blob = await (await fetch(first.url)).blob();
              thumbUrl = await uploadBlob(await compress(blob, THUMB_MAX, 0.72), "thumbs/");
            } catch (_) { thumbUrl = null; }
          }
          row.thumb_url = thumbUrl;
          row.batch_ids = Array.from(document.querySelectorAll('input[name="fb"]:checked')).map((x) => x.value);
        }
        const res = p ? await sb.from("products").update(row).eq("id", p.id).select().single()
                      : await sb.from("products").insert(row).select().single();
        if (res.error) throw res.error;
        const toRemove = [...removed];
        if (oldThumb && oldThumb !== thumbUrl) toRemove.push(oldThumb);
        if (toRemove.length) await removeImages(toRemove);
        if (p) products = products.map((x) => (x.id === p.id ? res.data : x));
        else products.unshift(res.data);
        host.innerHTML = ""; drawOwnerList(); toast("Saved");
      } catch (ex) {
        err.textContent = ex.message || "Could not save. Please try again.";
        err.hidden = false; btn.disabled = false; btn.textContent = "Save product";
      }
    };
  }

  // The owner area is not linked anywhere customers can see.
  // To open the owner login: tap the logo at the top 5 times quickly.
  (function () {
    const brand = document.querySelector(".brand");
    if (!brand) return;
    let taps = 0, timer;
    brand.addEventListener("click", (e) => {
      taps += 1;
      clearTimeout(timer);
      timer = setTimeout(() => { taps = 0; }, 2500);
      if (taps >= 5) { taps = 0; e.preventDefault(); location.hash = "#/owner"; }
    });
  })();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  init();
})();
