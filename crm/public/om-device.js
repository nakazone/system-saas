/**
 * ObraMate device gate — mobile app shell vs desktop CRM.
 * Uses user-agent (and iPadOS touch Mac) so PC keeps the classic layout.
 */
(function (global) {
  function isMobileUa(ua) {
    const s = String(ua || "");
    if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(s)) return true;
    if (/iPad/i.test(s)) return true;
    return false;
  }

  function isIpadOsDesktopUa() {
    try {
      return (
        typeof navigator !== "undefined" &&
        navigator.platform === "MacIntel" &&
        Number(navigator.maxTouchPoints || 0) > 1
      );
    } catch (_) {
      return false;
    }
  }

  function isMobile() {
    if (typeof navigator === "undefined") return false;
    return isMobileUa(navigator.userAgent) || isIpadOsDesktopUa();
  }

  function entryHref() {
    return isMobile() ? "home.html" : "pipeline-lab.html";
  }

  function applyBodyClass() {
    if (typeof document === "undefined" || !document.body) return;
    document.body.classList.toggle("om-device-mobile", isMobile());
    document.body.classList.toggle("om-device-desktop", !isMobile());
  }

  /** Redirect desktop away from the mobile-only Home. */
  function guardMobileOnlyPage(desktopHref) {
    if (isMobile()) return false;
    const target = desktopHref || "pipeline-lab.html";
    try {
      location.replace(target);
    } catch (_) {
      location.href = target;
    }
    return true;
  }

  const api = {
    isMobileUa,
    isMobile,
    entryHref,
    applyBodyClass,
    guardMobileOnlyPage,
  };

  global.__omDevice = api;

  if (typeof document !== "undefined") {
    if (document.body) applyBodyClass();
    else document.addEventListener("DOMContentLoaded", applyBodyClass);
  }
})(typeof window !== "undefined" ? window : globalThis);
