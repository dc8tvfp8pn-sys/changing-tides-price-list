// Tides of Change — one-tap order sender.
// Public endpoint (an order form is public by nature). Protections: strict validation,
// size limits, honeypot field, simple per-IP rate limit. Sends through SMTP2GO.
// Secret required: TOC_SMTP2GO_API_KEY (set by the owner in Supabase → Edge Functions → Secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ORDER_TO = "orders@tidesofchange.ca";
const SENDER = "Tides of Change Orders <orders@tidesofchange.ca>";
const METHODS = ["Delivery (Edmonton area only)", "Express mail (extra fee)"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Max-Age": "86400",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 5; // max 5 orders per 10 minutes per IP
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => "$" + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function send(apiKey: string, msg: Record<string, unknown>) {
  const r = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": apiKey, accept: "application/json" },
    body: JSON.stringify({ sender: SENDER, ...msg }),
  });
  const j = await r.json().catch(() => ({}));
  const ok = r.ok && j?.data?.succeeded >= 1;
  if (!ok) console.error("smtp2go failed", r.status, JSON.stringify(j?.data ?? j).slice(0, 400));
  return ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });

  const apiKey = Deno.env.get("TOC_SMTP2GO_API_KEY");
  if (!apiKey) return json(503, { ok: false, error: "not_configured" });

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return json(429, { ok: false, error: "rate_limited" });

  let b: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 20_000) return json(413, { ok: false, error: "too_large" });
    b = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "bad_json" });
  }

  if (str(b.website, 200)) return json(200, { ok: true }); // honeypot: silently drop bots

  const name = str(b.name, 100);
  const phone = str(b.phone, 40);
  const email = str(b.email, 200);
  const method = str(b.method, 60);
  const address = str(b.address, 400);
  const notes = str(b.notes, 1000);
  const ack = b.ack === true;
  const items = Array.isArray(b.items) ? b.items.slice(0, 80) : [];

  const clean = items
    .map((i: any) => ({
      name: str(i?.name, 80),
      size: str(i?.size, 40),
      qty: Math.max(0, Math.min(99, Math.floor(Number(i?.qty) || 0))),
      price: Math.max(0, Math.min(100000, Number(i?.price) || 0)),
    }))
    .filter((i) => i.name && i.qty > 0);

  if (!name) return json(400, { ok: false, error: "name" });
  if (!phone && !email) return json(400, { ok: false, error: "contact" });
  if (email && !emailOk(email)) return json(400, { ok: false, error: "email" });
  if (!METHODS.includes(method)) return json(400, { ok: false, error: "method_choice" });
  if (!address) return json(400, { ok: false, error: "address" });
  if (!ack) return json(400, { ok: false, error: "ack" });
  if (!clean.length) return json(400, { ok: false, error: "items" });

  const total = clean.reduce((s, i) => s + i.qty * i.price, 0);
  const express = method === METHODS[1];
  const ref = "TOC-" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" +
    Math.random().toString(36).slice(2, 6).toUpperCase();

  const lines = clean.map((i) => `• ${i.qty} × ${i.name}${i.size ? " " + i.size : ""} @ ${money(i.price)} = ${money(i.qty * i.price)}`);
  const totalLine = `Estimated total: ${money(total)} CAD${express ? " + express mail fee" : ""} (final total confirmed before payment)`;

  const ownerText = [
    `NEW ORDER ${ref} — Tides of Change`, "",
    `Name: ${name}`, `Phone: ${phone || "—"}`, `Email: ${email || "—"}`,
    `Delivery method: ${method}`, `Delivery address: ${address.replace(/\s*\n\s*/g, ", ")}`,
    "", "Items:", ...lines, "", totalLine, "",
    "Payment: Interac e-Transfer after confirmation.", "Customer confirmed: research purposes only.",
    ...(notes ? ["", "Notes:", notes] : []),
  ].join("\n");

  const rows = clean.map((i) =>
    `<tr><td style="padding:6px 0">${i.qty} × ${esc(i.name)}${i.size ? " " + esc(i.size) : ""}</td><td style="padding:6px 0;text-align:right">${money(i.qty * i.price)}</td></tr>`
  ).join("");
  const wrap = (title: string, intro: string, extra: string) => `<!doctype html><html><body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#e6edf6">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="font-size:20px;font-weight:700;letter-spacing:.08em;color:#2ee6c5">TIDES OF CHANGE</div>
<h1 style="font-size:20px;margin:16px 0 8px">${title}</h1><p style="margin:0 0 16px;color:#b8c4d6">${intro}</p>
<div style="background:#111b2e;border:1px solid #1f2d47;border-radius:12px;padding:16px">
<div style="font-size:12px;color:#8aa0bd">Order ${ref}</div>
<table style="width:100%;border-collapse:collapse;margin-top:8px;color:#e6edf6">${rows}</table>
<div style="border-top:1px solid #1f2d47;margin-top:8px;padding-top:8px;font-weight:700">${esc(totalLine)}</div>
</div>${extra}
<p style="margin-top:20px;font-size:12px;color:#8aa0bd">For research purposes only. Payment by Interac e-Transfer after we confirm your order.</p>
</div></body></html>`;

  const ownerHtml = wrap(`New order from ${esc(name)}`, "Reply to this email to answer the customer directly.",
    `<div style="margin-top:16px;line-height:1.6;color:#b8c4d6">Phone: ${esc(phone || "—")}<br>Email: ${esc(email || "—")}<br>Delivery: ${esc(method)}<br>Address: ${esc(address)}${notes ? "<br>Notes: " + esc(notes) : ""}</div>`);

  const sentOwner = await send(apiKey, {
    to: [ORDER_TO],
    subject: `Order ${ref} — ${name}`,
    text_body: ownerText,
    html_body: ownerHtml,
    ...(email ? { custom_headers: [{ header: "Reply-To", value: email }] } : {}),
  });
  if (!sentOwner) return json(502, { ok: false, error: "send_failed" });

  let customerCopy = false;
  if (email) {
    customerCopy = await send(apiKey, {
      to: [email],
      subject: `We got your order ${ref} — Tides of Change`,
      text_body: `Thanks ${name}, we received your order request.\n\n${lines.join("\n")}\n\n${totalLine}\n\nWe'll reply to confirm your order${express ? ", the express mail fee" : ""} and send Interac e-Transfer details.\n\nTides of Change — research purposes only.`,
      html_body: wrap(`Thanks, ${esc(name)} — we got your order`,
        `We'll reply to confirm your order${express ? ", the express mail fee" : ""} and send Interac e-Transfer details.`, ""),
      custom_headers: [{ header: "Reply-To", value: ORDER_TO }],
    });
  }

  return json(200, { ok: true, ref, customerCopy });
});
