/* =====================================================================
   BLISS — behavior layer
   v1.0.0 · MIT · companion to bliss.css

   Zero dependencies. Auto-wires components on load and re-wires safely if
   you call Bliss.init(root) after injecting markup. Everything is opt-in via
   classes / data-attributes; nothing global is touched.

   PUBLIC API
     Bliss.init(root = document)        rewire components inside root
     Bliss.setTheme('blue'|'olive'|'silver'[, el])
     Bliss.toast(stringOrOptions)       {title, body, icon, timeout}
     Bliss.openDialog(elOrSelector)     /  Bliss.closeDialog(...)
     Bliss.openWindow(elOrSelector)     /  Bliss.closeWindow(...)
     Bliss.on(event, fn)                events: 'theme', 'window:open', 'window:close'

   DATA-ATTRIBUTE HOOKS
     [data-bl-open="#dialog"]           open a .bl-overlay dialog
     [data-bl-close]                    close the nearest open overlay
     [data-bl-menu="#menu"]             menubar item → dropdown .bl-menu
     [data-bl-context="#menu"]          right-click target → .bl-menu
     [data-bl-open-window="#win"]       icon (dblclick) / menu item (click)
     [data-bl-tasklist]                 container that holds taskbar buttons
     [data-bl-min] [data-bl-max] [data-bl-close]   window control buttons
     [data-bl-clock]                    element that shows the tray clock
     [data-bl-min="N"] [data-bl-max="N"] on .bl-spin to bound a spinner
   ===================================================================== */
(function (global) {
  'use strict';

  var Bliss = {};
  var uid = 0;
  var wiredGlobal = false;
  var bus = {};

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function resolve(t) { return typeof t === 'string' ? document.querySelector(t) : t; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function once(el, key) { if (el.dataset['blw' + key]) return false; el.dataset['blw' + key] = '1'; return true; }

  Bliss.on = function (evt, fn) { (bus[evt] = bus[evt] || []).push(fn); };
  function emit(evt, d) { (bus[evt] || []).forEach(function (f) { try { f(d); } catch (e) {} }); }

  /* ---------------- theme ---------------- */
  Bliss.setTheme = function (name, el) {
    el = el || document.querySelector('.bl-root') || document.body;
    el.setAttribute('data-bl-theme', name);
    emit('theme', { theme: name, el: el });
  };

  /* ---------------- toggles: checkbox / radio / switch ---------------- */
  function wireToggles(root) {
    $all('[role="checkbox"].bl-check, [role="switch"].bl-switch', root).forEach(function (el) {
      if (!once(el, 'tog')) return;
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      function flip() { el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); emit('change', { el: el }); }
      el.addEventListener('click', flip);
      el.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
    });
    $all('[role="radio"].bl-check', root).forEach(function (el) {
      if (!once(el, 'rad')) return;
      if (!el.hasAttribute('tabindex')) el.tabIndex = el.getAttribute('aria-checked') === 'true' ? 0 : -1;
      function pick() {
        var group = el.closest('[role="radiogroup"]') || el.parentElement;
        $all('[role="radio"].bl-check', group).forEach(function (r) { r.setAttribute('aria-checked', 'false'); r.tabIndex = -1; });
        el.setAttribute('aria-checked', 'true'); el.tabIndex = 0; el.focus(); emit('change', { el: el });
      }
      el.addEventListener('click', pick);
      el.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(); } });
    });
  }

  /* ---------------- tabs ---------------- */
  function wireTabs(root) {
    $all('[role="tablist"]', root).forEach(function (list) {
      if (!once(list, 'tab')) return;
      var tabs = $all('[role="tab"], .bl-tab', list);
      function select(tab, focus) {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !on;
        });
        if (focus) tab.focus();
      }
      tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { select(tab, false); });
        tab.addEventListener('keydown', function (e) {
          var last = tabs.length - 1, n = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = tabs[i === last ? 0 : i + 1];
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = tabs[i === 0 ? last : i - 1];
          else if (e.key === 'Home') n = tabs[0];
          else if (e.key === 'End') n = tabs[last];
          if (n) { e.preventDefault(); select(n, true); }
        });
      });
    });
  }

  /* ---------------- spinner ---------------- */
  function wireSpinners(root) {
    $all('.bl-spin', root).forEach(function (sp) {
      if (!once(sp, 'spin')) return;
      var inp = sp.querySelector('input');
      var min = parseInt(sp.getAttribute('data-bl-min'), 10); if (isNaN(min)) min = 0;
      var max = parseInt(sp.getAttribute('data-bl-max'), 10); if (isNaN(max)) max = 99;
      function step(d) { var v = parseInt(inp.value, 10); if (isNaN(v)) v = min; inp.value = Math.max(min, Math.min(max, v + d)); }
      var up = sp.querySelector('.bl-spin__up'), dn = sp.querySelector('.bl-spin__dn');
      if (up) up.addEventListener('click', function () { step(1); });
      if (dn) dn.addEventListener('click', function () { step(-1); });
    });
  }

  /* ---------------- slider fill ---------------- */
  function wireSliders(root) {
    $all('input.bl-slider', root).forEach(function (r) {
      function paint() { var min = +r.min || 0, max = +r.max || 100; r.style.setProperty('--bl-pct', ((r.value - min) / (max - min) * 100) + '%'); }
      paint();
      if (once(r, 'sld')) r.addEventListener('input', paint);
    });
  }

  /* ---------------- collapsible task groups ---------------- */
  function wireTaskGroups(root) {
    $all('.bl-tasks__head', root).forEach(function (h) {
      if (!once(h, 'tg')) return;
      h.addEventListener('click', function () { var g = h.closest('.bl-tasks__group'); if (g) g.classList.toggle('is-collapsed'); });
    });
  }

  /* ---------------- tree view ---------------- */
  function wireTrees(root) {
    $all('.bl-tree', root).forEach(function (tree) {
      if (!once(tree, 'tree')) return;
      $all('.bl-tree__toggle', tree).forEach(function (tg) {
        tg.addEventListener('click', function (e) {
          e.stopPropagation();
          var item = tg.closest('.bl-tree__item');
          var grp = item && item.nextElementSibling;
          if (grp && grp.classList.contains('bl-tree__group')) { grp.hidden = !grp.hidden; tg.textContent = grp.hidden ? '+' : '−'; }
        });
      });
      $all('.bl-tree__item', tree).forEach(function (it) {
        it.addEventListener('click', function () {
          $all('.bl-tree__item', tree).forEach(function (x) { x.setAttribute('aria-selected', 'false'); });
          it.setAttribute('aria-selected', 'true');
        });
      });
    });
  }

  /* ---------------- selectable rows (listview + grid) ---------------- */
  function wireSelectables(root) {
    $all('.bl-listview', root).forEach(function (lb) {
      if (!once(lb, 'lv')) return;
      $all('.bl-listview__item', lb).forEach(function (r) {
        r.addEventListener('click', function () {
          $all('.bl-listview__item', lb).forEach(function (x) { x.setAttribute('aria-selected', 'false'); });
          r.setAttribute('aria-selected', 'true');
        });
      });
    });
    $all('.bl-grid', root).forEach(function (g) {
      if (!once(g, 'gr')) return;
      $all('tbody tr', g).forEach(function (r) {
        r.addEventListener('click', function () {
          $all('tbody tr', g).forEach(function (x) { x.setAttribute('aria-selected', 'false'); });
          r.setAttribute('aria-selected', 'true');
        });
      });
    });
  }

  /* ---------------- balloons ---------------- */
  function wireBalloons(root) {
    $all('.bl-balloon__close', root).forEach(function (x) {
      if (!once(x, 'bal')) return;
      x.addEventListener('click', function () { var b = x.closest('.bl-balloon'); if (b) b.hidden = true; });
    });
  }

  /* ---------------- dialogs ---------------- */
  Bliss.openDialog = function (t) {
    var ov = resolve(t); if (!ov) return;
    ov.classList.add('is-open');
    var f = ov.querySelector('[data-bl-autofocus]') || ov.querySelector('[data-bl-close]') || ov.querySelector('button, .bl-btn');
    if (f) f.focus();
  };
  Bliss.closeDialog = function (t) { var ov = resolve(t); if (ov) ov.classList.remove('is-open'); };
  function wireDialogs(root) {
    $all('[data-bl-open]', root).forEach(function (b) {
      if (!once(b, 'dlgo')) return;
      b.addEventListener('click', function () { Bliss.openDialog(b.getAttribute('data-bl-open')); });
    });
    $all('.bl-overlay', root).forEach(function (ov) {
      if (!once(ov, 'dlg')) return;
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.classList.remove('is-open'); });
      $all('[data-bl-close]', ov).forEach(function (c) { c.addEventListener('click', function () { ov.classList.remove('is-open'); }); });
    });
  }

  /* ---------------- menus (menubar dropdowns + context) ---------------- */
  var openMenu = null;
  function closeMenus() {
    if (openMenu) { openMenu.hidden = true; openMenu = null; }
    $all('.bl-menubar__item.is-open').forEach(function (i) { i.classList.remove('is-open'); });
  }
  function showMenu(menu, x, y) {
    closeMenus();
    menu.hidden = false; menu.style.position = 'fixed';
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(2, Math.min(x, window.innerWidth - mw - 4)) + 'px';
    menu.style.top = Math.max(2, Math.min(y, window.innerHeight - mh - 4)) + 'px';
    openMenu = menu;
  }
  function wireMenus(root) {
    $all('[data-bl-menu]', root).forEach(function (item) {
      if (!once(item, 'menu')) return;
      var menu = document.querySelector(item.getAttribute('data-bl-menu'));
      if (!menu) return;
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        if (openMenu === menu) { closeMenus(); return; }
        var r = item.getBoundingClientRect();
        closeMenus(); item.classList.add('is-open'); showMenu(menu, r.left, r.bottom);
      });
    });
    $all('[data-bl-context]', root).forEach(function (el) {
      if (!once(el, 'ctx')) return;
      var menu = document.querySelector(el.getAttribute('data-bl-context'));
      if (!menu) return;
      el.addEventListener('contextmenu', function (e) { e.preventDefault(); showMenu(menu, e.clientX, e.clientY); });
    });
  }

  /* ---------------- desktop / window manager ---------------- */
  function wireDesktop(desk) {
    if (!once(desk, 'desk')) return;
    var taskList = desk.querySelector('[data-bl-tasklist]') || desk.querySelector('.bl-tasklist');
    var taskBtns = {};
    var zTop = 100;

    function wins() { return $all('.bl-window', desk); }
    function focus(w) {
      zTop += 1; w.style.zIndex = zTop;
      wins().forEach(function (x) { x.classList.add('is-inactive'); });
      w.classList.remove('is-inactive');
      Object.keys(taskBtns).forEach(function (id) { taskBtns[id].classList.toggle('is-active', id === w.id); });
    }
    function addTaskBtn(w) {
      if (!taskList || taskBtns[w.id]) { if (taskBtns[w.id]) taskBtns[w.id].classList.add('is-active'); return; }
      var b = document.createElement('button'); b.className = 'bl-taskbtn is-active';
      var icon = w.querySelector('.bl-titlebar__icon');
      if (icon) { var c = icon.cloneNode(true); c.removeAttribute('class'); b.appendChild(c); }
      var span = document.createElement('span');
      span.textContent = (w.querySelector('.bl-titlebar__title') || {}).textContent || w.getAttribute('data-bl-title') || 'Window';
      b.appendChild(span);
      b.addEventListener('click', function () {
        if (w.hidden || w.classList.contains('is-min')) { w.hidden = false; w.classList.remove('is-min'); focus(w); }
        else if (b.classList.contains('is-active')) { w.classList.add('is-min'); b.classList.remove('is-active'); }
        else focus(w);
      });
      taskList.appendChild(b); taskBtns[w.id] = b;
    }
    function open(w) { w.hidden = false; w.classList.remove('is-min'); addTaskBtn(w); focus(w); closeStart(); emit('window:open', { el: w }); }
    function close(w) { w.hidden = true; if (taskBtns[w.id]) { taskBtns[w.id].remove(); delete taskBtns[w.id]; } emit('window:close', { el: w }); }
    function minimize(w) { w.classList.add('is-min'); if (taskBtns[w.id]) taskBtns[w.id].classList.remove('is-active'); }
    function toggleMax(w) {
      if (w.classList.contains('is-max')) {
        w.classList.remove('is-max');
        w.style.left = w.dataset.blL || ''; w.style.top = w.dataset.blT || ''; w.style.width = w.dataset.blW || ''; w.style.height = w.dataset.blH || '';
      } else {
        w.dataset.blL = w.style.left; w.dataset.blT = w.style.top; w.dataset.blW = w.style.width; w.dataset.blH = w.style.height;
        w.classList.add('is-max');
        w.style.left = '0'; w.style.top = '0'; w.style.width = '100%'; w.style.height = 'calc(100% - 38px)';
      }
      focus(w);
    }
    function bind(w, sel, fn) { var el = w.querySelector(sel); if (el) el.addEventListener('click', function (e) { e.stopPropagation(); fn(w); }); }
    function makeDraggable(w, bar) {
      var dragging = false, ox = 0, oy = 0;
      bar.addEventListener('pointerdown', function (e) {
        if (e.target.closest('.bl-winbtn') || w.classList.contains('is-max')) return;
        dragging = true; bar.setPointerCapture(e.pointerId);
        var wr = w.getBoundingClientRect(), dr = desk.getBoundingClientRect();
        ox = e.clientX - wr.left; oy = e.clientY - wr.top;
      });
      bar.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var dr = desk.getBoundingClientRect();
        var nx = Math.max(0, Math.min(e.clientX - dr.left - ox, dr.width - 60));
        var ny = Math.max(0, Math.min(e.clientY - dr.top - oy, dr.height - 40));
        w.style.left = nx + 'px'; w.style.top = ny + 'px';
      });
      function end() { dragging = false; }
      bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    }

    wins().forEach(function (w) {
      if (!w.id) w.id = 'bl-win-' + (++uid);
      w._blOpen = function () { open(w); };
      w._blClose = function () { close(w); };
      w.addEventListener('pointerdown', function () { focus(w); });
      var bar = w.querySelector('.bl-titlebar');
      bind(w, '[data-bl-close]', close);
      bind(w, '[data-bl-min]', minimize);
      bind(w, '[data-bl-max]', toggleMax);
      if (bar) { bar.addEventListener('dblclick', function (e) { if (e.target.closest('.bl-winbtn')) return; toggleMax(w); }); makeDraggable(w, bar); }
    });

    $all('[data-bl-open-window]', desk).forEach(function (el) {
      var target = el.getAttribute('data-bl-open-window');
      function go() { var w = desk.querySelector(target); if (w) open(w); }
      var inMenu = el.closest('.bl-startmenu') || el.closest('.bl-menu');
      el.addEventListener(inMenu ? 'click' : 'dblclick', go);
      if (!inMenu) {
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        el.addEventListener('click', function () { $all('[data-bl-open-window]', desk).forEach(function (i) { if (!i.closest('.bl-startmenu') && !i.closest('.bl-menu')) i.classList.remove('is-selected'); }); el.classList.add('is-selected'); });
      }
    });

    /* start menu */
    var startBtn = desk.querySelector('.bl-startbtn');
    var startMenu = desk.querySelector('.bl-startmenu');
    function openStart(o) { if (!startBtn || !startMenu) return; startBtn.setAttribute('aria-expanded', String(o)); if (o) { startMenu.hidden = false; startMenu.classList.add('is-open'); } else { startMenu.classList.remove('is-open'); startMenu.hidden = true; } }
    function closeStart() { openStart(false); }
    desk._blCloseStart = closeStart;
    if (startBtn) startBtn.addEventListener('click', function (e) { e.stopPropagation(); openStart(startBtn.getAttribute('aria-expanded') !== 'true'); });
    desk.addEventListener('pointerdown', function (e) {
      if (startMenu && !startMenu.hidden && !startMenu.contains(e.target) && (!startBtn || (e.target !== startBtn && !startBtn.contains(e.target)))) closeStart();
    });

    /* tray clock */
    var clock = desk.querySelector('[data-bl-clock]');
    if (clock) {
      var tick = function () { var d = new Date(), h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12; clock.textContent = h + ':' + (m < 10 ? '0' + m : m) + ' ' + ap; };
      tick(); setInterval(tick, 15000);
    }
  }

  /* find a window's desktop and open/close it */
  Bliss.openWindow = function (t) { var w = resolve(t); if (w && w._blOpen) w._blOpen(); };
  Bliss.closeWindow = function (t) { var w = resolve(t); if (w && w._blClose) w._blClose(); };

  /* ---------------- toasts ---------------- */
  Bliss.toast = function (opts) {
    if (typeof opts === 'string') opts = { body: opts };
    opts = opts || {};
    var host = document.querySelector('.bl-toast-host');
    if (!host) { host = document.createElement('div'); host.className = 'bl-toast-host'; document.body.appendChild(host); }
    var t = document.createElement('div'); t.className = 'bl-toast';
    var icon = opts.icon !== undefined ? opts.icon : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/></svg>';
    t.innerHTML = (icon || '') + '<div>' + (opts.title ? '<strong>' + esc(opts.title) + '</strong><br>' : '') + esc(opts.body || '') + '</div>';
    host.appendChild(t);
    var ms = opts.timeout || 2800;
    setTimeout(function () { t.classList.add('is-out'); setTimeout(function () { if (t.parentNode) t.remove(); }, 240); }, ms);
    return t;
  };

  /* ---------------- global handlers (bound once) ---------------- */
  function wireGlobal() {
    if (wiredGlobal) return; wiredGlobal = true;
    document.addEventListener('click', function (e) {
      var inMenu = e.target.closest && e.target.closest('.bl-menu');
      if (inMenu) { var item = e.target.closest('.bl-menu__item'); if (item && !item.classList.contains('bl-menu__item--disabled')) closeMenus(); return; }
      if (!(e.target.closest && e.target.closest('[data-bl-menu]'))) closeMenus();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      closeMenus();
      $all('.bl-overlay.is-open').forEach(function (o) { o.classList.remove('is-open'); });
      $all('.bl-desktop').forEach(function (d) { if (d._blCloseStart) d._blCloseStart(); });
    });
    window.addEventListener('resize', closeMenus);
  }

  /* ---------------- init ---------------- */
  Bliss.init = function (root) {
    root = root || document;
    wireToggles(root); wireTabs(root); wireSpinners(root); wireSliders(root);
    wireTaskGroups(root); wireTrees(root); wireSelectables(root); wireBalloons(root);
    wireDialogs(root); wireMenus(root);
    $all('.bl-desktop', root).forEach(wireDesktop);
    wireGlobal();
    return Bliss;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { Bliss.init(); });
  else Bliss.init();

  global.Bliss = Bliss;
})(typeof window !== 'undefined' ? window : this);
