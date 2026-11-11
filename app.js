(() => {
  "use strict";
  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById("app");
  const $id = (id) => document.getElementById(id);
  const MAX_IMAGES = 4;
  const BUCKET = "product-images";
  const THUMB_MAX = 480;
  const CART_KEY = "ebony_cart_v1";
  const FAV_KEY = "ebony_favs_v1";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const naira = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
  const total = (p) => Number(p.price || 0) + Number(p.shipping_fee || 0);
  // small preview for the grid; falls back to the full photo for older products
  const thumbOf = (p) => p.thumb_url || (p.image_urls && p.image_urls[0]) || "";
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

  // Sizes: a range like "38-44" becomes 38, 39, 40 ... 44 and "S-XL" becomes S, M, L, XL.
  // Anything else is kept exactly as typed. Used in the shop and in the owner form.
  const LETTER_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];
  const letterIdx = (s) => LETTER_SIZES.indexOf(String(s).toUpperCase().replace(/^2XL$/, "XXL").replace(/^3XL$/, "XXXL"));
  function expandSizes(v) {
    const raw = Array.isArray(v) ? v.join(",") : String(v || "");
    const out = [];
    raw.replace(/[–—]/g, "-").split(/[,;\n]/).forEach((tok) => {
      const t = tok.trim().replace(/\s+to\s+/i, "-");
      if (!t) return;
      const n = t.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
      if (n) {
        const lo = Math.min(parseFloat(n[1]), parseFloat(n[2])), hi = Math.max(parseFloat(n[1]), parseFloat(n[2]));
        const step = (lo % 1 || hi % 1) ? 0.5 : 1;
        if ((hi - lo) / step <= 40) {
          for (let x = lo; x <= hi + 1e-9; x += step) out.push(String(Math.round(x * 100) / 100));
          return;
        }
      }
      const l = t.match(/^([a-z0-9]{1,4})\s*-\s*([a-z0-9]{1,4})$/i);
      if (l && letterIdx(l[1]) >= 0 && letterIdx(l[2]) >= 0) {
        const a = Math.min(letterIdx(l[1]), letterIdx(l[2])), z = Math.max(letterIdx(l[1]), letterIdx(l[2]));
        out.push(...LETTER_SIZES.slice(a, z + 1));
        return;
      }
      out.push(t.slice(0, 24));
    });
    return out.filter((s, i, a) => a.indexOf(s) === i).slice(0, 40);
  }
  const sizesOf = (p) => expandSizes(list(p.sizes));
  const pad2 = (n) => String(n).padStart(2, "0");

  // Things the customer's own device remembers (cart, saved items)
  const LS = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };

  const ICON = {
    heart: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>`,
    back: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
    plus: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
    minus: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>`,
    wa: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 18.8L4 20z"/></svg>`,
  };

  // Colour names the owner can type, shown as round swatches (other names show as a text button)
  const COLOURS = {
    black: "#111111", white: "#F4EFE6", tan: "#B08A5A", brown: "#6B4A2F", beige: "#D8C3A5", cream: "#EFE6D2",
    grey: "#8C8C8C", gray: "#8C8C8C", silver: "#C0C0C0", gold: "#C9AB66", red: "#B3261E", maroon: "#6D1B2A",
    wine: "#6D1B2A", pink: "#E58FAE", purple: "#6B4FA0", blue: "#2F5FA8", navy: "#1B2A4A", green: "#2F6B3A",
    olive: "#6B6B2F", khaki: "#B5A874", yellow: "#E5C32F", orange: "#E07B2A", "light blue": "#8CB8E0", "sky blue": "#8CB8E0",
    "dark green": "#1F4A2A",
  };
  const swatchOf = (name) => COLOURS[String(name).trim().toLowerCase()] || null;

  let sb = null;
  let session = null;
  let products = [];
  let batches = [];
  let batchesReady = false; // true once batches.sql has been run in Supabase
  let optionsReady = false; // true once options.sql (sizes + colours) has been run
  let batchSel = null;
  let loadError = "";
  let loaded = false;
  let filterCat = "All";
  let query = "";
  let showFavs = false;
  let page = null; // state of the product page being viewed
  let navDepth = 0;
  let settings = {};
  let ordersOk = false; // true once orders.sql has been run in Supabase

  let cart = LS.get(CART_KEY, []);
  if (!Array.isArray(cart)) cart = [];
  cart = cart
    .filter((i) => i && typeof i.pid === "string" && Number(i.qty) > 0)
    .map((i) => ({ pid: i.pid, bid: i.bid || null, size: i.size || "", colour: i.colour || "", qty: Math.min(20, Math.max(1, Math.floor(Number(i.qty)))) }));
  let favs = LS.get(FAV_KEY, []);
  if (!Array.isArray(favs)) favs = [];

  // Business name: what the owner saved in Settings, otherwise the default
  const bizName = () => ((settings.business_name || "").trim() || "Ebony Imports Hub");
  // Shop details: use what the owner saved in Settings, otherwise fall back to config.js
  const val = (k) => {
    const v = settings[k.toLowerCase()];
    return v !== undefined && v !== null && String(v).trim() !== "" ? String(v).trim() : cfg[k];
  };
  const waNum = () => String(val("WHATSAPP_NUMBER") || "").replace(/\D/g, "");

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
  const endMs = (s) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 23, 59, 59).getTime(); };
  const cdParts = (end) => {
    const left = end - Date.now();
    if (left <= 0) return null;
    return { d: Math.floor(left / 864e5), h: Math.floor((left % 864e5) / 36e5), m: Math.floor((left % 36e5) / 6e4) };
  };
  const closesText = (end) => { const c = cdParts(end); return c ? (c.d >= 1 ? `Closes in ${c.d} day${c.d === 1 ? "" : "s"}` : "Closes today") : "Closed"; };
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
  const savedProducts = () => products.filter((p) => favs.includes(p.id));

  // Live countdown tiles (days / hours / minutes)
  function countdownHtml(b) {
    const end = endMs(b.closes_on);
    const c = end && cdParts(end);
    if (!c) return "";
    const tile = (n, l) => `<div class="cd-tile"><b class="cd-n">${pad2(n)}</b><span>${l}</span></div>`;
    return `<div class="cd-wrap"><span class="eyebrow">Preorders close in</span>
      <div class="cd" data-end="${end}" role="timer" aria-label="${esc(closesText(end))}">${tile(c.d, "DAYS")}${tile(c.h, "HOURS")}${tile(c.m, "MINS")}</div></div>`;
  }
  function tick() {
    document.querySelectorAll(".cd[data-end]").forEach((el) => {
      const c = cdParts(Number(el.dataset.end));
      if (!c) { const w = el.closest(".cd-wrap"); if (w) w.remove(); return; }
      const n = el.querySelectorAll(".cd-n");
      if (n.length === 3) { n[0].textContent = pad2(c.d); n[1].textContent = pad2(c.h); n[2].textContent = pad2(c.m); }
    });
    document.querySelectorAll("[data-closes]").forEach((el) => { el.textContent = closesText(Number(el.dataset.closes)); });
  }
  setInterval(tick, 30000);

  /* ---------------- Cart + saved items ---------------- */

  const cartKey = (i) => [i.pid, i.bid || "", i.size || "", i.colour || ""].join("|");
  const cartCount = () => cart.reduce((t, i) => t + i.qty, 0);
  const saveCart = () => LS.set(CART_KEY, cart);
  const saveFavs = () => LS.set(FAV_KEY, favs);

  // Match each cart line with its product and batch, and check it can still be ordered
  function resolveCart() {
    return cart.map((i) => {
      const p = products.find((x) => x.id === i.pid) || null;
      const b = i.bid ? batches.find((x) => x.id === i.bid) || null : null;
      let reason = "";
      if (!p) reason = "No longer listed";
      else if (!p.in_stock) reason = "Sold out";
      else if (batches.length && !(b && isOpen(b) && productBatches(p).some((x) => x.id === b.id))) reason = "This batch is closed";
      else if (i.size && sizesOf(p).length && !sizesOf(p).includes(i.size)) reason = "Size changed. Remove it and pick a size again";
      return { ...i, p, b, ok: !reason, reason };
    });
  }
  const sums = (items) => {
    const it = items.reduce((t, i) => t + Number(i.p.price || 0) * i.qty, 0);
    const sh = items.reduce((t, i) => t + Number(i.p.shipping_fee || 0) * i.qty, 0);
    return { items: it, ship: sh, total: it + sh, count: items.reduce((t, i) => t + i.qty, 0) };
  };
  const variantText = (i) => [i.size ? `Size ${i.size}` : "", i.colour].filter(Boolean).join(" · ");

  function addToCart(line) {
    const k = cartKey(line);
    const ex = cart.find((i) => cartKey(i) === k);
    if (ex) ex.qty = Math.min(20, ex.qty + line.qty);
    else cart.push({ pid: line.pid, bid: line.bid || null, size: line.size || "", colour: line.colour || "", qty: line.qty });
    saveCart();
  }

  function orderMessage(ok, extra) {
    const groups = [];
    ok.forEach((i) => {
      const k = i.bid || "";
      let g = groups.find((x) => x.k === k);
      if (!g) { g = { k, b: i.b, items: [] }; groups.push(g); }
      g.items.push(i);
    });
    const line = (i) => `${i.qty} × ${i.p.name}${variantText(i) ? ` (${variantText(i).replace(" · ", ", ")})` : ""} – ${naira(total(i.p) * i.qty)}`;
    const out = [`Hello ${bizName()}, I would like to preorder:`];
    groups.forEach((g) => {
      if (groups.length > 1) out.push("", g.b ? `Batch: ${g.b.name}` : "Order:");
      g.items.forEach((i) => out.push(line(i)));
      if (groups.length === 1 && g.b) out.push(`Batch: ${g.b.name}`);
    });
    out.push(`Total: ${naira(sums(ok).total)}`);
    if (extra && extra.name) out.push(`Name: ${extra.name}`);
    if (extra && extra.code) out.push(`Order ref: ${extra.code}`);
    return out.join("\n");
  }

  function toggleFav(id, btn) {
    const on = !favs.includes(id);
    favs = on ? [...favs, id] : favs.filter((x) => x !== id);
    saveFavs();
    if (btn) {
      btn.setAttribute("aria-pressed", String(on));
      const nm = btn.dataset.name || "this item";
      btn.setAttribute("aria-label", on ? `Remove ${nm} from favourites` : `Save ${nm} to favourites`);
      btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop");
    }
    updateHeader(true);
    if (showFavs && !on && $id("grid")) drawGrid();
  }

  function updateHeader(bump) {
    const fc = $id("favCount"), cc = $id("cartCount"), fb = $id("favBtn");
    const f = favs.length, c = cartCount();
    if (fc) { fc.textContent = f; fc.hidden = f === 0; }
    if (cc) {
      const before = cc.textContent;
      cc.textContent = c; cc.hidden = c === 0;
      if (bump && String(c) !== before) { cc.classList.remove("bump"); void cc.offsetWidth; cc.classList.add("bump"); }
    }
    if (fb) { fb.setAttribute("aria-pressed", String(showFavs)); fb.setAttribute("aria-label", `Saved items, ${f} saved`); }
    const cl = $id("cartLink"); if (cl) cl.setAttribute("aria-label", `Cart, ${c} item${c === 1 ? "" : "s"}`);
  }

  // The bar at the bottom of the screen: "View cart" on the shop, "Add to cart" on a product page
  function setDock(html) {
    const el = $id("cartbar");
    if (!el) return;
    el.innerHTML = html || "";
    el.hidden = !html;
  }
  function updateDock() {
    const r = route();
    if (r.startsWith("/p/")) return; // the product page draws its own bar
    if (r.startsWith("/cart") || r.startsWith("/order") || r.startsWith("/owner") || !loaded) return setDock("");
    const ok = resolveCart().filter((i) => i.ok);
    if (!ok.length) return setDock("");
    const t = sums(ok);
    setDock(`<a class="dockbtn" href="#/cart"><span class="dk"><small>${t.count} item${t.count === 1 ? "" : "s"}</small><b>${naira(t.total)}</b></span><span>View cart →</span></a>`);
  }

  /* ---------------- Basics ---------------- */

  function toast(msg) {
    const t = $id("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 3200);
  }

  function setupNeeded() {
    app.innerHTML = `<div class="panel login"><h1>Almost ready</h1>
      <p>This app needs to be connected to its database. Open <b>config.js</b> and fill in your Supabase details, then reload. Steps are in README.md.</p></div>`;
  }

  function skeleton() {
    app.innerHTML = `<div class="view" aria-busy="true"><span class="sr-only">Loading</span><div class="sk sk-hero"></div><div class="grid">${'<div class="sk sk-card"></div>'.repeat(4)}</div></div>`;
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
    window.addEventListener("hashchange", () => { navDepth += 1; render(); });
    $id("favBtn").onclick = () => {
      if (route() === "/" || route() === "") { showFavs = !showFavs; filterCat = "All"; renderShop(); updateHeader(); }
      else { showFavs = true; filterCat = "All"; location.hash = "#/"; }
    };
    updateHeader();
    render();
    await Promise.all([loadProducts(), loadSettings(), loadBatches()]);
    favs = favs.filter((id) => products.some((p) => p.id === id));
    saveFavs();
    render();
  }

  async function loadProducts() {
    loadError = "";
    const { data, error } = await sb.from("products").select("*").order("created_at", { ascending: false });
    if (error) loadError = error.message;
    else products = data || [];
    // sizes + colours need options.sql
    const probe = await sb.from("products").select("sizes,colours").limit(1);
    optionsReady = !probe.error;
    loaded = true;
  }

  async function loadSettings() {
    const { data, error } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
    if (!error && data) settings = data; // if the table isn't set up yet, config.js values are used
    const probe = await sb.from("settings").select("accounts,pay_note").limit(1);
    ordersOk = !probe.error;
    if (ordersOk && !Array.isArray(settings.accounts)) settings = { ...settings, accounts: [] };
  }

  async function loadBatches() {
    const { data, error } = await sb.from("batches").select("*").order("created_at", { ascending: false });
    if (error) { batchesReady = false; batches = []; }
    else { batchesReady = true; batches = data || []; }
  }

  const route = () => (location.hash || "#/").slice(1);

  function render() {
    if (!sb) return;
    const r = route();
    if (!r.startsWith("/p/")) page = null;
    stopPoll();
    window.scrollTo(0, 0);
    if (r.startsWith("/owner")) renderOwner();
    else if (r.startsWith("/info")) renderInfo();
    else if (r.startsWith("/cart")) renderCart();
    else if (r.startsWith("/orders")) renderMyOrders();
    else if (r.startsWith("/order/")) renderOrder(decodeURIComponent(r.slice(7)));
    else if (r.startsWith("/p/")) renderProduct(decodeURIComponent(r.slice(3)));
    else renderShop();
    updateHeader();
    updateDock();
  }

  const goBack = () => { if (navDepth > 0) history.back(); else location.hash = "#/"; };

  /* ---------------- Shop ---------------- */

  function batchBar() {
    if (!batches.length) return "";
    const live = liveBatches();
    if (!live.length) return `<div class="notice">No preorder batch is open right now. Join our WhatsApp group to hear when the next one opens.</div>`;
    ensureBatchSel();
    const cur = live.find((b) => b.id === batchSel);
    return `<section class="box batches" aria-label="Preorder batches">
      <span class="eyebrow-muted">Choose a batch</span>
      <div class="b-tabs" id="btabs">${live.map((b) => `<button type="button" class="b-tab" data-b="${esc(b.id)}" aria-pressed="${b.id === batchSel}"><span class="b-name">${esc(b.name)}</span><span class="b-state">${esc(statusLabel(b))}</span></button>`).join("")}</div>
      ${cur && cur.status === "ongoing" ? countdownHtml(cur) : ""}
      ${cur && cur.status === "upcoming" ? `<span class="eyebrow">Opening soon</span>` : ""}
      <p class="b-info">${batchInfo(cur)}</p>
    </section>`;
  }

  function renderShop() {
    if (!loaded) return skeleton();
    if (loadError) {
      app.innerHTML = `<div class="view empty">Couldn't load products.<br><small>${esc(loadError)}</small><br><button class="btn btn-gold btn-sm" id="retry">Try again</button></div>`;
      $id("retry").onclick = async () => { loaded = false; render(); await Promise.all([loadProducts(), loadBatches()]); render(); };
      return;
    }
    const vis = showFavs ? savedProducts() : visibleProducts();
    const cats = ["All", ...Array.from(new Set(vis.map((p) => p.category).filter(Boolean)))];
    if (!cats.includes(filterCat)) filterCat = "All";
    app.innerHTML = `<div class="view">
      <section class="hero"><span class="eyebrow">Preorder from China</span>
        <h1>Preorder from China, delivered to you.</h1>
        <p>Every price already includes shipping. Add what you like to your cart and send one order on WhatsApp.</p></section>
      ${settings.announcement ? `<div class="notice">${esc(settings.announcement)}</div>` : ""}
      ${showFavs ? `<div class="savedbar"><b>Saved items</b><button type="button" class="btn btn-ghost btn-sm" id="allBtn">Show all products</button></div>` : batchBar() + rulesCard()}
      <div class="tools">
        <input class="search" type="search" id="q" placeholder="Search products" aria-label="Search products" value="${esc(query)}">
        <div class="chips" id="chips">${cats.map((c) => `<button type="button" class="chip" data-c="${esc(c)}" aria-pressed="${c === filterCat}">${esc(c)}</button>`).join("")}</div>
      </div>
      <div class="grid" id="grid"></div>
      ${contactSection()}</div>`;
    const tabs = $id("btabs");
    if (tabs) tabs.onclick = (e) => {
      const b = e.target.closest(".b-tab"); if (!b) return;
      batchSel = b.dataset.b; filterCat = "All";
      renderShop();
    };
    const all = $id("allBtn");
    if (all) all.onclick = () => { showFavs = false; renderShop(); updateHeader(); };
    $id("q").oninput = (e) => { query = e.target.value; drawGrid(); };
    $id("chips").onclick = (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      filterCat = b.dataset.c;
      document.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x.dataset.c === filterCat));
      drawGrid();
    };
    drawGrid();
  }

  function contactSection() {
    const num = waNum();
    const chat = `https://wa.me/${num}?text=${encodeURIComponent("Hello " + bizName() + ", I have a question.")}`;
    const items = [];
    if (num) items.push(`<a class="btn btn-wa" href="${esc(chat)}" target="_blank" rel="noopener">Chat on WhatsApp${val("PHONE_DISPLAY") ? ` · ${esc(val("PHONE_DISPLAY"))}` : ""}</a>`);
    if (val("WHATSAPP_GROUP")) items.push(`<a class="btn btn-gold" href="${esc(val("WHATSAPP_GROUP"))}" target="_blank" rel="noopener">Join our WhatsApp group</a>`);
    if (val("TIKTOK_HANDLE")) items.push(`<a class="btn btn-ghost" href="https://www.tiktok.com/@${esc(val("TIKTOK_HANDLE"))}" target="_blank" rel="noopener">TikTok @${esc(val("TIKTOK_HANDLE"))}</a>`);
    if (val("EMAIL")) items.push(`<a class="btn btn-ghost" href="mailto:${esc(val("EMAIL"))}">${esc(val("EMAIL"))}</a>`);
    if (!items.length) return "";
    return `<section class="contact box"><h2>Contact us</h2><p>Questions, or want something that isn't listed? Reach out.</p><div class="contact-links">${items.join("")}</div></section>`;
  }

  function drawGrid() {
    const grid = $id("grid");
    if (!grid) return;
    const q = query.trim().toLowerCase();
    const vis = showFavs ? savedProducts() : visibleProducts();
    const items = vis.filter((p) =>
      (filterCat === "All" || p.category === filterCat) &&
      (!q || (p.name + " " + (p.description || "") + " " + (p.category || "")).toLowerCase().includes(q)));
    if (!items.length) {
      const noBatchOpen = !showFavs && batches.length && !liveBatches().length;
      const msg = showFavs ? "No saved items yet. Tap the heart on a product to save it."
        : noBatchOpen ? "Check back soon for the next batch."
        : vis.length ? "No products match your search."
        : batches.length ? "No products in this batch yet. Please check back soon."
        : "No products yet. Please check back soon.";
      grid.innerHTML = `<div class="empty">${msg}</div>`;
      grid.onclick = null;
      return;
    }
    grid.innerHTML = items.map((p) => {
      const saved = favs.includes(p.id);
      const href = `#/p/${encodeURIComponent(p.id)}`;
      return `<article class="card">
        <div class="thumbwrap">
          <a class="thumb" href="${href}" aria-label="View ${esc(p.name)}">${thumbOf(p) ? `<img src="${esc(thumbOf(p))}" alt="" loading="lazy" decoding="async">` : `<div class="noimg">Product photo</div>`}</a>
          <button type="button" class="heart" data-heart="${esc(p.id)}" data-name="${esc(p.name)}" aria-pressed="${saved}" aria-label="${saved ? "Remove" : "Save"} ${esc(p.name)} ${saved ? "from" : "to"} favourites">${ICON.heart}</button>
          ${p.in_stock ? "" : `<span class="soldchip">SOLD OUT</span>`}
        </div>
        <div class="card-body">
          <a class="card-link" href="${href}">
            <span class="cat">${esc(p.category)}</span>
            <span class="pname">${esc(p.name)}</span>
            <span class="break">${naira(p.price)} + ${naira(p.shipping_fee)} shipping</span>
          </a>
          <div class="card-foot">
            <div class="tot"><span class="total">${naira(total(p))}</span><small>total</small></div>
            <a class="plus" href="${href}" aria-label="Choose options for ${esc(p.name)}">${ICON.plus}</a>
          </div>
        </div>
      </article>`;
    }).join("");
    grid.onclick = (e) => {
      const h = e.target.closest("[data-heart]"); if (!h) return;
      toggleFav(h.dataset.heart, h);
    };
  }

  /* ---------------- Product page ---------------- */

  function renderProduct(id) {
    if (!loaded) return skeleton();
    const p = products.find((x) => x.id === id);
    if (!p) {
      app.innerHTML = `<div class="view empty"><p>This product isn't available any more.</p><a class="btn btn-gold" href="#/">Back to shop</a></div>`;
      setDock("");
      return;
    }
    const avail = batches.length ? productBatches(p) : [];
    const sizes = sizesOf(p), cols = list(p.colours);
    if (!page || page.pid !== id) {
      page = {
        pid: id,
        size: sizes.length === 1 ? sizes[0] : "",
        colour: cols.length === 1 ? cols[0] : "",
        qty: 1,
        bid: avail.some((b) => b.id === batchSel) ? batchSel : (avail[0] ? avail[0].id : null),
      };
    }
    const imgs = list(p.image_urls);
    const saved = favs.includes(p.id);
    app.innerHTML = `<div class="view pwrap">
      <div class="pgal">
        <div class="pgal-track" id="gtrack">${imgs.length ? imgs.map((u, i) => `<img src="${esc(u)}" alt="${esc(p.name)} photo ${i + 1}" ${i ? 'loading="lazy"' : ""} decoding="async">`).join("") : `<div class="noimg">Product photo</div>`}</div>
        <button type="button" class="pbtn pback" id="pBack" aria-label="Back">${ICON.back}</button>
        <button type="button" class="pbtn pheart" id="pHeart" data-name="${esc(p.name)}" aria-pressed="${saved}" aria-label="${saved ? "Remove from" : "Save to"} favourites">${ICON.heart}</button>
        ${imgs.length > 1 ? `<div class="dots"><div class="dots-in" id="dots">${imgs.map((_, i) => `<span class="dot${i === 0 ? " on" : ""}"></span>`).join("")}</div></div>` : ""}
      </div>
      <div class="pinfo" id="pinfo">
        <div class="phead"><span class="eyebrow">${esc(p.category)}</span><h1>${esc(p.name)}</h1><div class="pbatch" id="pbatch"></div></div>
        <div class="box pricebox">
          <div class="row"><span>Item price</span><span>${naira(p.price)}</span></div>
          <div class="row"><span>Shipping fee</span><span>${naira(p.shipping_fee)}</span></div>
          <hr>
          <div class="big"><span class="lbl">TOTAL</span><span class="amt">${naira(total(p))}</span></div>
        </div>
        <div id="popts"></div>
        ${p.description ? `<div class="pdesc"><span class="opt-label">About this item</span><p>${esc(p.description)}</p></div>` : ""}
        <div class="qtyrow"><span class="opt-label">Quantity</span><div id="pqty"></div></div>
      </div>
    </div>`;
    $id("pBack").onclick = goBack;
    $id("pHeart").onclick = (e) => toggleFav(p.id, e.currentTarget);
    const track = $id("gtrack"), dots = $id("dots");
    if (dots) track.addEventListener("scroll", () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      dots.querySelectorAll(".dot").forEach((d, n) => d.classList.toggle("on", n === i));
    }, { passive: true });
    $id("pinfo").onclick = (e) => {
      const t = e.target.closest("[data-bid],[data-size],[data-colour],[data-q]"); if (!t) return;
      if (t.dataset.bid) page.bid = t.dataset.bid;
      if (t.dataset.size !== undefined) page.size = page.size === t.dataset.size ? "" : t.dataset.size;
      if (t.dataset.colour !== undefined) page.colour = page.colour === t.dataset.colour ? "" : t.dataset.colour;
      if (t.dataset.q) page.qty = Math.min(20, Math.max(1, page.qty + Number(t.dataset.q)));
      drawProductControls(p, avail);
    };
    drawProductControls(p, avail);
  }

  function drawProductControls(p, avail) {
    const sizes = sizesOf(p), cols = list(p.colours);
    const b = avail.find((x) => x.id === page.bid) || null;
    // batch
    let bh = "";
    if (batches.length && !avail.length) bh = `<span class="bpill" style="background:var(--surface2);color:var(--muted)">Not open for preorder right now</span>`;
    else if (avail.length === 1) {
      const end = endMs(b.closes_on);
      bh = `<span class="bpill">${esc(b.name)} · ${esc(statusLabel(b))}</span>${end ? `<span class="closes" data-closes="${end}">${esc(closesText(end))}</span>` : ""}`;
    } else if (avail.length > 1) {
      bh = `<div class="b-opts">${avail.map((x) => `<button type="button" class="b-opt" data-bid="${esc(x.id)}" aria-pressed="${x.id === page.bid}">${esc(x.name)} · ${esc(statusLabel(x))}</button>`).join("")}</div>
        <p class="b-info" style="width:100%">${batchInfo(b)}</p>`;
    }
    $id("pbatch").innerHTML = bh;
    // sizes + colours
    let oh = "";
    if (sizes.length) oh += `<div class="opt"><span class="opt-label">Size${page.size ? ` · <b>${esc(page.size)}</b>` : ""}</span>
      <div class="sizes">${sizes.map((z) => `<button type="button" class="size" data-size="${esc(z)}" aria-pressed="${z === page.size}">${esc(z)}</button>`).join("")}</div></div>`;
    if (cols.length) oh += `<div class="opt"><span class="opt-label">Colour${page.colour ? ` · <b>${esc(page.colour)}</b>` : ""}</span>
      <div class="swatches">${cols.map((c) => {
        const hex = swatchOf(c);
        return hex
          ? `<button type="button" class="swatch" data-colour="${esc(c)}" aria-label="${esc(c)}" aria-pressed="${c === page.colour}" style="background:${hex}"></button>`
          : `<button type="button" class="size" data-colour="${esc(c)}" aria-pressed="${c === page.colour}">${esc(c)}</button>`;
      }).join("")}</div></div>`;
    $id("popts").innerHTML = oh ? `<div style="display:flex;flex-direction:column;gap:22px">${oh}</div>` : "";
    // quantity
    $id("pqty").innerHTML = `<div class="qty"><button type="button" data-q="-1" aria-label="Decrease quantity">${ICON.minus}</button><span aria-live="polite">${page.qty}</span><button type="button" data-q="1" aria-label="Increase quantity">${ICON.plus}</button></div>`;
    // add to cart bar
    let label = "Add to cart", dis = false;
    if (!p.in_stock) { label = "Sold out"; dis = true; }
    else if (batches.length && !avail.length) { label = "Not open for preorder"; dis = true; }
    else if (sizes.length && !page.size) { label = "Choose a size"; dis = true; }
    else if (cols.length && !page.colour) { label = "Choose a colour"; dis = true; }
    setDock(`<button type="button" class="dockbtn" id="addBtn" ${dis ? "disabled" : ""}><span>${label}</span><span class="addtotal">${naira(total(p) * page.qty)}</span></button>`);
    $id("addBtn").onclick = () => {
      if (dis) return;
      addToCart({ pid: p.id, bid: b ? b.id : null, size: page.size, colour: page.colour, qty: page.qty });
      updateHeader(true);
      toast("Added to cart");
      location.hash = "#/cart";
    };
  }

  /* ---------------- Cart page ---------------- */

  function renderCart() {
    if (!loaded) return skeleton();
    const items = resolveCart();
    const ok = items.filter((i) => i.ok), bad = items.filter((i) => !i.ok);
    const n = cartCount();
    const head = `<div class="chead"><button type="button" class="iconbtn" id="cBack" aria-label="Back to shop">${ICON.back}</button><h1>Your cart</h1><span class="ccount">${n} ITEM${n === 1 ? "" : "S"}</span></div>`;
    if (!items.length) {
      app.innerHTML = `<div class="view cartpage">${head}<div class="empty"><p>Your cart is empty.</p><a class="btn btn-gold" href="#/">Browse products</a></div></div>`;
      $id("cBack").onclick = goBack;
      return;
    }
    const row = (i) => `<div class="crow${i.ok ? "" : " gone"}" data-key="${esc(cartKey(i))}">
      <div class="cthumb">${i.p && thumbOf(i.p) ? `<img src="${esc(thumbOf(i.p))}" alt="">` : "PHOTO"}</div>
      <div class="cmid">
        <b class="cname">${esc(i.p ? i.p.name : "Item no longer listed")}</b>
        ${variantText(i) ? `<span class="cvar">${esc(variantText(i))}</span>` : ""}
        ${i.p ? `<span class="cunit">${naira(i.p.price)} + ${naira(i.p.shipping_fee)} shipping each</span>` : ""}
        ${i.ok ? "" : `<span class="cwarn">${esc(i.reason)}</span>`}
        <div class="cfoot">
          ${i.ok ? `<div class="qty sm"><button type="button" data-act="minus" aria-label="Decrease ${esc(i.p.name)}">${ICON.minus}</button><span>${i.qty}</span><button type="button" data-act="plus" aria-label="Increase ${esc(i.p.name)}">${ICON.plus}</button></div><span class="cprice">${naira(total(i.p) * i.qty)}</span>` : ""}
          <button type="button" class="linkbtn" data-act="remove">Remove</button>
        </div>
      </div></div>`;
    const groups = [];
    ok.forEach((i) => {
      const k = i.bid || "";
      let g = groups.find((x) => x.k === k);
      if (!g) { g = { k, b: i.b, items: [] }; groups.push(g); }
      g.items.push(i);
    });
    const t = sums(ok);
    const canSend = ok.length > 0 && !bad.length;
    const cust = LS.get(CUST_KEY, {}) || {};
    let checkout = "";
    if (!canSend) {
      checkout = `<button type="button" class="btn btn-wa wide" disabled>${ICON.wa} Send order on WhatsApp</button>`;
    } else if (!ordersOk) {
      // orders.sql not run yet: the original WhatsApp-only checkout still works
      const msg = orderMessage(ok);
      checkout = waNum()
        ? `<div style="display:flex;flex-direction:column;gap:10px"><a class="btn btn-wa wide" id="sendWa" href="https://wa.me/${waNum()}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ICON.wa} Send order on WhatsApp</a>
           <span class="cnote">This opens WhatsApp with your full order list ready to send.</span></div>
           <div class="msgbox"><span class="eyebrow">Your message</span><pre>${esc(msg)}</pre></div>`
        : `<button type="button" class="btn btn-wa wide" disabled>${ICON.wa} Send order on WhatsApp</button>`;
    } else {
      const tr = canTransfer();
      checkout = `<div class="box o-co">
        <span class="eyebrow">How would you like to order?</span>
        <div class="field"><label for="c-name">Your name</label><input id="c-name" type="text" maxlength="80" autocomplete="name" value="${esc(cust.name || "")}"></div>
        <div class="field"><label for="c-phone">Phone number</label><input id="c-phone" type="text" inputmode="tel" maxlength="30" autocomplete="tel" value="${esc(cust.phone || "")}">
          <span class="hint">Needed for bank transfer so we can match your payment. Optional for WhatsApp.</span></div>
        <p class="error" id="coErr" role="alert" hidden></p>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${tr ? `<button type="button" class="btn btn-gold wide" id="payTr">Pay by bank transfer</button>
          <span class="cnote">You will see our account numbers. Pay, then upload your receipt here or send it on WhatsApp. We confirm your order once the money arrives.</span>` : ""}
          <button type="button" class="btn btn-wa wide" id="payWa">${ICON.wa} Send order on WhatsApp</button>
          <span class="cnote">${waNum() ? "Opens WhatsApp with your order list ready to send. " : ""}Your order is also saved here so you can track it.</span>
        </div></div>`;
    }
    app.innerHTML = `<div class="view cartpage">${head}
      ${groups.map((g) => `${g.b ? `<div class="from"><span class="eyebrow">Ordering from</span><b>${esc(g.b.name)}</b><span class="b-info">${batchInfo(g.b)}</span></div>` : ""}
        <div style="display:flex;flex-direction:column;gap:12px">${g.items.map(row).join("")}</div>`).join("")}
      ${bad.length ? `<div class="warnbox">Some items can't be ordered any more. Remove them to send your order.</div><div style="display:flex;flex-direction:column;gap:12px">${bad.map(row).join("")}</div>` : ""}
      ${ok.length ? `<div class="box sumbox">
        <div class="row"><span>Items</span><span>${naira(t.items)}</span></div>
        <div class="row"><span>Shipping</span><span>${naira(t.ship)}</span></div>
        <hr><div class="big"><span class="lbl">TOTAL</span><span class="amt">${naira(t.total)}</span></div></div>` : ""}
      ${checkout}
      <button type="button" class="btn btn-ghost" id="clearCart">Clear cart</button>
      ${myOrders.length ? `<a class="linkbtn" style="text-align:center;display:block;padding-top:12px" href="#/orders">My orders</a>` : ""}
    </div>`;
    const placeOrder = async (method) => {
      const err = $id("coErr");
      const name = $id("c-name").value.trim(), phone = $id("c-phone").value.trim();
      LS.set(CUST_KEY, { name, phone });
      err.hidden = true;
      if (method === "transfer" && (!name || phone.replace(/\D/g, "").length < 10)) {
        err.textContent = "Please enter your name and a valid phone number so we can match your payment.";
        err.hidden = false;
        return;
      }
      const btns = [$id("payWa"), $id("payTr")].filter(Boolean);
      btns.forEach((x) => { x.disabled = true; });
      // open the WhatsApp tab right now (browsers only allow it straight after a tap), fill it in once the order is saved
      let w = null;
      if (method === "whatsapp" && waNum()) { try { w = window.open("about:blank", "_blank"); } catch (_) { w = null; } }
      const { data, error } = await sb.rpc("place_order", {
        p_items: ok.map((i) => ({ pid: i.pid, bid: i.bid, size: i.size, colour: i.colour, qty: i.qty })),
        p_method: method, p_name: name, p_phone: phone,
      });
      if (error || !data) {
        if (w) { try { w.close(); } catch (_) {} }
        err.textContent = (error && error.message) || "Couldn't place the order. Please try again.";
        err.hidden = false;
        btns.forEach((x) => { x.disabled = false; });
        return;
      }
      myOrders.unshift({ code: data.code, token: data.token, at: Date.now() });
      saveOrders();
      if (w) { try { w.location.href = `https://wa.me/${waNum()}?text=${encodeURIComponent(orderMessage(ok, { code: data.code, name }))}`; } catch (_) {} }
      cart = []; saveCart();
      location.hash = "#/order/" + data.token;
    };
    if ($id("payWa")) $id("payWa").onclick = () => placeOrder("whatsapp");
    if ($id("payTr")) $id("payTr").onclick = () => placeOrder("transfer");
    $id("cBack").onclick = goBack;
    $id("clearCart").onclick = () => {
      if (!confirm("Remove everything from your cart?")) return;
      cart = []; saveCart(); renderCart(); updateHeader(); updateDock();
    };
    app.querySelector(".cartpage").onclick = (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const key = b.closest(".crow").dataset.key;
      const line = cart.find((i) => cartKey(i) === key); if (!line) return;
      if (b.dataset.act === "plus") line.qty = Math.min(20, line.qty + 1);
      if (b.dataset.act === "minus") line.qty = Math.max(1, line.qty - 1);
      if (b.dataset.act === "remove") cart = cart.filter((i) => i !== line);
      saveCart(); renderCart(); updateHeader(); updateDock();
    };
  }

  /* ---------------- Orders (customer side) ---------------- */

  const ORD_KEY = "ebony_orders_v1", CUST_KEY = "ebony_cust_v1";
  let myOrders = LS.get(ORD_KEY, []);
  if (!Array.isArray(myOrders)) myOrders = [];
  myOrders = myOrders.filter((o) => o && typeof o.token === "string" && typeof o.code === "string");
  const saveOrders = () => LS.set(ORD_KEY, myOrders.slice(0, 20));
  const accountsList = () => (Array.isArray(settings.accounts) ? settings.accounts : []).filter((a) => a && String(a.number || "").trim());
  const canTransfer = () => ordersOk && accountsList().length > 0;
  let pollT = null;
  const stopPoll = () => { if (pollT) { clearInterval(pollT); pollT = null; } };
  const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (_) { return ""; } };

  const STATUS_TXT = {
    requested: "Sent on WhatsApp", awaiting_payment: "Awaiting payment", receipt_sent: "Receipt received",
    confirmed: "Confirmed", cancelled: "Cancelled",
  };
  const statusChip = (st) => `<span class="o-chip st-${esc(st)}">${esc(STATUS_TXT[st] || st)}</span>`;

  async function fetchOrders(tokens) {
    const { data, error } = await sb.rpc("get_orders", { p_tokens: tokens });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  function orderMsgFromRow(o) {
    const out = [`Hello ${bizName()}, I would like to preorder:`];
    (o.items || []).forEach((i) => {
      const v = [i.size ? `Size ${i.size}` : "", i.colour].filter(Boolean).join(", ");
      out.push(`${i.qty} × ${i.name}${v ? ` (${v})` : ""} – ${naira((Number(i.price) + Number(i.ship)) * i.qty)}`);
    });
    out.push(`Total: ${naira(o.total)}`);
    if (o.name) out.push(`Name: ${o.name}`);
    out.push(`Order ref: ${o.code}`);
    return out.join("\n");
  }

  async function copyText(txt) {
    try { await navigator.clipboard.writeText(txt); toast("Copied"); return; } catch (_) {}
    try {
      const ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied");
    } catch (_) { toast("Copy didn't work. Please type the number."); }
  }

  function orderSteps(o) {
    const transfer = o.method === "transfer";
    const names = transfer ? ["Order placed", "Payment sent", "Confirmed"] : ["Sent on WhatsApp", "Confirmed"];
    let at = 0;
    if (o.status === "receipt_sent") at = 1;
    if (o.status === "confirmed") at = names.length - 1;
    return `<ol class="o-steps">${names.map((n, i) => `<li class="${o.status === "confirmed" || i < at ? "done" : i === at ? "now" : ""}"><i>${o.status === "confirmed" || i < at ? "✓" : i + 1}</i><span>${esc(n)}</span></li>`).join("")}</ol>`;
  }

  async function renderOrder(token) {
    if (!loaded) return skeleton();
    app.innerHTML = `<div class="view cartpage"><div class="chead"><button type="button" class="iconbtn" id="oBack" aria-label="Back">${ICON.back}</button><h1>Your order</h1></div><p class="muted" style="padding:12px 4px">Loading your order…</p></div>`;
    $id("oBack").onclick = () => { location.hash = "#/"; };
    const load = async () => { try { return (await fetchOrders([token]))[0] || null; } catch (_) { return undefined; } };
    let o = await load();
    if (route() !== "/order/" + token) return;
    if (o === undefined || o === null) {
      app.innerHTML = `<div class="view cartpage"><div class="chead"><button type="button" class="iconbtn" id="oBack" aria-label="Back">${ICON.back}</button><h1>Your order</h1></div>
        <div class="empty"><p>${o === null ? "We couldn't find this order." : "Couldn't load your order. Check your connection and try again."}</p><a class="btn btn-gold" href="#/">Back to shop</a></div></div>`;
      $id("oBack").onclick = () => { location.hash = "#/"; };
      return;
    }
    let busy = false;
    const draw = () => {
      const transfer = o.method === "transfer";
      const open = o.status !== "confirmed" && o.status !== "cancelled";
      const accts = accountsList();
      const waBase = waNum() ? `https://wa.me/${waNum()}?text=` : "";
      let banner = "";
      if (o.status === "confirmed") banner = `<div class="o-banner ok"><b>Order confirmed ✓</b><span>${o.confirmed_at ? "Confirmed " + esc(fmtWhen(o.confirmed_at)) + ". " : ""}Thank you! We will update you on shipping.</span></div>`;
      else if (o.status === "cancelled") banner = `<div class="o-banner bad"><b>Order cancelled</b><span>If this is a mistake, please message us on WhatsApp with your order number.</span></div>`;
      else if (o.status === "receipt_sent") banner = `<div class="o-banner wait"><b>Receipt received</b><span>${o.receipt_via === "whatsapp" ? "You said you sent it on WhatsApp. " : ""}We are checking your payment. This page updates by itself once we confirm.</span></div>`;
      else if (o.status === "awaiting_payment") banner = `<div class="o-banner wait"><b>Waiting for your payment</b><span>Pay ${esc(naira(o.total))} to one of the accounts below, then send us your receipt.</span></div>`;
      else banner = `<div class="o-banner wait"><b>Order sent on WhatsApp</b><span>We will confirm it with you there. This page shows when it is confirmed.</span></div>`;
      const lines = (o.items || []).map((i) => `<div class="o-line"><span>${esc(i.qty)} × ${esc(i.name)}${i.size || i.colour ? ` <small>(${esc([i.size ? "Size " + i.size : "", i.colour].filter(Boolean).join(", "))})</small>` : ""}</span><b>${naira((Number(i.price) + Number(i.ship)) * i.qty)}</b></div>`).join("");
      const acctHtml = transfer && open ? `<div class="box o-pay">
          <span class="eyebrow">Pay to</span>
          ${accts.length ? accts.map((a, n) => `<div class="o-acct"><div><small>${esc(a.bank || "Bank")}</small><b>${esc(a.number)}</b><span>${esc(a.name || "")}</span></div><button type="button" class="btn btn-ghost btn-sm" data-copy="${n}">Copy</button></div>`).join("") : `<p class="muted">Account details will be shared on WhatsApp.</p>`}
          <div class="o-amt"><span>Amount to pay</span><b>${naira(o.total)}</b></div>
          <p class="cnote" style="text-align:left">Use <b>${esc(o.code)}</b> as the payment reference/narration if your bank lets you.</p>
          ${settings.pay_note ? `<p class="cnote" style="text-align:left">${esc(settings.pay_note)}</p>` : ""}
        </div>
        <div class="box o-rcpt">
          <span class="eyebrow">${o.status === "receipt_sent" ? "Send a different receipt" : "Paid? Send your receipt"}</span>
          <p class="err-line error" id="rErr" role="alert" hidden></p>
          <input id="rFile" type="file" accept="image/*" hidden>
          <button type="button" class="btn btn-gold wide" id="rUp">Upload receipt here</button>
          ${waBase ? `<a class="btn btn-wa wide" id="rWa" href="${waBase}${encodeURIComponent(`Hello ${bizName()}, I have paid ${naira(o.total)} for order ${o.code}. I am sending my receipt now.`)}" target="_blank" rel="noopener">${ICON.wa} I'll send the receipt on WhatsApp</a>` : ""}
          <span class="cnote">We will confirm your order once the money reaches our account.</span>
        </div>` : "";
      const waOnly = !transfer && o.status === "requested" && waBase
        ? `<a class="btn btn-wa wide" href="${waBase}${encodeURIComponent(orderMsgFromRow(o))}" target="_blank" rel="noopener">${ICON.wa} Open WhatsApp to send this order</a><span class="cnote">If you already sent it, you don't need to do anything.</span>` : "";
      app.innerHTML = `<div class="view cartpage">
        <div class="chead"><button type="button" class="iconbtn" id="oBack" aria-label="Back">${ICON.back}</button><h1>${esc(o.code)}</h1>${statusChip(o.status)}</div>
        ${banner}${orderSteps(o)}
        <div class="box"><div class="o-lines">${lines}</div>
          <div class="o-line"><span>Shipping included</span><b>${naira(o.ship_total)}</b></div>
          <div class="o-line o-tot"><span>Total</span><b>${naira(o.total)}</b></div>
          <p class="cnote" style="text-align:left;margin-top:8px">Placed ${esc(fmtWhen(o.created_at))}</p></div>
        ${acctHtml}${waOnly}
        <a class="btn btn-ghost" href="#/orders">All my orders</a>
        <a class="linkbtn" style="text-align:center;display:block" href="#/">Back to shop</a></div>`;
      $id("oBack").onclick = () => { location.hash = "#/"; };
      app.querySelectorAll("[data-copy]").forEach((b) => { b.onclick = () => copyText(String(accts[+b.dataset.copy].number)); });
      if ($id("rUp")) {
        $id("rUp").onclick = () => $id("rFile").click();
        $id("rFile").onchange = async (e) => {
          const f = e.target.files && e.target.files[0]; if (!f) return;
          const btn = $id("rUp"), err = $id("rErr");
          err.hidden = true; btn.disabled = true; btn.textContent = "Uploading…"; busy = true;
          try {
            const blob = await compress(f, 1600, 0.85);
            if (!blob) throw new Error("read");
            const path = `${token}/${crypto.randomUUID()}.jpg`;
            const up = await sb.storage.from("receipts").upload(path, blob, { contentType: "image/jpeg" });
            if (up.error) throw up.error;
            const { error } = await sb.rpc("attach_receipt", { p_token: token, p_path: path, p_via: "app" });
            if (error) throw error;
            busy = false; toast("Receipt sent. Thank you!");
            const n = await load(); if (n) o = n; else o = { ...o, status: "receipt_sent", receipt_via: "app" };
            draw();
          } catch (ex) {
            busy = false;
            err.textContent = ex && ex.message && ex.message !== "read" && !/image|bitmap|decode/i.test(ex.message) ? ex.message : "We couldn't read that photo. Try a screenshot of the receipt instead.";
            err.hidden = false; btn.disabled = false; btn.textContent = "Upload receipt here";
          }
        };
      }
      if ($id("rWa")) $id("rWa").addEventListener("click", async () => {
        const { error } = await sb.rpc("attach_receipt", { p_token: token, p_path: null, p_via: "whatsapp" });
        if (!error) { const n = await load(); if (n) { o = n; setTimeout(() => { if (route() === "/order/" + token && !busy) draw(); }, 400); } }
      });
    };
    draw();
    stopPoll();
    pollT = setInterval(async () => {
      if (route() !== "/order/" + token) return stopPoll();
      if (busy || document.hidden) return;
      const n = await load();
      if (n && (n.status !== o.status || n.receipt_via !== o.receipt_via)) { o = n; draw(); if (n.status === "confirmed") toast("Your order is confirmed ✓"); }
    }, 20000);
  }

  async function renderMyOrders() {
    if (!loaded) return skeleton();
    const head = `<div class="chead"><button type="button" class="iconbtn" id="oBack" aria-label="Back">${ICON.back}</button><h1>My orders</h1></div>`;
    app.innerHTML = `<div class="view cartpage">${head}<p class="muted" style="padding:12px 4px">Loading…</p></div>`;
    $id("oBack").onclick = () => { location.hash = "#/"; };
    let rows = [], failed = false;
    if (myOrders.length) { try { rows = await fetchOrders(myOrders.map((o) => o.token)); } catch (_) { failed = true; } }
    if (route() !== "/orders") return;
    app.innerHTML = `<div class="view cartpage">${head}
      ${rows.length ? `<div style="display:flex;flex-direction:column;gap:12px">${rows.map((o) => `<a class="box o-row" href="#/order/${esc(o.token)}"><div><b>${esc(o.code)}</b><small>${esc(fmtWhen(o.created_at))} · ${o.method === "transfer" ? "Bank transfer" : "WhatsApp"}</small></div><div class="o-r2"><b>${naira(o.total)}</b>${statusChip(o.status)}</div></a>`).join("")}</div>
        <p class="cnote">Orders are saved on this phone. On a new phone, use the form below to get yours back.</p>`
        : `<div class="empty"><p>${failed ? "Couldn't load your orders. Check your connection." : "You haven't placed any orders on this phone yet."}</p><a class="btn btn-gold" href="#/">Browse products</a></div>`}
    </div>`;
    $id("oBack").onclick = () => { location.hash = "#/"; };
    const host = app.querySelector(".cartpage");
    host.insertAdjacentHTML("beforeend", `<form class="box o-find" id="findForm">
      <span class="eyebrow">Ordered on another phone?</span>
      <p class="cnote" style="text-align:left;margin:0">Enter your order number and the phone number you ordered with to bring your order back here.</p>
      <div class="field"><label for="f-code">Order number</label><input id="f-code" type="text" maxlength="20" placeholder="e.g. EIH-1001" autocapitalize="characters" autocomplete="off"></div>
      <div class="field"><label for="f-phone">Phone number</label><input id="f-phone" type="text" inputmode="tel" maxlength="30" autocomplete="tel"></div>
      <p class="error" id="fErr" role="alert" hidden></p>
      <button type="submit" class="btn btn-gold" id="fBtn">Find my order</button></form>`);
    $id("findForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $id("fBtn"), err = $id("fErr");
      err.hidden = true;
      const code = $id("f-code").value.trim(), phone = $id("f-phone").value.trim();
      if (!code || phone.replace(/\D/g, "").length < 10) { err.textContent = "Please enter your order number and phone number."; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = "Searching…";
      const { data, error } = await sb.rpc("find_order", { p_code: code, p_phone: phone });
      btn.disabled = false; btn.textContent = "Find my order";
      if (error || !data || !data.token) {
        err.textContent = (error && /No order found/i.test(error.message))
          ? "We couldn't find an order with those details. Check the order number and use the same phone number you ordered with. If you ordered on WhatsApp without giving a number, message us there."
          : ((error && error.message) || "Something went wrong. Please try again.");
        err.hidden = false; return;
      }
      if (!myOrders.some((o) => o.token === data.token)) { myOrders.unshift({ code: data.code, token: data.token, at: Date.now() }); saveOrders(); }
      location.hash = "#/order/" + data.token;
    };
  }

  /* ---------------- Shipping rules ---------------- */

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

  // All the rules, shown on the shop page under the batch card (customers can fold it away)
  function rulesCard() {
    const rules = (settings.rules || "").trim();
    if (!rules) return "";
    return `<details class="rulescard" open><summary>Shipping rules &amp; how to order</summary><div class="rules">${renderRules(rules)}</div></details>`;
  }

  function renderInfo() {
    if (!loaded) return skeleton();
    const num = waNum();
    const chat = `https://wa.me/${num}?text=${encodeURIComponent("Hello " + bizName() + ", I have a question about shipping.")}`;
    const rules = (settings.rules || "").trim();
    app.innerHTML = `<div class="view cartpage">
      <section class="hero"><span class="eyebrow">Before you order</span><h1>Shipping rules &amp; how to order</h1></section>
      <div class="box rules">${rules ? renderRules(rules) : `<p class="muted">Shipping rules will be posted here soon. For now, message us on WhatsApp with any questions.</p>`}</div>
      <div class="actions"><a class="btn btn-gold" href="#/">Back to shop</a>${num ? `<a class="btn btn-wa" href="${esc(chat)}" target="_blank" rel="noopener">Ask a question on WhatsApp</a>` : ""}</div>
    </div>`;
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
        <div class="actions"><button class="btn btn-gold" id="loginBtn" type="submit">Log in</button>
        <a class="btn btn-ghost" href="#/">Back to shop</a></div>
      </form>`;
    $id("loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $id("loginBtn");
      btn.disabled = true; btn.textContent = "Logging in…";
      const { data, error } = await sb.auth.signInWithPassword({ email: cfg.OWNER_EMAIL, password: $id("pw").value });
      if (error) { renderLogin("Wrong password, or the account isn't set up yet."); return; }
      session = data.session;
      renderDashboard();
    };
  }

  function renderDashboard() {
    app.innerHTML = `
      <div class="owner-bar"><h1>Owner dashboard</h1><button class="btn btn-ghost btn-sm" id="logout">Log out</button></div>
      <div class="actions"><button class="btn btn-gold" id="ordersBtn">Orders<span class="o-badge" id="ordBadge" hidden>0</span></button><button class="btn btn-ghost" id="addBtn">+ Add product</button><button class="btn btn-ghost" id="batchBtn">Batches</button><button class="btn btn-ghost" id="setBtn">Settings</button><a class="btn btn-ghost" href="#/">View shop</a></div>
      <div id="formHost"></div>
      <div class="olist" id="olist"></div>`;
    $id("logout").onclick = async () => { await sb.auth.signOut(); session = null; renderLogin(); };
    $id("ordersBtn").onclick = () => openOrders();
    $id("addBtn").onclick = () => openForm(null);
    refreshOrdBadge();
    $id("batchBtn").onclick = () => openBatchManager();
    $id("setBtn").onclick = () => openSettings();
    drawOwnerList();
  }

  const batchText = (p) => {
    if (!batches.length) return "";
    const names = (p.batch_ids || []).map((id) => batches.find((b) => b.id === id)).filter(Boolean).map((b) => b.name);
    return names.length ? names.join(", ") : "All batches";
  };

  function drawOwnerList() {
    const host = $id("olist");
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
    const host = $id("formHost");
    const $ = $id;
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
        <form class="panel" id="bf" style="margin:0 0 14px;background:var(--bg)">
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
            <span class="hint">After this day the batch hides itself from the shop. The countdown counts down to this day.</span></div>
          <div class="field"><label for="bf-arr">Expected arrival (optional)</label>
            <input id="bf-arr" type="text" maxlength="60" placeholder="e.g. Mid-December" value="${esc(b ? b.arrival_note || "" : "")}"></div>
          <div class="field"><label for="bf-note">Note for customers (optional)</label>
            <textarea id="bf-note" maxlength="200">${esc(b ? b.note || "" : "")}</textarea></div>
          <p class="error" id="bferr" role="alert" hidden></p>
          <div class="actions"><button class="btn btn-gold" type="submit" id="bfSave">Save batch</button>
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
    const host = $id("formHost");
    const $ = $id;
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
          <div class="actions"><button class="btn btn-gold" type="submit" id="sBtn">Save details</button></div>
        </form>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2 style="margin:0 0 6px;font-size:18px">Payment accounts</h2>
        <p style="margin:0 0 14px;color:var(--muted);font-size:14px">Customers who choose bank transfer see these accounts. Leave empty to hide the transfer option.</p>
        <form id="aform">
          <div id="aRows"></div>
          <div class="actions" style="margin-bottom:14px"><button type="button" class="btn btn-ghost btn-sm" id="aAdd">+ Add account</button></div>
          <div class="field"><label for="a-note">Note shown with the accounts (optional)</label>
            <textarea id="a-note" maxlength="300" placeholder="e.g. Please send your receipt within 24 hours.">${esc(settings.pay_note || "")}</textarea></div>
          <p class="error" id="aerr" role="alert" hidden></p>
          <div class="actions"><button class="btn btn-gold" type="submit" id="aBtn">Save accounts</button></div>
        </form>
      </div>

      <div class="panel" style="margin-top:16px">
        <h2 style="margin:0 0 14px;font-size:18px">Shipping rules page</h2>
        <form id="rform">
          <div class="field"><label for="r-text">Rules and instructions customers will read</label>
            <textarea id="r-text" maxlength="6000" style="min-height:220px" placeholder="# How preorders work&#10;- Write each rule on its own line, starting with a dash&#10;&#10;# Shipping&#10;- Write your shipping rules here">${esc(settings.rules || "")}</textarea>
            <span class="hint">Start a line with "# " for a heading and "- " for a bullet point. Leave a blank line between sections. Customers see these rules in a card on the shop once this is filled in.</span></div>
          <p class="error" id="rerr" role="alert" hidden></p>
          <div class="actions"><button class="btn btn-gold" type="submit" id="rBtn">Save rules</button>
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
          <div class="actions"><button class="btn btn-gold" type="submit" id="pBtn">Change password</button></div>
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

    let accts = accountsList().map((a) => ({ bank: a.bank || "", number: a.number || "", name: a.name || "" }));
    const drawAcctRows = () => {
      $("aRows").innerHTML = accts.map((a, i) => `<div class="o-arow" data-i="${i}">
        <input type="text" class="a-bank" maxlength="40" placeholder="Bank (e.g. GTBank)" value="${esc(a.bank)}" aria-label="Bank name">
        <input type="text" class="a-num" inputmode="numeric" maxlength="20" placeholder="Account number" value="${esc(a.number)}" aria-label="Account number">
        <input type="text" class="a-name" maxlength="60" placeholder="Account name" value="${esc(a.name)}" aria-label="Account name">
        <button type="button" class="linkbtn" data-del="${i}">Remove</button></div>`).join("") || `<p class="muted" style="margin:0 0 12px">No accounts yet.</p>`;
      $("aRows").querySelectorAll("[data-del]").forEach((b) => { b.onclick = () => { readAcctRows(); accts.splice(+b.dataset.del, 1); drawAcctRows(); }; });
    };
    const readAcctRows = () => {
      accts = [...$("aRows").querySelectorAll(".o-arow")].map((r) => ({ bank: r.querySelector(".a-bank").value, number: r.querySelector(".a-num").value, name: r.querySelector(".a-name").value }));
    };
    drawAcctRows();
    $("aAdd").onclick = () => { readAcctRows(); if (accts.length >= 5) return toast("Up to 5 accounts"); accts.push({ bank: "", number: "", name: "" }); drawAcctRows(); };
    $("aform").onsubmit = async (e) => {
      e.preventDefault();
      readAcctRows();
      const btn = $("aBtn"), err = $("aerr");
      err.hidden = true;
      const clean = accts.map((a) => ({ bank: a.bank.trim(), number: a.number.replace(/\s/g, ""), name: a.name.trim() })).filter((a) => a.number || a.bank || a.name);
      if (clean.some((a) => !/^\d{6,20}$/.test(a.number))) { err.textContent = "Each account needs an account number (digits only)."; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = "Saving…";
      const { data, error } = await sb.from("settings").upsert({ id: 1, accounts: clean, pay_note: $("a-note").value.trim(), updated_at: new Date().toISOString() }).select().single();
      btn.disabled = false; btn.textContent = "Save accounts";
      if (error) {
        err.textContent = /accounts|pay_note|schema cache|column|does not exist/i.test(error.message)
          ? "Payments aren't set up yet. Run orders.sql in Supabase (see README), then try again."
          : error.message;
        err.hidden = false;
        return;
      }
      settings = data; ordersOk = true;
      toast("Saved");
    };

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
          ? "The settings table isn't set up yet. Run rules.sql in Supabase (see README), then try again."
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

  /* ---------- Owner: orders ---------- */

  let ordDay = null, ordFilter = "all", ordTimer = null;
  const lagosDay = (iso) => new Date(new Date(iso).getTime() + 3600000).toISOString().slice(0, 10);
  const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const dayStart = (d) => new Date(d + "T00:00:00+01:00").toISOString();
  const waPhone = (p) => { let d = String(p || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "0") d = "234" + d.slice(1); return d; };
  const dayLabel = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" }); };
  const METHOD_TXT = { whatsapp: "WhatsApp request", transfer: "Bank transfer" };
  let ordRows = [];

  async function refreshOrdBadge() {
    const el = $id("ordBadge"); if (!el || !sb) return;
    const { count, error } = await sb.from("orders").select("id", { count: "exact", head: true }).in("status", ["requested", "receipt_sent"]);
    if (error || !count) { el.hidden = true; return; }
    el.textContent = count > 99 ? "99+" : count; el.hidden = false;
    el.title = "Orders waiting for you to confirm";
  }

  async function openOrders() {
    const host = $id("formHost");
    if (!ordDay) ordDay = lagosDay(new Date().toISOString());
    host.innerHTML = `<div class="panel" style="margin-top:16px">
      <div class="owner-bar" style="margin-top:0"><h2 style="margin:0;font-size:20px">Orders</h2><div class="actions"><button type="button" class="btn btn-ghost btn-sm" id="oRef">Refresh</button><button type="button" class="btn btn-ghost btn-sm" id="oClose">Close</button></div></div>
      <div id="oBody"><p class="muted">Loading…</p></div></div>`;
    host.scrollIntoView({ behavior: "smooth", block: "start" });
    $id("oClose").onclick = () => { host.innerHTML = ""; clearInterval(ordTimer); };
    $id("oRef").onclick = () => loadOrdersView();
    clearInterval(ordTimer);
    ordTimer = setInterval(() => { if (!$id("oBody")) return clearInterval(ordTimer); if (!document.hidden) loadOrdersView(true); }, 30000);
    await loadOrdersView();
  }

  async function loadOrdersView(quiet) {
    const body = $id("oBody"); if (!body) return;
    const from = dayStart(addDays(ordDay, -6)), to = dayStart(addDays(ordDay, 1));
    const { data, error } = await sb.from("orders").select("*").gte("created_at", from).lt("created_at", to).order("created_at", { ascending: false });
    if (!$id("oBody")) return;
    if (error) {
      body.innerHTML = `<p class="error">${/orders|schema cache|does not exist/i.test(error.message) ? "Orders aren't set up yet. Run orders.sql in Supabase (see README), then try again." : esc(error.message)}</p>`;
      return;
    }
    ordRows = data || [];
    drawOrdersView();
    refreshOrdBadge();
  }

  function drawOrdersView() {
    const body = $id("oBody"); if (!body) return;
    const today = lagosDay(new Date().toISOString());
    const dayRows = ordRows.filter((o) => lagosDay(o.created_at) === ordDay);
    const live = dayRows.filter((o) => o.status !== "cancelled");
    const sum = (l) => l.reduce((t, o) => t + Number(o.total || 0), 0);
    const tr = dayRows.filter((o) => o.method === "transfer");
    const card = (label, n, sub, key) => `<button type="button" class="o-stat${ordFilter === key ? " on" : ""}" data-f="${key}"><small>${label}</small><b>${n}</b>${sub ? `<span>${sub}</span>` : ""}</button>`;
    const cnt = (f) => dayRows.filter(f).length;
    const FILTERS = {
      all: () => true,
      action: (o) => o.status === "receipt_sent" || o.status === "requested",
      app: (o) => o.method === "transfer" && o.receipt_via === "app" && o.status !== "cancelled",
      wareceipt: (o) => o.method === "transfer" && o.receipt_via === "whatsapp" && o.status !== "cancelled",
      awaiting: (o) => o.status === "awaiting_payment",
      wa: (o) => o.method === "whatsapp",
      confirmed: (o) => o.status === "confirmed",
      cancelled: (o) => o.status === "cancelled",
    };
    const shown = dayRows.filter(FILTERS[ordFilter] || FILTERS.all);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(ordDay, -i), r = ordRows.filter((o) => lagosDay(o.created_at) === d);
      week.push({ d, n: r.length, tr: r.filter((o) => o.method === "transfer").length, wa: r.filter((o) => o.method === "whatsapp").length,
        c: r.filter((o) => o.status === "confirmed").length, cv: sum(r.filter((o) => o.status === "confirmed")) });
    }
    const orderCard = (o) => {
      const items = (o.items || []).map((i) => `${i.qty} × ${esc(i.name)}${i.size || i.colour ? ` (${esc([i.size, i.colour].filter(Boolean).join(", "))})` : ""}${i.batch ? ` · ${esc(i.batch)}` : ""}`).join("<br>");
      const ph = waPhone(o.customer_phone);
      const acts = [];
      if (o.status !== "confirmed" && o.status !== "cancelled") acts.push(`<button type="button" class="btn btn-gold btn-sm" data-oact="confirm" data-id="${esc(o.id)}">Confirm${o.method === "transfer" ? " payment" : " order"}</button>`);
      if (o.receipt_path) acts.push(`<button type="button" class="btn btn-ghost btn-sm" data-oact="receipt" data-id="${esc(o.id)}">View receipt</button>`);
      if (ph) acts.push(`<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/${ph}?text=${encodeURIComponent(`Hello ${o.customer_name || ""}, this is ${bizName()} about your order ${o.code}.`)}">WhatsApp customer</a>`);
      if (o.status === "confirmed" || o.status === "cancelled") acts.push(`<button type="button" class="btn btn-ghost btn-sm" data-oact="reopen" data-id="${esc(o.id)}">Reopen</button>`);
      if (o.status !== "cancelled" && o.status !== "confirmed") acts.push(`<button type="button" class="btn btn-danger btn-sm" data-oact="cancel" data-id="${esc(o.id)}">Cancel</button>`);
      return `<div class="o-card" data-card="${esc(o.id)}">
        <div class="o-top"><div><b>${esc(o.code)}</b><small>${esc(fmtWhen(o.created_at))} · ${esc(METHOD_TXT[o.method] || o.method)}</small></div><div class="o-r2"><b>${naira(o.total)}</b>${statusChip(o.status)}</div></div>
        <div class="o-who">${esc(o.customer_name || "No name")}${o.customer_phone ? ` · ${esc(o.customer_phone)}` : ""}</div>
        <div class="o-items">${items}</div>
        ${o.receipt_via ? `<div class="o-rv">Receipt: ${o.receipt_via === "app" ? "uploaded in the app" : "customer says sent on WhatsApp"}${o.receipt_at ? " · " + esc(fmtWhen(o.receipt_at)) : ""}</div>` : ""}
        <div class="o-img" data-img="${esc(o.id)}"></div>
        <div class="actions" style="margin-top:10px">${acts.join("")}</div></div>`;
    };
    body.innerHTML = `
      <div class="o-daynav">
        <button type="button" class="btn btn-ghost btn-sm" id="dPrev" aria-label="Previous day">←</button>
        <div class="field" style="margin:0;flex:1"><input id="dPick" type="date" max="${today}" value="${ordDay}" aria-label="Pick a day"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="dNext" aria-label="Next day" ${ordDay >= today ? "disabled" : ""}>→</button>
        <button type="button" class="btn btn-ghost btn-sm" id="dToday" ${ordDay === today ? "disabled" : ""}>Today</button>
      </div>
      <p class="o-daylabel"><b>${ordDay === today ? "Today" : esc(dayLabel(ordDay))}</b> · ${live.length} order${live.length === 1 ? "" : "s"} · ${naira(sum(live))}</p>
      <div class="o-stats">
        ${card("All orders", dayRows.length, naira(sum(live)), "all")}
        ${card("Needs your action", cnt(FILTERS.action), "to confirm", "action")}
        ${card("Paid on app", cnt(FILTERS.app), "receipt uploaded", "app")}
        ${card("Receipt via WhatsApp", cnt(FILTERS.wareceipt), "paid, sent receipt", "wareceipt")}
        ${card("Awaiting payment", cnt(FILTERS.awaiting), naira(sum(tr.filter(FILTERS.awaiting))), "awaiting")}
        ${card("WhatsApp requests", cnt(FILTERS.wa), naira(sum(dayRows.filter(FILTERS.wa).filter((o) => o.status !== "cancelled"))), "wa")}
        ${card("Confirmed", cnt(FILTERS.confirmed), naira(sum(dayRows.filter(FILTERS.confirmed))), "confirmed")}
        ${card("Cancelled", cnt(FILTERS.cancelled), "", "cancelled")}
      </div>
      <div class="o-list">${shown.length ? shown.map(orderCard).join("") : `<p class="muted" style="text-align:center;padding:18px 0">${dayRows.length ? "No orders in this view." : "No orders on this day."}</p>`}</div>
      <h3 class="o-h3">Last 7 days</h3>
      <div class="o-week"><table><thead><tr><th>Day</th><th>Orders</th><th>Transfer</th><th>WhatsApp</th><th>Confirmed</th><th>Confirmed ₦</th></tr></thead><tbody>
        ${week.map((w) => `<tr data-day="${w.d}" class="${w.d === ordDay ? "on" : ""}"><td>${w.d === today ? "Today" : esc(dayLabel(w.d))}</td><td>${w.n}</td><td>${w.tr}</td><td>${w.wa}</td><td>${w.c}</td><td>${naira(w.cv)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="cnote" style="text-align:left">Days follow Nigerian time. Only confirm an order after you have seen the money in your account.</p>`;

    const go = (d) => { ordDay = d; ordFilter = "all"; loadOrdersView(); };
    $id("dPrev").onclick = () => go(addDays(ordDay, -1));
    $id("dNext").onclick = () => go(addDays(ordDay, 1));
    $id("dToday").onclick = () => go(today);
    $id("dPick").onchange = (e) => { if (e.target.value && e.target.value <= today) go(e.target.value); };
    body.querySelectorAll("[data-f]").forEach((b) => { b.onclick = () => { ordFilter = b.dataset.f; drawOrdersView(); }; });
    body.querySelectorAll("[data-day]").forEach((r) => { r.onclick = () => go(r.dataset.day); });
    body.querySelector(".o-list").onclick = async (e) => {
      const b = e.target.closest("[data-oact]"); if (!b) return;
      const o = ordRows.find((x) => x.id === b.dataset.id); if (!o) return;
      const act = b.dataset.oact;
      if (act === "receipt") {
        const holder = body.querySelector(`[data-img="${CSS.escape(o.id)}"]`);
        if (holder.innerHTML) { holder.innerHTML = ""; return; }
        b.disabled = true;
        const { data, error } = await sb.storage.from("receipts").createSignedUrl(o.receipt_path, 600);
        b.disabled = false;
        if (error || !data) return toast("Couldn't open the receipt");
        holder.innerHTML = `<a href="${esc(data.signedUrl)}" target="_blank" rel="noopener"><img class="o-rcptimg" src="${esc(data.signedUrl)}" alt="Payment receipt for ${esc(o.code)}"></a><span class="cnote">Tap the picture to open it full size.</span>`;
        return;
      }
      let patch;
      if (act === "confirm") {
        if (!confirm(`Confirm ${o.code} for ${naira(o.total)}? The customer will see it as confirmed.`)) return;
        patch = { status: "confirmed", confirmed_at: new Date().toISOString() };
      } else if (act === "cancel") {
        if (!confirm(`Cancel ${o.code}?`)) return;
        patch = { status: "cancelled", confirmed_at: null };
      } else if (act === "reopen") {
        patch = { status: o.receipt_via ? "receipt_sent" : o.method === "transfer" ? "awaiting_payment" : "requested", confirmed_at: null };
      } else return;
      b.disabled = true;
      const { error } = await sb.from("orders").update(patch).eq("id", o.id);
      if (error) { b.disabled = false; return toast(error.message); }
      toast(act === "confirm" ? "Confirmed. The customer can see it now." : "Updated");
      loadOrdersView();
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

  // "38, 39, 40" -> ["38","39","40"]
  const parseList = (v) => String(v || "").split(/[,\n]/).map((s) => s.trim().slice(0, 24)).filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).slice(0, 20);

  function openForm(p) {
    const host = $id("formHost");
    // images: existing {url} or new {file, preview}
    let images = (p && p.image_urls ? p.image_urls : []).map((url) => ({ url }));
    const removed = [];
    const cats = Array.from(new Set(["Clothes", "Shoes", "Bags", "Electronics", "Accessories", "Home & Kitchen", ...products.map((x) => x.category).filter(Boolean)]));
    const batchBoxes = batches.length ? `
        <div class="field"><label>Batches</label>
          ${batches.map((b) => `<label class="check"><input type="checkbox" name="fb" value="${esc(b.id)}" ${p && (p.batch_ids || []).includes(b.id) ? "checked" : ""}> ${esc(b.name)} <span class="pill ${isOpen(b) ? (b.status === "ongoing" ? "ok" : "soon") : "out"}">${esc(isOpen(b) ? statusLabel(b) : "Closed")}</span></label>`).join("")}
          <span class="hint">Tick the batch(es) this product is in. Leave all unticked to show it in every batch.</span></div>` : "";
    const optionFields = optionsReady ? `
        <div class="two">
          <div class="field"><label for="f-sizes">Sizes (optional)</label>
            <input id="f-sizes" type="text" maxlength="200" placeholder="e.g. 38-44 or S-XL or 38, 40, 42" value="${esc(list(p && p.sizes).join(", "))}">
            <span class="hint">Type a range (38-44, S-XL) or list sizes with commas. Customers must pick one.</span>
            <span class="hint" id="sizePrev" aria-live="polite"></span></div>
          <div class="field"><label for="f-colours">Colours (optional)</label>
            <input id="f-colours" type="text" maxlength="200" placeholder="e.g. Black, White, Tan" value="${esc(list(p && p.colours).join(", "))}">
            <span class="hint">Separate with commas. Common colours show as round swatches.</span></div>
        </div>` : `<p class="hint" style="margin:0 0 14px">To add sizes and colours to products, run options.sql in Supabase (see README), then reload.</p>`;

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
        ${optionFields}
        <div class="field"><label for="f-desc">Description (optional)</label>
          <textarea id="f-desc" maxlength="1000" placeholder="Material, fit, what is in the box…">${esc(p ? p.description || "" : "")}</textarea></div>
        <label class="check"><input type="checkbox" id="f-stock" ${!p || p.in_stock ? "checked" : ""}> Available for preorder</label>
        <p class="error" id="ferr" role="alert" hidden></p>
        <div class="actions" style="margin-top:12px"><button class="btn btn-gold" type="submit" id="saveBtn">Save product</button>
          <button class="btn btn-ghost" type="button" id="cancelBtn">Cancel</button></div>
      </form>`;
    host.scrollIntoView({ behavior: "smooth", block: "start" });

    const $ = $id;
    const drawImgs = () => {
      $("imgs").innerHTML = images.map((im, i) => `<div class="im"><img src="${esc(im.url || im.preview)}" alt="Photo ${i + 1}"><button type="button" data-i="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join("");
    };
    const drawTotal = () => {
      const t = Number($("f-price").value || 0) + Number($("f-ship").value || 0);
      $("ptotal").innerHTML = `Customers will see a total of <b>${naira(t)}</b>`;
    };
    drawImgs(); drawTotal();
    $("f-price").oninput = drawTotal; $("f-ship").oninput = drawTotal;
    if ($("f-sizes")) {
      const drawSizes = () => {
        const s = expandSizes($("f-sizes").value);
        $("sizePrev").textContent = s.length ? `Customers will choose from: ${s.join(" · ")}` : "";
      };
      $("f-sizes").oninput = drawSizes; drawSizes();
    }
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
        if (optionsReady) {
          row.sizes = expandSizes($("f-sizes").value);
          row.colours = parseList($("f-colours").value);
        }
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
