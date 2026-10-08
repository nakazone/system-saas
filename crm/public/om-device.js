/**
 * ObraMate device gate — phone app shell vs desktop CRM.
 * Tablets use the desktop CRM (sidebar, job detail, etc.), not the phone shell.
 * Uses user-agent (and iPadOS touch Mac) so PC keeps the classic layout.
 */
(function (global) {
  function isPhoneUa(ua) {
    const s = String(ua || "");
    // Narrow phone UAs — large Android devices may also match and get reclassified as tablet.
    if (/iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(s)) return true;
    if (/Android/i.test(s) && /Mobile/i.test(s)) return true;
    return false;
  }

  function isTabletUa(ua) {
    const s = String(ua || "");
    if (/iPad/i.test(s)) return true;
    if (/Android/i.test(s) && !/Mobile/i.test(s)) return true;
    if (/Tablet|PlayBook|Silk/i.test(s)) return true;
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

  /** Large touch screens that still report a "phone" UA (common on Android tablets). */
  function isLargeTouchScreen() {
    try {
      if (typeof window === "undefined") return false;
      const w = Math.max(Number(window.screen && window.screen.width) || 0, Number(window.innerWidth) || 0);
      const h = Math.max(Number(window.screen && window.screen.height) || 0, Number(window.innerHeight) || 0);
      const minSide = Math.min(w, h);
      const maxSide = Math.max(w, h);
      return minSide >= 600 && maxSide >= 900;
    } catch (_) {
      return false;
    }
  }

  function isTablet() {
    if (typeof navigator === "undefined") return false;
    if (isIpadOsDesktopUa() || isTabletUa(navigator.userAgent)) return true;
    // Android tablets often include "Mobile" in the UA — upgrade them by screen size.
    if (isPhoneUa(navigator.userAgent) && isLargeTouchScreen()) return true;
    return false;
  }

  function isPhone() {
    if (typeof navigator === "undefined") return false;
    return isPhoneUa(navigator.userAgent) && !isTablet();
  }

  /**
   * Phone-only mobile app chrome (tab bar, jcm overlays, home.html).
   * Tablets intentionally use the desktop CRM shell.
   */
  function isMobile() {
    return isPhone();
  }

  function entryHref() {
    return isMobile() ? "home.html" : "/dashboard";
  }

  function applyBodyClass() {
    if (typeof document === "undefined" || !document.body) return;
    const phone = isPhone();
    const tablet = isTablet();
    // Mobile shell only on phones. Tablets keep desktop CRM (+ optional tablet tweaks).
    document.body.classList.toggle("om-device-mobile", phone);
    document.body.classList.toggle("om-device-phone", phone);
    document.body.classList.toggle("om-device-tablet", tablet);
    document.body.classList.toggle("om-device-desktop", !phone);
  }

  /**
   * Lock a stable app height on phones so the UI doesn't jump when the browser
   * chrome (URL bar) shows/hides. Update only on orientation change.
   */
  function lockMobileAppHeight() {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (!isPhone()) return;
    try {
      const h = Math.round(Number(window.innerHeight) || 0);
      if (h > 0) {
        document.documentElement.style.setProperty("--om-app-height", h + "px");
      }
    } catch (_) {
      /* ignore */
    }
  }

  function wireMobileAppHeightLock() {
    if (typeof window === "undefined") return;
    lockMobileAppHeight();
    window.addEventListener("orientationchange", function () {
      setTimeout(lockMobileAppHeight, 250);
      setTimeout(lockMobileAppHeight, 700);
    });
    // Ignore visualViewport / resize — those fire when the keyboard or URL bar moves.
  }

  /**
   * Prevent iOS/Android focus-zoom from rescaling the whole CRM UI.
   * Caps pinch-zoom and loads shared form font-size rules (≥16px on touch widths).
   */
  function lockStableViewport() {
    if (typeof document === "undefined") return;
    try {
      let meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "viewport");
        (document.head || document.documentElement).appendChild(meta);
      }
      meta.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover",
      );
      if (!document.getElementById("om-stable-viewport-css")) {
        const link = document.createElement("link");
        link.id = "om-stable-viewport-css";
        link.rel = "stylesheet";
        link.href = "/om-stable-viewport.css?v=20261007-stable1";
        (document.head || document.documentElement).appendChild(link);
      }
    } catch (_) {
      /* ignore */
    }
  }

  /** Redirect desktop/tablet away from the mobile-only Home. */
  function guardMobileOnlyPage(desktopHref) {
    if (isMobile()) return false;
    const target = desktopHref || "/dashboard";
    try {
      location.replace(target);
    } catch (_) {
      location.href = target;
    }
    return true;
  }

  const api = {
    isMobileUa: function (ua) {
      return isPhoneUa(ua) || isTabletUa(ua);
    },
    isPhoneUa,
    isTabletUa,
    isPhone,
    isTablet,
    isMobile,
    entryHref,
    applyBodyClass,
    guardMobileOnlyPage,
    lockMobileAppHeight,
    lockStableViewport,
  };

  global.__omDevice = api;

  if (typeof document !== "undefined") {
    lockStableViewport();
    if (document.body) applyBodyClass();
    else document.addEventListener("DOMContentLoaded", applyBodyClass);
    wireMobileAppHeightLock();
  }
})(typeof window !== "undefined" ? window : globalThis);
