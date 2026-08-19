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
        if (/^QRPass 1\.[0-2]$/.test(el.textContent.trim())) setText(el, 'QRPass 1.3');
      });
      document.querySelectorAll('.legal-note').forEach(el => {
        if (/QRPass 1\.[0-2]/.test(el.textContent)) {
          setText(el, el.textContent.replace(/QRPass 1\.[0-2]/g, 'QRPass 1.3'));
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

      document.querySelectorAll('.legal-section').forEach(section => {
        const heading = section.querySelector('h3');
        if (!heading || !heading.textContent.startsWith('8. Passwort-Zurücksetzung per E-Mail')) return;
        setText(heading, '8. E-Mail-Versand und Erinnerungen');
        const paragraph = section.querySelector('p');
        if (paragraph) {
          setText(paragraph, 'QRPass kann für Passwort-Zurücksetzungen und vom Admin aktivierte Termin-Erinnerungen einen externen E-Mail-Versanddienst (Resend) verwenden. Dabei werden die jeweilige Empfänger-E-Mail-Adresse und die für die Nachricht erforderlichen Inhalte an den Versanddienst übertragen. E-Mail-Erinnerungen sind optional und können vom Admin jederzeit deaktiviert oder an eine andere Empfänger-Adresse gerichtet werden.');
        }
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
