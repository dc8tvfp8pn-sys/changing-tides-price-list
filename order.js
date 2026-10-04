/* ================= TIDES OF CHANGE — ORDER NOW =================
   Prices are read from the existing .price-row markup (single price source).
   Sending: opens the customer's email app with a pre-written order to
   ORDER_EMAIL. ORDER_ENDPOINT is reserved for a future automatic sender. */
(function () {
  'use strict';

  var ORDER_EMAIL = 'orders@tidesofchange.ca';
  var ORDER_ENDPOINT = 'https://gvexlysmyqitmvexfxep.supabase.co/functions/v1/toc-order'; // one-tap sender
  // Optional Changing Tides account autofill (public publishable key; RLS limits reads to the signed-in user)
  var CT_URL = 'https://gvexlysmyqitmvexfxep.supabase.co';
  var CT_KEY = 'sb_publishable_R572xTOvVsbVmsJiU_wCWg_PBw0Wo7J';
  var MAX_QTY = 20;

  var main = document.getElementById('pricelist');
  if (!main) return;

  // ---------- state ----------
  var cart = {}; // key -> {name, strength, price, qty} — kept in memory for this visit
  function save() { /* in-memory only */ }

  function rowInfo(row) {
    var n = row.querySelector('.name');
    var s = row.querySelector('.strength');
    var p = row.querySelector('.price');
    if (!n || !p) return null;
    var name = n.textContent.trim();
    var strength = s ? s.textContent.trim() : '';
    var price = parseFloat(p.textContent.replace(/[^0-9.]/g, ''));
    if (!isFinite(price)) return null;
    return { key: (name + '|' + strength).toLowerCase(), name: name, strength: strength, price: price };
  }

  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0); }
  function label(it) { return it.strength ? it.name + ' ' + it.strength : it.name; }

  function items() {
    return Object.keys(cart).map(function (k) { return cart[k]; }).filter(function (it) { return it.qty > 0; });
  }
  function totals() {
    var list = items(), count = 0, sum = 0;
    list.forEach(function (it) { count += it.qty; sum += it.qty * it.price; });
    return { list: list, count: count, sum: sum };
  }

  // Drop saved items whose price row no longer exists, and refresh prices from the page.
  var live = {};
  Array.prototype.forEach.call(main.querySelectorAll('.price-row'), function (row) {
    var info = rowInfo(row);
    if (info) live[info.key] = info;
  });
  Object.keys(cart).forEach(function (k) {
    if (!live[k]) { delete cart[k]; return; }
    cart[k].price = live[k].price;
    cart[k].name = live[k].name;
    cart[k].strength = live[k].strength;
  });

  // ---------- per-row Add buttons ----------
  function decorate(row) {
    if (row.querySelector('.add-btn')) return;
    var info = rowInfo(row);
    if (!info) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-btn';
    btn.setAttribute('data-key', info.key);
    btn.setAttribute('data-testid', 'add-' + info.key.replace(/[^a-z0-9]+/g, '-'));
    row.appendChild(btn);
    paintBtn(btn);
  }
  function paintBtn(btn) {
    var k = btn.getAttribute('data-key');
    var info = live[k];
    var q = cart[k] ? cart[k].qty : 0;
    btn.textContent = q ? '✓ ' + q : 'Add';
    btn.classList.toggle('in-cart', q > 0);
    btn.setAttribute('aria-label', q ? (label(info) + ': ' + q + ' in order. Add one more') : ('Add ' + label(info) + ' to order'));
  }
  function paintAll(keepSheet) {
    Array.prototype.forEach.call(document.querySelectorAll('.add-btn'), paintBtn);
    paintBar();
    if (!sheet.hidden && !keepSheet) renderSheet();
  }

  Array.prototype.forEach.call(main.querySelectorAll('.price-row'), decorate);
  // The A–Z view clones rows later; decorate those clones as they appear.
  var allList = document.getElementById('all-products-list');
  if (allList && 'MutationObserver' in window) {
    new MutationObserver(function () {
      Array.prototype.forEach.call(allList.querySelectorAll('.price-row'), decorate);
      Array.prototype.forEach.call(allList.querySelectorAll('.add-btn'), paintBtn);
    }).observe(allList, { childList: true });
  }

  main.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.add-btn');
    if (!btn) return;
    var k = btn.getAttribute('data-key');
    var info = live[k];
    if (!info) return;
    if (!cart[k]) cart[k] = { name: info.name, strength: info.strength, price: info.price, qty: 0 };
    cart[k].qty = Math.min(MAX_QTY, cart[k].qty + 1);
    save();
    paintAll();
  });

  // ---------- header CTA + floating bar ----------
  var header = document.querySelector('.header-inner');
  if (header) {
    var wrap = document.createElement('div');
    wrap.className = 'order-cta-wrap';
    wrap.innerHTML = '<button type="button" class="order-cta" id="orderNowTop" data-testid="order-now-top">Order now</button>';
    header.appendChild(wrap);
  }

  var bar = document.createElement('div');
  bar.className = 'order-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Your order');
  bar.innerHTML =
    '<div class="order-bar-sum"><span class="order-bar-count" id="orderBarCount"></span>' +
    '<span class="order-bar-total" id="orderBarTotal"></span></div>' +
    '<button type="button" class="order-cta" id="orderNowBar" data-testid="order-now-bar">Review &amp; order</button>';
  document.body.appendChild(bar);

  function paintBar() {
    var t = totals();
    document.getElementById('orderBarCount').textContent = t.count + (t.count === 1 ? ' item' : ' items');
    document.getElementById('orderBarTotal').textContent = money(t.sum);
    var show = t.count > 0;
    bar.classList.toggle('visible', show);
    document.body.classList.toggle('has-order', show);
  }

  // ---------- order sheet ----------
  var sheet = document.createElement('div');
  sheet.className = 'order-sheet';
  sheet.hidden = true;
  sheet.innerHTML =
    '<div class="order-panel" role="dialog" aria-modal="true" aria-labelledby="orderTitle">' +
      '<div class="order-head"><h2 class="order-title" id="orderTitle">Your order</h2>' +
      '<button type="button" class="order-close" id="orderClose" aria-label="Close">×</button></div>' +
      '<div id="orderBody"></div>' +
    '</div>';
  document.body.appendChild(sheet);
  var body = sheet.querySelector('#orderBody');
  var lastFocus = null;
  var ct = { open: false, busy: false, msg: '', ok: false };
  // Edmonton delivery pricing (owner-set). FREE_OVER: items subtotal at/above which delivery + fuel are free; null = never.
  var DELIVERY_FEE = 20, FUEL_FEE = 20, FREE_OVER = 200; // free when items subtotal is over $200
  var FUEL_NAME = 'Rising Tide fuel surcharge';
  var FUEL_NOTE = 'Fuel prices are running high. This small temporary surcharge keeps Edmonton delivery running and comes off when the tide goes out.';
  function fees(sum, method) {
    if (method !== METHODS[0]) return { delivery: 0, fuel: 0, free: false, express: true };
    var free = FREE_OVER != null && sum > FREE_OVER;
    return { delivery: free ? 0 : DELIVERY_FEE, fuel: free ? 0 : FUEL_FEE, free: free, express: false };
  }
  function totalsHtml() {
    var t = totals(), f = fees(t.sum, form.method), h = '';
    h += '<div class="order-fee-row"><span>Items</span><span>' + money(t.sum) + '</span></div>';
    if (f.express) {
      h += '<div class="order-fee-row"><span>Express mail</span><span>quoted on confirm</span></div>';
    } else if (f.free) {
      h += '<div class="order-fee-row"><span>Edmonton delivery</span><span class="free">Free</span></div>';
    } else {
      h += '<div class="order-fee-row"><span>Edmonton delivery</span><span>' + money(f.delivery) + '</span></div>';
      h += '<div class="order-fee-row"><span>' + FUEL_NAME + '</span><span>' + money(f.fuel) + '</span></div>';
    }
    h += '<div class="order-total-row"><span>Estimated total</span><span data-testid="order-total">' + money(t.sum + f.delivery + f.fuel) + (f.express ? '+' : '') + '</span></div>';
    h += '<p class="order-total-note">' + (f.express ? 'CAD, plus express mail. ' : 'CAD. ') + 'Final total confirmed by our team before payment.</p>';
    if (!f.express && !f.free) h += '<p class="order-total-note fuel-note">' + FUEL_NOTE + '</p>';
    if (!f.express && FREE_OVER != null && !f.free) h += '<p class="order-total-note">Free Edmonton delivery on orders over ' + money(FREE_OVER) + '.</p>';
    return h;
  }
  var METHODS = ['Delivery (Edmonton area only)', 'Express mail (extra fee)'];
  var form = { name: '', phone: '', email: '', method: METHODS[0], address: '', notes: '', ack: false };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function renderSheet() {
    var t = totals();
    var rows = t.list.length ? t.list.map(function (it) {
      var k = (it.name + '|' + it.strength).toLowerCase();
      return '<li class="order-item">' +
        '<div class="order-item-info"><span class="order-item-name">' + esc(label(it)) + '</span>' +
        '<span class="order-item-meta">' + money(it.price) + ' each</span></div>' +
        '<div class="qty"><button type="button" data-dec="' + esc(k) + '" aria-label="One less ' + esc(label(it)) + '">−</button>' +
        '<output aria-live="polite">' + it.qty + '</output>' +
        '<button type="button" data-inc="' + esc(k) + '" aria-label="One more ' + esc(label(it)) + '">+</button></div>' +
        '<span class="order-line-total">' + money(it.qty * it.price) + '</span></li>';
    }).join('') : '<li class="order-empty">Nothing added yet. Tap <strong>Add</strong> beside any item on the price list.</li>';

    body.innerHTML =
      '<p class="order-sub">Pick your items, add your details, and send. We confirm every order personally.</p>' +
      '<ul class="order-items">' + rows + '</ul>' +
      (t.list.length ?
        '<div class="order-totals" id="orderTotals">' + totalsHtml() + '</div>' +
        ctBlock() +
        '<form class="order-form" id="orderForm" novalidate>' +
          field('ofName', 'Name', '<input id="ofName" name="name" autocomplete="name" required value="' + esc(form.name) + '">') +
          field('ofPhone', 'Phone', '<input id="ofPhone" name="phone" type="tel" autocomplete="tel" inputmode="tel" value="' + esc(form.phone) + '">') +
          field('ofEmail', 'Email', '<input id="ofEmail" name="email" type="email" autocomplete="email" inputmode="email" value="' + esc(form.email) + '">') +
          field('ofMethod', 'Delivery method', '<select id="ofMethod" name="method">' +
            METHODS.map(function (o) { return '<option' + (form.method === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>') +
          '<p class="order-total-note" id="ofMethodNote">' + methodNote() + '</p>' +
          field('ofAddress', 'Delivery address', '<textarea id="ofAddress" name="address" autocomplete="street-address" placeholder="Street, city, province, postal code">' + esc(form.address) + '</textarea>') +
          field('ofNotes', 'Notes (optional)', '<textarea id="ofNotes" name="notes" placeholder="Anything we should know">' + esc(form.notes) + '</textarea>') +
          '<label class="order-check"><input type="checkbox" id="ofAck"' + (form.ack ? ' checked' : '') + '> I understand these products are for research purposes only.</label>' +
          '<div class="order-hp" aria-hidden="true"><label>Leave blank<input id="ofWebsite" name="website" tabindex="-1" autocomplete="off"></label></div>' +
          '<p class="order-pay"><strong>Payment:</strong> Interac e-Transfer after we confirm your order. No card details needed.</p>' +
          '<p class="order-error" id="orderError" role="alert"></p>' +
          '<button type="submit" class="order-cta order-send" data-testid="order-send">Send order</button>' +
          '<div class="order-alt"><button type="button" class="order-link" id="orderCopy">Copy order</button>' +
          '<button type="button" class="order-link" id="orderClear">Clear order</button></div>' +
          '<p class="order-status" id="orderStatus" role="status"></p>' +
        '</form>'
      : '');

    var f = body.querySelector('#orderForm');
    if (f) {
      f.addEventListener('input', function () { capture(); var er = body.querySelector('#orderError'); if (er) er.textContent = ''; });
      f.addEventListener('change', capture);
      f.addEventListener('submit', submit);
      body.querySelector('#orderCopy').addEventListener('click', copyOrder);
      var o = body.querySelector('#ctOpen'); if (o) o.addEventListener('click', function () { capture(); ct.open = true; ct.msg = ''; renderSheet(); var e = body.querySelector('#ctEmail'); if (e) e.focus(); });
      var c = body.querySelector('#ctCancel'); if (c) c.addEventListener('click', function () { capture(); ct.open = false; ct.msg = ''; renderSheet(); });
      var g = body.querySelector('#ctGo'); if (g) g.addEventListener('click', ctSignInAndFill);
      var cp = body.querySelector('#ctPass'); if (cp) cp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ctSignInAndFill(); } });
      body.querySelector('#orderClear').addEventListener('click', function () {
        cart = {}; save(); paintAll();
      });
    }
  }
  function ctBlock() {
    if (ct.ok) return '<div class="ct-fill ct-done" role="status">' + esc(ct.msg) + '</div>';
    if (!ct.open) {
      return '<div class="ct-fill"><button type="button" class="order-link ct-toggle" id="ctOpen" data-testid="ct-open">Have a Changing Tides account? Fill in my details</button></div>';
    }
    return '<div class="ct-fill ct-open">' +
      '<p class="ct-title">Fill in from your Changing Tides account</p>' +
      '<p class="ct-note">Optional. We only copy your name and email into this form, then sign you straight back out. Nothing else is shared.</p>' +
      field('ctEmail', 'Changing Tides email', '<input id="ctEmail" type="email" autocomplete="username" inputmode="email">') +
      field('ctPass', 'Password', '<input id="ctPass" type="password" autocomplete="current-password">') +
      '<p class="order-error" id="ctError" role="alert">' + esc(ct.msg) + '</p>' +
      '<div class="order-alt"><button type="button" class="order-cta ct-go" id="ctGo" data-testid="ct-go"' + (ct.busy ? ' disabled' : '') + '>' + (ct.busy ? 'Checking…' : 'Sign in &amp; fill') + '</button>' +
      '<button type="button" class="order-link" id="ctCancel">Cancel</button></div>' +
    '</div>';
  }

  function ctFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ apikey: CT_KEY, 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(CT_URL + path, opts).then(function (r) {
      return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} return { ok: r.ok, status: r.status, json: j }; });
    });
  }

  function ctSignInAndFill() {
    capture();
    var em = (body.querySelector('#ctEmail') || {}).value || '';
    var pw = (body.querySelector('#ctPass') || {}).value || '';
    if (!em.trim() || !pw) { ct.msg = 'Enter your Changing Tides email and password.'; renderSheet(); return; }
    ct.busy = true; ct.msg = ''; renderSheet();
    var token = null;
    ctFetch('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: em.trim(), password: pw }) })
      .then(function (res) {
        if (!res.ok || !res.json || !res.json.access_token) {
          var code = res.json && (res.json.error_code || res.json.code || res.json.error);
          var m = res.json && (res.json.msg || res.json.error_description || res.json.message) || '';
          if (/not.?confirmed/i.test(String(code) + ' ' + m)) throw new Error('Please confirm your Changing Tides email first, then try again.');
          if (res.status === 400 || res.status === 401) throw new Error('That email and password didn’t match a Changing Tides account.');
          throw new Error('Couldn’t reach Changing Tides right now. You can fill the form in by hand.');
        }
        token = res.json.access_token;
        var user = res.json.user || {};
        var meta = user.user_metadata || {};
        return ctFetch('/rest/v1/profiles?select=display_name&id=eq.' + encodeURIComponent(user.id), { headers: { Authorization: 'Bearer ' + token } })
          .then(function (p) {
            var dn = p.ok && Array.isArray(p.json) && p.json[0] && p.json[0].display_name;
            return { email: user.email || em.trim(), name: (dn || meta.display_name || meta.full_name || '').trim() };
          });
      })
      .then(function (info) {
        var filled = [];
        if (info.name && !/@/.test(info.name)) { form.name = info.name; filled.push('name'); }
        if (info.email) { form.email = info.email; filled.push('email'); }
        ct.ok = true; ct.busy = false;
        ct.msg = 'Filled in your ' + (filled.join(' and ') || 'details') + ' from Changing Tides. You’ve been signed back out. Please add your phone and delivery address.';
      })
      .catch(function (err) {
        ct.busy = false; ct.msg = err && err.message ? err.message : 'Something went wrong. You can fill the form in by hand.';
      })
      .then(function () {
        if (token) ctFetch('/auth/v1/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(function () {});
        renderSheet();
      });
  }

  function methodNote() {
    return form.method === METHODS[1]
      ? 'Express mail has an extra fee. We’ll confirm the exact amount before you pay.'
      : 'Edmonton area only: ' + money(DELIVERY_FEE) + ' delivery + ' + money(FUEL_FEE) + ' ' + FUEL_NAME + ', free on orders over ' + money(FREE_OVER) + '. Outside Edmonton? Choose Express mail.';
  }
  function field(id, text, control) {
    return '<div class="order-field"><label for="' + id + '">' + text + '</label>' + control + '</div>';
  }
  function capture() {
    var g = function (id) { var el = body.querySelector('#' + id); return el ? el.value : ''; };
    form.name = g('ofName'); form.phone = g('ofPhone'); form.email = g('ofEmail');
    form.method = g('ofMethod') || form.method; form.address = g('ofAddress'); form.notes = g('ofNotes');
    var mn = body.querySelector('#ofMethodNote'); if (mn) mn.textContent = methodNote();
    var ot = body.querySelector('#orderTotals'); if (ot) ot.innerHTML = totalsHtml();
    var a = body.querySelector('#ofAck'); form.ack = !!(a && a.checked);
  }

  body.addEventListener('click', function (e) {
    var inc = e.target.getAttribute && e.target.getAttribute('data-inc');
    var dec = e.target.getAttribute && e.target.getAttribute('data-dec');
    var k = inc || dec;
    if (!k || !cart[k]) return;
    capture();
    cart[k].qty = Math.max(0, Math.min(MAX_QTY, cart[k].qty + (inc ? 1 : -1)));
    if (!cart[k].qty) delete cart[k];
    save();
    paintAll();
  });

  function orderText() {
    var t = totals();
    var lines = [
      'NEW ORDER REQUEST — Tides of Change',
      '',
      'Name: ' + form.name.trim(),
      'Phone: ' + (form.phone.trim() || '—'),
      'Email: ' + (form.email.trim() || '—'),
      'Delivery method: ' + form.method,
      'Delivery address: ' + form.address.trim().replace(/\s*\n\s*/g, ', '),
      '',
      'Items:'
    ];
    t.list.forEach(function (it) {
      lines.push('• ' + it.qty + ' × ' + label(it) + ' @ ' + money(it.price) + ' = ' + money(it.qty * it.price));
    });
    var f = fees(t.sum, form.method);
    lines.push('', 'Items: ' + money(t.sum));
    if (f.express) lines.push('Express mail: quoted on confirm');
    else if (f.free) lines.push('Edmonton delivery: Free');
    else lines.push('Edmonton delivery: ' + money(f.delivery), FUEL_NAME + ': ' + money(f.fuel));
    lines.push('Estimated total: ' + money(t.sum + f.delivery + f.fuel) + ' CAD' + (f.express ? ' + express mail' : '') + ' (final total confirmed before payment)');
    if (form.notes.trim()) lines.push('', 'Notes: ' + form.notes.trim());
    lines.push('', 'Payment: Interac e-Transfer after confirmation.', 'Customer confirmed: research purposes only.');
    return lines.join('\n');
  }

  function validate() {
    capture();
    if (!totals().count) return 'Add at least one item.';
    if (!form.name.trim()) return 'Please enter your name.';
    if (!form.phone.trim() && !form.email.trim()) return 'Please enter a phone number or email so we can confirm.';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'That email address doesn’t look right.';
    if (!form.address.trim()) return 'Please enter your delivery address.';
    if (!form.ack) return 'Please tick the research-purposes box.';
    return '';
  }

  function submit(e) {
    e.preventDefault();
    var err = validate();
    var errEl = body.querySelector('#orderError');
    errEl.textContent = err;
    if (err) return;
    if (ORDER_ENDPOINT && window.fetch) return sendDirect();
    openMailApp();
  }

  function openMailApp() {
    var subject = 'Order request — ' + form.name.trim();
    var href = 'mailto:' + ORDER_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(orderText());
    window.location.href = href;
    showDone();
  }

  var sending = false;
  function sendDirect() {
    if (sending) return;
    sending = true;
    var btn = body.querySelector('[data-testid=order-send]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    var hp = body.querySelector('#ofWebsite');
    var payload = {
      name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
      method: form.method, address: form.address.trim(), notes: form.notes.trim(), ack: form.ack,
      website: hp ? hp.value : '',
      items: totals().list.map(function (it) { return { name: it.name, size: it.strength, qty: it.qty, price: it.price }; })
    };
    fetch(ORDER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j && j.ok, j: j || {} }; }); })
      .then(function (res) {
        sending = false;
        if (res.ok) return showSent(res.j.ref, res.j.customerCopy);
        sendFailed();
      })
      .catch(function () { sending = false; sendFailed(); });
  }

  function sendFailed() {
    var btn = body.querySelector('[data-testid=order-send]');
    if (btn) { btn.disabled = false; btn.textContent = 'Send order'; }
    var er = body.querySelector('#orderError');
    if (er) er.innerHTML = 'Couldn’t send just now. <button type="button" class="order-link" id="ofMailApp">Send with my email app instead</button>';
    var m = body.querySelector('#ofMailApp'); if (m) m.addEventListener('click', openMailApp);
  }

  function showSent(ref, customerCopy) {
    var summary = totals();
    body.innerHTML =
      '<div class="order-done">' +
        '<h3>Order received — thank you</h3>' +
        (ref ? '<p>Your order number is <strong>' + esc(ref) + '</strong>.</p>' : '') +
        '<p>We’ll reply to confirm your order and send Interac e-Transfer details.</p>' +
        (customerCopy ? '<p>A copy is on its way to <strong>' + esc(form.email.trim()) + '</strong>.</p>' : '') +
        '<div class="order-alt"><button type="button" class="order-link" id="doneClear">Done</button></div>' +
      '</div>';
    cart = {}; save(); paintAll(true);
    body.querySelector('#doneClear').addEventListener('click', function () { closeSheet(); });
  }

  function showDone() {
    body.innerHTML =
      '<div class="order-done">' +
        '<h3>Almost done — tap Send in your email app</h3>' +
        '<p>Your email app should have opened with the order written out to <strong>' + ORDER_EMAIL + '</strong>. Just tap <strong>Send</strong>.</p>' +
        '<p>We’ll reply to confirm your order and send Interac e-Transfer details.</p>' +
        '<p>No email app opened? Copy the order and email it to ' + ORDER_EMAIL + '.</p>' +
        '<div class="order-alt"><button type="button" class="order-link" id="doneCopy">Copy order</button>' +
        '<button type="button" class="order-link" id="doneBack">Back to order</button>' +
        '<button type="button" class="order-link" id="doneClear">Start a new order</button></div>' +
        '<p class="order-status" id="orderStatus" role="status"></p>' +
      '</div>';
    body.querySelector('#doneCopy').addEventListener('click', copyOrder);
    body.querySelector('#doneBack').addEventListener('click', renderSheet);
    body.querySelector('#doneClear').addEventListener('click', function () { cart = {}; save(); paintAll(); closeSheet(); });
  }

  function copyOrder() {
    capture();
    var text = 'To: ' + ORDER_EMAIL + '\n\n' + orderText();
    var status = body.querySelector('#orderStatus');
    function ok() { if (status) status.textContent = 'Order copied — paste it into an email to ' + ORDER_EMAIL; }
    function legacy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'absolute'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); ok();
      } catch (e) { if (status) status.textContent = 'Couldn’t copy automatically.'; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, legacy);
    else legacy();
  }

  function openSheet() {
    lastFocus = document.activeElement;
    renderSheet();
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    var c = sheet.querySelector('#orderClose');
    if (c) c.focus();
  }
  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('click', function (e) {
    var id = e.target && e.target.id;
    if (id === 'orderNowTop') {
      if (totals().count) openSheet();
      else {
        var nav = document.getElementById('goalnav');
        if (nav) nav.scrollIntoView({ behavior: 'smooth', block: 'start' });
        flashHint();
      }
    }
    if (id === 'orderNowBar') openSheet();
    if (id === 'orderClose') closeSheet();
  });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  function flashHint() {
    var status = document.getElementById('shareStatus');
    if (!status) return;
    status.textContent = 'Tap “Add” beside any item to start your order';
    status.classList.add('visible');
    window.setTimeout(function () { status.classList.remove('visible'); }, 3200);
  }

  paintAll();
})();
