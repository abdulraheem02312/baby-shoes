// Baby Shoes server
// - serves the website with clean URLs (/shop serves shop/index.html, no .html in links)
// - JSON API for products and site text, read by the website
// - password protected admin API used by the admin panel at /admin
// - data is saved in Supabase when .env has the Supabase keys, otherwise in local files (see storage.js)
// No packages needed: only Node's built-in modules.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// Connect to Supabase over IPv4 first: on some home internet the IPv6 route hangs
require("dns").setDefaultResultOrder("ipv4first");

const ROOT = __dirname;

// Read settings from the .env file (KEY=value lines). Real environment variables win.
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
    }
  }
} catch {
  // no .env file: use local files
}

const { createStore, copyLocalDataTo } = require("./storage");
const store = createStore(ROOT);
const PORT = process.env.PORT || 3000;

// Only these folders are public. Everything else (data/, server.js, CLAUDE.md...) is never served.
const PUBLIC_DIRS = new Set(["assets", "shop", "about", "contact", "size-chart", "admin"]);
const CATEGORIES = ["heels", "flats", "sandals", "sneakers"];
const SIZES = [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45];
const SESSION_DAYS = 7;
const MAX_JSON = 200 * 1024; // 200 KB
const MAX_IMAGE = 8 * 1024 * 1024; // 8 MB

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/* ---------- Passwords and login sessions ---------- */

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

async function checkPassword(password) {
  const admin = await store.getAdmin();
  if (!admin) return false;
  const { hash } = hashPassword(password, admin.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(admin.hash, "hex"));
}

const sessions = new Map(); // token -> expiry time

function newSession(res, req) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_DAYS * 864e5);
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `rr_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
}

function sessionToken(req) {
  const match = /(?:^|;\s*)rr_session=([a-f0-9]{64})/.exec(req.headers.cookie || "");
  return match ? match[1] : null;
}

function isLoggedIn(req) {
  const token = sessionToken(req);
  const expiry = token && sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Slow down password guessing: 5 wrong tries per 15 minutes per IP
const failedLogins = new Map();
function tooManyTries(ip) {
  const entry = failedLogins.get(ip);
  return entry && entry.count >= 5 && Date.now() - entry.first < 15 * 60e3;
}
function noteFailedLogin(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.first > 15 * 60e3) failedLogins.set(ip, { count: 1, first: Date.now() });
  else entry.count++;
}

/* ---------- Helpers ---------- */

function sendJSON(res, status, body) {
  res.writeHead(status, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "That file is too big."));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJSONBody(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json")) {
    throw new HttpError(415, "Expected JSON.");
  }
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString("utf8") || "{}");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Could not read the request.");
  }
}

// Photos may be the site's own images, local uploads, or photos in the Supabase bucket
const IMAGE_PATH = /^\/assets\/(uploads|images)\/[a-z0-9-]+\.(webp|jpg|jpeg|png)$/;
const isAllowedImage = (ref) => IMAGE_PATH.test(ref) || store.isUpload(ref);

function toPrice(value) {
  const n = Math.round(Number(String(value ?? "").replace(/[^0-9.]/g, "")));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? n : null;
}

// Checks and cleans a product coming from the admin panel
function cleanProduct(input, existing = {}) {
  const pick = (key) => (key in input ? input[key] : existing[key]);

  const name = String(pick("name") || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw new HttpError(400, "Please enter the shoe name.");

  const cat = pick("cat");
  if (!CATEGORIES.includes(cat)) throw new HttpError(400, "Please choose a category.");

  const price = toPrice(pick("price"));
  if (!price) throw new HttpError(400, "Please enter a price.");

  const rawOld = pick("old");
  const old = rawOld === null || rawOld === "" || rawOld === undefined ? null : toPrice(rawOld);
  if (rawOld && !old) throw new HttpError(400, "The old price is not a valid number.");
  if (old && old <= price) throw new HttpError(400, "The old price must be higher than the new price.");

  const rawBaby = pick("babyPrice");
  const babyPrice = rawBaby === null || rawBaby === "" || rawBaby === undefined ? null : toPrice(rawBaby);
  if (rawBaby && !babyPrice) throw new HttpError(400, "The baby price is not a valid number.");

  const img = pick("img");
  const babyImg = pick("babyImg");
  if (img && !isAllowedImage(img)) throw new HttpError(400, "That photo could not be used.");
  if (babyImg && !isAllowedImage(babyImg)) throw new HttpError(400, "That baby photo could not be used.");

  return {
    id: existing.id || crypto.randomBytes(6).toString("hex"),
    name,
    cat,
    price,
    old: old || null,
    babyPrice: babyPrice || null,
    img: img || null,
    babyImg: babyImg || null,
    best: Boolean(pick("best")),
    hidden: Boolean(pick("hidden")),
    outOfStock: Boolean(pick("outOfStock")),
    // sizes that are not available right now (hidden on the website)
    soldSizes: [...new Set((Array.isArray(pick("soldSizes")) ? pick("soldSizes") : []).map(Number))]
      .filter((n) => SIZES.includes(n))
      .sort((a, b) => a - b),
  };
}

// Removes an uploaded photo once no product uses it any more
async function removeUnusedUpload(imgPath, products) {
  if (!imgPath || !store.isUpload(imgPath)) return;
  const stillUsed = products.some((p) => p.img === imgPath || p.babyImg === imgPath);
  if (!stillUsed) await store.deleteUpload(imgPath);
}

// Editable site text: only known keys, plain text (the website escapes it before showing it)
const CONTENT_KEYS = [
  "site.topbar",
  "home.heroLabel", "home.heroTitle", "home.heroText",
  "home.stylesTitle", "home.stylesText",
  "home.bestTitle", "home.bestText",
  "home.ctaTitle", "home.ctaText",
  "about.title", "about.text", "about.storyTitle", "about.story1", "about.story2", "about.story3",
  "contact.title", "contact.text",
];

/* ---------- API ---------- */

async function handleApi(req, res, urlPath) {
  const method = req.method;
  const ip = req.socket.remoteAddress || "unknown";

  // Public: what the website needs
  if (method === "GET" && urlPath === "/api/products") {
    const all = await store.listProducts();
    const wantsAll = isLoggedIn(req) && /[?&]all=1/.test(req.url);
    return sendJSON(res, 200, wantsAll ? all : all.filter((p) => !p.hidden));
  }
  if (method === "GET" && urlPath === "/api/content") return sendJSON(res, 200, await store.getContent());

  // Admin: status, first time password, login, logout
  if (method === "GET" && urlPath === "/api/admin/status") {
    const loggedIn = isLoggedIn(req);
    return sendJSON(res, 200, {
      hasPassword: Boolean(await store.getAdmin()),
      loggedIn,
      ...(loggedIn ? { storage: store.name } : {}),
    });
  }
  if (method === "POST" && urlPath === "/api/admin/setup") {
    if (await store.getAdmin()) throw new HttpError(403, "A password is already set. Please log in.");
    const { password } = await readJSONBody(req);
    if (typeof password !== "string" || password.length < 8) {
      throw new HttpError(400, "The password must be at least 8 characters.");
    }
    await store.setAdmin(hashPassword(password));
    newSession(res, req);
    return sendJSON(res, 200, { ok: true });
  }
  if (method === "POST" && urlPath === "/api/admin/login") {
    if (tooManyTries(ip)) throw new HttpError(429, "Too many wrong tries. Please wait 15 minutes.");
    const { password } = await readJSONBody(req);
    if (typeof password !== "string" || !(await checkPassword(password))) {
      noteFailedLogin(ip);
      throw new HttpError(401, "Wrong password.");
    }
    failedLogins.delete(ip);
    newSession(res, req);
    return sendJSON(res, 200, { ok: true });
  }
  if (method === "POST" && urlPath === "/api/admin/logout") {
    const token = sessionToken(req);
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "rr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return sendJSON(res, 200, { ok: true });
  }

  // Everything below needs a logged in admin
  if (urlPath.startsWith("/api/admin/") && !isLoggedIn(req)) throw new HttpError(401, "Please log in again.");

  if (method === "POST" && urlPath === "/api/admin/password") {
    const { current, next } = await readJSONBody(req);
    if (typeof current !== "string" || !(await checkPassword(current))) throw new HttpError(400, "The current password is wrong.");
    if (typeof next !== "string" || next.length < 8) throw new HttpError(400, "The new password must be at least 8 characters.");
    await store.setAdmin(hashPassword(next));
    return sendJSON(res, 200, { ok: true });
  }

  if (method === "POST" && urlPath === "/api/admin/products") {
    const product = cleanProduct(await readJSONBody(req));
    await store.createProduct(product); // newest shoe first
    return sendJSON(res, 201, product);
  }

  if (method === "POST" && urlPath === "/api/admin/products/reorder") {
    const { ids } = await readJSONBody(req);
    const products = await store.listProducts();
    const known = new Set(products.map((p) => p.id));
    if (!Array.isArray(ids) || ids.length !== products.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      throw new HttpError(400, "Could not change the order. Please refresh the page.");
    }
    await store.reorder(ids);
    return sendJSON(res, 200, { ok: true });
  }

  const productMatch = /^\/api\/admin\/products\/([a-f0-9]{6,24})$/.exec(urlPath);
  if (productMatch && (method === "PUT" || method === "DELETE")) {
    const products = await store.listProducts();
    const index = products.findIndex((p) => p.id === productMatch[1]);
    if (index < 0) throw new HttpError(404, "That shoe was not found. Please refresh the page.");
    const before = products[index];

    if (method === "DELETE") {
      products.splice(index, 1);
      await store.deleteProduct(before.id);
    } else {
      products[index] = cleanProduct(await readJSONBody(req), before);
      await store.updateProduct(products[index]);
    }
    await removeUnusedUpload(before.img, products);
    await removeUnusedUpload(before.babyImg, products);
    return sendJSON(res, 200, method === "DELETE" ? { ok: true } : products[index]);
  }

  if (method === "POST" && urlPath === "/api/admin/upload") {
    const body = await readBody(req, MAX_IMAGE);
    // Trust the file's first bytes, not its name
    let ext = null;
    if (body.length > 12) {
      if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) ext = "jpg";
      else if (body.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = "png";
      else if (body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP") ext = "webp";
    }
    if (!ext) throw new HttpError(400, "Please upload a JPG, PNG or WEBP photo.");
    const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
    const type = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext];
    return sendJSON(res, 201, { path: await store.saveUpload(name, body, type) });
  }

  if (method === "PUT" && urlPath === "/api/admin/content") {
    const input = await readJSONBody(req);
    const changes = {};
    for (const key of CONTENT_KEYS) {
      if (typeof input[key] === "string") changes[key] = input[key].trim().slice(0, 600);
    }
    await store.saveContent({ ...(await store.getContent()), ...changes });
    return sendJSON(res, 200, await store.getContent());
  }

  throw new HttpError(404, "Not found.");
}

/* ---------- Website files ---------- */

function serveStatic(req, res, urlPath) {
  // Redirect /page.html to /page so .html never shows in the address bar
  if (urlPath.endsWith(".html")) {
    const clean = urlPath.replace(/(index)?\.html$/, "").replace(/\/$/, "") || "/";
    res.writeHead(301, { Location: clean });
    return res.end();
  }

  const parts = urlPath.split("/").filter(Boolean);
  const blocked =
    parts.some((p) => p.startsWith(".")) || (parts.length > 0 && !PUBLIC_DIRS.has(parts[0]));
  let file = path.normalize(path.join(ROOT, urlPath));
  if (blocked || (!file.startsWith(ROOT + path.sep) && file !== ROOT)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Page not found");
  }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Page not found");
    }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": file.includes(`${path.sep}uploads${path.sep}`) ? "public, max-age=604800" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split("?")[0]);
    } catch {
      res.writeHead(400);
      return res.end("Bad request");
    }

    if (urlPath.startsWith("/api/")) {
      try {
        await handleApi(req, res, urlPath);
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        if (status === 500) console.error(err);
        if (!res.headersSent) sendJSON(res, status, { error: status === 500 ? "Something went wrong. Please try again." : err.message });
      }
      return;
    }
    serveStatic(req, res, urlPath);
});

// Start: when Supabase is connected, check it works and copy local data across the first time
copyLocalDataTo(store, ROOT)
  .catch((err) => {
    console.error("\nCould not use Supabase. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env,");
    console.error("and that supabase/setup.sql was run in the Supabase SQL Editor.\n" + err.message + "\n");
  })
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Data is saved in: ${store.name}`);
      console.log(`Site running at http://localhost:${PORT}`);
      console.log(`Admin panel at  http://localhost:${PORT}/admin`);
    });
  });
