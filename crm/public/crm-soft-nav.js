/**
 * Soft navigation disabled — full page loads keep CRM pages reliable.
 * Sidebar persistence is handled by crm-shared-nav cache + syncActiveFromLocation.
 */
(function () {
  if (window.__crmSoftNav) return;

  window.__crmSoftNav = {
    navigate(href) {
      if (href) location.href = href;
      return false;
    },
    shouldSoftNav() {
      return false;
    },
  };
})();
