// Shop settings: change these in one place
const PHONE = "923337723203"; // 03337723203 in international format, used for WhatsApp

// Shoes are managed in the admin panel (/admin) and come from the server: /api/products
let PRODUCTS = [];
const CAT_EMOJI = { heels: "👠", flats: "🥿", sandals: "👡", sneakers: "👟" };

// Makes text safe to put inside HTML
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const formatPrice = (n) => "Rs. " + n.toLocaleString("en-PK");

const waLink = (text) => `https://wa.me/${PHONE}?text=${encodeURIComponent(text)}`;

// baby = true shows the baby version of the card (baby photo, baby price, baby size in the WhatsApp message)
// rank shows a big "#1" style number on the card (used in the Best Sellers slider)
function productCard(p, baby = false, rank = 0) {
  const photo = baby ? p.babyImg : p.img;
  const price = baby && p.babyPrice ? p.babyPrice : p.price;
  const old = baby ? null : p.old;
  const name = esc(baby ? `${p.name} (Baby size)` : p.name);
  const sale = old && old > price ? Math.round((1 - price / old) * 100) : 0;
  // small line under the name: which sizes can be ordered
  const sold = new Set((p.soldSizes || []).map(String));
  const left = SIZES.filter((s) => !sold.has(s)).length;
  const sizes = p.outOfStock ? "" : baby ? "Baby sizes, ask on WhatsApp" : left === SIZES.length ? `Sizes ${SIZES[0]} to ${SIZES[SIZES.length - 1]}` : left ? `${left} sizes available` : "Ask us for sizes";
  return `
    <article class="product${baby ? " is-baby" : ""}${p.outOfStock ? " is-sold-out" : ""}">
      <div class="product-img${photo ? " has-photo" : ""}">
        <span class="p-ring" aria-hidden="true"></span>
        <div class="p-badges">
          ${baby ? `<span class="p-badge">Baby</span>` : ""}
          ${p.best && !rank ? `<span class="p-badge"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#heart"></use></svg> Best seller</span>` : ""}
          ${sale && !p.outOfStock ? `<span class="p-badge sale">${sale}% off</span>` : ""}
        </div>
        ${rank ? `<span class="rank">#${rank}</span>` : ""}
        ${p.outOfStock ? `<span class="sold-out">Out of stock</span>` : ""}
        ${photo ? `<img src="${photo}" alt="${name}" loading="lazy">` : `<span class="product-emoji">${p.emoji || CAT_EMOJI[p.cat] || "👠"}</span><span class="p-floor" aria-hidden="true"></span>`}
      </div>
      <div class="product-body">
        <span class="product-cat">${baby ? "Baby " : ""}${p.cat}</span>
        <h3>${name}</h3>
        ${sizes ? `<span class="p-sizes">${sizes}</span>` : ""}
        <div class="price">${formatPrice(price)}${old ? `<del>${formatPrice(old)}</del>` : ""}</div>
        <button type="button" class="btn btn-primary see-more" data-id="${PRODUCTS.indexOf(p)}" data-baby="${baby ? 1 : ""}">See More <svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#arrow-right"></use></svg></button>
      </div>
    </article>`;
}

// "See More" opens a quick view popup with a bigger picture, size choice and the WhatsApp order button
const SIZES = ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];

// Size chart shown inside the popup: [our size, foot length cm, Europe, UK, US] (same as the /size-chart page)
const SIZE_CHART = [
  [35, "22.0", 35, "3-3.5", "5-5.5"], [36, "22.7", 36, "4", "6"], [37, "23.3", 37, "4.5-5", "6.5-7"],
  [38, "24.0", 38, "5.5", "7.5"], [39, "24.7", 39, "6-6.5", "8-8.5"], [40, "25.3", 40, "7-7.5", "9-9.5"],
  [41, "26.0", 41, "7.5-8", "10"], [42, "26.7", 42, "8.5-9", "10.5-11"], [43, "27.3", 43, "9.5", "11.5"],
  [44, "28.0", 44, "10-10.5", "12-12.5"], [45, "28.7", 45, "11", "13"],
];
const chartPanel = () => `
  <div class="qv-chart" hidden>
    <div class="qv-chart-head">
      <button type="button" class="qv-chart-back"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#arrow-left"></use></svg> Back</button>
      <h3>Women Shoes Size Chart</h3>
    </div>
    <div class="size-table-wrap">
      <table class="size-table">
        <thead>
          <tr><th scope="col">Size</th><th scope="col">Foot length<br><small>(cm)</small></th><th scope="col">Europe</th><th scope="col">UK</th><th scope="col">US</th></tr>
        </thead>
        <tbody>
          ${SIZE_CHART.map(([size, cm, eu, uk, us]) => `<tr><th scope="row">${size}</th><td>${cm}</td><td>${eu}</td><td>${uk}</td><td>${us}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
    <p class="qv-chart-note">Measure your foot from heel to longest toe in cm and find it in the chart. Between two sizes? Choose the bigger one. <a href="/size-chart">How to measure</a></p>
  </div>`;
const quickView = document.createElement("dialog");
quickView.className = "quick-view";
document.body.appendChild(quickView);

function openQuickView(p, baby) {
  const photo = baby ? p.babyImg : p.img;
  const price = baby && p.babyPrice ? p.babyPrice : p.price;
  const old = baby ? null : p.old;
  const rawName = baby ? `${p.name} (Baby size)` : p.name;
  const name = esc(rawName);
  // sizes marked "not available" in the admin panel are left out
  const sold = new Set((p.soldSizes || []).map(String));
  const inStockSizes = SIZES.filter((s) => !sold.has(s));

  const sale = old && old > price ? Math.round((1 - price / old) * 100) : 0;
  const icon = (n) => `<svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#${n}"></use></svg>`;

  quickView.innerHTML = `
    <button type="button" class="qv-close" aria-label="Close">${icon("close")}</button>
    <div class="qv-media${baby ? " is-baby" : ""}${photo ? " has-photo" : ""}${p.outOfStock ? " is-sold-out" : ""}">
      <span class="qv-ring" aria-hidden="true"></span>
      <span class="qv-ring qv-ring-2" aria-hidden="true"></span>
      <div class="qv-badges">
        ${p.outOfStock ? `<span class="qv-badge out">Out of stock</span>` : ""}
        ${baby ? `<span class="qv-badge">Baby size</span>` : ""}
        ${p.best ? `<span class="qv-badge">${icon("heart")} Best seller</span>` : ""}
        ${sale ? `<span class="qv-badge sale">${sale}% off</span>` : ""}
      </div>
      ${photo ? `<img src="${photo}" alt="${name}">` : `<span class="product-emoji">${p.emoji || CAT_EMOJI[p.cat] || "👠"}</span><span class="qv-floor" aria-hidden="true"></span>`}
    </div>
    <div class="qv-body">
      <span class="product-cat">${baby ? "Baby " : ""}${p.cat}</span>
      <h2>${name}</h2>
      <div class="qv-price-row">
        <span class="price qv-price">${formatPrice(price)}</span>
        ${old ? `<del>${formatPrice(old)}</del><span class="qv-save">Save ${formatPrice(old - price)}</span>` : ""}
      </div>
      <hr class="qv-divider">
      ${p.outOfStock ? `<p class="qv-soldout">Out of stock right now. Message us and we will tell you when it is back.</p>` : baby ? `
      <div class="qv-info">
        <span class="qv-info-icon">${icon("heart")}</span>
        <div><strong>Made for little feet</strong><p>Tell us the baby's age in the WhatsApp chat and we will help you pick the right size.</p></div>
      </div>` : `
      <div class="qv-size-head">
        <span class="qv-label" id="qv-size-label">Choose your size <span class="qv-picked"></span></span>
        <button type="button" class="qv-chart-link">Size chart</button>
      </div>
      ${inStockSizes.length ? `<div class="qv-sizes" role="group" aria-labelledby="qv-size-label">
        ${inStockSizes.map((s) => `<button type="button" class="qv-size" data-size="${s}">${s}</button>`).join("")}
      </div>
      <p class="qv-note">Not sure? Skip it and ask us on WhatsApp.</p>` : `<p class="qv-note">No sizes available right now. Message us and we will help you.</p>`}`}
      <div class="qv-actions">
        <a class="btn btn-wa qv-order" target="_blank" rel="noopener">${icon("whatsapp")} ${p.outOfStock ? "Ask when it's back" : "Order on WhatsApp"}</a>
        <a class="btn qv-call" href="tel:+${PHONE}" aria-label="Call the shop">${icon("phone")} <span>Call</span></a>
      </div>
      <ul class="qv-points">
        <li><span>${icon("truck")}</span> Delivery all over Pakistan</li>
        <li><span>${icon("whatsapp")}</span> Easy order on WhatsApp</li>
        <li><span>${icon("pin")}</span> Shop in Churi Bazar, Vehari</li>
      </ul>
    </div>`;

  const orderBtn = quickView.querySelector(".qv-order");
  let size = "";
  const updateLink = () => {
    const sizeText = size ? ` Size: ${size}.` : "";
    orderBtn.href = p.outOfStock
      ? waLink(`Hi, please tell me when ${rawName} is back in stock.`)
      : waLink(`Hi, I want to order: ${rawName} (${formatPrice(price)}).${sizeText} Please deliver to my address.`);
  };
  quickView.querySelectorAll(".qv-size").forEach((btn) =>
    btn.addEventListener("click", () => {
      const already = btn.classList.contains("active");
      quickView.querySelectorAll(".qv-size").forEach((b) => b.classList.remove("active"));
      size = already ? "" : btn.dataset.size;
      if (!already) btn.classList.add("active");
      quickView.querySelector(".qv-picked").textContent = size;
      updateLink();
    })
  );
  updateLink();
  quickView.querySelector(".qv-close").addEventListener("click", () => quickView.close());

  // "Size chart" opens the chart over the popup, "Back" returns to the shoe
  quickView.insertAdjacentHTML("beforeend", chartPanel());
  const chart = quickView.querySelector(".qv-chart");
  const chartLink = quickView.querySelector(".qv-chart-link");
  if (chartLink) {
    chartLink.addEventListener("click", () => {
      quickView.scrollTop = 0;
      chart.hidden = false;
      chart.querySelector(".qv-chart-back").focus();
    });
  }
  chart.querySelector(".qv-chart-back").addEventListener("click", () => {
    chart.hidden = true;
    if (chartLink) chartLink.focus();
  });
  quickView.showModal();
}

document.addEventListener("click", (e) => {
  // a tap anywhere on a shoe card opens it, not only the See More button
  const card = e.target.closest(".product");
  const btn = card && card.querySelector(".see-more");
  if (btn) openQuickView(PRODUCTS[Number(btn.dataset.id)], btn.dataset.baby === "1");
});
// Clicking the dark area outside the popup closes it
quickView.addEventListener("click", (e) => {
  if (e.target === quickView) quickView.close();
});

// Home page: "Most loved" slider (shoes ticked "Show on home page" in the admin panel, in list order)
function initFeatured() {
  const featured = document.getElementById("featured");
  if (!featured) return;
  featured.innerHTML = PRODUCTS.filter((p) => p.best)
    .map((p, i) => productCard(p, false, i + 1))
    .join("");

  const arrows = document.querySelectorAll(".bs-arrow");
  const controls = document.querySelector(".bs-controls");

  // Move by one card per click
  arrows.forEach((btn) =>
    btn.addEventListener("click", () => {
      const card = featured.querySelector(".product");
      const step = card ? card.offsetWidth + parseFloat(getComputedStyle(featured).columnGap || 0) : 300;
      const index = Math.round(featured.scrollLeft / step) + Number(btn.dataset.dir);
      featured.scrollTo({ left: index * step, behavior: "smooth" });
    })
  );

  // Arrow states follow the slider; arrows hide when every card already fits on screen
  const update = () => {
    const max = featured.scrollWidth - featured.clientWidth;
    if (controls) controls.hidden = max <= 2;
    arrows[0].disabled = featured.scrollLeft <= 2;
    arrows[1].disabled = featured.scrollLeft >= max - 2;
  };
  featured.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}

// Roads (home Best Sellers, contact form): the shoe walks along the road as the page
// scrolls, from the start of the road to the end
document.querySelectorAll(".bs-road").forEach((road) => {
  const walker = road.querySelector(".bs-walker");
  if (!walker) return;
  let stopTimer;
  const walk = () => {
    // Start of the road when it appears at the bottom of the screen,
    // end of the road when it has scrolled up to a quarter of the screen
    const top = road.getBoundingClientRect().top;
    const vh = window.innerHeight;
    const progress = Math.min(Math.max((vh - top) / (vh * 0.75), 0), 1);
    walker.style.left = `calc(${progress} * (100% - ${walker.offsetWidth}px))`;
  };
  window.addEventListener(
    "scroll",
    () => {
      // Bob the shoe up and down while the page is moving
      road.classList.add("walking");
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => road.classList.remove("walking"), 180);
      walk();
    },
    { passive: true }
  );
  window.addEventListener("resize", walk);
  walk();
});

// Scroll reveal: cards fade up one after another when they come into view
const revealItems = document.querySelectorAll("[data-reveal]");
if (revealItems.length) {
  revealItems.forEach((el, i) => el.style.setProperty("--delay", `${(i % 5) * 0.1}s`));
  if ("IntersectionObserver" in window) {
    // Cards only start hidden when JS is running, so the page never stays blank
    document.documentElement.classList.add("reveal-on");
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("revealed");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.15 }
    );
    revealItems.forEach((el) => io.observe(el));
  } else {
    revealItems.forEach((el) => el.classList.add("revealed"));
  }
}

// Smooth dropdowns: the browser's own <select> opens instantly and can't be animated,
// so each one gets a custom button + menu. The real <select> stays hidden underneath,
// so its value, "change" events and form data all keep working.
function smoothSelect(select) {
  const wrap = document.createElement("div");
  wrap.className = "dd";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dd-toggle";
  toggle.setAttribute("aria-haspopup", "listbox");
  toggle.setAttribute("aria-expanded", "false");
  const label = select.closest("label");
  if (label) toggle.setAttribute("aria-label", label.firstChild.textContent.trim());

  const menu = document.createElement("ul");
  menu.className = "dd-menu";
  menu.setAttribute("role", "listbox");
  [...select.options].forEach((opt, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.dataset.value = opt.value;
    li.textContent = opt.textContent;
    li.style.setProperty("--i", i);
    li.tabIndex = -1;
    menu.appendChild(li);
  });
  wrap.append(toggle, menu);
  select.tabIndex = -1;

  const items = [...menu.children];
  const sync = () => {
    toggle.textContent = select.options[select.selectedIndex].textContent;
    items.forEach((li) => li.setAttribute("aria-selected", li.dataset.value === select.value));
  };
  const open = () => {
    document.querySelectorAll(".dd.open").forEach((d) => d !== wrap && d.classList.remove("open"));
    wrap.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    (items.find((li) => li.dataset.value === select.value) || items[0]).focus({ preventScroll: true });
  };
  const close = (focusToggle) => {
    wrap.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    if (focusToggle) toggle.focus();
  };
  const choose = (li) => {
    select.value = li.dataset.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
    close(true);
  };

  toggle.addEventListener("click", () => (wrap.classList.contains("open") ? close() : open()));
  // Stop the surrounding <label> from re-activating anything when an option is clicked
  if (label) wrap.addEventListener("click", (e) => e.preventDefault());
  items.forEach((li) => li.addEventListener("click", () => choose(li)));
  menu.addEventListener("keydown", (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(i - 1, 0)].focus(); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (i >= 0) choose(items[i]); }
    if (e.key === "Escape" || e.key === "Tab") close(e.key === "Escape");
  });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
  select.form && select.form.addEventListener("reset", () => setTimeout(sync));
  sync();
}
document.querySelectorAll("#shop-sort, .form select").forEach(smoothSelect);

// Blue CTA cards (Shop, About...): add the same slowly falling white shoes as the home page card
const RAIN = [
  [4, 26, 11, -2, -25, "👠"], [13, 20, 14, -9, 30, "🥿"], [21, 30, 12, -5, -15, "👟"],
  [30, 22, 15, -12, 40, "👡"], [38, 18, 13, -1, -35, "🩰"], [47, 24, 16, -7, 20, "👢"],
  [55, 20, 12, -10, -20, "👞"], [63, 28, 14, -3, 35, "👠"], [71, 22, 11, -8, -30, "👟"],
  [79, 26, 15, -4, 25, "🥿"], [87, 20, 13, -11, -40, "👡"], [95, 24, 16, -6, 15, "👢"],
];
document.querySelectorAll(".cta:not(.cta-rain)").forEach((card) => {
  card.classList.add("cta-rain");
  const rain = document.createElement("div");
  rain.className = "shoe-rain";
  rain.setAttribute("aria-hidden", "true");
  rain.innerHTML = RAIN.map(
    ([x, s, d, delay, r, shoe]) =>
      `<span style="--x: ${x}%; --s: ${s}px; --d: ${d}s; --delay: ${delay}s; --r: ${r}deg">${shoe}</span>`
  ).join("");
  card.prepend(rain);
});

// Shop pages: three big soft bubbles behind the header that drift down as you scroll (parallax)
const shopHero = document.querySelector(".shop-hero");
if (shopHero) {
  const bubbles = document.createElement("div");
  bubbles.className = "bubbles";
  bubbles.setAttribute("aria-hidden", "true");
  bubbles.innerHTML = "<span></span><span></span><span></span>";
  shopHero.prepend(bubbles);

  // Floating info chips and sparkles fill the empty sides of the header
  const floats = document.createElement("div");
  floats.className = "hero-floats";
  floats.setAttribute("aria-hidden", "true");
  floats.innerHTML = `
    <div class="float-item chip chip-left" data-depth="12"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#truck"></use></svg> Delivery all over Pakistan</div>
    <div class="float-item chip chip-right" data-depth="14"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#whatsapp"></use></svg> Order on WhatsApp</div>
    <div class="foot-trail">${Array.from({ length: 14 }, (_, i) => `<span style="--i: ${i}"></span>`).join("")}</div>
    <i class="sparkle s1">✦</i><i class="sparkle s2">✦</i><i class="sparkle s3">✦</i>
    <i class="sparkle s4">✦</i><i class="sparkle s5">✦</i><i class="sparkle s6">✦</i>`;
  shopHero.prepend(floats);

  // Mouse parallax: closer items (bigger depth) follow the cursor more
  const items = floats.querySelectorAll(".float-item");
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    shopHero.addEventListener("mousemove", (e) => {
      const r = shopHero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      items.forEach((el) => {
        const d = Number(el.dataset.depth);
        el.style.translate = `${x * d}px ${y * d}px`;
      });
    });
    shopHero.addEventListener("mouseleave", () => items.forEach((el) => (el.style.translate = "0 0")));
  }

  const speeds = [0.15, 0.3, 0.45]; // outer bubble moves slowest, inner one fastest
  const circles = bubbles.querySelectorAll("span");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const drift = () => {
    const y = Math.min(window.scrollY, shopHero.offsetHeight * 1.5);
    circles.forEach((c, i) => (c.style.transform = `translate(-50%, ${y * speeds[i]}px)`));
  };
  if (!still) {
    window.addEventListener("scroll", drift, { passive: true });
    drift();
  }
}

// Old links like /shop?cat=heels now go to the category page /shop/heels
const oldParams = new URLSearchParams(location.search);
if (location.pathname.replace(/\/$/, "") === "/shop" && oldParams.get("cat")) {
  location.replace(`/shop/${oldParams.get("cat")}${oldParams.get("baby") === "1" ? "?baby=1" : ""}`);
}

// Category pages (/shop/heels, /shop/sneakers ...): search, Baby switch and sorting work together.
// The category comes from <body data-cat="...">.
function initShop() {
  const shopGrid = document.getElementById("shop-grid");
  if (!shopGrid) return;
  const cat = document.body.dataset.cat || "all";
  let baby = false;
  let query = "";
  let sort = "featured";

  const countEl = document.getElementById("shop-count");
  const emptyEl = document.getElementById("shop-empty");
  const searchEl = document.getElementById("shop-search");
  const sortEl = document.getElementById("shop-sort");

  const inCat = cat === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.cat === cat);
  const priceOf = (p) => (baby && p.babyPrice ? p.babyPrice : p.price);

  const render = () => {
    let list = inCat;
    if (query) list = list.filter((p) => `${p.name} ${p.cat}`.toLowerCase().includes(query));
    if (sort === "low") list = [...list].sort((a, b) => priceOf(a) - priceOf(b));
    if (sort === "high") list = [...list].sort((a, b) => priceOf(b) - priceOf(a));
    if (sort === "sale") list = [...list].sort((a, b) => !!b.old - !!a.old);

    shopGrid.innerHTML = list.map((p) => productCard(p, baby)).join("");
    // Cards fade in one after another
    shopGrid.querySelectorAll(".product").forEach((el, i) => (el.style.animationDelay = `${Math.min(i, 8) * 0.05}s`));

    if (countEl) countEl.textContent = `Showing ${list.length} ${list.length === 1 ? "style" : "styles"}${baby ? " in baby size" : ""}`;
    if (emptyEl) emptyEl.hidden = list.length > 0;
  };

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      query = searchEl.value.trim().toLowerCase();
      render();
    });
  }
  if (sortEl) {
    sortEl.addEventListener("change", () => {
      sort = sortEl.value;
      render();
    });
  }
  const resetBtn = document.getElementById("shop-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (searchEl) searchEl.value = "";
      query = "";
      render();
    });
  }

  // Baby switch: shows this category in baby size
  const babyBtn = document.querySelector(".baby-btn");
  if (babyBtn) {
    babyBtn.addEventListener("click", () => {
      baby = !baby;
      babyBtn.classList.toggle("active", baby);
      babyBtn.setAttribute("aria-pressed", baby);
      render();
    });
  }

  // A link like /shop/heels?baby=1 opens straight in baby mode
  if (oldParams.get("baby") === "1" && babyBtn) babyBtn.click();
  else render();
}

// Contact page: send the form as a WhatsApp message
const form = document.getElementById("contact-form");
if (form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const text = `Name: ${d.get("name")}\nPhone: ${d.get("phone")}\nShoe size: ${d.get("size") || "Not sure, please help"}\n\n${d.get("message")}`;
    window.open(waLink(text), "_blank", "noopener");
  });
}

// Navbar: switch to the glass style once the page is scrolled
const header = document.querySelector(".header");
if (header) {
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 10);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

// Mobile menu
const menuBtn = document.querySelector(".menu-btn");
const navLinks = document.querySelector(".nav-links");
if (menuBtn && navLinks) {
  menuBtn.addEventListener("click", () => navLinks.classList.toggle("open"));
}

// Footer year
document.querySelectorAll(".year").forEach((el) => (el.textContent = new Date().getFullYear()));

// Asks the server up to 3 times (a weak mobile signal can drop one request). null = still failed.
async function getJSON(url, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      // no internet for a moment: try again below
    }
    if (attempt >= tries) return null;
    await new Promise((done) => setTimeout(done, 1500 * attempt));
  }
}

// Load the shoes from the server, then build the home slider and the shop grid
getJSON("/api/products").then((list) => {
  PRODUCTS = Array.isArray(list) ? list : [];
  initFeatured();
  initShop();
  if (!Array.isArray(list)) {
    // could not load at all: say so plainly instead of showing an empty shop
    document.querySelectorAll("#shop-empty").forEach((el) => (el.hidden = true));
    document.querySelectorAll(".product-grid, .bs-track").forEach((el) => {
      el.innerHTML = `<p class="load-error">Could not load the shoes. Please check your internet and <a href="">refresh the page</a>.</p>`;
    });
  }
});

// Text changed in the admin panel replaces the default text on the page.
// *word* becomes the blue italic accent word, a new line becomes a line break.
function applyContent(content) {
  document.querySelectorAll("[data-edit]").forEach((el) => {
    const text = content && content[el.dataset.edit];
    if (typeof text !== "string" || !text.trim()) return;
    const tag = el.dataset.accent === "span" ? "span" : "em";
    el.innerHTML = esc(text)
      .replace(/\*([^*]+)\*/g, `<${tag}>$1</${tag}>`)
      .replace(/\n/g, "<br>");
  });
}
getJSON("/api/content").then(applyContent);
