(() => {
  "use strict";
  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById("app");
  const MAX_IMAGES = 4;
  const BUCKET = "product-images";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const naira = (n) => "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
  const total = (p) => Number(p.price || 0) + Number(p.shipping_fee || 0);

  let sb = null;
  let session = null;
  let products = [];
  let loadError = "";
  let loaded = false;
  let filterCat = "All";
  let query = "";

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
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const { data } = await sb.auth.getSession();
    session = data.session;
    sb.auth.onAuthStateChange((_e, s) => { session = s; });
    window.addEventListener("hashchange", render);
    render();
    await loadProducts();
    render();
  }

  async function loadProducts() {
    loadError = "";
    const { data, error } = await sb.from("products").select("*").order("created_at", { ascending: false });
    if (error) loadError = error.message;
    else products = data || [];
    loaded = true;
  }

  const route = () => (location.hash || "#/").slice(1);

  function render() {
    if (!sb) return;
    window.scrollTo(0, 0);
    if (route().startsWith("/owner")) renderOwner();
    else renderShop();
  }

  /* ---------------- Customer view ---------------- */

  function renderShop() {
    if (!loaded) { app.innerHTML = `<div class="loading">Loading products…</div>`; return; }
    if (loadError) {
      app.innerHTML = `<div class="empty">Couldn't load products.<br><small>${esc(loadError)}</small><br><br><button class="btn btn-sm" id="retry">Try again</button></div>`;
      document.getElementById("retry").onclick = async () => { loaded = false; render(); await loadProducts(); render(); };
      return;
    }
    const cats = ["All", ...Array.from(new Set(products.map((p) => p.category).filter(Boolean)))];
    if (!cats.includes(filterCat)) filterCat = "All";
    app.innerHTML = `
      <section class="hero"><h1>Preorder from China</h1>
      <p>Every price below already includes shipping. Tap a product to preorder on WhatsApp.</p></section>
      <div class="tools">
        <input class="search" type="search" id="q" placeholder="Search products" aria-label="Search products" value="${esc(query)}">
        <div class="chips" id="chips">${cats.map((c) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${c === filterCat}">${esc(c)}</button>`).join("")}</div>
      </div>
      <div class="grid" id="grid"></div>
      ${contactSection()}`;
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
    const num = String(cfg.WHATSAPP_NUMBER || "").replace(/\D/g, "");
    const chat = `https://wa.me/${num}?text=${encodeURIComponent("Hello " + (cfg.BUSINESS_NAME || "Ebony Import Hub") + ", I have a question.")}`;
    const items = [];
    if (num) items.push(`<a class="btn btn-wa" href="${esc(chat)}" target="_blank" rel="noopener">Chat on WhatsApp${cfg.PHONE_DISPLAY ? ` · ${esc(cfg.PHONE_DISPLAY)}` : ""}</a>`);
    if (cfg.WHATSAPP_GROUP) items.push(`<a class="btn btn-gold" href="${esc(cfg.WHATSAPP_GROUP)}" target="_blank" rel="noopener">Join our WhatsApp group</a>`);
    if (cfg.TIKTOK_HANDLE) items.push(`<a class="btn btn-ghost" href="https://www.tiktok.com/@${esc(cfg.TIKTOK_HANDLE)}" target="_blank" rel="noopener">TikTok @${esc(cfg.TIKTOK_HANDLE)}</a>`);
    if (cfg.EMAIL) items.push(`<a class="btn btn-ghost" href="mailto:${esc(cfg.EMAIL)}">${esc(cfg.EMAIL)}</a>`);
    if (!items.length) return "";
    return `<section class="contact panel"><h2>Contact us</h2><p>Questions, or want something that isn't listed? Reach out.</p><div class="contact-links">${items.join("")}</div></section>`;
  }

  function drawGrid() {
    const grid = document.getElementById("grid");
    if (!grid) return;
    const q = query.trim().toLowerCase();
    const list = products.filter((p) =>
      (filterCat === "All" || p.category === filterCat) &&
      (!q || (p.name + " " + (p.description || "") + " " + (p.category || "")).toLowerCase().includes(q)));
    if (!list.length) {
      grid.outerHTML = `<div class="empty" id="grid">${products.length ? "No products match your search." : "No products yet. Please check back soon."}</div>`;
      return;
    }
    if (grid.classList.contains("empty")) grid.className = "grid";
    grid.className = "grid";
    grid.innerHTML = list.map((p) => `
      <button class="card" data-id="${esc(p.id)}" aria-label="${esc(p.name)}, ${naira(total(p))}">
        <div class="thumb">${p.image_urls && p.image_urls[0] ? `<img src="${esc(p.image_urls[0])}" alt="" loading="lazy">` : `<div class="noimg">No photo</div>`}
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
    const msg = `Hello ${cfg.BUSINESS_NAME || "Ebony Import Hub"}, I'd like to preorder:\n${p.name}\nItem: ${naira(p.price)}\nShipping: ${naira(p.shipping_fee)}\nTotal: ${naira(total(p))}`;
    const wa = `https://wa.me/${encodeURIComponent(String(cfg.WHATSAPP_NUMBER || "").replace(/\D/g, ""))}?text=${encodeURIComponent(msg)}`;
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
        <button class="close" aria-label="Close">×</button>
        <div class="gallery">${imgs.length ? imgs.map((u) => `<img src="${esc(u)}" alt="${esc(p.name)}">`).join("") : `<div class="noimg">No photo</div>`}</div>
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
          ${p.in_stock
            ? `<a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">Preorder on WhatsApp</a>`
            : `<button class="btn" disabled>Sold out</button>`}
        </div>
      </div>`;
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.querySelector(".close").onclick = close;
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    document.body.appendChild(ov);
    ov.querySelector(".close").focus();
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
      <div class="actions"><button class="btn btn-gold" id="addBtn">+ Add product</button><a class="btn btn-ghost" href="#/">View shop</a></div>
      <div id="formHost"></div>
      <div class="olist" id="olist"></div>`;
    document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); session = null; renderLogin(); };
    document.getElementById("addBtn").onclick = () => openForm(null);
    drawOwnerList();
  }

  function drawOwnerList() {
    const host = document.getElementById("olist");
    if (!host) return;
    if (!products.length) { host.innerHTML = `<div class="empty">No products yet. Tap "Add product" to upload your first one.</div>`; return; }
    host.innerHTML = products.map((p) => `
      <div class="orow" data-id="${esc(p.id)}">
        <div class="t">${p.image_urls && p.image_urls[0] ? `<img src="${esc(p.image_urls[0])}" alt="">` : ""}</div>
        <div class="info"><b>${esc(p.name)}<span class="pill ${p.in_stock ? "ok" : "out"}">${p.in_stock ? "Available" : "Sold out"}</span></b>
          <span>${esc(p.category)} · ${naira(p.price)} + ${naira(p.shipping_fee)} = <b style="display:inline">${naira(total(p))}</b></span></div>
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
        await removeImages(p.image_urls || []);
        products = products.filter((x) => x.id !== id); drawOwnerList(); toast("Deleted");
      }
    };
  }

  const pathFromUrl = (u) => { const i = u.indexOf(`/${BUCKET}/`); return i === -1 ? null : decodeURIComponent(u.slice(i + BUCKET.length + 2).split("?")[0]); };
  async function removeImages(urls) {
    const paths = urls.map(pathFromUrl).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  }

  async function compress(file, max = 1100) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
  }

  function openForm(p) {
    const host = document.getElementById("formHost");
    // images: existing {url} or new {file, preview}
    let images = (p && p.image_urls ? p.image_urls : []).map((url) => ({ url }));
    const removed = [];
    const cats = Array.from(new Set(["Clothes", "Shoes", "Bags", "Electronics", "Accessories", "Home & Kitchen", ...products.map((x) => x.category).filter(Boolean)]));

    host.innerHTML = `
      <form class="panel" id="pform" style="margin-top:16px">
        <h2 style="margin:0 0 14px;font-size:18px">${p ? "Edit product" : "Add product"}</h2>
        <div class="field"><label>Photos (up to ${MAX_IMAGES})</label>
          <div class="imgs" id="imgs"></div>
          <input type="file" id="files" accept="image/*" multiple>
          <span class="hint">Photos are resized automatically so the app stays fast.</span></div>
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
          const blob = await compress(im.file);
          const path = `${crypto.randomUUID()}.jpg`;
          const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
          if (error) throw error;
          urls.push(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
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
        const res = p ? await sb.from("products").update(row).eq("id", p.id).select().single()
                      : await sb.from("products").insert(row).select().single();
        if (res.error) throw res.error;
        if (removed.length) await removeImages(removed);
        if (p) products = products.map((x) => (x.id === p.id ? res.data : x));
        else products.unshift(res.data);
        host.innerHTML = ""; drawOwnerList(); toast("Saved");
      } catch (ex) {
        err.textContent = ex.message || "Could not save. Please try again.";
        err.hidden = false; btn.disabled = false; btn.textContent = "Save product";
      }
    };
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  init();
})();
