(() => {
  const VERSION = '1.2.0';
  const nativeFetch = window.fetch.bind(window);
  let sessionHandling = false;

  window.QRPassVersion = VERSION;
  document.documentElement.dataset.qrpassVersion = VERSION;

  function requestPath(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.href);
      if (input instanceof Request) return new URL(input.url, location.href);
      return new URL(String(input), location.href);
    } catch {
      return null;
    }
  }

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const url = requestPath(args[0]);

    if (
      response.status === 401 &&
      url?.origin === location.origin &&
      url.pathname.startsWith('/api/') &&
      !url.pathname.startsWith('/api/auth/')
    ) {
      queueMicrotask(() => document.dispatchEvent(new CustomEvent('qrpass:session-expired')));
    }

    return response;
  };

  function showSessionNote() {
    document.querySelector('.qrpass-session-note')?.remove();
    const note = document.createElement('div');
    note.className = 'qrpass-session-note';
    note.textContent = 'Sitzung abgelaufen – bitte erneut anmelden.';
    document.body.append(note);
    setTimeout(() => note.remove(), 3500);
  }

  function handleSessionExpired() {
    if (sessionHandling) return;
    sessionHandling = true;
    showSessionNote();

    const openLogin = () => {
      if (window.QRPassAuth?.showLogin) {
        window.QRPassAuth.showLogin();
        sessionHandling = false;
        return true;
      }
      return false;
    };

    if (!openLogin()) {
      setTimeout(() => {
        openLogin();
        sessionHandling = false;
      }, 300);
    }
  }

  function injectFooter() {
    if (document.querySelector('#qrpass-footer')) return;
    const footer = document.createElement('footer');
    footer.id = 'qrpass-footer';
    footer.className = 'qrpass-footer';
    footer.innerHTML = `
      <span>QRPass ${VERSION}</span>
      <span class="footer-sep">·</span>
      <button type="button" data-legal-open="imprint">Impressum</button>
      <span class="footer-sep">·</span>
      <button type="button" data-legal-open="privacy">Datenschutz</button>`;
    document.body.append(footer);
  }

  document.addEventListener('qrpass:session-expired', handleSessionExpired);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFooter, { once: true });
  } else {
    injectFooter();
  }
})();
