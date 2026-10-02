/**
 * Google Places Autocomplete reutilizavel para formularios de morada do CRM.
 * Prioriza sempre Google Maps quando a chave estiver configurada; Photon (OSM)
 * so entra como ultimo recurso se o script Google falhar.
 * Restringe sugestões ao país da empresa (Configurações › Empresa).
 */
(function (global) {
  'use strict';

  let mapsKey = null;
  let loadPromise = null;
  let lastLoadFailed = false;
  let orgCountryPromise = null;
  let orgCountryCode = null; // lowercase ISO-2 for Places, e.g. "us"
  const attached = new WeakSet();

  function normalizeCountryCode(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) {
      var list = raw
        .map(function (c) {
          return String(c || '')
            .trim()
            .toLowerCase()
            .slice(0, 2);
        })
        .filter(Boolean);
      return list.length ? list : null;
    }
    var one = String(raw)
      .trim()
      .toLowerCase()
      .slice(0, 2);
    return one || null;
  }

  async function fetchOrgCountry() {
    if (orgCountryCode) return orgCountryCode;
    if (orgCountryPromise) return orgCountryPromise;
    orgCountryPromise = (async function () {
      try {
        var r = await fetch('/api/config/ui', { credentials: 'include', cache: 'no-store' });
        if (r.ok) {
          var j = await r.json().catch(function () {
            return {};
          });
          var data = (j && j.data) || {};
          var code = normalizeCountryCode(data.organizationCountry || data.country);
          if (code) {
            orgCountryCode = code;
            return code;
          }
        }
      } catch (_) {}
      try {
        var r2 = await fetch('/api/settings/organization', { credentials: 'include', cache: 'no-store' });
        if (r2.ok) {
          var j2 = await r2.json().catch(function () {
            return {};
          });
          var d2 = (j2 && j2.data) || j2 || {};
          var code2 = normalizeCountryCode(d2.country);
          if (code2) {
            orgCountryCode = code2;
            return code2;
          }
        }
      } catch (_) {}
      orgCountryCode = 'us';
      return orgCountryCode;
    })();
    return orgCountryPromise;
  }

  function extractLeadingStreetNumber(text) {
    const m = String(text || '')
      .trim()
      .match(/^(\d+[A-Za-z]?(?:[-\/]\d+[A-Za-z]?)*)\b/);
    return m ? m[1] : '';
  }

  /** Google/Photon often omit housenumber on route-level picks — recover from typed text or formatted address. */
  function ensureStreetNumber(parsed, hintText) {
    if (!parsed) return parsed;
    const line = String(parsed.line1 || '').trim();
    if (extractLeadingStreetNumber(line)) return parsed;
    const num =
      extractLeadingStreetNumber(hintText) || extractLeadingStreetNumber(parsed.formatted);
    if (!num) return parsed;
    parsed.line1 = [num, line].filter(Boolean).join(' ').trim();
    const fmt = String(parsed.formatted || '').trim();
    if (fmt && !extractLeadingStreetNumber(fmt)) {
      parsed.formatted = [num, fmt].filter(Boolean).join(' ').trim();
    }
    return parsed;
  }

  function parsePlaceComponents(place) {
    const out = {
      line1: '',
      line2: '',
      city: '',
      state: '',
      zip: '',
      country: '',
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
      if (types.indexOf('country') !== -1) out.country = comp.short_name;
    });
    // Place name sometimes carries "123 Main St" when components omit street_number
    if (!streetNumber && place && place.name) {
      streetNumber = extractLeadingStreetNumber(place.name);
    }
    if (!streetNumber && out.formatted) {
      streetNumber = extractLeadingStreetNumber(out.formatted);
    }
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
    if (!el) return;
    if (value == null) return;
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function mapHasStructuredFields(map) {
    if (!map) return false;
    return !!(map.city || map.state || map.zip || map.line2 || map.line1);
  }

  /**
   * Fill street/city/state/zip. When structured fields exist, the search input
   * keeps only the street (not the full "Street, City, ST ZIP, Country").
   * Optional map.search is cleared after pick.
   */
  function applySelection(parsed, map, inputEl) {
    if (!parsed) return;
    if (!map) {
      if (inputEl) inputEl.value = parsed.formatted || parsed.line1 || '';
      return;
    }

    if (mapHasStructuredFields(map)) {
      if (map.line1) setFieldValue(map.line1, parsed.line1 || '');
      if (map.line2) setFieldValue(map.line2, parsed.line2 || '');
      if (map.city) setFieldValue(map.city, parsed.city || '');
      if (map.state) setFieldValue(map.state, parsed.state || '');
      if (map.zip) setFieldValue(map.zip, parsed.zip || '');

      var street = parsed.line1 || '';
      if (map.combined) {
        // Combined field with sibling city/state/zip → street only (avoid duplicating city/zip).
        if (map.city || map.state || map.zip) setFieldValue(map.combined, street);
        else setFieldValue(map.combined, parsed.formatted || street);
      } else if (!map.line1 && inputEl) {
        inputEl.value = street;
      } else if (map.line1 && resolveEl(map.line1) === inputEl) {
        inputEl.value = street;
      }

      if (map.search) setFieldValue(map.search, '');
      return;
    }

    if (map.combined) {
      var combinedVal = parsed.formatted || parsed.line1 || '';
      var line1 = String(parsed.line1 || '').trim();
      var fmt = String(parsed.formatted || '').trim();
      if (line1 && /^\d/.test(line1) && fmt && !/^\d/.test(fmt)) {
        combinedVal = line1;
      }
      setFieldValue(map.combined, combinedVal);
    }
    if (map.search) setFieldValue(map.search, '');
  }

  function dismissPacDropdown(inputEl) {
    document.querySelectorAll('.pac-container').forEach(function (pac) {
      pac.style.display = 'none';
      pac.style.visibility = 'hidden';
      pac.style.opacity = '0';
      pac.style.pointerEvents = 'none';
      pac.setAttribute('aria-hidden', 'true');
      while (pac.firstChild) pac.removeChild(pac.firstChild);
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
        if (!item) return;
        // Close Google dropdown after the pick is applied
        setTimeout(function () {
          dismissPacDropdown();
        }, 0);
        setTimeout(function () {
          dismissPacDropdown();
        }, 80);
        setTimeout(function () {
          dismissPacDropdown();
        }, 200);
      },
      true
    );
  }

  function loadGoogleMapsScript(key) {
    return new Promise(function (resolve, reject) {
      if (global.__crmGoogleMapsAuthFailed) {
        reject(new Error('Google Maps auth failed'));
        return;
      }
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
      if (typeof global.gm_authFailure !== 'function' || !global.__crmGoogleMapsAuthHooked) {
        global.__crmGoogleMapsAuthHooked = true;
        var prev = global.gm_authFailure;
        global.gm_authFailure = function () {
          global.__crmGoogleMapsAuthFailed = true;
          console.warn('[crm-address-autocomplete] Google Maps auth failure (billing, API ou restrições da chave)');
          if (typeof prev === 'function') {
            try {
              prev();
            } catch (_) {}
          }
        };
      }
      var cbName = '__sfCrmPlacesInit';
      global[cbName] = function () {
        try {
          delete global[cbName];
        } catch (_) {}
        if (global.__crmGoogleMapsAuthFailed) {
          reject(new Error('Google Maps auth failed'));
          return;
        }
        resolve(true);
      };
      var s = document.createElement('script');
      s.async = true;
      s.src =
        'https://maps.googleapis.com/maps/api/js?key=' +
        encodeURIComponent(key) +
        '&libraries=places&callback=' +
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
    var data = (j && j.data) || {};
    var code = normalizeCountryCode(data.organizationCountry || data.country);
    if (code) orgCountryCode = code;
    // Always prefer Google when a key is present (ignore server probe fail).
    var key = data.googleMapsJsKey ? String(data.googleMapsJsKey).trim() : '';
    return key || null;
  }

  async function ensureMapsReady(forceRetry) {
    if (global.google && global.google.maps && global.google.maps.places && !global.__crmGoogleMapsAuthFailed) {
      return true;
    }
    if (forceRetry) {
      resetMapsLoadState();
      global.__crmGoogleMapsAuthFailed = false;
    }
    if (loadPromise && !lastLoadFailed) return loadPromise;

    loadPromise = (async function () {
      try {
        mapsKey = await fetchMapsKey();
        if (!mapsKey) {
          lastLoadFailed = true;
          console.warn('[crm-address-autocomplete] Google Maps key ausente; a usar sugestões OSM');
          return false;
        }
        await loadGoogleMapsScript(mapsKey);
        var ok =
          !!(global.google && global.google.maps && global.google.maps.places) &&
          !global.__crmGoogleMapsAuthFailed;
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

  function ensurePhotonStyles() {
    if (document.getElementById('crm-photon-ac-style')) return;
    var style = document.createElement('style');
    style.id = 'crm-photon-ac-style';
    style.textContent =
      '.crm-photon-ac{position:absolute;z-index:2500;left:0;right:0;top:100%;margin:4px 0 0;padding:4px 0;' +
      'background:#fff;border:1px solid #e2d9cc;border-radius:10px;box-shadow:0 10px 28px rgba(33,29,26,.14);' +
      'max-height:240px;overflow:auto;list-style:none}' +
      '.crm-photon-ac li{margin:0;padding:8px 12px;cursor:pointer;font-size:.88rem;color:#211d1a;line-height:1.35}' +
      '.crm-photon-ac li:hover,.crm-photon-ac li.is-active{background:#fff4eb}' +
      '.crm-photon-ac__wrap{position:relative}';
    document.head.appendChild(style);
  }

  function parsePhotonFeature(feature) {
    var p = (feature && feature.properties) || {};
    var coords = feature && feature.geometry && feature.geometry.coordinates;
    var street = [p.housenumber, p.street || p.name].filter(Boolean).join(' ').trim();
    var city = p.city || p.town || p.village || p.municipality || '';
    var state = p.state || p.county || '';
    var zip = p.postcode || '';
    var countryCode = String(p.countrycode || '').toLowerCase();
    var parts = [street, city, state, zip].filter(Boolean);
    var formatted = parts.join(', ');
    return {
      line1: street || p.name || formatted,
      line2: '',
      city: city,
      state: state,
      zip: zip,
      country: countryCode,
      formatted: formatted || p.name || '',
      placeId: p.osm_id ? String(p.osm_id) : '',
      lat: coords && coords.length >= 2 ? Number(coords[1]) : null,
      lng: coords && coords.length >= 2 ? Number(coords[0]) : null,
    };
  }

  function countryList(optionsCountry) {
    var fromOpt = normalizeCountryCode(optionsCountry);
    if (fromOpt) return Array.isArray(fromOpt) ? fromOpt : [fromOpt];
    if (orgCountryCode) return [orgCountryCode];
    return ['us'];
  }

  function attachPhotonAutocomplete(inputEl, options) {
    options = options || {};
    ensurePhotonStyles();
    attached.add(inputEl);
    inputEl.setAttribute('data-sf-address-autocomplete', 'photon');
    inputEl.setAttribute('autocomplete', 'off');
    if (!inputEl.placeholder || /Google Maps/i.test(inputEl.placeholder)) {
      inputEl.placeholder = 'Digite a morada…';
    }

    var parent = inputEl.parentElement;
    if (parent && getComputedStyle(parent).position === 'static') {
      parent.classList.add('crm-photon-ac__wrap');
    }

    var list = document.createElement('ul');
    list.className = 'crm-photon-ac';
    list.hidden = true;
    list.setAttribute('role', 'listbox');
    (parent || inputEl).appendChild(list);

    var timer = null;
    var items = [];
    var active = -1;
    var countries = countryList(options.country);
    var suppressSearch = false;
    var suppressUntil = 0;

    function hide() {
      list.hidden = true;
      list.innerHTML = '';
      items = [];
      active = -1;
    }

    function render() {
      list.innerHTML = '';
      items.forEach(function (it, idx) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = it.formatted || it.line1;
        if (idx === active) li.className = 'is-active';
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          select(idx);
        });
        list.appendChild(li);
      });
      list.hidden = !items.length;
    }

    function select(idx) {
      var parsed = items[idx];
      if (!parsed) return;
      suppressSearch = true;
      suppressUntil = Date.now() + 600;
      clearTimeout(timer);
      hide();
      parsed = ensureStreetNumber(parsed, inputEl._sfLastTyped || inputEl.value || '');
      applySelection(parsed, options.map, inputEl);
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof options.onSelect === 'function') {
        options.onSelect(parsed, null, inputEl);
      }
      // Keep closed — applySelection can dispatch input and would reopen the list
      hide();
      try {
        inputEl.blur();
      } catch (_) {}
      setTimeout(function () {
        hide();
        suppressSearch = false;
      }, 650);
    }

    async function search(q) {
      if (suppressSearch || Date.now() < suppressUntil) {
        hide();
        return;
      }
      if (!q || q.trim().length < 3) {
        hide();
        return;
      }
      try {
        var url =
          'https://photon.komoot.io/api/?q=' +
          encodeURIComponent(q.trim()) +
          '&limit=8&lang=en';
        if (countries.indexOf('us') >= 0 && countries.length === 1) {
          url += '&lat=39.8&lon=-98.5';
        } else if (countries.indexOf('br') >= 0 && countries.length === 1) {
          url += '&lat=-14.2&lon=-51.9';
        } else if (countries.indexOf('ca') >= 0 && countries.length === 1) {
          url += '&lat=56.1&lon=-106.3';
        }
        var r = await fetch(url);
        if (!r.ok) throw new Error('photon ' + r.status);
        var j = await r.json();
        if (suppressSearch || Date.now() < suppressUntil) {
          hide();
          return;
        }
        items = (j.features || [])
          .map(parsePhotonFeature)
          .filter(function (p) {
            if (!(p.formatted || p.line1)) return false;
            if (!countries.length) return true;
            if (!p.country) return true;
            return countries.indexOf(String(p.country).toLowerCase()) >= 0;
          })
          .slice(0, 6);
        active = items.length ? 0 : -1;
        render();
      } catch (err) {
        console.warn('[crm-address-autocomplete] photon', err);
        hide();
      }
    }

    inputEl.addEventListener('input', function () {
      inputEl._sfLastTyped = inputEl.value;
      if (suppressSearch || Date.now() < suppressUntil) {
        clearTimeout(timer);
        hide();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(function () {
        search(inputEl.value);
      }, 280);
    });
    inputEl.addEventListener('keydown', function (e) {
      if (list.hidden || !items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        active = (active + 1) % items.length;
        render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active - 1 + items.length) % items.length;
        render();
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        select(active);
      } else if (e.key === 'Escape') {
        hide();
      }
    });
    inputEl.addEventListener('blur', function () {
      setTimeout(hide, 150);
    });
    return true;
  }

  /**
   * @param {HTMLInputElement} inputEl
   * @param {{ map?: object, onSelect?: Function, country?: string|string[], types?: string[] }} [options]
   */
  async function attachAddressAutocomplete(inputEl, options) {
    options = options || {};
    if (!inputEl || inputEl.tagName !== 'INPUT') return false;
    if (attached.has(inputEl)) return true;

    var country = normalizeCountryCode(options.country) || (await fetchOrgCountry());
    options = Object.assign({}, options, { country: country });

    var ready = await ensureMapsReady(false);
    if (!ready) {
      // One forced retry before falling back to Photon
      ready = await ensureMapsReady(true);
    }
    if (!ready) {
      console.warn('[crm-address-autocomplete] Google indisponivel — fallback Photon');
      return attachPhotonAutocomplete(inputEl, options);
    }

    try {
      var acOptions = {
        fields: ['formatted_address', 'address_components', 'geometry', 'place_id'],
        types: options.types || ['address'],
      };
      if (country) {
        acOptions.componentRestrictions = { country: country };
      }
      var ac = new global.google.maps.places.Autocomplete(inputEl, acOptions);
      attached.add(inputEl);
      inputEl.setAttribute('data-sf-address-autocomplete', '1');
      inputEl.setAttribute('autocomplete', 'off');
      if (!inputEl.placeholder) {
        inputEl.placeholder = 'Digite a morada…';
      }

      bindPacDismissHandlers();

      var pacLockUntil = 0;
      function lockAndDismiss() {
        pacLockUntil = Date.now() + 700;
        dismissPacDropdown(inputEl);
      }

      inputEl.addEventListener('input', function () {
        inputEl._sfLastTyped = inputEl.value;
        if (Date.now() < pacLockUntil) dismissPacDropdown(inputEl);
      });

      inputEl.addEventListener('blur', function () {
        setTimeout(function () {
          dismissPacDropdown();
        }, 150);
      });

      ac.addListener('place_changed', function () {
        var place = ac.getPlace();
        if (!place) return;
        var hint = inputEl._sfLastTyped || '';
        var parsed = ensureStreetNumber(parsePlaceComponents(place), hint);
        lockAndDismiss();
        applySelection(parsed, options.map, inputEl);
        if (typeof options.onSelect === 'function') {
          options.onSelect(parsed, place, inputEl);
        }
        // Google may rewrite the input and reopen .pac-container after place_changed
        function finalize() {
          applySelection(parsed, options.map, inputEl);
          dismissPacDropdown(inputEl);
        }
        setTimeout(finalize, 0);
        setTimeout(finalize, 50);
        setTimeout(finalize, 150);
        setTimeout(finalize, 300);
        setTimeout(function () {
          dismissPacDropdown(inputEl);
        }, 500);
      });
      return true;
    } catch (err) {
      console.warn('[crm-address-autocomplete] attach google failed, photon fallback', err);
      return attachPhotonAutocomplete(inputEl, options);
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
      map: {
        combined: '#clientAddress',
        city: '#clientCity',
        state: '#clientState',
        zip: '#clientZip',
      },
    },
    {
      input: '#lqsVisitAddressLine1',
      map: {
        line1: '#lqsVisitAddressLine1',
        city: '#lqsVisitCity',
        zip: '#lqsVisitZipCode',
      },
    },
    {
      input: '#qualAddressStreet',
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
      map: { combined: '#leadFullAddress' },
    },
    {
      input: '#visitAddressLine1',
      map: {
        line1: '#visitAddressLine1',
        line2: '#visitAddressLine2',
        city: '#visitCity',
        zip: '#visitZipCode',
      },
    },
    {
      input: '#editVisitAddressLine1',
      map: {
        line1: '#editVisitAddressLine1',
        line2: '#editVisitAddressLine2',
        city: '#editVisitCity',
        zip: '#editVisitZipCode',
      },
    },
    {
      input: '#manualClientAddress',
      map: {
        combined: '#manualClientAddress',
        zip: '#manualClientZip',
      },
    },
    {
      input: '#editClientAddress',
      map: {
        combined: '#editClientAddress',
        zip: '#editClientZip',
      },
    },
    {
      input: '#pd-edit-address',
      map: { combined: '#pd-edit-address' },
    },
    {
      input: '#quoteJobAddress',
      map: { combined: '#quoteJobAddress' },
    },
    {
      input: '#estAddress',
      map: { combined: '#estAddress' },
    },
    {
      input: '#jobAddress',
      map: { combined: '#jobAddress' },
    },
    {
      input: '#mtgLocation',
      map: { combined: '#mtgLocation' },
    },
    {
      input: '#visitLine1',
      map: {
        line1: '#visitLine1',
        city: '#visitCity',
        zip: '#visitZip',
      },
    },
    {
      input: '#fAddress',
      map: { combined: '#fAddress' },
    },
    {
      input: '#v-addr',
      map: { combined: '#v-addr' },
    },
    {
      input: '#f_address_line1',
      map: {
        line1: '#f_address_line1',
        city: '#f_city',
        state: '#f_state',
        zip: '#f_postal_code',
      },
    },
  ];

  var SECONDARY_RE =
    /(line2|address_line2|complement|suite|apto|apt|unit|city|state|zip|postal|cep|bairro|search|filter|query|buscar|filtrar)/i;
  var PRIMARY_ID_RE =
    /(^|[^a-z0-9])(address|addr|location|morada|endereco|endereço|street|rua)([^a-z0-9]|$)/i;
  var PRIMARY_PLACEHOLDER_RE =
    /(digite a morada|google maps|comece a digitar|start typing.*(address|morada)|street,\s*city|rua,?\s*n[uú]mero|endere[cç]o)/i;

  function isPrimaryAddressInput(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName !== 'INPUT') return false;
    var type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type && type !== 'text' && type !== 'search') return false;
    if (type === 'search') return false;
    if (el.readOnly || el.disabled) return false;
    if (el.getAttribute('data-crm-address-autocomplete') === 'off') return false;
    if (el.getAttribute('data-crm-address-autocomplete') === '1') return true;
    if ((el.getAttribute('autocomplete') || '') === 'street-address') return true;

    var idName = ((el.id || '') + ' ' + (el.name || '')).trim();
    var ph = el.placeholder || '';
    if (SECONDARY_RE.test(idName)) return false;
    if (/search|filter|query|buscar|filtrar/i.test(idName + ' ' + ph)) return false;
    if (PRIMARY_ID_RE.test(idName)) return true;
    if (PRIMARY_PLACEHOLDER_RE.test(ph)) return true;
    return false;
  }

  function guessMapForInput(el) {
    var id = el.id;
    if (!id) return { combined: el };
    var map = { combined: '#' + id };
    var pairs = [
      ['City', 'city'],
      ['State', 'state'],
      ['Zip', 'zip'],
      ['ZipCode', 'zip'],
      ['ZIP', 'zip'],
      ['Postal', 'zip'],
      ['Line2', 'line2'],
    ];
    var base = id
      .replace(/(AddressLine1|address_line1|Address|Addr|Street|Location|Line1)$/i, '')
      .replace(/(Full)?$/i, '');
    if (base && base !== id) {
      pairs.forEach(function (p) {
        var cand = document.getElementById(base + p[0]);
        if (cand) map[p[1]] = '#' + cand.id;
      });
      if (map.combined === '#' + id && /Line1|Street/i.test(id)) {
        map.line1 = '#' + id;
        delete map.combined;
      }
    }
    return map;
  }

  async function resolveAttachCountry(presetCountry) {
    var fromPreset = normalizeCountryCode(presetCountry);
    if (fromPreset) return fromPreset;
    return fetchOrgCountry();
  }

  function scanAndAttachAll() {
    var nodes = document.querySelectorAll(
      'input[type="text"], input:not([type]), input[autocomplete="street-address"], input[data-crm-address-autocomplete]',
    );
    nodes.forEach(function (el) {
      if (!isPrimaryAddressInput(el)) return;
      if (attached.has(el)) return;
      var preset = PRESETS.find(function (p) {
        return p.input === '#' + el.id;
      });
      resolveAttachCountry(preset && preset.country).then(function (country) {
        if (attached.has(el)) return;
        attachAddressAutocomplete(el, {
          country: country,
          map: (preset && preset.map) || guessMapForInput(el),
        });
      });
    });
  }

  function initCrmAddressAutocomplete() {
    PRESETS.forEach(function (preset) {
      if (!document.querySelector(preset.input)) return;
      resolveAttachCountry(preset.country).then(function (country) {
        attachBySelector(preset.input, {
          country: country,
          map: preset.map,
        });
      });
    });
    scanAndAttachAll();
  }

  var observerStarted = false;
  function startDomObserver() {
    if (observerStarted || typeof MutationObserver === 'undefined' || !document.body) return;
    observerStarted = true;
    var timer = null;
    var obs = new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        scanAndAttachAll();
      }, 250);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  global.sfAttachAddressAutocomplete = attachAddressAutocomplete;
  global.sfInitCrmAddressAutocomplete = initCrmAddressAutocomplete;
  global.sfScanCrmAddressAutocomplete = scanAndAttachAll;
  global.sfEnsureCrmAddressAutocomplete = ensureMapsReady;
  global.sfParseGooglePlaceComponents = parsePlaceComponents;
  global.sfDismissPacDropdown = dismissPacDropdown;
  global.sfGetOrgAddressCountry = fetchOrgCountry;

  function bootAfterAuth() {
    fetchOrgCountry().finally(function () {
      initCrmAddressAutocomplete();
      startDomObserver();
    });
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
