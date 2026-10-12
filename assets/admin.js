// Admin panel for Baby Shoes: login, shoes (add, edit, delete, order), website text, password

const $ = (id) => document.getElementById(id);
const CAT_NAMES = { heels: "Heels", flats: "Flats & Khussa", sandals: "Sandals", sneakers: "Sneakers" };
const CAT_EMOJI = { heels: "👠", flats: "🥿", sandals: "👡", sneakers: "👟" };
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const formatPrice = (n) => "Rs. " + Number(n).toLocaleString("en-PK");
const SIZES = [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45];
const ic = (name) => `<svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#${name}"></use></svg>`;

// Website text fields, grouped by page: [key, name, where it shows on the website, long text?]
const TEXT_FIELDS = [
  {
    page: "Every page", link: "/", about: "Shown at the top of all pages",
    fields: [["site.topbar", "Announcement bar", "The thin blue strip at the very top of every page"]],
  },
  {
    page: "Home page", link: "/", about: "The first page customers see",
    fields: [
      ["home.heroLabel", "Hero badge", "Small rounded label above the main title, e.g. New Collection 2026"],
      ["home.heroTitle", "Main title", "The biggest text on the home page, next to the khussa photo"],
      ["home.heroText", "Main description", "The sentence under the main title", true],
      ["home.stylesTitle", "Categories title", "Heading above the 4 category cards (Flats, Heels, Sandals, Sneakers)"],
      ["home.stylesText", "Categories description", "Sentence under the categories title", true],
      ["home.bestTitle", "Best sellers title", "Heading above the \"most loved\" shoes slider"],
      ["home.bestText", "Best sellers description", "Sentence under the best sellers title", true],
      ["home.ctaTitle", "Help box title", "Heading in the blue box near the bottom (with the falling shoes)"],
      ["home.ctaText", "Help box text", "Sentence in the blue box, above the WhatsApp button", true],
    ],
  },
  {
    page: "About page", link: "/about", about: "Your shop's story",
    fields: [
      ["about.title", "Page title", "Big heading at the top of the About page"],
      ["about.text", "Page subtitle", "Sentence under the page title", true],
      ["about.storyTitle", "Story title", "Heading next to the khussa photo"],
      ["about.story1", "Story intro", "First paragraph of the story, shown in bold", true],
      ["about.story2", "Story paragraph 2", "Second paragraph of the story", true],
      ["about.story3", "Story paragraph 3", "Third paragraph of the story", true],
    ],
  },
  {
    page: "Contact page", link: "/contact", about: "Where customers reach you",
    fields: [
      ["contact.title", "Page title", "Big heading at the top of the Contact page"],
      ["contact.text", "Page subtitle", "Sentence under the page title, above the WhatsApp and Call buttons", true],
    ],
  },
];

/* ---------- Server calls ---------- */

async function api(path, options = {}) {
  const opts = { credentials: "same-origin", ...options };
  if (opts.json !== undefined) {
    opts.method = opts.method || "POST";
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(opts.json);
    delete opts.json;
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error("Could not reach the server. Is it running?");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.endsWith("/login") && !path.endsWith("/setup")) {
    showAuth(true);
    throw new Error(data.error || "Please log in again.");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

/* ---------- Little helpers ---------- */

let toastTimer;
function toast(message, isError = false) {
  const t = $("toast");
  t.textContent = message;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

async function withBusy(button, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/* ---------- Login and first time password ---------- */

let firstTime = false;

function showAuth(hasPassword) {
  firstTime = !hasPassword;
  $("app").hidden = true;
  $("auth").hidden = false;
  $("auth-title").textContent = firstTime ? "Create admin password" : "Admin login";
  $("auth-text").textContent = firstTime
    ? "First time here. Choose a password (at least 8 characters). Only people with this password can change the website."
    : "Enter your password to manage the website.";
  $("auth-btn").textContent = firstTime ? "Create password" : "Log in";
  $("auth-confirm-wrap").hidden = !firstTime;
  $("auth-confirm").required = firstTime;
  $("auth-password").autocomplete = firstTime ? "new-password" : "current-password";
  $("auth-password").value = "";
  $("auth-confirm").value = "";
  $("auth-error").textContent = "";
  $("auth-password").focus();
}

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("auth-password").value;
  $("auth-error").textContent = "";
  if (firstTime && password !== $("auth-confirm").value) {
    $("auth-error").textContent = "The two passwords are not the same.";
    return;
  }
  try {
    await withBusy($("auth-btn"), () => api(firstTime ? "/api/admin/setup" : "/api/admin/login", { json: { password } }));
    startApp();
  } catch (err) {
    $("auth-error").textContent = err.message;
  }
});

$("logout").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  showAuth(true);
});

/* ---------- Tabs ---------- */

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab);
    });
    ["shoes", "text", "password"].forEach((name) => ($(`tab-${name}`).hidden = name !== tab.dataset.tab));
  })
);

/* ---------- Shoes list ---------- */

let shoes = [];
let filterCat = "all";
let filterText = "";
let filterFlag = ""; // "best", "out" or "hidden": set by tapping a stat box
const FLAGS = {
  best: { label: "on the home page", test: (s) => s.best },
  out: { label: "out of stock", test: (s) => s.outOfStock },
  hidden: { label: "hidden from the website", test: (s) => s.hidden },
};

async function loadShoes() {
  shoes = await api("/api/products?all=1");
  renderShoes();
}

function renderStats() {
  const count = (fn) => shoes.filter(fn).length;
  const stats = [
    ["", "Total shoes", shoes.length, "bag", ""],
    ["best", "On home page", count(FLAGS.best.test), "home", "sky"],
    ["out", "Out of stock", count(FLAGS.out.test), "close", "red"],
    ["hidden", "Hidden", count(FLAGS.hidden.test), "eye-off", "grey"],
  ];
  $("stats").innerHTML = stats
    .map(
      ([flag, label, n, icon, tone]) => `
      <button type="button" class="stat ${tone}${filterFlag === flag ? " active" : ""}" data-flag="${flag}" aria-pressed="${filterFlag === flag}">
        <span class="stat-icon">${ic(icon)}</span>
        <span class="stat-text"><strong>${n}</strong><span>${label}</span></span>
      </button>`
    )
    .join("");
  $("shoe-count").textContent = shoes.length || "";
}

// Tap a stat box to see only those shoes, tap it again (or "Total shoes") to see all
$("stats").addEventListener("click", (e) => {
  const box = e.target.closest("[data-flag]");
  if (!box) return;
  filterFlag = filterFlag === box.dataset.flag ? "" : box.dataset.flag;
  renderShoes();
});

function renderShoes() {
  renderStats();
  const list = shoes.filter(
    (s) =>
      (filterCat === "all" || s.cat === filterCat) &&
      (!filterFlag || FLAGS[filterFlag].test(s)) &&
      s.name.toLowerCase().includes(filterText)
  );
  const note = $("filter-note");
  note.hidden = !filterFlag;
  if (filterFlag) {
    note.innerHTML = `Showing shoes ${FLAGS[filterFlag].label} <button type="button" class="link" data-clear>Show all</button>`;
  }
  $("shoe-empty").hidden = list.length > 0;
  $("shoe-list").innerHTML = list
    .map((s) => {
      const i = shoes.indexOf(s);
      const sale = s.old && s.old > s.price ? Math.round((1 - s.price / s.old) * 100) : 0;
      return `
      <article class="shoe${s.hidden ? " is-hidden" : ""}${s.outOfStock ? " is-sold-out" : ""}">
        <div class="shoe-pic${s.img ? " has-photo" : ""}">
          <span class="shoe-ring" aria-hidden="true"></span>
          ${s.img ? `<img src="${esc(s.img)}" alt="" loading="lazy">` : `<span class="shoe-emoji">${CAT_EMOJI[s.cat]}</span><span class="shoe-floor" aria-hidden="true"></span>`}
          <div class="shoe-tags">
            ${s.best ? `<span class="tag tag-home">${ic("home")} Home page</span>` : ""}
            ${sale ? `<span class="tag tag-sale">${sale}% off</span>` : ""}
            ${s.hidden ? `<span class="tag tag-hidden">${ic("eye-off")} Hidden</span>` : ""}
          </div>
          <span class="shoe-pos" title="Place on the website">#${i + 1}</span>
          ${s.outOfStock ? `<span class="sold-ribbon">Out of stock</span>` : ""}
        </div>
        <div class="shoe-body">
          <span class="shoe-cat">${esc(CAT_NAMES[s.cat])}</span>
          <h3 class="shoe-name">${esc(s.name)}</h3>
          <span class="shoe-price">${formatPrice(s.price)}${s.old ? `<del>${formatPrice(s.old)}</del>` : ""}</span>
          ${s.soldSizes && s.soldSizes.length ? `<span class="shoe-sold">Sizes not available: ${s.soldSizes.join(", ")}</span>` : `<span class="shoe-sizes">All sizes 35 to 45 available</span>`}
          ${s.babyPrice || s.babyImg ? `<span class="shoe-baby">Baby size too${s.babyPrice ? `: ${formatPrice(s.babyPrice)}` : ""}</span>` : ""}
        </div>
        <label class="quick-stock" title="Turn on when this shoe is sold out">
          <input type="checkbox" data-stock="${s.id}" ${s.outOfStock ? "checked" : ""}>
          <span class="mini-track" aria-hidden="true"></span>
          <span class="quick-stock-text">${s.outOfStock ? "Out of stock" : "In stock"}</span>
        </label>
        <div class="shoe-actions">
          <button class="btn btn-soft" data-edit="${s.id}">Edit shoe</button>
          <button class="icon-btn" data-move="${s.id}" data-dir="-1" aria-label="Move up" title="Show earlier on the website" ${i === 0 ? "disabled" : ""}>${ic("arrow-up")}</button>
          <button class="icon-btn" data-move="${s.id}" data-dir="1" aria-label="Move down" title="Show later on the website" ${i === shoes.length - 1 ? "disabled" : ""}>${ic("arrow-down")}</button>
        </div>
      </article>`;
    })
    .join("");
}

$("filter-note").addEventListener("click", (e) => {
  if (!e.target.closest("[data-clear]")) return;
  filterFlag = "";
  renderShoes();
});

// Quick stock switch on each card: saves straight away
$("shoe-list").addEventListener("change", async (e) => {
  const box = e.target.closest("[data-stock]");
  if (!box) return;
  const shoe = shoes.find((s) => s.id === box.dataset.stock);
  const outOfStock = box.checked;
  box.disabled = true;
  try {
    const saved = await api(`/api/admin/products/${shoe.id}`, { method: "PUT", json: { outOfStock } });
    Object.assign(shoe, saved);
    toast(outOfStock ? `"${shoe.name}" marked out of stock` : `"${shoe.name}" is back in stock`);
  } catch (err) {
    toast(err.message, true);
  }
  renderShoes();
});

$("cat-chips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  filterCat = chip.dataset.cat;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderShoes();
});
$("shoe-search").addEventListener("input", (e) => {
  filterText = e.target.value.trim().toLowerCase();
  renderShoes();
});

$("shoe-list").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) return openEditor(shoes.find((s) => s.id === edit.dataset.edit));

  const move = e.target.closest("[data-move]");
  if (move) {
    const from = shoes.findIndex((s) => s.id === move.dataset.move);
    const to = from + Number(move.dataset.dir);
    if (to < 0 || to >= shoes.length) return;
    const before = shoes.slice();
    [shoes[from], shoes[to]] = [shoes[to], shoes[from]];
    renderShoes();
    try {
      await api("/api/admin/products/reorder", { json: { ids: shoes.map((s) => s.id) } });
      toast("Order saved");
    } catch (err) {
      shoes = before;
      renderShoes();
      toast(err.message, true);
    }
  }
});

/* ---------- Add / edit a shoe ---------- */

const editor = $("editor");
let editing = null; // the shoe being edited, or null for a new one
let photo = null;
let babyPhoto = null;

function updatePreview() {
  const name = $("f-name").value.trim() || "Shoe name";
  const price = Number($("f-price").value) || 0;
  const old = Number($("f-old").value) || 0;
  const sale = old > price && price ? Math.round((1 - price / old) * 100) : 0;
  const out = $("f-stock").checked;
  const cat = $("f-cat").value;
  $("preview").innerHTML = `
    <div class="pv${out ? " is-sold-out" : ""}${$("f-hidden").checked ? " is-hidden" : ""}">
      <div class="pv-pic${photo ? " has-photo" : ""}">
        ${photo ? `<img src="${esc(photo)}" alt="">` : `<span class="pv-emoji">${CAT_EMOJI[cat]}</span>`}
        <div class="pv-tags">
          ${$("f-best").checked ? `<span>Best seller</span>` : ""}
          ${sale && !out ? `<span class="sale">${sale}% off</span>` : ""}
        </div>
        ${out ? `<span class="pv-out">Out of stock</span>` : ""}
      </div>
      <div class="pv-body">
        <span class="pv-cat">${esc(CAT_NAMES[cat])}</span>
        <strong>${esc(name)}</strong>
        <span class="pv-price">${price ? formatPrice(price) : "Rs. ..."}${old ? `<del>${formatPrice(old)}</del>` : ""}</span>
        <span class="pv-btn">See More</span>
      </div>
    </div>
    ${$("f-hidden").checked ? `<p class="hint">Hidden: customers will not see this shoe.</p>` : ""}`;
}
$("shoe-form").addEventListener("input", updatePreview);
$("shoe-form").addEventListener("change", updatePreview);

function setPhoto(which, path) {
  const isBaby = which === "baby";
  if (isBaby) babyPhoto = path;
  else photo = path;
  const preview = $(isBaby ? "baby-preview" : "photo-preview");
  preview.hidden = !path;
  if (path) preview.src = path;
  $(isBaby ? "baby-text" : "photo-text").hidden = Boolean(path);
  $(isBaby ? "baby-remove" : "photo-remove").hidden = !path;
  updatePreview();
}

function openEditor(shoe = null) {
  editing = shoe;
  $("editor-title").textContent = shoe ? "Edit shoe" : "Add new shoe";
  $("f-name").value = shoe ? shoe.name : "";
  $("f-cat").value = shoe ? shoe.cat : (filterCat !== "all" ? filterCat : "heels");
  $("f-price").value = shoe ? shoe.price : "";
  $("f-old").value = shoe && shoe.old ? shoe.old : "";
  $("f-baby-price").value = shoe && shoe.babyPrice ? shoe.babyPrice : "";
  $("f-best").checked = shoe ? shoe.best : false;
  $("f-hidden").checked = shoe ? shoe.hidden : false;
  $("f-stock").checked = shoe ? Boolean(shoe.outOfStock) : false;
  const sold = new Set(shoe && shoe.soldSizes ? shoe.soldSizes : []);
  $("f-sizes").innerHTML = SIZES.map(
    (n) => `<button type="button" class="size-chip" data-size="${n}" aria-pressed="${sold.has(n)}">${n}</button>`
  ).join("");
  setPhoto("main", shoe ? shoe.img : null);
  setPhoto("baby", shoe ? shoe.babyImg : null);
  document.querySelector(".baby-box").open = Boolean(shoe && (shoe.babyPrice || shoe.babyImg));
  $("shoe-delete").hidden = !shoe;
  $("shoe-error").textContent = "";
  editor.showModal();
  $("f-name").focus();
}

$("add-shoe").addEventListener("click", () => openEditor());
// Size buttons: tap to mark a size as not available (orange), tap again to bring it back
$("f-sizes").addEventListener("click", (e) => {
  const chip = e.target.closest(".size-chip");
  if (chip) chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") !== "true");
});
$("editor-close").addEventListener("click", () => editor.close());
$("shoe-cancel").addEventListener("click", () => editor.close());
editor.addEventListener("click", (e) => {
  if (e.target === editor) editor.close();
});

// Photos are made smaller in the browser before uploading (max 1400px wide), so they load fast
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Please choose a JPG, PNG or WEBP photo.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (blob && blob.type === "image/webp") return blob;
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
}

async function uploadPhoto(which, file) {
  const drop = $(which === "baby" ? "drop-baby" : "drop-main");
  drop.classList.add("busy");
  try {
    const blob = await shrinkImage(file);
    const res = await fetch("/api/admin/upload", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": blob.type },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "The photo could not be uploaded.");
    setPhoto(which, data.path);
  } catch (err) {
    toast(err.message, true);
  } finally {
    drop.classList.remove("busy");
  }
}

for (const [which, inputId, dropId, removeId] of [
  ["main", "photo-input", "drop-main", "photo-remove"],
  ["baby", "baby-input", "drop-baby", "baby-remove"],
]) {
  const input = $(inputId);
  const drop = $(dropId);
  input.addEventListener("change", () => {
    if (input.files[0]) uploadPhoto(which, input.files[0]);
    input.value = "";
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("dragging");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragging");
    if (e.dataTransfer.files[0]) uploadPhoto(which, e.dataTransfer.files[0]);
  });
  $(removeId).addEventListener("click", () => setPhoto(which, null));
}

$("shoe-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("shoe-error").textContent = "";
  const body = {
    name: $("f-name").value,
    cat: $("f-cat").value,
    price: $("f-price").value,
    old: $("f-old").value || null,
    babyPrice: $("f-baby-price").value || null,
    img: photo,
    babyImg: babyPhoto,
    best: $("f-best").checked,
    hidden: $("f-hidden").checked,
    outOfStock: $("f-stock").checked,
    soldSizes: [...document.querySelectorAll(".size-chip[aria-pressed='true']")].map((b) => Number(b.dataset.size)),
  };
  try {
    await withBusy($("shoe-save"), () =>
      editing
        ? api(`/api/admin/products/${editing.id}`, { method: "PUT", json: body })
        : api("/api/admin/products", { json: body })
    );
    editor.close();
    toast(editing ? "Shoe saved" : "New shoe added");
    await loadShoes();
  } catch (err) {
    $("shoe-error").textContent = err.message;
  }
});

$("shoe-delete").addEventListener("click", async () => {
  if (!editing) return;
  if (!confirm(`Delete "${editing.name}" from the website? This cannot be undone.`)) return;
  try {
    await api(`/api/admin/products/${editing.id}`, { method: "DELETE" });
    editor.close();
    toast("Shoe deleted");
    await loadShoes();
  } catch (err) {
    $("shoe-error").textContent = err.message;
  }
});

/* ---------- Website text ---------- */

let textDirty = false;
function setTextDirty(dirty) {
  textDirty = dirty;
  $("save-text").disabled = !dirty;
  $("save-state").textContent = dirty ? "You have unsaved changes" : "All changes saved";
  $("save-bar").classList.toggle("dirty", dirty);
}

async function loadText() {
  const content = await api("/api/content");
  $("text-jump").innerHTML = TEXT_FIELDS.map(
    (group, i) => `<a href="#text-${i}" class="chip">${group.page} <small>${group.fields.length}</small></a>`
  ).join("");
  $("text-form").innerHTML = TEXT_FIELDS.map(
    (group, i) => `
    <fieldset class="text-group" id="text-${i}">
      <div class="text-group-head">
        <div>
          <h2>${group.page}</h2>
          <p class="muted">${group.about}</p>
        </div>
        <a href="${group.link}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#external"></use></svg> Open page</a>
      </div>
      ${group.fields
        .map(
          ([key, label, hint, long]) => `
        <label class="text-field">
          <span class="text-label">${esc(label)}</span>
          <span class="text-hint">${esc(hint)}</span>
          <textarea name="${key}" rows="${long ? 3 : 1}" maxlength="600">${esc(content[key] || "")}</textarea>
        </label>`
        )
        .join("")}
    </fieldset>`
  ).join("");
  setTextDirty(false);
}

$("text-form").addEventListener("input", () => setTextDirty(true));

$("save-text").addEventListener("click", async () => {
  const body = {};
  new FormData($("text-form")).forEach((value, key) => (body[key] = value));
  try {
    await withBusy($("save-text"), () => api("/api/admin/content", { method: "PUT", json: body }));
    setTextDirty(false);
    toast("Website text saved");
  } catch (err) {
    toast(err.message, true);
  }
});

// Warn before closing the page with unsaved text
window.addEventListener("beforeunload", (e) => {
  if (textDirty) e.preventDefault();
});

/* ---------- Password ---------- */

$("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("pw-error").textContent = "";
  if ($("pw-new").value !== $("pw-confirm").value) {
    $("pw-error").textContent = "The two new passwords are not the same.";
    return;
  }
  try {
    await api("/api/admin/password", { json: { current: $("pw-current").value, next: $("pw-new").value } });
    e.target.reset();
    toast("Password changed");
  } catch (err) {
    $("pw-error").textContent = err.message;
  }
});

/* ---------- Start ---------- */

async function startApp() {
  $("auth").hidden = true;
  $("app").hidden = false;
  $("today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  // Show where the data is saved: Supabase (online) or local files (this computer only)
  api("/api/admin/status")
    .then((s) => {
      const badge = $("storage-badge");
      badge.textContent = s.storage === "Supabase" ? "Saved in Supabase" : "Saved on this computer";
      badge.classList.toggle("is-cloud", s.storage === "Supabase");
    })
    .catch(() => {});
  try {
    await Promise.all([loadShoes(), loadText()]);
  } catch (err) {
    toast(err.message, true);
  }
}

api("/api/admin/status")
  .then((status) => (status.loggedIn ? startApp() : showAuth(status.hasPassword)))
  .catch((err) => {
    showAuth(true);
    $("auth-error").textContent = err.message;
  });
