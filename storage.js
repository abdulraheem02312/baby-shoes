// Where the shop's data lives.
//
// With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set (in the .env file), everything is saved in Supabase:
//   tables "products", "site_content", "admin_settings" and the public storage bucket "uploads".
//   Run supabase/setup.sql once in the Supabase SQL Editor to create them.
// Without them, data is kept in local files (data/*.json and assets/uploads/), handy for testing.
//
// Both stores have the same functions, so server.js does not care which one is used.
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const LOCAL_UPLOAD = /^\/assets\/uploads\/([a-z0-9-]+\.(?:webp|jpg|png))$/;
const FILE_NAME = /^[a-z0-9-]+\.(webp|jpg|png)$/;

/* ---------- Local files ---------- */

function fileStore(root) {
  const dataDir = path.join(root, "data");
  const uploadDir = path.join(root, "assets", "uploads");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const read = (name, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));
    } catch {
      return fallback;
    }
  };
  // Write to a temp file first, then swap it in, so a crash never leaves a half-written file
  let queue = Promise.resolve();
  const write = (name, value) => {
    queue = queue.then(async () => {
      const file = path.join(dataDir, name);
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
      await fsp.rename(tmp, file);
    });
    return queue;
  };

  return {
    name: "local files",
    async listProducts() {
      return read("products.json", []);
    },
    async createProduct(product) {
      const list = read("products.json", []);
      list.unshift(product); // newest shoe first
      await write("products.json", list);
    },
    async updateProduct(product) {
      const list = read("products.json", []).map((p) => (p.id === product.id ? product : p));
      await write("products.json", list);
    },
    async deleteProduct(id) {
      await write("products.json", read("products.json", []).filter((p) => p.id !== id));
    },
    async reorder(ids) {
      const byId = new Map(read("products.json", []).map((p) => [p.id, p]));
      await write("products.json", ids.map((id) => byId.get(id)));
    },
    async getContent() {
      return read("content.json", {});
    },
    async saveContent(content) {
      await write("content.json", content);
    },
    async getAdmin() {
      return read("admin.json", null);
    },
    async setAdmin(admin) {
      await write("admin.json", admin);
    },
    isUpload(ref) {
      return LOCAL_UPLOAD.test(ref || "");
    },
    async saveUpload(name, buffer) {
      await fsp.writeFile(path.join(uploadDir, name), buffer);
      return `/assets/uploads/${name}`;
    },
    async deleteUpload(ref) {
      const match = LOCAL_UPLOAD.exec(ref || "");
      if (match) await fsp.unlink(path.join(uploadDir, match[1])).catch(() => {});
    },
  };
}

/* ---------- Supabase (REST API, no packages needed) ---------- */

function supabaseStore(url, key, root) {
  const bucket = "uploads";
  const publicPrefix = `${url}/storage/v1/object/public/${bucket}/`;

  // New style keys (sb_secret_...) go in the apikey header only; old JWT keys also go in Authorization
  const authHeaders = { apikey: key };
  if (!key.startsWith("sb_")) authHeaders.Authorization = `Bearer ${key}`;

  async function call(pathAndQuery, { method = "GET", body, prefer, headers = {}, raw } = {}) {
    // Reads give up after 6 seconds and try once more (the connection to Supabase sometimes hangs).
    // Saves get longer and are never repeated, so nothing is saved twice.
    const tries = method === "GET" ? 2 : 1;
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetch(`${url}${pathAndQuery}`, {
          method,
          headers: {
            ...authHeaders,
            ...(raw ? {} : { "Content-Type": "application/json" }),
            ...(prefer ? { Prefer: prefer } : {}),
            ...headers,
          },
          body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(method === "GET" ? 6000 : 30000),
        });
        break;
      } catch (err) {
        if (attempt >= tries) throw err;
      }
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${pathAndQuery.split("?")[0]} failed (${res.status}): ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  // Newer columns (out_of_stock, sold_sizes) may not exist yet if their ALTER TABLE line from
  // supabase/setup.sql was not run. Then save the shoe without them instead of failing,
  // and remind once in the terminal.
  const OPTIONAL_COLUMNS = ["out_of_stock", "sold_sizes"];
  const warned = new Set();
  const rest = async (pathAndQuery, options = {}) => {
    let body = options.body;
    for (;;) {
      try {
        return await call(`/rest/v1/${pathAndQuery}`, { ...options, body });
      } catch (err) {
        const missing = OPTIONAL_COLUMNS.find((c) => err.message.includes(c) && body && !Array.isArray(body) && c in body);
        if (!missing) throw err;
        if (!warned.has(missing)) {
          warned.add(missing);
          console.error(`Supabase has no "${missing}" column yet. Run its ALTER TABLE line from supabase/setup.sql.`);
        }
        const { [missing]: _skip, ...others } = body;
        body = others;
      }
    }
  };

  // Last good copy of the shoes and the website text. Pages use it for 30 seconds before asking
  // Supabase again, and if Supabase is slow or unreachable, visitors get this copy instead of an
  // empty shop. It is also saved in data/supabase-cache.json, so it survives a server restart.
  const cacheFile = path.join(root, "data", "supabase-cache.json");
  const FRESH_MS = 30000;
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {
    // no saved copy yet
  }
  const fetchedAt = {};
  const loading = {};
  let cacheWrite = Promise.resolve();
  const saveCache = () => {
    cacheWrite = cacheWrite
      .then(async () => {
        const tmp = `${cacheFile}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(cache));
        await fsp.rename(tmp, cacheFile);
      })
      .catch((err) => console.error("Could not save data/supabase-cache.json:", err.message));
  };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const edited = new Set(); // changed in the admin panel since the last read
  const editCount = {};
  function refresh(name, load) {
    // many visitors at once share one request to Supabase
    loading[name] ||= (async () => {
      const startedAt = editCount[name];
      try {
        cache[name] = await load();
        fetchedAt[name] = Date.now();
        if (editCount[name] === startedAt) edited.delete(name); // a save during this read needs another read
        saveCache();
      } catch (err) {
        if (!(name in cache)) throw err;
        console.error(`Supabase did not answer (${(err.cause && err.cause.code) || err.name}). Showing the saved copy of the ${name}.`);
        fetchedAt[name] = Date.now() - FRESH_MS + 10000; // try Supabase again in 10 seconds
      } finally {
        delete loading[name];
      }
      return cache[name];
    })();
    return loading[name];
  }
  function cachedRead(name, load) {
    if (!(name in cache) || edited.has(name)) return refresh(name, load).then(copy); // must wait for Supabase
    // otherwise answer straight away with the saved copy, and fetch a newer one in the background if it is old
    if (Date.now() - (fetchedAt[name] || 0) >= FRESH_MS) refresh(name, load).catch(() => {});
    return Promise.resolve(copy(cache[name]));
  }
  // after a change, the next read waits for the new data from Supabase
  const changed = (name) => {
    edited.add(name);
    editCount[name] = (editCount[name] || 0) + 1;
  };

  // Database columns use snake_case, the website uses camelCase
  const toRow = (p) => ({
    id: p.id,
    name: p.name,
    cat: p.cat,
    price: p.price,
    old: p.old,
    baby_price: p.babyPrice,
    img: p.img,
    baby_img: p.babyImg,
    best: p.best,
    hidden: p.hidden,
    out_of_stock: p.outOfStock,
    sold_sizes: p.soldSizes,
  });
  const fromRow = (r) => ({
    id: r.id,
    name: r.name,
    cat: r.cat,
    price: r.price,
    old: r.old,
    babyPrice: r.baby_price,
    img: r.img,
    babyImg: r.baby_img,
    best: r.best,
    hidden: r.hidden,
    outOfStock: Boolean(r.out_of_stock),
    soldSizes: Array.isArray(r.sold_sizes) ? r.sold_sizes : [],
  });

  return {
    name: "Supabase",
    async listProducts() {
      return cachedRead("products", async () => {
        const rows = await rest("products?select=*&order=position.asc,created_at.desc");
        return rows.map(fromRow);
      });
    },
    async createProduct(product) {
      changed("products");
      // newest shoe first: one position above the current first shoe
      const first = await rest("products?select=position&order=position.asc&limit=1");
      const position = first.length ? first[0].position - 1 : 0;
      await rest("products", { method: "POST", body: { ...toRow(product), position }, prefer: "return=minimal" });
    },
    async updateProduct(product) {
      changed("products");
      await rest(`products?id=eq.${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        body: toRow(product),
        prefer: "return=minimal",
      });
    },
    async deleteProduct(id) {
      changed("products");
      await rest(`products?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" });
    },
    async reorder(ids) {
      changed("products");
      await Promise.all(
        ids.map((id, position) =>
          rest(`products?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: { position }, prefer: "return=minimal" })
        )
      );
    },
    async getContent() {
      return cachedRead("content", async () => {
        const rows = await rest("site_content?select=key,value");
        return Object.fromEntries(rows.map((r) => [r.key, r.value]));
      });
    },
    async saveContent(content) {
      changed("content");
      const rows = Object.entries(content).map(([k, value]) => ({ key: k, value }));
      if (rows.length) {
        await rest("site_content", { method: "POST", body: rows, prefer: "resolution=merge-duplicates,return=minimal" });
      }
    },
    async getAdmin() {
      const rows = await rest("admin_settings?id=eq.1&select=salt,hash");
      return rows[0] || null;
    },
    async setAdmin(admin) {
      await rest("admin_settings", {
        method: "POST",
        body: { id: 1, salt: admin.salt, hash: admin.hash, updated_at: new Date().toISOString() },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    },
    isUpload(ref) {
      return typeof ref === "string" && ref.startsWith(publicPrefix) && FILE_NAME.test(ref.slice(publicPrefix.length));
    },
    async saveUpload(name, buffer, type) {
      await call(`/storage/v1/object/${bucket}/${name}`, {
        method: "POST",
        body: buffer,
        raw: true,
        headers: { "Content-Type": type, "x-upsert": "false", "cache-control": "604800" },
      });
      return publicPrefix + name;
    },
    async deleteUpload(ref) {
      if (!this.isUpload(ref)) return;
      await call(`/storage/v1/object/${bucket}`, {
        method: "DELETE",
        body: { prefixes: [ref.slice(publicPrefix.length)] },
      }).catch((err) => console.error(err.message));
    },
  };
}

/* ---------- Pick the store and move local data across the first time ---------- */

function createStore(root) {
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return url && key ? supabaseStore(url, key, root) : fileStore(root);
}

// When Supabase is connected for the first time, copy the shoes, text, password and photos
// that were saved in local files, so nothing is lost. Only runs into empty tables.
async function copyLocalDataTo(store, root) {
  if (store.name !== "Supabase") return;
  const local = fileStore(root);
  const report = [];

  if ((await store.listProducts()).length === 0) {
    const products = await local.listProducts();
    for (const p of products.slice().reverse()) {
      // re-upload photos that only exist on this computer
      for (const field of ["img", "babyImg"]) {
        const match = LOCAL_UPLOAD.exec(p[field] || "");
        if (match) {
          const buffer = await fsp.readFile(path.join(root, "assets", "uploads", match[1])).catch(() => null);
          const type = { webp: "image/webp", jpg: "image/jpeg", png: "image/png" }[match[1].split(".").pop()];
          p[field] = buffer ? await store.saveUpload(match[1], buffer, type) : null;
        }
      }
      await store.createProduct(p);
    }
    if (products.length) report.push(`${products.length} shoes`);
  }

  if (Object.keys(await store.getContent()).length === 0) {
    const content = await local.getContent();
    if (Object.keys(content).length) {
      await store.saveContent(content);
      report.push("website text");
    }
  }

  if (!(await store.getAdmin())) {
    const admin = await local.getAdmin();
    if (admin) {
      await store.setAdmin(admin);
      report.push("admin password");
    }
  }

  if (report.length) console.log(`Copied local ${report.join(", ")} to Supabase.`);
}

module.exports = { createStore, copyLocalDataTo };
