(function () {
  'use strict';
  var btn = document.getElementById('backToTop');
  if (!btn) return;

  var ticking = false;
  function update() {
    if (window.scrollY > 400) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  btn.addEventListener('click', function () {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });

  update();
})();

/* ---- Browse by Research Goal: grouped ↔ All Products (single price source) ---- */
(function () {
  'use strict';
  var grouped = document.getElementById('grouped-view');
  var allView = document.getElementById('all-view');
  var allList = document.getElementById('all-products-list');
  var allBtn = document.getElementById('allProductsBtn');
  if (!grouped || !allView || !allList || !allBtn) return;

  // Build the alphabetical All Products list once, by cloning the grouped
  // rows — the grouped markup stays the single source of truth for prices.
  function buildAllList() {
    if (allList.children.length) return;
    var rows = Array.prototype.slice.call(grouped.querySelectorAll('.price-row'));
    rows.sort(function (a, b) {
      var na = a.querySelector('.name').textContent.trim();
      var nb = b.querySelector('.name').textContent.trim();
      var cmp = na.localeCompare(nb, 'en', { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      var sa = parseFloat((a.querySelector('.strength').textContent || '').replace(/[^0-9.]/g, '')) || 0;
      var sb = parseFloat((b.querySelector('.strength').textContent || '').replace(/[^0-9.]/g, '')) || 0;
      return sa - sb;
    });
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) { frag.appendChild(r.cloneNode(true)); });
    allList.appendChild(frag);
  }

  function showAll() {
    buildAllList();
    grouped.hidden = true;
    allView.hidden = false;
    allBtn.setAttribute('aria-pressed', 'true');
  }

  function showGrouped() {
    allView.hidden = true;
    grouped.hidden = false;
    allBtn.setAttribute('aria-pressed', 'false');
  }

  allBtn.addEventListener('click', function () {
    if (allView.hidden) { showAll(); scrollToEl(allView); }
  });

  function scrollToEl(el) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  // Category chips always return to the grouped view, then jump to the target.
  var chips = document.querySelectorAll('.goal-chip[data-cat]');
  Array.prototype.forEach.call(chips, function (chip) {
    chip.addEventListener('click', function (e) {
      e.preventDefault();
      var target = document.getElementById(chip.getAttribute('data-cat'));
      if (!target) return;
      showGrouped();
      // wait a frame so the newly-shown section has layout before scrolling
      window.requestAnimationFrame(function () { scrollToEl(target); });
    });
  });
})();

/* ---- Native share with copy-link fallback ---- */
(function () {
  'use strict';
  var btn = document.getElementById('shareBtn');
  var status = document.getElementById('shareStatus');
  if (!btn) return;

  var statusTimer;
  function flash(msg) {
    if (!status) return;
    status.textContent = msg;
    status.classList.add('visible');
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(function () {
      status.classList.remove('visible');
    }, 2600);
  }

  function pageUrl() {
    return (window.location && window.location.href) || '';
  }

  // Last-resort copy for browsers without the async Clipboard API (or where it
  // is blocked): a hidden, off-screen textarea + execCommand('copy').
  function legacyCopy(url) {
    try {
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      flash(ok ? 'Link copied to clipboard' : 'Copy this link: ' + url);
    } catch (e) {
      flash('Copy this link: ' + url);
    }
  }

  function copyFallback() {
    var url = pageUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        flash('Link copied to clipboard');
      }, function () {
        legacyCopy(url);
      });
    } else {
      legacyCopy(url);
    }
  }

  btn.addEventListener('click', function () {
    var data = {
      title: document.title || 'Tides of Change',
      text: 'Tides of Change — Research Supplement Price List',
      url: pageUrl()
    };
    if (navigator.share) {
      navigator.share(data).catch(function (err) {
        // User dismissed the native share sheet — stay silent.
        if (err && err.name === 'AbortError') return;
        // Any other failure (e.g. permission) → fall back to copy.
        copyFallback();
      });
    } else {
      copyFallback();
    }
  });
})();
