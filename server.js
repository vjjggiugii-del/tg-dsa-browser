const express = require("express");
const puppeteer = require("puppeteer-core");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

let browser = null;
let page = null;
let busy = false;

function requireConfig(res) {
  if (!process.env.BROWSERLESS_WS_ENDPOINT) {
    res.status(503).json({
      error: "Browserless is not configured. Add BROWSERLESS_WS_ENDPOINT as a server secret."
    });
    return false;
  }
  return true;
}

async function ensurePage() {
  if (page && !page.isClosed()) return page;
  if (!browser || !browser.connected) {
    browser = await puppeteer.connect({
      browserWSEndpoint: process.env.BROWSERLESS_WS_ENDPOINT,
      defaultViewport: { width: 1365, height: 900 }
    });
    browser.on("disconnected", () => { browser = null; page = null; });
  }
  const pages = await browser.pages();
  page = pages[0] || await browser.newPage();
  await page.setViewport({ width: 1365, height: 900 });
  return page;
}

app.post("/api/open", async (req, res) => {
  if (!requireConfig(res)) return;
  if (busy) return res.status(429).json({ error: "Browser is busy. Try again shortly." });
  busy = true;
  try {
    const p = await ensurePage();
    await p.goto("https://telegram.org/dsa-report", {
      waitUntil: "domcontentloaded", timeout: 60000
    });
    res.json({ ok: true, url: p.url(), title: await p.title() });
  } catch (e) {
    res.status(502).json({ error: "Could not open the page. Check the Browserless endpoint and connection.", detail: e.message });
  } finally { busy = false; }
});

app.get("/api/screenshot", async (_req, res) => {
  try {
    if (!page || page.isClosed()) return res.status(404).end();
    const image = await page.screenshot({ type: "jpeg", quality: 72 });
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "no-store");
    res.send(image);
  } catch { res.status(503).end(); }
});

app.post("/api/click", async (req, res) => {
  try {
    if (!page || page.isClosed()) return res.status(400).json({ error: "Open the DSA page first." });
    const { x, y } = req.body || {};
    if (!Number.isFinite(x) || !Number.isFinite(y)) return res.status(400).json({ error: "Invalid coordinates." });
    await page.mouse.click(x, y);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/type", async (req, res) => {
  try {
    if (!page || page.isClosed()) return res.status(400).json({ error: "Open the DSA page first." });
    const value = String((req.body || {}).text || "").slice(0, 4000);
    await page.keyboard.type(value);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/key", async (req, res) => {
  try {
    if (!page || page.isClosed()) return res.status(400).json({ error: "Open the DSA page first." });
    const allowed = new Set(["Enter","Tab","Escape","Backspace","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"]);
    const key = String((req.body || {}).key || "");
    if (!allowed.has(key)) return res.status(400).json({ error: "Key not allowed." });
    await page.keyboard.press(key);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/scroll", async (req, res) => {
  try {
    if (!page || page.isClosed()) return res.status(400).json({ error: "Open the DSA page first." });
    const delta = Math.max(-1000, Math.min(1000, Number((req.body || {}).delta) || 0));
    await page.mouse.wheel({ deltaY: delta });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/close", async (_req, res) => {
  try {
    if (browser) await browser.disconnect();
    browser = null; page = null;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Tg DSA Browser listening on ${port}`));