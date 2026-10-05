// Tides of Change — order sender + owner "confirm & request payment".
// Public endpoint (an order form is public by nature). Protections: strict validation,
// size limits, honeypot, per-IP rate limit, and HMAC-signed confirm links.
// Secret required: TOC_SMTP2GO_API_KEY. Optional: TOC_ETRANSFER_EMAIL, TOC_CONFIRM_URL.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ORDER_TO = "orders@tidesofchange.ca";
const SENDER = "Tides of Change Orders <orders@tidesofchange.ca>";
const METHODS = ["In-person delivery (Edmonton area)", "Express mail (Canada Post rate)"];
const LOGO = "https://tidesofchange.ca/assets/icon-512-v9.png";
// Email art. Mail apps (iPhone Mail, Outlook) repaint text/background COLOURS
// in light mode, turning the navy design grey. They do not repaint IMAGES, so
// the header is one picture and every navy surface is also painted with a
// tiny navy image behind the normal colour.
const EMAIL_ART = (Deno.env.get("TOC_EMAIL_ART") || "https://tidesofchange.ca/assets/email/").trim();
const BG_DEEP = `${EMAIL_ART}navy-deep.png`, BG_CARD = `${EMAIL_ART}navy.png`, BG_PANEL = `${EMAIL_ART}panel.png`;
const HEADER_IMG = `${EMAIL_ART}header-v2.png`;
const CONFIRM_URL = (Deno.env.get("TOC_CONFIRM_URL") || "https://tidesofchange.ca/confirm.html").trim();
// Edmonton delivery pricing. FREE_OVER = items subtotal at/above which delivery + fuel are free (null = never).
const DELIVERY_FEE = 20, FUEL_FEE = 0; // $20 in-person delivery includes the Rising Tide fuel surcharge
const FREE_OVER: number | null = 200; // free when items subtotal is $200 or more
const FUEL_NAME = "Rising Tide fuel surcharge";
const FUEL_NOTE = "In-person delivery includes our Rising Tide fuel surcharge. Fuel prices are running high, and this keeps delivery running until the tide goes out.";
function localFees(subtotal: number) {
  const free = FREE_OVER != null && subtotal >= FREE_OVER;
  return { delivery: free ? 0 : DELIVERY_FEE, fuel: free ? 0 : FUEL_FEE, free };
}
// Welcome bonus (owner rules, 5 Oct 2026): 10% off the ITEMS (not delivery or
// postage) of a person's FIRST order placed from the Changing Tides app while
// signed in. No minimum, no end date. One use per account/email, tracked
// server-side in public.welcome_bonus_uses. Free-delivery threshold is checked
// against the items subtotal BEFORE the bonus.
const BONUS_PCT = 10;
const BONUS_LABEL = `Welcome bonus (${BONUS_PCT}% off items)`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = SB_URL && SB_SERVICE ? createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } }) : null;
type BonusUser = { id: string; email: string };
async function bonusUser(req: Request): Promise<BonusUser | null> {
  if (!admin) return null;
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!tok || tok.split(".").length !== 3) return null; // anon/publishable keys are not user sessions
  try {
    const { data } = await admin.auth.getUser(tok);
    const u = data?.user;
    if (!u?.id || !u.email || !u.email_confirmed_at) return null;
    return { id: u.id, email: u.email.toLowerCase() };
  } catch { return null; }
}
async function bonusEligible(u: BonusUser | null): Promise<boolean> {
  if (!u || !admin) return false;
  const [a, b] = await Promise.all([
    admin.from("welcome_bonus_uses").select("user_id").eq("user_id", u.id).limit(1),
    admin.from("welcome_bonus_uses").select("user_id").eq("email", u.email).limit(1),
  ]);
  return !a.error && !b.error && !a.data?.length && !b.data?.length;
}
async function claimBonus(u: BonusUser, ref: string, amount: number): Promise<boolean> {
  if (!admin) return false;
  const { error } = await admin.from("welcome_bonus_uses").insert({ user_id: u.id, email: u.email, order_ref: ref, discount: amount });
  return !error; // unique user_id/email: a second claim fails
}
async function releaseBonus(u: BonusUser, ref: string) {
  if (admin) await admin.from("welcome_bonus_uses").delete().eq("user_id", u.id).eq("order_ref", ref);
}

const PAY_EMAIL_DEFAULT = (Deno.env.get("TOC_ETRANSFER_EMAIL") || "payments@tidesofchange.ca").trim(); // owner-set e-Transfer address

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Max-Age": "86400",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const hits = new Map<string, number[]>();
function limited(ip: string, max: number) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > max;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => "$" + (Math.round(n * 100) / 100).toFixed(Math.round(n * 100) % 100 ? 2 : 0);
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// ---------- signed confirm token ----------
const enc = new TextEncoder();
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDecode = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret + ":toc-confirm-v1"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}
async function makeToken(secret: string, payload: unknown) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return body + "." + (await hmac(secret, body));
}
async function readToken(secret: string, token: string) {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if ((await hmac(secret, body)) !== sig) return null;
  try { return JSON.parse(new TextDecoder().decode(b64uDecode(body))); } catch { return null; }
}

// ---------- email ----------
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

type Item = { name: string; size: string; qty: number; price: number };
const F = "font-family:Arial,Helvetica,sans-serif;";
const rowsHtml = (items: Item[]) => items.map((i) =>
  `<tr><td style="padding:6px 0;${F}font-size:15px;color:#0a1424">${i.qty} &times; ${esc(i.name)}${i.size ? ` <span style="color:#3c4b63">${esc(i.size)}</span>` : ""}</td><td align="right" style="padding:6px 0;${F}font-size:15px;font-weight:700;color:#007a55;text-align:right">${money(i.qty * i.price)}</td></tr>`
).join("");
const lineRow = (label: string, value: string, strong = false) =>
  `<tr><td style="padding:4px 0;${F}font-size:${strong ? 16 : 14}px;color:${strong ? "#0a1424" : "#3c4b63"};font-weight:${strong ? 700 : 400}">${label}</td><td align="right" style="padding:4px 0;${F}font-size:${strong ? 16 : 14}px;font-weight:700;color:${strong ? "#007a55" : "#0a1424"};text-align:right">${value}</td></tr>`;
const section = (html: string) => `<tr><td style="padding:16px 24px 0 24px">${html}</td></tr>`;
const panel = (inner: string, accent = "") =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f6fa" style="background:#f3f6fa;border:1px solid #dbe3ee;${accent ? `border-left:4px solid ${accent};` : ""}border-radius:12px"><tr><td style="padding:14px 16px;${F}color:#0a1424;font-size:14px;line-height:1.55">${inner}</td></tr></table>`;
const textBlock = (html: string) => `<tr><td style="padding:16px 24px 0 24px;${F}font-size:14px;line-height:1.7;color:#3c4b63">${html}</td></tr>`;
const button = (href: string, label: string) =>
  `<tr><td align="center" style="padding:20px 24px 0 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#01c88a" style="background:#01c88a;border-radius:999px"><a href="${href}" style="display:inline-block;padding:14px 26px;${F}font-size:15px;font-weight:700;color:#06121f;text-decoration:none">${label}</a></td></tr></table></td></tr>`;

function shell(title: string, intro: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>:root{color-scheme:light dark} body{background-color:#eef2f7}</style></head>
<body bgcolor="#eef2f7" style="margin:0;padding:0;background:#eef2f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2f7" style="background:#eef2f7"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:560px;background:#ffffff;border:1px solid #dbe3ee;border-radius:16px;overflow:hidden">
<tr><td style="padding:0;font-size:0;line-height:0"><img src="${HEADER_IMG}" width="560" alt="Tides of Change · Research Supplement Price List" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>
<tr><td style="padding:22px 24px 0 24px;${F}">
<div style="font-size:20px;font-weight:700;color:#0a1424;line-height:1.3">${title}</div>
<div style="font-size:15px;color:#3c4b63;line-height:1.55;margin-top:8px">${intro}</div>
</td></tr>
${body}
<tr><td style="padding:20px 24px 24px 24px;${F}font-size:12px;color:#5d6b80;line-height:1.5">
For research purposes only. Questions? Reply to this email or write to <a href="mailto:${ORDER_TO}" style="color:#0b6f9e">${ORDER_TO}</a>.
</td></tr>
</table></td></tr></table></body></html>`;
}

function orderPanel(ref: string, items: Item[], totalsHtml: string) {
  return section(panel(
    `<div style="font-size:12px;color:#0b6f9e;letter-spacing:.06em">ORDER ${esc(ref)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">${rowsHtml(items)}</table>
<div style="border-top:1px solid #dbe3ee;margin-top:8px;padding-top:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${totalsHtml}</table></div>`));
}

// ---------- handlers ----------
async function handleOrder(apiKey: string, b: Record<string, unknown>, user: BonusUser | null) {
  if (str(b.website, 200)) return json(200, { ok: true }); // honeypot

  const name = str(b.name, 100);
  const phone = str(b.phone, 40);
  const email = str(b.email, 200);
  const method = str(b.method, 60);
  const address = str(b.address, 400);
  const notes = str(b.notes, 1000);
  const ack = b.ack === true;
  const items: Item[] = (Array.isArray(b.items) ? b.items.slice(0, 80) : [])
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
  if (!items.length) return json(400, { ok: false, error: "items" });

  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const express = method === METHODS[1];
  const ref = "TOC-" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" +
    Math.random().toString(36).slice(2, 6).toUpperCase();

  // Welcome bonus: claim first (unique per account) so two quick orders can't both get it.
  let discount = 0;
  if (user && (await bonusEligible(user))) {
    const amt = round2(subtotal * BONUS_PCT / 100);
    if (amt > 0 && (await claimBonus(user, ref, amt))) discount = amt;
  }
  const bonusRow = discount ? lineRow(BONUS_LABEL, `&minus;${money(discount)}`) : "";
  const bonusText = discount ? [`${BONUS_LABEL}: -${money(discount)}`] : [];

  const token = await makeToken(apiKey, { v: 1, ref, name, phone, email, method, address, notes, items, discount, ts: Date.now() });
  const confirmLink = `${CONFIRM_URL}#t=${token}`;

  const lines = items.map((i) => `• ${i.qty} × ${i.name}${i.size ? " " + i.size : ""} @ ${money(i.price)} = ${money(i.qty * i.price)}`);
  const lf = localFees(subtotal);
  const est = subtotal - discount + (express ? 0 : lf.delivery + lf.fuel);
  const feeText = express ? ["Express mail: Canada Post rate (confirmed before payment)"]
    : [`In-person delivery: ${lf.free ? "Free" : money(lf.delivery)}`];
  const estLine = [`Items: ${money(subtotal)}`, ...bonusText, ...feeText, `Estimated total: ${money(est)} CAD${express ? " + Canada Post express postage" : ""} (final total confirmed before payment)`].join("\n");
  const estRows = lineRow("Items", money(subtotal)) + bonusRow +
    (express ? lineRow("Express mail", "Canada Post rate")
      : lineRow("In-person delivery", lf.free ? "Free" : money(lf.delivery))) +
    lineRow("Estimated total", `${money(est)} CAD${express ? " +" : ""}`, true);
  const fuelBlurb = !express && !lf.free ? textBlock(`<span style="font-size:12px;color:#5d6b80">${FUEL_NOTE}</span>`) : "";

  const ownerText = [
    `NEW ORDER ${ref} — Tides of Change`, "",
    `Name: ${name}`, `Phone: ${phone || "—"}`, `Email: ${email || "—"}`,
    `Delivery method: ${method}`, `Delivery address: ${address.replace(/\s*\n\s*/g, ", ")}`,
    "", "Items:", ...lines, "", estLine, "",
    "Customer confirmed: research purposes only.",
    ...(notes ? ["", "Notes:", notes] : []),
    "", email ? `Confirm & send payment request: ${confirmLink}` : "No customer email — contact them by phone to confirm and take payment.",
  ].join("\n");

  const details = textBlock(
    `<strong style="color:#0a1424">Phone:</strong> ${esc(phone || "—")}<br><strong style="color:#0a1424">Email:</strong> ${esc(email || "—")}<br>` +
    `<strong style="color:#0a1424">Delivery:</strong> ${esc(method)}<br><strong style="color:#0a1424">Address:</strong> ${esc(address)}` +
    (notes ? `<br><strong style="color:#0a1424">Notes:</strong> ${esc(notes)}` : ""));
  const ownerHtml = shell(`New order from ${esc(name)}`,
    email ? "Check stock, then tap the button to confirm and send the customer their payment details."
          : "No email given — contact the customer by phone to confirm and take payment.",
    orderPanel(ref, items, estRows) + details +
    (email ? button(confirmLink, "Confirm order &amp; send payment request") +
      textBlock(`<span style="font-size:12px;color:#5d6b80">Or reply to this email to write to the customer yourself.</span>`) : ""));

  const sentOwner = await send(apiKey, {
    to: [ORDER_TO],
    subject: `New order ${ref} — ${name}`,
    text_body: ownerText,
    html_body: ownerHtml,
    ...(email ? { custom_headers: [{ header: "Reply-To", value: email }] } : {}),
  });
  if (!sentOwner) {
    if (discount && user) await releaseBonus(user, ref); // order didn't go through: keep the bonus for next time
    return json(502, { ok: false, error: "send_failed" });
  }

  let customerCopy = false;
  if (email) {
    const pay = section(panel(
      `<div style="font-weight:700;color:#b85f00;font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Payment &middot; Interac e-Transfer</div>
<div style="color:#3c4b63">Please don&rsquo;t send payment yet. We&rsquo;ll email you shortly to confirm your order${express ? " and the Canada Post postage" : ""}, with the exact amount and where to send your e-Transfer.</div>`, "#ff9500"));
    customerCopy = await send(apiKey, {
      to: [email],
      subject: `We got your order ${ref} — Tides of Change`,
      text_body: `Thanks ${name}, we received your order request.\n\n${lines.join("\n")}\n\n${estLine}\n\nPayment: Interac e-Transfer. Please don't send payment yet. We'll email you shortly to confirm your order${express ? " and the Canada Post postage" : ""}, with the exact amount and where to send your e-Transfer.\n\nTides of Change — research purposes only.`,
      html_body: shell(`Thanks, ${esc(name)} — we got your order`,
        `We&rsquo;ll check everything and get back to you shortly. Here&rsquo;s what you asked for:`,
        orderPanel(ref, items, estRows) + fuelBlurb + pay +
        textBlock(`<strong style="color:#0a1424">Delivery:</strong> ${esc(method)}<br><strong style="color:#0a1424">Address:</strong> ${esc(address)}`)),
      custom_headers: [{ header: "Reply-To", value: ORDER_TO }],
    });
  }
  return json(200, { ok: true, ref, customerCopy, discount });
}

async function handleConfirm(apiKey: string, b: Record<string, unknown>, dry: boolean) {
  const o = await readToken(apiKey, str(b.token, 12000));
  if (!o || !o.ref) return json(403, { ok: false, error: "bad_link" });
  if (Date.now() - Number(o.ts || 0) > 60 * 24 * 3600_000) return json(410, { ok: false, error: "expired" });

  const items: Item[] = o.items;
  const express = o.method === METHODS[1];
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const lf = localFees(subtotal);
  const fee = express ? Math.max(0, Math.min(10000, Math.round((Number(b.fee) || 0) * 100) / 100)) : 0;
  const discount = Math.max(0, Math.min(subtotal, round2(Number(o.discount) || 0)));
  const total = subtotal - discount + (express ? fee : lf.delivery + lf.fuel);
  const payEmail = str(b.payEmail, 200) || PAY_EMAIL_DEFAULT;
  const autodeposit = b.autodeposit === true;
  const question = str(b.question, 200);
  const answer = str(b.answer, 100);
  const eta = str(b.eta, 200);
  const note = str(b.note, 600);

  const view = { local: express ? null : { delivery: lf.delivery, fuel: lf.fuel, free: lf.free, fuelName: FUEL_NAME }, ref: o.ref, name: o.name, email: o.email, phone: o.phone, method: o.method, address: o.address, notes: o.notes, items, subtotal, discount, discountLabel: discount ? BONUS_LABEL : "", express, payEmailDefault: PAY_EMAIL_DEFAULT };
  if (str(b.action, 20) === "view") return json(200, { ok: true, order: view });

  if (!o.email) return json(400, { ok: false, error: "no_customer_email" });
  if (!emailOk(payEmail)) return json(400, { ok: false, error: "pay_email" });
  if (express && !(fee > 0)) return json(400, { ok: false, error: "fee_required" });
  if (!autodeposit && (!question || !answer)) return json(400, { ok: false, error: "security_qa" });

  const feeLines: [string, string][] = express ? [["Express mail (Canada Post)", money(fee)]]
    : [["In-person delivery", lf.free ? "Free" : money(lf.delivery)]];
  const totals = lineRow("Items", `${money(subtotal)}`) +
    (discount ? lineRow(BONUS_LABEL, `&minus;${money(discount)}`) : "") +
    feeLines.map(([k, v]) => lineRow(k, v)).join("") +
    lineRow("Total due", `${money(total)} CAD`, true);

  const steps = [
    `Send <strong style="color:#0a1424">${money(total)} CAD</strong> by Interac e-Transfer to <strong style="color:#0a1424">${esc(payEmail)}</strong>`,
    `In the message box, enter your order number <strong style="color:#0a1424">${esc(o.ref)}</strong>`,
    autodeposit ? `Auto-deposit is on, so no security question is needed`
      : `Security question: <strong style="color:#0a1424">${esc(question)}</strong><br>Answer: <strong style="color:#0a1424">${esc(answer)}</strong>`,
  ];
  const payPanel = section(panel(
    `<div style="font-weight:700;color:#b85f00;font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">How to pay &middot; Interac e-Transfer</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${steps.map((s, n) =>
      `<tr><td valign="top" width="28" style="padding:4px 0;${F}font-size:14px;font-weight:700;color:#b85f00">${n + 1}.</td><td style="padding:4px 0;${F}font-size:14px;color:#3c4b63;line-height:1.5">${s}</td></tr>`).join("")}</table>`, "#ff9500"));
  const next = express
    ? "Once your payment arrives, we&rsquo;ll ship your order by express mail and send you the tracking number."
    : "Once your payment arrives, we&rsquo;ll contact you to arrange your in-person delivery.";
  const html = shell(`Your order is confirmed, ${esc(o.name)}`,
    "Thank you for your order. Everything is confirmed and ready. Here are your final total and payment details.",
    orderPanel(o.ref, items, totals) + payPanel +
    textBlock((eta ? `<strong style="color:#0a1424">Timing:</strong> ${esc(eta)}<br>` : "") +
      `<strong style="color:#0a1424">Delivery:</strong> ${esc(o.method)}<br><strong style="color:#0a1424">Address:</strong> ${esc(o.address)}` +
      (note ? `<br><br>${esc(note).replace(/\n/g, "<br>")}` : "") + `<br><br>${next}`) +
    textBlock(`Thank you for choosing Tides of Change.<br><strong style="color:#0a1424">Tides of Change</strong> &middot; <a href="mailto:${ORDER_TO}" style="color:#0b6f9e">${ORDER_TO}</a>`));

  const text = [
    `Hi ${o.name},`, "", "Thank you for your order. Everything is confirmed and ready.", "",
    `Order: ${o.ref}`, ...items.map((i) => `• ${i.qty} × ${i.name}${i.size ? " " + i.size : ""} = ${money(i.qty * i.price)}`),
    `Items: ${money(subtotal)}`, ...(discount ? [`${BONUS_LABEL}: -${money(discount)}`] : []), ...feeLines.map(([k, v]) => `${k}: ${v}`), `Total due: ${money(total)} CAD`, "",
    "How to pay (Interac e-Transfer)",
    `1. Send ${money(total)} CAD to: ${payEmail}`,
    `2. In the message box, enter your order number: ${o.ref}`,
    autodeposit ? "3. Auto-deposit is on, so no security question is needed." : `3. Security question: ${question} / Answer: ${answer}`,
    "", ...(eta ? [`Timing: ${eta}`] : []), `Delivery: ${o.method}`, `Address: ${o.address}`,
    ...(note ? ["", note] : []), "", next.replace(/&rsquo;/g, "'"), "",
    "Thank you for choosing Tides of Change.", "Tides of Change", ORDER_TO, "For research purposes only.",
  ].join("\n");
  const subject = `Your Tides of Change order ${o.ref} is confirmed`;

  if (dry) return json(200, { ok: true, preview: { subject, html, text, to: o.email } });

  const sent = await send(apiKey, {
    to: [o.email], bcc: [ORDER_TO], subject, html_body: html, text_body: text,
    custom_headers: [{ header: "Reply-To", value: ORDER_TO }],
  });
  if (!sent) return json(502, { ok: false, error: "send_failed" });
  return json(200, { ok: true, ref: o.ref, to: o.email, total });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });

  const apiKey = Deno.env.get("TOC_SMTP2GO_API_KEY");
  if (!apiKey) return json(503, { ok: false, error: "not_configured" });

  let b: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 30_000) return json(413, { ok: false, error: "too_large" });
    b = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "bad_json" });
  }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const action = str(b.action, 20);
  if (action === "view" || action === "preview" || action === "confirm") {
    if (limited("c:" + ip, 40)) return json(429, { ok: false, error: "rate_limited" });
    return handleConfirm(apiKey, b, action !== "confirm");
  }
  if (action === "bonus") {
    if (limited("b:" + ip, 60)) return json(429, { ok: false, error: "rate_limited" });
    const u = await bonusUser(req);
    let usedRef = "";
    if (u && admin) {
      const { data } = await admin.from("welcome_bonus_uses").select("order_ref").eq("user_id", u.id).limit(1);
      usedRef = data?.[0]?.order_ref || "";
    }
    return json(200, { ok: true, signedIn: !!u, eligible: await bonusEligible(u), usedRef, pct: BONUS_PCT });
  }
  if (limited(ip, 5)) return json(429, { ok: false, error: "rate_limited" });
  return handleOrder(apiKey, b, await bonusUser(req));
});
