(() => {
  let observer;

  function setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function update() {
    observer?.disconnect();
    try {
      document.querySelectorAll('.auth-head span').forEach(el => {
        if (el.textContent.trim() === 'Maschinenbuch') setText(el, 'Betriebsmittelbuch');
      });

      document.querySelectorAll('.qr-label-brand small').forEach(el => {
        if (el.textContent.trim() === 'Maschinenbuch') setText(el, 'Betriebsmittelbuch');
      });

      const archiveTitle = document.querySelector('#archive-title');
      if (archiveTitle?.textContent.trim() === 'Archivierte Maschinen') {
        setText(archiveTitle, 'Archivierte Betriebsmittel');
      }

      document.querySelectorAll('.archive-empty strong').forEach(el => {
        if (el.textContent.trim() === 'Archiv ist leer') return;
      });
      document.querySelectorAll('.archive-empty span').forEach(el => {
        const text = el.textContent.trim();
        if (text.includes('Archivierte Maschinen erscheinen hier')) {
          setText(el, 'Archivierte Betriebsmittel erscheinen hier und können wiederhergestellt werden.');
        }
      });

      document.querySelectorAll('.account-section').forEach(section => {
        const title = section.querySelector('.account-section-head strong')?.textContent.trim();
        if (title !== 'Datensicherung') return;
        const small = section.querySelector('.account-section-head small');
        if (small?.textContent.includes('Maschinen')) {
          setText(small, 'Aktive und archivierte Betriebsmittel inklusive Störungen, Wartungen, Prüfungen und Verlauf.');
        }
      });

      document.querySelectorAll('.legal-head small').forEach(el => {
        if (el.textContent.trim() === 'QRPass 1.0') setText(el, 'QRPass 1.1');
      });
      document.querySelectorAll('.legal-note').forEach(el => {
        if (el.textContent.includes('QRPass 1.0')) {
          setText(el, el.textContent.replaceAll('QRPass 1.0', 'QRPass 1.1'));
        }
      });

      const privacyLists = [...document.querySelectorAll('.legal-section')].filter(section =>
        section.querySelector('h3')?.textContent.startsWith('2. Welche Daten QRPass verarbeitet')
      );
      privacyLists.forEach(section => {
        const list = section.querySelector('ul');
        if (!list || list.querySelector('[data-v11-inspection-privacy]')) return;
        const item = document.createElement('li');
        item.dataset.v11InspectionPrivacy = '1';
        item.textContent = 'Prüfdaten wie Prüfart, Prüfdatum, Prüfer, Prüfergebnis und der eingetragene nächste Prüftermin.';
        list.append(item);
      });
    } finally {
      observer?.observe(document.body, { childList: true, subtree: true });
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  }

  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
})();
