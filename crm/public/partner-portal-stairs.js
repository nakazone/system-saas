/**
 * Builder portal: the rules for building a stair from counts.
 * The person says how many treads and risers a flight has and one size for each; this keeps
 * stair.steps (the shape the PDF, the 3D, the work order and voice already read) in line with that.
 * No DOM here. Each step holds a tread and the riser below it; extra risers sit at the top.
 */
(function () {
  const MAX_STEPS = 60;
  const UP = ['straight', 'left', 'right', 'u_left', 'u_right'];

  const isTread = (step) => step.kind !== 'riser';
  const carriesRiser = (step) => (step.kind === 'riser' ? true : !step.no_riser);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const round2 = (n) => Math.round(n * 100) / 100;

  function steps(stair) { return stair.steps || (stair.steps = []); }
  function specOf(stair) { return stair.spec || (stair.spec = {}); }

  /** How many treads and risers the flight has, measured or not. */
  function counts(stair) {
    const list = stair.steps || [];
    const treads = list.filter(isTread).length;
    const risers = stair.riser_material === 'none' ? 0 : list.filter(carriesRiser).length;
    return { treads, risers };
  }

  /** One value for a list of pieces: `mixed` when they differ, so an edit never hides a difference. */
  function shared(list, key, fallback) {
    if (!list.length) return { value: fallback == null ? null : fallback, mixed: false };
    const seen = [...new Set(list.map((x) => (x[key] == null ? null : x[key])))];
    return seen.length === 1 ? { value: seen[0], mixed: false } : { value: null, mixed: true };
  }

  /** The sizes and sides that apply to the whole flight, read from its steps. */
  function readSpec(stair) {
    const sp = stair.spec || {};
    const list = stair.steps || [];
    const treads = list.filter(isTread);
    const risers = list.filter(carriesRiser);
    return {
      tread_w: shared(treads, 'tread_w', sp.tread_w),
      tread_d: shared(treads, 'tread_d', sp.tread_d),
      open: shared(treads, 'open', sp.open || 'none'),
      ret: shared(treads, 'ret', sp.ret || '45'),
      riser_w: shared(risers, 'riser_w', sp.riser_w),
      riser_h: shared(risers, 'riser_h', sp.riser_h),
    };
  }

  function newStep(stair, kind) {
    const sp = readSpec(stair);
    const raw = stair.spec || {};
    const pick = (x, k) => (x.value != null ? x.value : raw[k] != null ? raw[k] : null);
    if (kind === 'riser') {
      return { id: uid(), kind: 'riser', tread_w: null, tread_d: null, riser_w: pick(sp.riser_w, 'riser_w'), riser_h: pick(sp.riser_h, 'riser_h'), open: 'none', ret: '45', no_riser: false, note: '' };
    }
    return { id: uid(), kind: 'step', tread_w: pick(sp.tread_w, 'tread_w'), tread_d: pick(sp.tread_d, 'tread_d'), riser_w: pick(sp.riser_w, 'riser_w'), riser_h: pick(sp.riser_h, 'riser_h'), open: pick(sp.open, 'open') || 'none', ret: pick(sp.ret, 'ret') || '45', no_riser: false, note: '' };
  }

  function setRisers(stair, wanted) {
    const list = steps(stair);
    const target = Math.max(0, Math.round(Number(wanted) || 0));
    if (target > 0 && stair.riser_material === 'none') stair.riser_material = 'same';
    let have = list.filter(carriesRiser).length;
    // Adding: first the treads that have none, from the bottom, then riser-only pieces at the top.
    for (let i = 0; i < list.length && have < target; i += 1) {
      if (isTread(list[i]) && list[i].no_riser) {
        const fresh = newStep(stair, 'step');
        list[i].no_riser = false;
        if (list[i].riser_w == null) list[i].riser_w = fresh.riser_w;
        if (list[i].riser_h == null) list[i].riser_h = fresh.riser_h;
        have += 1;
      }
    }
    while (have < target && list.length < MAX_STEPS) { list.push(newStep(stair, 'riser')); have += 1; }
    // Removing: riser-only pieces first, then the risers under the top treads.
    for (let i = list.length - 1; i >= 0 && have > target; i -= 1) {
      if (!isTread(list[i])) { list.splice(i, 1); have -= 1; }
    }
    for (let i = list.length - 1; i >= 0 && have > target; i -= 1) {
      if (isTread(list[i]) && !list[i].no_riser) { list[i].no_riser = true; have -= 1; }
    }
    return counts(stair).risers;
  }

  /**
   * Treads go up or down from the top. A flight normally has one more riser than treads, so the
   * risers follow while they are in that rhythm (or equal); a count typed by hand stays as it is.
   */
  function setTreads(stair, wanted) {
    const list = steps(stair);
    const before = counts(stair);
    const target = Math.min(MAX_STEPS, Math.max(0, Math.round(Number(wanted) || 0)));
    const gap = before.risers - before.treads;
    const empty = !before.treads && !before.risers;
    let have = before.treads;
    while (have < target && list.length < MAX_STEPS) {
      let at = list.length;
      while (at > 0 && !isTread(list[at - 1])) at -= 1; // new treads go below the risers at the top
      list.splice(at, 0, newStep(stair, 'step'));
      have += 1;
    }
    for (let i = list.length - 1; i >= 0 && have > target; i -= 1) {
      if (isTread(list[i])) { list.splice(i, 1); have -= 1; }
    }
    if (empty) setRisers(stair, target ? target + 1 : 0);
    else if (gap === 0 || gap === 1) setRisers(stair, target ? target + gap : 0);
    else setRisers(stair, before.risers);
    return counts(stair);
  }

  /** One tread size or side, on every tread. A riser still at the tread's width follows it. */
  function applyTread(stair, key, value) {
    const sp = specOf(stair);
    const list = steps(stair);
    if (key === 'tread_w') {
      const risers = readSpec(stair).riser_w;
      const was = readSpec(stair).tread_w.value;
      if (!risers.mixed && (risers.value == null || risers.value === was)) applyRiser(stair, 'riser_w', value);
    }
    sp[key] = value;
    list.filter(isTread).forEach((step) => { step[key] = value; });
  }

  function applyRiser(stair, key, value) {
    specOf(stair)[key] = value;
    steps(stair).forEach((step) => { step[key] = value; });
  }

  /** Risers keep their old material field in line, because the PDF and quote lines read it. */
  function syncRiserMaterial(stair) {
    if (stair.riser_finish === 'Primed') stair.riser_material = 'primed';
    else if (stair.riser_species === 'Paint grade') stair.riser_material = 'paint_grade';
    else if (stair.riser_material !== 'none') stair.riser_material = 'same';
  }

  /** Older stairs say "primed" or "paint grade" in one field; the new blocks show it as wood and finish. */
  function normalize(stair) {
    if (stair.riser_material === 'primed' && !stair.riser_finish) stair.riser_finish = 'Primed';
    if (stair.riser_material === 'paint_grade' && !stair.riser_species) stair.riser_species = 'Paint grade';
    return stair;
  }

  /** "16", "16 sf", "16.5 sq ft", "4x4" or "4 × 4" → square feet. */
  function parseSqft(raw) {
    const s = String(raw == null ? '' : raw).toLowerCase().replace(/,/g, '.').replace(/sq\.?\s*ft\.?|sqft|sf|ft²|'/g, ' ').trim();
    if (!s) return null;
    const pair = /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/.exec(s);
    const n = pair ? Number(pair[1]) * Number(pair[2]) : /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
    return Number.isFinite(n) && n > 0 && n <= 2000 ? round2(n) : null;
  }

  /** A landing is measured in square feet; the drawings and the PDF need a width and a depth. */
  function syncLanding(stair, upper) {
    const landing = stair.landing;
    if (!landing || !landing.enabled) return;
    const area = Number(landing.sqft) || 0;
    if (!area) return;
    const own = Number(readSpec(stair).tread_w.value) || 0;
    const next = upper ? Number(readSpec(upper).tread_w.value) || own : own;
    const uturn = /^u_/.test((upper && upper.turn) || landing.direction || '');
    const width = own ? (uturn ? own + next + 2 : own) : Math.sqrt(area) * 12;
    landing.width = round2(width);
    landing.depth = round2((area * 144) / width);
  }

  /** What still needs a size or an answer, per flight. The server checks the same before completing. */
  function gaps(data) {
    const out = [];
    (data.stairs || []).forEach((stair, index) => {
      const name = stair.name || `Stair ${index + 1}`;
      const list = stair.steps || [];
      const c = counts(stair);
      if (!list.length) { out.push({ id: stair.id, part: 'treads', text: `${name}: how many treads?` }); return; }
      const noTread = list.filter(isTread).filter((x) => !x.tread_w || !x.tread_d).length;
      if (noTread) out.push({ id: stair.id, part: 'treads', text: `${name}: ${noTread} ${noTread === 1 ? 'tread needs' : 'treads need'} a size` });
      const noRiser = stair.riser_material === 'none' ? 0 : list.filter(carriesRiser).filter((x) => !x.riser_w || !x.riser_h).length;
      if (c.risers && noRiser) out.push({ id: stair.id, part: 'risers', text: `${name}: ${noRiser} ${noRiser === 1 ? 'riser needs' : 'risers need'} a size` });
      if (stair.landing && stair.landing.enabled && !stair.landing.sqft && !(stair.landing.width && stair.landing.depth)) out.push({ id: stair.id, part: 'landing', text: `${name}: landing needs a size` });
    });
    return out;
  }

  const api = { MAX_STEPS, UP, counts, readSpec, setTreads, setRisers, applyTread, applyRiser, syncRiserMaterial, normalize, parseSqft, syncLanding, gaps };
  window.PpStairs = api;
})();
