(() => {
  const DEFAULTS = {
    companyName: '',
    logoDataUrl: '',
    headerColor: '#181916',
    accentColor: '#f0c400',
    backgroundColor: '#e9e7df',
    setupCompleted: false
  };

  let company = { ...DEFAULTS };
  let draftLogo = '';
  let firstRun = false;

  function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
  }

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
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function contrastColor(hex) {
    const color = normalizeHex(hex, '#000000');
    return contrastRatio(color, '#111111') >= contrastRatio(color, '#ffffff') ? '#111111' : '#ffffff';
  }

  function shadeColor(hex, factor = -0.18) {
    const { r, g, b } = hexToRgb(hex);
    const shade = value => Math.max(0, Math.min(255, Math.round(value + 255 * factor)));
    return `#${[shade(r), shade(g), shade(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || 'Speichern fehlgeschlagen.');
    return data;
  }

  function applyTheme(settings) {
    company = { ...DEFAULTS, ...(settings || {}) };
    const header = normalizeHex(company.headerColor, DEFAULTS.headerColor);
    const accent = normalizeHex(company.accentColor, DEFAULTS.accentColor);
    const background = normalizeHex(company.backgroundColor, DEFAULTS.backgroundColor);
    const root = document.documentElement;

    root.style.setProperty('--company-header', header);
    root.style.setProperty('--company-header-text', contrastColor(header));
    root.style.setProperty('--company-accent', accent);
    root.style.setProperty('--company-accent-text', contrastColor(accent));
    root.style.setProperty('--bg', background);
    root.style.setProperty('--signal', accent);
    root.style.setProperty('--signal-dark', shadeColor(accent));

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', header);

    renderHeaderBrand();
  }

  function renderHeaderBrand() {
    const brand = document.querySelector('.brand');
    if (!brand) return;
    const name = company.companyName || 'QRPass';

    if (company.logoDataUrl) {
      brand.innerHTML = `
        <span class="company-logo-slot"><img src="${company.logoDataUrl}" alt="${esc(name)} Logo"></span>
        <span class="company-brand-copy"><strong>${esc(name)}</strong><small>QRPass</small></span>`;
    } else {
      brand.innerHTML = `
        <span class="company-brand-copy"><strong>${esc(name)}</strong><small>${company.setupCompleted ? 'QRPass' : 'Maschinenbuch'}</small></span>`;
    }

    ensureCompanyButton();
  }

  function ensureCompanyButton() {
    const actions = document.querySelector('.top-actions');
    if (!actions || actions.querySelector('[data-company-action="settings"]')) return;
    const button = document.createElement('button');
    button.className = 'button company-settings-button';
    button.type = 'button';
    button.dataset.companyAction = 'settings';
    button.textContent = 'Firma';
    actions.prepend(button);
  }

  function setupMarkup() {
    const logo = draftLogo || company.logoDataUrl || '';
    return `
      <div class="company-setup-backdrop" id="company-setup-backdrop">
        <section class="company-setup" role="dialog" aria-modal="true" aria-labelledby="company-setup-title">
          <header class="company-setup-head">
            <div>
              <small>${firstRun ? 'Ersteinrichtung' : 'Firmeneinstellungen'}</small>
              <h2 id="company-setup-title">${firstRun ? 'QRPass einrichten' : 'Firma anpassen'}</h2>
            </div>
            ${firstRun ? '' : '<button class="company-close" type="button" data-company-action="close" aria-label="Schließen">×</button>'}
          </header>

          <form id="company-setup-form" class="company-setup-body">
            <div class="company-preview" id="company-preview">
              <div class="company-preview-logo" id="company-preview-logo">
                ${logo ? `<img src="${logo}" alt="Logo Vorschau">` : '<span>LOGO</span>'}
              </div>
              <div><strong id="company-preview-name">${esc(company.companyName || 'Ihre Firma')}</strong><small>QRPass</small></div>
            </div>

            <div class="field">
              <label>Firmenname *</label>
              <input name="companyName" required maxlength="180" value="${esc(company.companyName)}" placeholder="Firmenname">
            </div>

            <div class="field company-logo-field">
              <label>Firmenlogo</label>
              <input id="company-logo-input" type="file" accept="image/*,.heic,.heif">
              <small class="field-hint" id="company-logo-hint">Bild auswählen – QRPass wandelt es automatisch in PNG um, entfernt den Hintergrund und schneidet es passend zu.</small>
              ${logo ? '<button type="button" class="button button-small company-remove-logo" data-company-action="remove-logo">Logo entfernen</button>' : ''}
            </div>

            <div class="company-colors">
              <label class="company-color-field">
                <span>Header</span>
                <input name="headerColor" type="color" value="${normalizeHex(company.headerColor, DEFAULTS.headerColor)}">
              </label>
              <label class="company-color-field">
                <span>Akzent / Buttons</span>
                <input name="accentColor" type="color" value="${normalizeHex(company.accentColor, DEFAULTS.accentColor)}">
              </label>
              <label class="company-color-field">
                <span>Hintergrund</span>
                <input name="backgroundColor" type="color" value="${normalizeHex(company.backgroundColor, DEFAULTS.backgroundColor)}">
              </label>
            </div>

            <div class="company-setup-actions">
              ${firstRun ? '' : '<button type="button" class="button" data-company-action="close">Abbrechen</button>'}
              <button class="button button-primary" type="submit">${firstRun ? 'Einrichtung abschließen' : 'Speichern'}</button>
            </div>
          </form>
        </section>
      </div>`;
  }

  function openSetup(isFirstRun = false) {
    if (document.querySelector('#company-setup-backdrop')) return;
    firstRun = isFirstRun;
    draftLogo = company.logoDataUrl || '';
    document.body.insertAdjacentHTML('beforeend', setupMarkup());
    bindSetup();
    updatePreview();
  }

  function closeSetup() {
    if (firstRun) return;
    document.querySelector('#company-setup-backdrop')?.remove();
    draftLogo = '';
  }

  function bindSetup() {
    const form = document.querySelector('#company-setup-form');
    if (!form) return;

    form.querySelector('input[name="companyName"]')?.addEventListener('input', updatePreview);
    form.querySelectorAll('input[type="color"]').forEach(input => input.addEventListener('input', updatePreview));
    document.querySelector('#company-logo-input')?.addEventListener('change', handleLogoChange);
    form.addEventListener('submit', saveSetup);
  }

  function updatePreview() {
    const form = document.querySelector('#company-setup-form');
    const preview = document.querySelector('#company-preview');
    if (!form || !preview) return;

    const name = form.elements.companyName.value.trim() || 'Ihre Firma';
    const header = normalizeHex(form.elements.headerColor.value, DEFAULTS.headerColor);
    const accent = normalizeHex(form.elements.accentColor.value, DEFAULTS.accentColor);
    const background = normalizeHex(form.elements.backgroundColor.value, DEFAULTS.backgroundColor);

    preview.style.setProperty('--preview-header', header);
    preview.style.setProperty('--preview-header-text', contrastColor(header));
    preview.style.setProperty('--preview-accent', accent);
    preview.style.setProperty('--preview-bg', background);
    document.querySelector('#company-preview-name').textContent = name;

    const logoRoot = document.querySelector('#company-preview-logo');
    if (logoRoot) logoRoot.innerHTML = draftLogo ? `<img src="${draftLogo}" alt="Logo Vorschau">` : '<span>LOGO</span>';
  }

  function setLogoHint(text, state = '') {
    const hint = document.querySelector('#company-logo-hint');
    if (!hint) return;
    hint.textContent = text;
    hint.dataset.state = state;
  }

  async function handleLogoChange(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    if (!window.QRPassLogoProcessor?.process) {
      input.value = '';
      showCompanyError('Die automatische Bildverarbeitung konnte nicht geladen werden. Bitte Seite neu laden.');
      return;
    }

    input.disabled = true;
    showCompanyError('');
    setLogoHint('Logo wird automatisch vorbereitet …', 'processing');

    try {
      const result = await window.QRPassLogoProcessor.process(file);
      draftLogo = result.dataUrl;
      updatePreview();

      let removeButton = document.querySelector('.company-remove-logo');
      if (!removeButton) {
        const hint = document.querySelector('#company-logo-hint');
        hint?.insertAdjacentHTML('afterend', '<button type="button" class="button button-small company-remove-logo" data-company-action="remove-logo">Logo entfernen</button>');
      }

      setLogoHint(
        result.removedBackground
          ? 'Fertig: Hintergrund entfernt, zugeschnitten und als PNG optimiert.'
          : 'Fertig: Bild zugeschnitten und als PNG optimiert. Ein eindeutiger Hintergrund war nicht vorhanden.',
        'done'
      );
    } catch (error) {
      draftLogo = company.logoDataUrl || '';
      updatePreview();
      input.value = '';
      setLogoHint('Bild auswählen – QRPass verarbeitet das Logo automatisch.', '');
      showCompanyError(error.message || 'Das Logo konnte nicht verarbeitet werden.');
    } finally {
      input.disabled = false;
    }
  }

  function showCompanyError(text) {
    const form = document.querySelector('#company-setup-form');
    if (!form) return;
    let el = form.querySelector('.company-error');
    if (!el) {
      el = document.createElement('div');
      el.className = 'company-error';
      form.prepend(el);
    }
    el.textContent = text;
    el.hidden = !text;
  }

  async function saveSetup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const logoInput = form.querySelector('#company-logo-input');
    if (logoInput?.disabled) {
      showCompanyError('Das Logo wird noch verarbeitet. Bitte kurz warten.');
      return;
    }

    const values = Object.fromEntries(new FormData(form).entries());
    const payload = {
      companyName: String(values.companyName || '').trim(),
      logoDataUrl: draftLogo,
      headerColor: normalizeHex(values.headerColor, DEFAULTS.headerColor),
      accentColor: normalizeHex(values.accentColor, DEFAULTS.accentColor),
      backgroundColor: normalizeHex(values.backgroundColor, DEFAULTS.backgroundColor)
    };

    if (!payload.companyName) {
      showCompanyError('Bitte den Firmennamen eintragen.');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Speichert…';
    showCompanyError('');

    try {
      const result = await request('/api/company', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      company = { ...DEFAULTS, ...(result.company || payload), setupCompleted: true };
      applyTheme(company);
      document.querySelector('#company-setup-backdrop')?.remove();
      firstRun = false;
      draftLogo = '';
    } catch (error) {
      submit.disabled = false;
      submit.textContent = firstRun ? 'Einrichtung abschließen' : 'Speichern';
      showCompanyError(error.message);
    }
  }

  async function init() {
    try {
      const state = await request('/api/state');
      applyTheme(state?.company || DEFAULTS);
      if (!state?.company?.setupCompleted) openSetup(true);
    } catch {
      applyTheme(DEFAULTS);
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-company-action]');
    if (!button) return;
    const action = button.dataset.companyAction;
    if (action === 'settings') openSetup(false);
    if (action === 'close') closeSetup();
    if (action === 'remove-logo') {
      draftLogo = '';
      const fileInput = document.querySelector('#company-logo-input');
      if (fileInput) fileInput.value = '';
      button.remove();
      setLogoHint('Bild auswählen – QRPass wandelt es automatisch in PNG um und entfernt den Hintergrund.', '');
      updatePreview();
    }
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !firstRun) closeSetup();
  });

  init();
})();