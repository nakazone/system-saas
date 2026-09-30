/**
 * ObraMate device gate — mobile app shell vs desktop CRM.
 * Uses user-agent (and iPadOS touch Mac) so PC keeps the classic layout.
 */
(function (global) {
  function isPhoneUa(ua) {
    const s = String(ua || "");
    // Phones only — iPad / tablets are handled separately so they can use Kanban.
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

  function isPhone() {
    if (typeof navigator === "undefined") return false;
    return isPhoneUa(navigator.userAgent);
  }

  function isTablet() {
    if (typeof navigator === "undefined") return false;
    if (isPhone()) return false;
    return isTabletUa(navigator.userAgent) || isIpadOsDesktopUa();
  }

  /** Phone or tablet — mobile app chrome (tab bar, etc.). */
  function isMobile() {
    return isPhone() || isTablet();
  }

  function entryHref() {
    return isMobile() ? "home.html" : "pipeline-lab.html";
  }

  function applyBodyClass() {
    if (typeof document === "undefined" || !document.body) return;
    const phone = isPhone();
    const tablet = isTablet();
    const mobile = phone || tablet;
    document.body.classList.toggle("om-device-mobile", mobile);
    document.body.classList.toggle("om-device-phone", phone);
    document.body.classList.toggle("om-device-tablet", tablet);
    document.body.classList.toggle("om-device-desktop", !mobile);
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
  };

  global.__omDevice = api;

  if (typeof document !== "undefined") {
    if (document.body) applyBodyClass();
    else document.addEventListener("DOMContentLoaded", applyBodyClass);
  }
})(typeof window !== "undefined" ? window : globalThis);
