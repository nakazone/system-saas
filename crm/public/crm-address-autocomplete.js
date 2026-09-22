/**
 * Google Places Autocomplete reutilizavel para formularios de morada do CRM.
 * Requer GOOGLE_MAPS_JS_KEY no servidor e /api/config/ui.
 */
(function (global) {
  'use strict';

  let mapsKey = null;
  let loadPromise = null;
  let lastLoadFailed = false;
  const attached = new WeakSet();

  function parsePlaceComponents(place) {
    const out = {
      line1: '',
      line2: '',
      city: '',
      state: '',
      zip: '',
      formatted: place && place.formatted_address ? String(place.formatted_address) : '',
      placeId: place && place.place_id ? String(place.place_id) : '',
      lat: null,
      lng: null,
    };
    if (place && place.geometry && place.geometry.location) {
      const loc = place.geometry.location;
      out.lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
      out.lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
    }
    let streetNumber = '';
    let route = '';
    (place && place.address_components ? place.address_components : []).forEach(function (comp) {
      const types = comp.types || [];
      if (types.indexOf('street_number') !== -1) streetNumber = comp.long_name;
      if (types.indexOf('route') !== -1) route = comp.long_name;
      if (types.indexOf('subpremise') !== -1) out.line2 = comp.long_name;
      if (types.indexOf('locality') !== -1) out.city = comp.long_name;
      else if (types.indexOf('postal_town') !== -1 && !out.city) out.city = comp.long_name;
      else if (types.indexOf('sublocality') !== -1 && !out.city) out.city = comp.long_name;
      if (types.indexOf('administrative_area_level_1') !== -1) out.state = comp.short_name;
      if (types.indexOf('postal_code') !== -1) out.zip = comp.long_name;
    });
    out.line1 = [streetNumber, route].filter(Boolean).join(' ').trim();
    if (!out.line1 && out.formatted) {
      out.line1 = out.formatted.split(',')[0] || out.formatted;
    }
    return out;
  }

  function resolveEl(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') return document.querySelector(ref);
    if (ref.nodeType === 1) return ref;
    return null;
  }

  function setFieldValue(ref, value) {
    const el = resolveEl(ref);
    if (!el || value == null || String(value).trim() === '') return;
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyFieldMap(parsed, map) {
    if (!map || !parsed) return;
    if (map.line1) setFieldValue(map.line1, parsed.line1);
    if (map.line2) setFieldValue(map.line2, parsed.line2);
    if (map.city) setFieldValue(map.city, parsed.city);
    if (map.state) setFieldValue(map.state, parsed.state);
    if (map.zip) setFieldValue(map.zip, parsed.zip);
    if (map.combined) setFieldValue(map.combined, parsed.formatted || parsed.line1);
  }

  function dismissPacDropdown(inputEl) {
    document.querySelectorAll('.pac-container').forEach(function (pac) {
      pac.style.display = 'none';
    });
    if (inputEl && typeof inputEl.blur === 'function') {
      try {
        inputEl.blur();
      } catch (_) {}
    }
  }

  function bindPacDismissHandlers() {
    if (global.__sfPacDismissBound) return;
    global.__sfPacDismissBound = true;
    document.addEventListener(
      'mousedown',
      function (e) {
        var item = e.target && e.target.closest ? e.target.closest('.pac-item') : null;
        if (item) {
          setTimeout(function () {
            dismissPacDropdown();
          }, 0);
        }
      },
      true
    );
  }

  function loadGoogleMapsScript(key) {
    return new Promise(function (resolve, reject) {
      if (global.google && global.google.maps && global.google.maps.places) {
        resolve(true);
        return;
      }
      var existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
      if (existing) {
        existing.addEventListener('load', function () {
          resolve(!!(global.google && global.google.maps && global.google.maps.places));
        });
        existing.addEventListener('error', function () {
          reject(new Error('Google Maps script failed'));
        });
        return;
      }
      var cbName = '__sfCrmPlacesInit';
      global[cbName] = function () {
        try {
          delete global[cbName];
        } catch (_) {}
        resolve(true);
      };
      var s = document.createElement('script');
      s.async = true;
      s.src =
        'https://maps.googleapis.com/maps/api/js?key=' +
        encodeURIComponent(key) +
        '&libraries=places&loading=async&callback=' +
        cbName;
      s.onerror = function () {
        reject(new Error('Google Maps script failed'));
      };
      document.head.appendChild(s);
    });
  }

  function resetMapsLoadState() {
    loadPromise = null;
    lastLoadFailed = false;
  }

  async function fetchMapsKey() {
    var r = await fetch('/api/config/ui', { credentials: 'include', cache: 'no-store' });
    if (!r.ok) {
      var builderToken = null;
      try {
        builderToken = sessionStorage.getItem('sf_builder_token');
      } catch (_) {
        builderToken = null;
      }
      if (builderToken) {
        r = await fetch('/api/builder-auth/config', {
          headers: { Authorization: 'Bearer ' + builderToken },
          cache: 'no-store',
        });
      }
      if (!r.ok) {
        throw new Error('UI config HTTP ' + r.status);
      }
    }
    var j = await r.json().catch(function () {
      return {};
    });
    var key = j && j.data && j.data.googleMapsJsKey ? String(j.data.googleMapsJsKey).trim() : '';
    return key || null;
  }

  async function ensureMapsReady(forceRetry) {
    if (global.google && global.google.maps && global.google.maps.places) return true;
    if (forceRetry) resetMapsLoadState();
    if (loadPromise && !lastLoadFailed) return loadPromise;

    loadPromise = (async function () {
      try {
        mapsKey = await fetchMapsKey();
        if (!mapsKey) {
          lastLoadFailed = true;
          console.warn('[crm-address-autocomplete] GOOGLE_MAPS_JS_KEY nao configurada');
          return false;
        }
        await loadGoogleMapsScript(mapsKey);
        var ok = !!(global.google && global.google.maps && global.google.maps.places);
        lastLoadFailed = !ok;
        return ok;
      } catch (err) {
        lastLoadFailed = true;
        console.warn('[crm-address-autocomplete]', err);
        return false;
      }
    })();

    return loadPromise;
  }

  /**
   * @param {HTMLInputElement} inputEl
   * @param {{ map?: object, onSelect?: Function, country?: string|string[], types?: string[] }} [options]
   */
  async function attachAddressAutocomplete(inputEl, options) {
    options = options || {};
    if (!inputEl || inputEl.tagName !== 'INPUT') return false;
    if (attached.has(inputEl)) return true;

    var ready = await ensureMapsReady(false);
    if (!ready) {
      ready = await ensureMapsReady(true);
    }
    if (!ready) return false;

    try {
      var acOptions = {
        fields: ['formatted_address', 'address_components', 'geometry', 'place_id'],
        types: options.types || ['address'],
      };
      if (options.country) {
        acOptions.componentRestrictions = { country: options.country };
      }
      var ac = new global.google.maps.places.Autocomplete(inputEl, acOptions);
      attached.add(inputEl);
      inputEl.setAttribute('data-sf-address-autocomplete', '1');
      inputEl.setAttribute('autocomplete', 'off');
      if (!inputEl.placeholder) {
        inputEl.placeholder = 'Digite a morada (Google Maps)...';
      }

      bindPacDismissHandlers();

      inputEl.addEventListener('blur', function () {
        setTimeout(function () {
          dismissPacDropdown();
        }, 150);
      });

      ac.addListener('place_changed', function () {
        var place = ac.getPlace();
        if (!place) return;
        var parsed = parsePlaceComponents(place);
        if (options.map) applyFieldMap(parsed, options.map);
        if (typeof options.onSelect === 'function') {
          options.onSelect(parsed, place, inputEl);
        }
        setTimeout(function () {
          dismissPacDropdown(inputEl);
        }, 0);
      });
      return true;
    } catch (err) {
      console.warn('[crm-address-autocomplete] attach', err);
      return false;
    }
  }

  function attachBySelector(selector, options) {
    var el = document.querySelector(selector);
    if (!el) return Promise.resolve(false);
    return attachAddressAutocomplete(el, options);
  }

  var PRESETS = [
    {
      input: '#clientAddress',
      country: 'us',
      map: {
        combined: '#clientAddress',
        city: '#clientCity',
        state: '#clientState',
        zip: '#clientZip',
      },
    },
    {
      input: '#lqsVisitAddressLine1',
      country: 'us',
      map: {
        line1: '#lqsVisitAddressLine1',
        city: '#lqsVisitCity',
        zip: '#lqsVisitZipCode',
      },
    },
    {
      input: '#qualAddressStreet',
      country: 'us',
      map: {
        line1: '#qualAddressStreet',
        line2: '#qualAddressLine2',
        city: '#qualAddressCity',
        state: '#qualAddressState',
        zip: '#qualAddressZip',
      },
    },
    {
      input: '#leadFullAddress',
      country: 'us',
      map: { combined: '#leadFullAddress' },
    },
    {
      input: '#visitAddressLine1',
      country: 'us',
      map: {
        line1: '#visitAddressLine1',
        line2: '#visitAddressLine2',
        city: '#visitCity',
        zip: '#visitZipCode',
      },
    },
    {
      input: '#editVisitAddressLine1',
      country: 'us',
      map: {
        line1: '#editVisitAddressLine1',
        line2: '#editVisitAddressLine2',
        city: '#editVisitCity',
        zip: '#editVisitZipCode',
      },
    },
    {
      input: '#manualClientAddress',
      country: 'us',
      map: {
        combined: '#manualClientAddress',
        zip: '#manualClientZip',
      },
    },
    {
      input: '#editClientAddress',
      country: 'us',
      map: {
        combined: '#editClientAddress',
        zip: '#editClientZip',
      },
    },
    {
      input: '#pd-edit-address',
      country: 'us',
      map: { combined: '#pd-edit-address' },
    },
    {
      input: '#quoteJobAddress',
      country: 'us',
      map: { combined: '#quoteJobAddress' },
    },
    {
      input: '#estAddress',
      country: 'us',
      map: { combined: '#estAddress' },
    },
  ];

  function initCrmAddressAutocomplete() {
    PRESETS.forEach(function (preset) {
      if (!document.querySelector(preset.input)) return;
      attachBySelector(preset.input, {
        country: preset.country,
        map: preset.map,
      });
    });
  }

  global.sfAttachAddressAutocomplete = attachAddressAutocomplete;
  global.sfInitCrmAddressAutocomplete = initCrmAddressAutocomplete;
  global.sfEnsureCrmAddressAutocomplete = ensureMapsReady;
  global.sfParseGooglePlaceComponents = parsePlaceComponents;
  global.sfDismissPacDropdown = dismissPacDropdown;

  function bootAfterAuth() {
    initCrmAddressAutocomplete();
  }

  global.sfBootCrmAddressAutocomplete = bootAfterAuth;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(bootAfterAuth, 400);
    });
  } else {
    setTimeout(bootAfterAuth, 400);
  }
})(typeof window !== 'undefined' ? window : globalThis);
