(() => {
  const root = document.documentElement;
  const DEFAULTS = {
    header: '#181916',
    accent: '#f0c400',
    background: '#e9e7df'
  };

  function normalizeHex(value, fallback) {
    const text = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
  }

  function hexToRgb(hex) {
    const value = normalizeHex(hex, '#000000').slice(1);
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    };
  }

  function channelToLinear(value) {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
  }

  function contrastRatio(background, foreground) {
    const a = luminance(background);
    const b = luminance(foreground);
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function bestTextColor(background) {
    const bg = normalizeHex(background, '#000000');
    const dark = '#111111';
    const light = '#ffffff';
    return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
  }

  function shadeColor(hex, factor = -0.18) {
    const { r, g, b } = hexToRgb(hex);
    const shade = value => Math.max(0, Math.min(255, Math.round(value + 255 * factor)));
    return `#${[shade(r), shade(g), shade(b)]
      .map(value => value.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  function getVar(name, fallback) {
    return normalizeHex(getComputedStyle(root).getPropertyValue(name).trim(), fallback);
  }

  let correcting = false;
  function correctCurrentContrast() {
    if (correcting) return;
    correcting = true;

    const header = getVar('--company-header', DEFAULTS.header);
    const accent = getVar('--company-accent', DEFAULTS.accent);
    const headerText = bestTextColor(header);
    const accentText = bestTextColor(accent);

    if (root.style.getPropertyValue('--company-header-text').trim() !== headerText) {
      root.style.setProperty('--company-header-text', headerText);
    }
    if (root.style.getPropertyValue('--company-accent-text').trim() !== accentText) {
      root.style.setProperty('--company-accent-text', accentText);
    }

    correcting = false;
  }

  function snapshotTheme() {
    const meta = document.querySelector('meta[name="theme-color"]');
    return {
      header: getVar('--company-header', DEFAULTS.header),
      headerText: getVar('--company-header-text', '#ffffff'),
      accent: getVar('--company-accent', DEFAULTS.accent),
      accentText: getVar('--company-accent-text', '#111111'),
      background: getVar('--bg', DEFAULTS.background),
      signal: getVar('--signal', DEFAULTS.accent),
      signalDark: getVar('--signal-dark', '#b99400'),
      meta: meta?.getAttribute('content') || DEFAULTS.header
    };
  }

  function restoreTheme(snapshot) {
    if (!snapshot) return;
    root.style.setProperty('--company-header', snapshot.header);
    root.style.setProperty('--company-header-text', snapshot.headerText);
    root.style.setProperty('--company-accent', snapshot.accent);
    root.style.setProperty('--company-accent-text', snapshot.accentText);
    root.style.setProperty('--bg', snapshot.background);
    root.style.setProperty('--signal', snapshot.signal);
    root.style.setProperty('--signal-dark', snapshot.signalDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', snapshot.meta);
  }

  function applyLiveTheme(form) {
    if (!form) return;
    const header = normalizeHex(form.elements.headerColor?.value, DEFAULTS.header);
    const accent = normalizeHex(form.elements.accentColor?.value, DEFAULTS.accent);
    const background = normalizeHex(form.elements.backgroundColor?.value, DEFAULTS.background);
    const headerText = bestTextColor(header);
    const accentText = bestTextColor(accent);

    root.style.setProperty('--company-header', header);
    root.style.setProperty('--company-header-text', headerText);
    root.style.setProperty('--company-accent', accent);
    root.style.setProperty('--company-accent-text', accentText);
    root.style.setProperty('--bg', background);
    root.style.setProperty('--signal', accent);
    root.style.setProperty('--signal-dark', shadeColor(accent));

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', header);

    const preview = document.querySelector('#company-preview');
    if (preview) {
      preview.style.setProperty('--preview-header-text', headerText);
    }
  }

  let activeSetup = null;

  function bindSetup(backdrop) {
    if (!backdrop || backdrop.dataset.contrastBound === '1') return;
    backdrop.dataset.contrastBound = '1';

    const form = backdrop.querySelector('#company-setup-form');
    if (!form) return;

    activeSetup = {
      backdrop,
      snapshot: snapshotTheme()
    };

    const update = () => applyLiveTheme(form);
    form.querySelectorAll('input[type="color"]').forEach(input => {
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    });

    applyLiveTheme(form);
  }

  document.addEventListener('click', event => {
    const close = event.target.closest('[data-company-action="close"]');
    if (!close || !activeSetup) return;
    restoreTheme(activeSetup.snapshot);
    activeSetup = null;
  }, true);

  const bodyObserver = new MutationObserver(() => {
    const backdrop = document.querySelector('#company-setup-backdrop');
    if (backdrop) {
      bindSetup(backdrop);
    } else if (activeSetup) {
      activeSetup = null;
    }
  });

  bodyObserver.observe(document.body, { childList: true, subtree: true });

  const rootObserver = new MutationObserver(correctCurrentContrast);
  rootObserver.observe(root, { attributes: true, attributeFilter: ['style'] });

  correctCurrentContrast();
})();
