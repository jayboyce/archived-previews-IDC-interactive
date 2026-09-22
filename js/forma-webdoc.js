/* ═══════════════════════════════════════════════════════════════════
   Forma — Web-Doc behaviour  (web-doc.js)
   Pairs with fusion/web-doc.css. Zero dependencies, no build step.

   Wires up, for any element with class .webdoc:
     • scroll reveals          [.reveal] / [.stagger]  → .in when in view
     • chart animate-in        [data-ig]               → .in when in view
     • scroll-spy nav          .navrow ↔ .doc-section[id]
     • reading progress bar     .doc-progress
     • scroll-reactive glow     .doc-section .doc-glow  (--gp / --gi)
     • interactive calculators  [data-calc] (declarative, see markup)

   Respects prefers-reduced-motion (reveals/charts show instantly).
   Re-run Forma.initWebDoc() after injecting new sections (AI on demand).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Guard: if the animation timeline doesn't advance (preview/capture
     harness, backgrounded tab), kill transition/animation durations so
     every end-state applies instantly and content is never trapped at a
     hidden start frame. Real browsers with a running clock animate fully. */
  (function detectFrozen() {
    var t0 = (document.timeline && document.timeline.currentTime) || 0;
    var rafSeen = false;
    requestAnimationFrame(function () {
      rafSeen = true;
      requestAnimationFrame(function () {
        var t1 = (document.timeline && document.timeline.currentTime) || 0;
        if (t1 - t0 < 1) document.documentElement.classList.add('anim-frozen');
      });
    });
    setTimeout(function () { if (!rafSeen) document.documentElement.classList.add('anim-frozen'); }, 240);
  })();

  function initWebDoc(root) {
    root = root || document;
    var docs = root.querySelectorAll ? root.querySelectorAll('.webdoc') : [];
    if (root.classList && root.classList.contains('webdoc')) docs = [root];
    Array.prototype.forEach.call(docs, setupDoc);
  }

  function setupDoc(doc) {
    if (doc.__wdInit) return;
    doc.__wdInit = true;

    /* ── reveals + chart animate-in via IntersectionObserver ────────
       PROGRESSIVE ENHANCEMENT (Dru's review, 2026-09-22): the hidden
       pre-animation states are scoped under html.reveal-ready in CSS.
       We add that class ONLY here, once IntersectionObserver is known to
       exist and the observer has been constructed without throwing. If
       JS is blocked, errors earlier, or the observer is unavailable, the
       class never lands and every .reveal / chart renders at its final
       visible value. Never move this above the feature test. */
    if (!('IntersectionObserver' in window) || REDUCED) {
      doc.querySelectorAll('.reveal, .stagger, [data-ig]').forEach(function (el) {
        el.classList.add('in');
      });
      setupChrome(doc);      // nav, calculators, focus management still run
      return;
    }
    document.documentElement.classList.add('reveal-ready');

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          if (!e.target.hasAttribute('data-ig-repeat')) io.unobserve(e.target);
        }
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });

    var observed = [];
    doc.querySelectorAll('.reveal, .stagger, [data-ig]').forEach(function (el) {
      if (REDUCED) { el.classList.add('in'); return; }
      io.observe(el);
      observed.push(el);
    });
    /* Robustness: some engines don't fire IO's initial callback until a
       scroll/layout tick. Sweep once for anything already on-screen. */
    function sweepInView() {
      var vh = window.innerHeight || document.documentElement.clientHeight;
      for (var i = observed.length - 1; i >= 0; i--) {
        var el = observed[i];
        if (el.classList.contains('in')) { observed.splice(i, 1); continue; }
        var r = el.getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > vh * 0.08) {
          el.classList.add('in');
          if (!el.hasAttribute('data-ig-repeat')) { io.unobserve(el); observed.splice(i, 1); }
        }
      }
    }
    requestAnimationFrame(sweepInView);
    setTimeout(sweepInView, 60);
    window.addEventListener('scroll', sweepInView, { passive: true });

    /* Symptom probe: the timeline-delta heuristic can pass while a capture
       harness still freezes transitions. After the reveal should have
       finished, if a first-viewport reveal is still computed-hidden, the
       clock is effectively frozen — snap everything to its end-state. In a
       real browser it's opacity ~1 by now, so this never fires. */
    setTimeout(function () {
      if (document.documentElement.classList.contains('anim-frozen')) return;
      var probe = doc.querySelector('.reveal.in');
      if (probe && parseFloat(getComputedStyle(probe).opacity) < 0.5) {
        document.documentElement.classList.add('anim-frozen');
      }
    }, 1300);

    /* index staggered children so CSS delay steps cleanly */
    doc.querySelectorAll('.stagger, .ig-stack, .ig-line').forEach(function (g) {
      var kids = g.children.length ? g.children : [];
      Array.prototype.forEach.call(g.querySelectorAll('.ig-stack__layer, .ln-dot'), function (k, i) { k.style.setProperty('--i', i); });
      Array.prototype.forEach.call(kids, function (k, i) { if (k.style.getPropertyValue('--i') === '') k.style.setProperty('--i', i); });
    });

    /* measure line paths so the draw-on length is exact */
    doc.querySelectorAll('.ig-line .ln-path').forEach(function (p) {
      try { var L = p.getTotalLength(); p.style.setProperty('--len', Math.ceil(L)); } catch (err) {}
    });

    /* ── stat count-up ─────────────────────────────────────────────
       Big figures (.ig-fig__n) and ring centres (.ig-ring__num) count
       0→value once when scrolled into view. Suffix/prefix ("%", "$",
       decimals, thousands commas) are parsed from the DOM, never
       hardcoded. Reduced-motion / calculator-owned figures are skipped. */
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function parseNum(raw) {
      raw = (raw || '').trim();
      var m = raw.match(/^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
      if (!m) return null;
      if (/\d/.test(m[3])) return null;            // a second number in the suffix → not a clean stat
      var numStr = m[2];
      return {
        prefix: m[1] || '', suffix: m[3] || '',
        value: parseFloat(numStr.replace(/,/g, '')),
        decimals: (numStr.split('.')[1] || '').length,
        comma: numStr.indexOf(',') > -1,
        raw: raw
      };
    }
    function fmtNum(n, p) {
      var s = n.toFixed(p.decimals);
      if (p.comma) {
        var parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        s = parts.join('.');
      }
      return p.prefix + s + p.suffix;
    }
    /* The count-up is decoration over a published figure, so the
       accessibility tree must always carry the FINAL value — never an
       intermediate frame. The element is given aria-hidden plus a visually
       hidden sibling holding the real number, so assistive tech and
       automated extraction read "71%" even mid-animation, while sighted
       readers still see it count. (Dru's review, 2026-09-22.) */
    function countTo(el, p, dur) {
      if (el.__counted) return;
      el.__counted = true;

      var real = document.createElement('span');
      real.className = 'sr-only';
      real.textContent = p.raw;
      el.setAttribute('aria-hidden', 'true');
      if (el.parentNode) el.parentNode.insertBefore(real, el.nextSibling);

      el.style.fontVariantNumeric = 'tabular-nums';   // steady width while counting
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / dur);
        el.textContent = fmtNum(p.value * easeOutCubic(t), p);
        if (t < 1) requestAnimationFrame(step);
        else {
          el.textContent = p.raw;                     // exact original text
          /* Animation over: hand the number back to the accessibility tree
             and drop the duplicate, so the DOM ends as it started. */
          el.removeAttribute('aria-hidden');
          if (real.parentNode) real.parentNode.removeChild(real);
        }
      }
      el.textContent = fmtNum(0, p);
      requestAnimationFrame(step);
    }
    if (!REDUCED) {
      var nio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          nio.unobserve(e.target);
          if (document.documentElement.classList.contains('anim-frozen')) return; // clock frozen → leave final value
          var p = parseNum(e.target.textContent);
          if (p) countTo(e.target, p, 1200);
        });
      }, { threshold: 0.6 });
      doc.querySelectorAll('.ig-fig__n, .ig-ring__num').forEach(function (el) {
        if (el.closest('[data-calc]')) return;        // calculator owns its live figures
        nio.observe(el);
      });
    }

    setupChrome(doc);
  }

  /* ═══════════════════════════════════════════════════════════════
     Everything that is NOT an entrance animation: navigation, progress,
     calculators, flip cards, sliders. Split out of setupDoc so it still
     runs when reveals are skipped (no IntersectionObserver, or reduced
     motion). Navigation and controls must never depend on the animation
     layer initialising. (Dru's review, 2026-09-22.)
     ═══════════════════════════════════════════════════════════════ */
  function setupChrome(doc) {
    /* ── scroll-spy nav + progress + scroll-reactive glow ─────────── */
    /* Scroll-spy tracks EVERY section, not only the 14 that carry an id.
       A chapter's id sits on its first page, and each page is about one
       viewport tall — so between one chapter opener and the next, no
       id-bearing section satisfied the "is it in the band" test and the
       rail simply went blank (as did the progress bar, same handler).
       Each section already declares its chapter via data-chapter, so use
       that for the highlight and keep the id only for the scroll target. */
    var sections = Array.prototype.slice.call(doc.querySelectorAll('.doc-section')).map(function (el) {
      return { el: el, target: el.getAttribute('data-chapter') || el.id };
    }).filter(function (s) { return s.target; });
    var rows = {};
    var rail = doc.querySelector('.doc-rail');
    var selectBtn = doc.querySelector('.doc-rail__select');
    var selectLabel = doc.querySelector('.doc-rail__select-label');

    /* Is the rail currently the compact dropdown? Matches the CSS
       boundary in forma-webdoc.css — keep the two in step. */
    function isCompact() {
      return window.matchMedia && window.matchMedia('(max-width: 1100px)').matches;
    }

    function closeChapterMenu(returnFocus) {
      if (!rail) return;
      var wasOpen = rail.classList.contains('is-open');
      rail.classList.remove('is-open');
      if (selectBtn) selectBtn.setAttribute('aria-expanded', 'false');
      /* Focus would otherwise be left on an element the CSS is about to
         set to display:none, which drops it to <body>. (Dru, 2026-09-22.) */
      if (wasOpen && returnFocus && selectBtn) selectBtn.focus();
    }

    /* Move focus to the chapter the reader just chose, so the next Tab
       continues from the destination rather than the top of the page.
       tabindex="-1" makes the heading programmatically focusable without
       adding it to the tab sequence; it is removed again on blur so the
       document is left as it was found. */
    function focusTarget(t) {
      if (!t) return;
      var h = t.querySelector('h1, h2, h3, .doc-display, .doc-h2') || t;
      if (!h.hasAttribute('tabindex')) {
        h.setAttribute('tabindex', '-1');
        h.addEventListener('blur', function once() {
          h.removeAttribute('tabindex');
          h.removeEventListener('blur', once);
        });
      }
      h.focus({ preventScroll: true });
    }

    doc.querySelectorAll('.navrow[data-target]').forEach(function (r) {
      rows[r.getAttribute('data-target')] = r;
      r.addEventListener('click', function (ev) {
        var t = doc.querySelector('#' + CSS.escape(r.getAttribute('data-target')));
        if (!t) return;                         // no target → let the href do its job
        /* Modified clicks (new tab/window) and the middle button belong to
           the browser now that these are real links. */
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
        ev.preventDefault();
        var compact = isCompact();
        closeChapterMenu(false);
        t.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
        setActive(t.id);
        /* In the compact menu the list is about to be hidden, so focus must
           move now. On desktop the rail stays put and the reader keeps their
           place in it, so only move focus when the menu was the entry point. */
        if (compact) focusTarget(t);
      });
    });

    /* mobile/tablet "Select a chapter" dropdown */
    if (selectBtn && rail) {
      selectBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var open = rail.classList.toggle('is-open');
        selectBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        /* Opening: put focus on the current chapter (or the first), so a
           keyboard or screen-reader user lands inside the choices instead
           of having to tab past the trigger to find them. */
        if (open) {
          var list = doc.querySelector('.doc-rail__list');
          var current = list && (list.querySelector('.navrow[aria-current]') || list.querySelector('.navrow'));
          if (current) current.focus();
        }
      });
      document.addEventListener('click', function (ev) {
        if (rail.classList.contains('is-open') && !rail.contains(ev.target)) closeChapterMenu(false);
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape') return;
        if (!rail.classList.contains('is-open')) return;
        ev.preventDefault();
        closeChapterMenu(true);                  // Escape returns focus to the trigger
      });
    }

    /* Single source of truth for the active chapter — visible state, the
       compact menu's label and aria-current are set together here and
       nowhere else, so they cannot disagree. (Dru, 2026-09-22: there were
       two scripts updating this independently.) */
    var activeId = null;
    function setActive(id) {
      if (id === activeId) return;
      activeId = id;
      for (var k in rows) {
        var on = (k === id);
        rows[k].classList.toggle('is-active', on);
        if (on) rows[k].setAttribute('aria-current', 'location');
        else rows[k].removeAttribute('aria-current');
      }
      if (selectLabel && rows[id]) selectLabel.textContent = rows[id].textContent.trim();
    }

    var progress = doc.querySelector('.doc-progress');
    var glows = Array.prototype.slice.call(doc.querySelectorAll('.doc-section .doc-glow'));
    var ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var vh = window.innerHeight || document.documentElement.clientHeight;

        /* progress bar */
        if (progress) {
          var sTop = doc.getBoundingClientRect().top + window.pageYOffset;
          var total = doc.offsetHeight - vh;
          var p = total > 0 ? (window.pageYOffset - sTop) / total : 0;
          progress.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
        }

        /* active section (scroll-spy). Nearest section to the reading line,
           with a fallback to whichever one the line is inside — between two
           sections the band test alone can match nothing. */
        var active = null, best = Infinity;
        sections.forEach(function (s) {
          var r = s.el.getBoundingClientRect();
          var d = Math.abs(r.top - vh * 0.32);
          if (r.top < vh * 0.6 && r.bottom > vh * 0.3 && d < best) { best = d; active = s; }
        });
        if (!active) {
          var line = vh * 0.32;
          for (var i = 0; i < sections.length; i++) {
            var rr = sections[i].el.getBoundingClientRect();
            if (rr.top <= line && rr.bottom >= line) { active = sections[i]; break; }
          }
        }
        if (active) setActive(active.target);   // one writer — see setActive above

        /* scroll-reactive glow: --gp 0→1 as section crosses viewport, --gi peaks at centre */
        if (!REDUCED) {
          glows.forEach(function (g) {
            var sec = g.closest('.doc-section');
            var r = sec.getBoundingClientRect();
            var gp = 1 - (r.top + r.height * 0.5) / (vh + r.height); // 0 below → 1 above
            gp = Math.max(0, Math.min(1, gp));
            var centre = 1 - Math.abs((r.top + r.height / 2) - vh / 2) / (vh / 2 + r.height / 2);
            g.style.setProperty('--gp', gp.toFixed(3));
            g.style.setProperty('--gi', (0.45 + Math.max(0, centre) * 0.75).toFixed(3));
          });
        }
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();

    /* ── declarative calculators ──────────────────────────────────
       <div data-calc>
         <input type="range" data-calc-var="people" min=… max=… value=… step=…>
         <b data-calc-bind="people"></b>                         ← echoes value
         <span data-calc-out="people * hours * 52 * rate"></span> ← evaluates
         <i data-calc-fmt="$,0">…</i>  fmt: "$,0" money | ",0" int | "0.0" 1dp | "%" pct
       Expr uses the data-calc-var names. Re-computes on input.            */
    doc.querySelectorAll('[data-calc]').forEach(function (calc) {
      var vars = {};
      var inputs = calc.querySelectorAll('input[data-calc-var]');
      function fmt(n, f) {
        if (f == null) return String(n);
        if (f === '%') return Math.round(n) + '%';
        var dp = /0\.(0+)/.test(f) ? RegExp.$1.length : 0;
        var s = Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
        return (f.indexOf('$') > -1 ? '$' : '') + s;
      }
      function recompute() {
        inputs.forEach(function (inp) { vars[inp.getAttribute('data-calc-var')] = parseFloat(inp.value); });
        calc.querySelectorAll('[data-calc-bind]').forEach(function (el) {
          var k = el.getAttribute('data-calc-bind');
          el.textContent = fmt(vars[k], el.getAttribute('data-calc-fmt'));
        });
        calc.querySelectorAll('[data-calc-out]').forEach(function (el) {
          var expr = el.getAttribute('data-calc-out');
          var val = 0;
          try {
            var keys = Object.keys(vars);
            /* eslint-disable no-new-func */
            val = Function.apply(null, keys.concat('return (' + expr + ');')).apply(null, keys.map(function (k) { return vars[k]; }));
          } catch (err) { val = 0; }
          el.textContent = fmt(val, el.getAttribute('data-calc-fmt'));
          var bar = el.parentNode && el.parentNode.querySelector ? el.parentNode.querySelector('[data-calc-fill]') : null;
        });
        /* optional fill bars: width = value/max */
        calc.querySelectorAll('[data-calc-fill]').forEach(function (b) {
          var expr = b.getAttribute('data-calc-fill');
          var parts = expr.split('/');
          try {
            var keys = Object.keys(vars);
            var num = Function.apply(null, keys.concat('return (' + parts[0] + ');')).apply(null, keys.map(function (k) { return vars[k]; }));
            var den = parseFloat(parts[1]) || 1;
            b.style.width = Math.max(0, Math.min(1, num / den)) * 100 + '%';
          } catch (err) {}
        });
      }
      inputs.forEach(function (inp) { inp.addEventListener('input', recompute); });

      /* Announce the result to screen readers on `change` (pointer released,
         or arrow-key settled) rather than on every `input` tick — dragging a
         slider fires input per pixel and would make the live region
         unusable. The visible figures still update on input. */
      var announce = calc.querySelector('[data-calc-announce]');
      if (announce) {
        var announceTimer = null;
        function sayResult() {
          clearTimeout(announceTimer);
          announceTimer = setTimeout(function () {
            var parts = [];
            calc.querySelectorAll('[data-calc-out]').forEach(function (el) {
              var lbl = el.getAttribute('aria-labelledby');
              var lblEl = lbl && document.getElementById(lbl);
              parts.push((lblEl ? lblEl.textContent.trim() + ': ' : '') + el.textContent.trim());
            });
            announce.textContent = parts.join('. ');
          }, 120);
        }
        inputs.forEach(function (inp) {
          inp.addEventListener('change', sayResult);
          /* Arrow keys fire input+change together in most engines, but
             Safari holds `change` until blur on range inputs — keyup keeps
             keyboard operation announcing at the same pace as pointer use. */
          inp.addEventListener('keyup', function (ev) {
            if (ev.key && ev.key.indexOf('Arrow') === 0) sayResult();
            else if (ev.key === 'Home' || ev.key === 'End' || ev.key === 'PageUp' || ev.key === 'PageDown') sayResult();
          });
        });
      }
      /* preset chips: data-calc-preset="people:40,hours:12" */
      calc.querySelectorAll('[data-calc-preset]').forEach(function (chip) {
        chip.addEventListener('click', function () {
          chip.getAttribute('data-calc-preset').split(',').forEach(function (pair) {
            var kv = pair.split(':'); var inp = calc.querySelector('input[data-calc-var="' + kv[0].trim() + '"]');
            if (inp) inp.value = kv[1];
          });
          calc.querySelectorAll('[data-calc-preset]').forEach(function (c) { c.classList.remove('is-on'); });
          chip.classList.add('is-on');
          recompute();
        });
      });
      recompute();
    });

    /* ── flip cards: tap / keyboard toggles a persistent flip ──────── */
    doc.querySelectorAll('.flipcard').forEach(function (card) {
      if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', 'false');
      function toggle() {
        var f = card.classList.toggle('is-flipped');
        card.setAttribute('aria-pressed', f ? 'true' : 'false');
      }
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });

    /* ── carousels / sliders ──────────────────────────────────────
       Scroll-snap track + generated dots + arrows + drag/swipe + keys.
       Re-runnable: skips any [data-slider] already wired.               */
    doc.querySelectorAll('[data-slider]').forEach(function (sl) {
      if (sl.__slInit) return;
      var track = sl.querySelector('.doc-slider__track');
      if (!track) return;
      sl.__slInit = true;
      var slides = Array.prototype.slice.call(track.querySelectorAll('.doc-slide'));
      var dotsWrap = sl.querySelector('.doc-slider__dots');
      var prev = sl.querySelector('[data-slider-prev]');
      var next = sl.querySelector('[data-slider-next]');
      var dots = [];

      function curIdx() {
        var centre = track.scrollLeft + track.clientWidth / 2;
        var best = 0, bd = Infinity;
        slides.forEach(function (s, i) {
          var mid = s.offsetLeft - slides[0].offsetLeft + s.offsetWidth / 2;
          var d = Math.abs(mid - (track.scrollLeft + track.clientWidth / 2));
          if (d < bd) { bd = d; best = i; }
        });
        return best;
      }
      function scrollToIdx(i) {
        i = Math.max(0, Math.min(slides.length - 1, i));
        track.scrollTo({ left: slides[i].offsetLeft - slides[0].offsetLeft, behavior: REDUCED ? 'auto' : 'smooth' });
      }
      var raf2 = false;
      function update() {
        var idx = curIdx();
        dots.forEach(function (d, i) { d.classList.toggle('is-on', i === idx); });
        if (prev) prev.disabled = track.scrollLeft <= 2;
        if (next) next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
      }

      if (dotsWrap) {
        slides.forEach(function (s, i) {
          var d = document.createElement('button');
          d.className = 'doc-slider__dot'; d.type = 'button';
          d.setAttribute('aria-label', 'Go to slide ' + (i + 1));
          d.addEventListener('click', function () { scrollToIdx(i); });
          dotsWrap.appendChild(d); dots.push(d);
        });
      }
      if (prev) prev.addEventListener('click', function () { scrollToIdx(curIdx() - 1); });
      if (next) next.addEventListener('click', function () { scrollToIdx(curIdx() + 1); });
      track.addEventListener('scroll', function () {
        if (raf2) return; raf2 = true;
        requestAnimationFrame(function () { update(); raf2 = false; });
      }, { passive: true });

      /* drag / swipe to scroll */
      var down = false, sx = 0, sl0 = 0, moved = false;
      track.addEventListener('pointerdown', function (e) {
        down = true; moved = false; sx = e.clientX; sl0 = track.scrollLeft; sl.classList.add('is-grabbing');
      });
      window.addEventListener('pointermove', function (e) {
        if (!down) return;
        var dx = e.clientX - sx; if (Math.abs(dx) > 4) moved = true;
        track.scrollLeft = sl0 - dx;
      });
      window.addEventListener('pointerup', function () {
        if (!down) return; down = false; sl.classList.remove('is-grabbing');
        if (moved) scrollToIdx(curIdx());
      });

      /* keyboard when the slider is focused */
      if (!sl.hasAttribute('tabindex')) sl.setAttribute('tabindex', '0');
      sl.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); scrollToIdx(curIdx() + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollToIdx(curIdx() - 1); }
      });

      update();
      window.addEventListener('resize', update);
    });

    /* ── scrollable tables: make the overflow discoverable ─────────
       A wide table in a plain overflow-x:auto box gives no sign that more
       columns exist, and no way for a keyboard user to scroll it. So:
       when (and only when) the table actually overflows, show a text hint
       plus edge fades, and make the scroller a tab stop with an accessible
       name. When it fits, all of that is removed — a focusable region that
       cannot scroll is a dead tab stop. (Dru's review, 2026-09-22.) */
    doc.querySelectorAll('[data-tablescroll]').forEach(function (wrap) {
      var view = wrap.querySelector('.tablescroll__view');
      if (!view) return;
      var table = view.querySelector('table');
      var cap = table && table.querySelector('caption');

      function syncEdges() {
        var max = view.scrollWidth - view.clientWidth;
        wrap.classList.toggle('is-atstart', view.scrollLeft <= 1);
        wrap.classList.toggle('is-atend', view.scrollLeft >= max - 1);
      }
      function sync() {
        /* 2px of slack: sub-pixel layout can report a 0.5px overflow on a
           table that visually fits, which would strand an empty hint. */
        var scrollable = view.scrollWidth - view.clientWidth > 2;
        wrap.classList.toggle('is-scrollable', scrollable);
        if (scrollable) {
          /* The edge fades are anchored to the wrapper, which also contains
             the hint line above the table. Offset their top by the hint's
             height so a fade never sits over "…see more". */
          var hint = wrap.querySelector('.tablescroll__hint');
          if (hint) {
            var hs = window.getComputedStyle(hint);
            wrap.style.setProperty('--tsHintH',
              (hint.offsetHeight + (parseFloat(hs.marginBottom) || 0)) + 'px');
          }
          view.setAttribute('tabindex', '0');
          view.setAttribute('role', 'region');
          if (!view.hasAttribute('aria-label')) {
            view.setAttribute('aria-label',
              (cap ? cap.textContent.trim().replace(/\.$/, '') : 'Data table') + ' (scrollable)');
          }
          syncEdges();
        } else {
          view.removeAttribute('tabindex');
          view.removeAttribute('role');
          view.removeAttribute('aria-label');
          wrap.classList.remove('is-atstart', 'is-atend');
        }
      }
      view.addEventListener('scroll', function () {
        if (wrap.classList.contains('is-scrollable')) syncEdges();
      }, { passive: true });
      window.addEventListener('resize', sync);
      /* Fonts landing after first paint change the table's intrinsic width,
         so re-measure once they are ready rather than trusting first layout. */
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync).catch(function () {});
      sync();
    });

    /* ── rail toggle (hamburger / off switch) ─────────────────────── */
    doc.querySelectorAll('[data-rail-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        doc.classList.toggle('rail-off');
      });
    });
  }

  window.Forma = window.Forma || {};
  window.Forma.initWebDoc = initWebDoc;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { initWebDoc(); });
  else initWebDoc();
})();
