/**
 * ObraMate — a mesma barra superior e inferior em todos os apps. Par de om-shell.css.
 * Carregado no <head>, antes do corpo, para os scripts de cada app poderem usar logo de cara.
 *
 *   OmShell.icon("home")                     ícone (conjunto único, um desenho por significado)
 *   OmShell.top({ app, href, actions })      <header> com ícone + nome do app e as ações à direita
 *       actions: [{ kind: "avatar"|"btn", id, label, icon, text, href, onClick, menu: { who, email, items } }]
 *   OmShell.tabs({ id, label, items, search, className })   <nav> pílula; até 5 abas
 *       items: [{ key, label, icon, href, active, attrs }]  sem href vira <button>
 *   OmShell.searchButton({ id, label, onClick })
 *   <span data-om-icon="home"></span>        em HTML estático: o ícone é preenchido ao carregar
 */
(function (global) {
  "use strict";
  if (global.OmShell) return;

  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    home: svg('<path d="M3 10.5L12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
    leads: svg('<path d="M3.5 4.5h17l-6.5 8v6l-4 2v-8z"/>'),
    calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    jobs: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
    invoice: svg('<path d="M14 2H6a2 2 0 00-2 2v16l3-1.5 3 1.5 3-1.5 3 1.5V4a2 2 0 00-2-2z"/><path d="M8 7h6M8 11h6"/>'),
    more: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    chat: svg('<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    camera: svg('<path d="M3 8.5A2.5 2.5 0 015.5 6h1.6l1.4-2h7l1.4 2h1.6A2.5 2.5 0 0121 8.5v9a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z"/><circle cx="12" cy="13" r="3.6"/>'),
    settings: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
    ruler: svg('<path d="M3 17 17 3l4 4L7 21H3z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
    bell: svg('<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>'),
  };
  const APPS = {
    obramate: { name: "ObraMate", icon: "/assets/favicon-192.png?v=20260924-pwa" },
    obrabuilder: { name: "ObraBuilder", icon: "/assets/obrabuilder/icon-192.png?v=1" },
    obracrew: { name: "ObraCrew", icon: "/assets/obracrew/icon-192.png?v=1" },
    obracam: { name: "ObraCam", icon: "/assets/obracam/icon-192.png?v=1" },
  };

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (name) => ICONS[name] || "";

  function initials(name) {
    const parts = String(name || "").replace(/@.*/, "").trim().split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return "—";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /** Inner HTML of the brand link, shared with pages that build their own header. */
  function brandHtml(app) {
    const a = APPS[app] || APPS.obramate;
    return `<img class="om-shell-mark" src="${esc(a.icon)}" alt="" width="36" height="36" /><span class="om-shell-name">${esc(a.name)}</span>`;
  }

  function bindMenu(trigger, menu) {
    const close = () => {
      if (menu.hidden) return;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      const open = menu.hidden;
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) {
        const first = menu.querySelector("a,button");
        if (first) first.focus({ preventScroll: true });
      }
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && !trigger.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        close();
        trigger.focus({ preventScroll: true });
      }
    });
    return { close };
  }

  function top(cfg) {
    const c = cfg || {};
    const a = APPS[c.app] || APPS.obramate;
    const header = document.createElement("header");
    header.className = `om-shell-top${c.className ? ` ${c.className}` : ""}`;
    if (c.id) header.id = c.id;
    header.setAttribute("aria-label", c.label || "Barra superior");
    const brand = document.createElement(c.href ? "a" : "div");
    brand.className = "om-shell-brand";
    if (c.href) {
      brand.href = c.href;
      brand.setAttribute("aria-label", `${a.name} — início`);
    }
    brand.innerHTML = brandHtml(c.app);
    const actions = document.createElement("div");
    actions.className = "om-shell-actions";
    (c.actions || []).forEach((act) => {
      const el = document.createElement(act.href ? "a" : "button");
      if (!act.href) el.type = "button";
      else el.href = act.href;
      el.className = act.kind === "avatar" ? "om-shell-avatar" : "om-shell-btn";
      if (act.id) el.id = act.id;
      if (act.label) el.setAttribute("aria-label", act.label);
      el.innerHTML = act.kind === "avatar" ? esc(act.text || "—") : icon(act.icon);
      if (act.onClick) el.addEventListener("click", act.onClick);
      actions.appendChild(el);
      if (act.menu) {
        const menu = document.createElement("div");
        menu.className = "om-shell-menu";
        menu.hidden = true;
        menu.innerHTML =
          (act.menu.who ? `<div class="om-shell-menu__who"><strong>${esc(act.menu.who)}</strong>${esc(act.menu.email || "")}</div>` : "") +
          (act.menu.items || [])
            .map((it, i) =>
              it.href
                ? `<a class="om-shell-menu__item" href="${esc(it.href)}">${esc(it.label)}</a>`
                : `<button type="button" class="om-shell-menu__item" data-i="${i}">${esc(it.label)}</button>`,
            )
            .join("");
        menu.addEventListener("click", (e) => {
          const b = e.target.closest("button[data-i]");
          if (b) (act.menu.items[Number(b.dataset.i)].onClick || (() => {}))();
        });
        actions.appendChild(menu);
        bindMenu(el, menu);
      }
    });
    header.append(brand, actions);
    return header;
  }

  /** The field team's top bar: the same on Campo pages and on Jobs/Chat, which are shared with the CRM. */
  function crewTop(id, className) {
    const logout = () => {
      fetch("/api/auth/logout", { method: "POST", credentials: "include" })
        .catch(() => {})
        .then(() => {
          location.href = "/login.html?app=obracrew";
        });
    };
    const build = (name, email) =>
      top({
        id,
        className,
        app: "obracrew",
        href: "/campo/hoje.html",
        actions: [
          {
            kind: "avatar",
            label: "Minha conta",
            text: name ? initials(name) : "—",
            menu: { who: name || "Minha conta", email: email || "", items: [{ label: "Sair", onClick: logout }] },
          },
        ],
      });
    const el = build("", "");
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => r.json())
      .then((s) => {
        if (s && s.user && el.isConnected) el.replaceWith(build(s.user.name || s.user.email || "", s.user.email || ""));
      })
      .catch(() => {});
    return el;
  }

  function tabButtonHtml(it) {
    const tag = it.href ? "a" : "button";
    const attrs = [
      `class="om-shell-tab${it.className ? ` ${it.className}` : ""}${it.active ? " is-active" : ""}"`,
      it.href ? `href="${esc(it.href)}"` : 'type="button"',
      it.active ? 'aria-current="page"' : "",
      it.attrs || "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<${tag} ${attrs}>${icon(it.icon)}<span>${esc(it.label)}</span></${tag}>`;
  }

  function tabs(cfg) {
    const c = cfg || {};
    const nav = document.createElement("nav");
    if (c.id) nav.id = c.id;
    nav.className = `om-shell-tabs${c.search ? " has-search" : ""}${c.className ? ` ${c.className}` : ""}`;
    nav.setAttribute("aria-label", c.label || "Navegação principal");
    nav.innerHTML = (c.items || []).map(tabButtonHtml).join("");
    return nav;
  }

  function searchButton(cfg) {
    const c = cfg || {};
    const b = document.createElement("button");
    b.type = "button";
    if (c.id) b.id = c.id;
    b.className = `om-shell-search${c.className ? ` ${c.className}` : ""}`;
    b.setAttribute("aria-label", c.label || "Buscar");
    b.innerHTML = icon("search");
    if (c.onClick) b.addEventListener("click", c.onClick);
    return b;
  }

  function hydrate(root) {
    (root || document).querySelectorAll("[data-om-icon]").forEach((el) => {
      const html = icon(el.getAttribute("data-om-icon"));
      if (html) el.outerHTML = html;
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => hydrate());
  else hydrate();

  global.OmShell = { VER: "20261105-hammer1", APPS, icons: ICONS, icon, brandHtml, initials, top, crewTop, tabs, searchButton, hydrate };
})(window);
