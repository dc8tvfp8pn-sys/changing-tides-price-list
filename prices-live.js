/* ==========================================================================
   Tides of Change — live prices
   Fetches current prices from Supabase on every page load and re-renders the
   price rows in place. The HTML baked into index.html is the fallback
   snapshot, so the list still displays if the database is unreachable.
   ========================================================================== */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://gvexlysmyqitmvexfxep.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_R572xTOvVsbVmsJiU_wCWg_PBw0Wo7J';
  var ENDPOINT = SUPABASE_URL + '/rest/v1/price_list' +
    '?select=category,name,strength,price&active=eq.true&order=sort_order.asc,name.asc';

  function formatPrice(p) {
    var n = Number(p);
    if (!isFinite(n)) return '';
    return '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
  }

  function makeRow(item) {
    var li = document.createElement('li');
    li.className = 'price-row';
    var div = document.createElement('div');
    div.className = 'item';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name;
    var strength = document.createElement('span');
    strength.className = 'strength';
    strength.textContent = item.strength || '';
    var price = document.createElement('span');
    price.className = 'price';
    price.textContent = formatPrice(item.price);
    div.appendChild(name);
    div.appendChild(strength);
    li.appendChild(div);
    li.appendChild(price);
    return li;
  }

  function render(items) {
    // Group items by category, preserving the approved per-category order.
    var byCat = {};
    items.forEach(function (it) {
      (byCat[it.category] = byCat[it.category] || []).push(it);
    });

    Object.keys(byCat).forEach(function (cat) {
      var section = document.getElementById(cat);
      if (!section) return;
      var list = section.querySelector('ul.price-list');
      if (!list) return;
      var frag = document.createDocumentFragment();
      byCat[cat].forEach(function (it) { frag.appendChild(makeRow(it)); });
      list.innerHTML = '';
      list.appendChild(frag);
    });

    // If the A–Z view was already built from the fallback snapshot, clear it
    // so script.v2.js rebuilds it from the live rows on next use.
    var allList = document.getElementById('all-products-list');
    if (allList) allList.innerHTML = '';
  }

  function refresh() {
    fetch(ENDPOINT, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        Accept: 'application/json'
      },
      cache: 'no-store'
    })
      .then(function (r) {
        if (!r.ok) throw new Error('price fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (items) {
        if (Array.isArray(items) && items.length) render(items);
      })
      .catch(function () {
        // Offline or Supabase unreachable: baked-in snapshot stays on screen.
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})();
