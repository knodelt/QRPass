(() => {
  const KEY = 'qrpass-pending-machine';

  function machineHash() {
    return /^#machine\/.+/.test(location.hash) ? location.hash : '';
  }

  function rememberMachine() {
    const hash = machineHash();
    if (hash) sessionStorage.setItem(KEY, hash);
  }

  rememberMachine();
  window.addEventListener('hashchange', rememberMachine);

  document.addEventListener('qrpass:auth', () => {
    const pending = sessionStorage.getItem(KEY);
    if (!pending) return;

    if (location.hash !== pending) {
      history.replaceState(null, '', `${location.pathname}${location.search}${pending}`);
    }

    setTimeout(() => sessionStorage.removeItem(KEY), 1200);
  });
})();
