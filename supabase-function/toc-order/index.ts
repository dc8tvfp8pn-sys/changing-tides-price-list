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
    `<tr><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#f2f6fb">${i.qty} &times; ${esc(i.name)}${i.size ? ` <span style="color:#c4d2e4">${esc(i.size)}</span>` : ""}</td><td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#01c88a;text-align:right">${money(i.qty * i.price)}</td></tr>`
  ).join("");
  const LOGO = "https://dc8tvfp8pn-sys.github.io/changing-tides-price-list/assets/icon-512-v9.png";
  const PAY_EMAIL = (Deno.env.get("TOC_ETRANSFER_EMAIL") || "").trim();
  const payBox = (forCustomer: boolean) => `
<tr><td style="padding:16px 24px 0 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0e1a30" style="background:#0e1a30;border:1px solid #1c2c48;border-left:4px solid #ff9500;border-radius:12px">
<tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;color:#f2f6fb;font-size:14px;line-height:1.55">
<div style="font-weight:700;color:#ff9500;font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Payment &middot; Interac e-Transfer</div>
${forCustomer
  ? `<div style="color:#c4d2e4">Please don&rsquo;t send payment yet. Once we confirm your order${express ? " and the express mail fee" : ""}, send your Interac e-Transfer for the final total${PAY_EMAIL ? ` to <strong style="color:#f2f6fb">${esc(PAY_EMAIL)}</strong>` : ""}.<br>Put your order number <strong style="color:#f2f6fb">${ref}</strong> in the e-Transfer message.</div>`
  : `<div style="color:#c4d2e4">Customer pays by Interac e-Transfer after you confirm${PAY_EMAIL ? ` (to ${esc(PAY_EMAIL)})` : ""}, quoting ${ref}.</div>`}
</td></tr></table></td></tr>`;
  const wrap = (title: string, intro: string, extra: string, forCustomer: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark only"><meta name="supported-color-schemes" content="dark">
<style>:root{color-scheme:dark only} body{background-color:#060e1c}</style></head>
<body bgcolor="#060e1c" style="margin:0;padding:0;background:#060e1c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#060e1c" style="background:#060e1c"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a1424" style="max-width:560px;background:#0a1424;border:1px solid #1c2c48;border-radius:16px;overflow:hidden">
<tr><td align="center" style="padding:26px 24px 10px 24px">
<img src="${LOGO}" width="64" height="64" alt="Tides of Change" style="display:block;border:0;border-radius:14px">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;letter-spacing:.14em;color:#f2f6fb;margin-top:12px">TIDES OF CHANGE</div>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#01c88a;margin-top:4px">Research Supplement Price List</div>
</td></tr>
<tr><td style="padding:8px 0 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td height="5" bgcolor="#22c7e6" style="background:#22c7e6;font-size:0;line-height:0">&nbsp;</td>
<td height="5" bgcolor="#01c88a" style="background:#01c88a;font-size:0;line-height:0">&nbsp;</td>
<td height="5" bgcolor="#0b9bdc" style="background:#0b9bdc;font-size:0;line-height:0">&nbsp;</td>
<td height="5" bgcolor="#ff9500" style="background:#ff9500;font-size:0;line-height:0">&nbsp;</td>
</tr></table></td></tr>
<tr><td style="padding:22px 24px 0 24px;font-family:Arial,Helvetica,sans-serif">
<div style="font-size:20px;font-weight:700;color:#f2f6fb;line-height:1.3">${title}</div>
<div style="font-size:15px;color:#c4d2e4;line-height:1.55;margin-top:8px">${intro}</div>
</td></tr>
<tr><td style="padding:16px 24px 0 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0e1a30" style="background:#0e1a30;border:1px solid #1c2c48;border-radius:12px">
<tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
<div style="font-size:12px;color:#22c7e6;letter-spacing:.06em">ORDER ${ref}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">${rows}</table>
<div style="border-top:1px solid #1c2c48;margin-top:8px;padding-top:10px;font-size:15px;font-weight:700;color:#f2f6fb">Estimated total: <span style="color:#01c88a">${money(total)} CAD</span>${express ? " + express mail fee" : ""}</div>
<div style="font-size:12px;color:#c4d2e4;margin-top:4px">Final total confirmed by our team before payment.</div>
</td></tr></table></td></tr>
${payBox(forCustomer)}
${extra}
<tr><td style="padding:20px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8ea2bf;line-height:1.5">
For research purposes only. Questions? Reply to this email or write to <a href="mailto:orders@tidesofchange.ca" style="color:#22c7e6">orders@tidesofchange.ca</a>.
</td></tr>
</table></td></tr></table></body></html>`;

  const ownerHtml = wrap(`New order from ${esc(name)}`, "Reply to this email to answer the customer directly.",
    `<tr><td style="padding:16px 24px 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#c4d2e4">
<strong style="color:#f2f6fb">Phone:</strong> ${esc(phone || "—")}<br><strong style="color:#f2f6fb">Email:</strong> ${esc(email || "—")}<br>
<strong style="color:#f2f6fb">Delivery:</strong> ${esc(method)}<br><strong style="color:#f2f6fb">Address:</strong> ${esc(address)}${notes ? `<br><strong style="color:#f2f6fb">Notes:</strong> ${esc(notes)}` : ""}</td></tr>`, false);

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
      text_body: `Thanks ${name}, we received your order request.\n\n${lines.join("\n")}\n\n${totalLine}\n\nPayment: Interac e-Transfer. Please don't send payment yet. Once we confirm your order${express ? " and the express mail fee" : ""}, send your e-Transfer for the final total${PAY_EMAIL ? " to " + PAY_EMAIL : ""} and put ${ref} in the message.\n\nTides of Change — research purposes only.`,
      html_body: wrap(`Thanks, ${esc(name)} — we got your order`,
        `We'll reply to confirm your order${express ? " and the express mail fee" : ""}. Here&rsquo;s what you asked for:`,
        `<tr><td style="padding:16px 24px 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#c4d2e4"><strong style="color:#f2f6fb">Delivery:</strong> ${esc(method)}<br><strong style="color:#f2f6fb">Address:</strong> ${esc(address)}</td></tr>`, true),
      custom_headers: [{ header: "Reply-To", value: ORDER_TO }],
    });
  }

  return json(200, { ok: true, ref, customerCopy });
});
