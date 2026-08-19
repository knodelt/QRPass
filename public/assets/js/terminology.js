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
        if (/^QRPass 1\.(?:0|1|2|3)$/.test(el.textContent.trim())) setText(el, 'QRPass 1.3.1');
      });
      document.querySelectorAll('.legal-note').forEach(el => {
        if (/QRPass 1\.(?:0|1|2|3)/.test(el.textContent)) {
          setText(el, el.textContent.replace(/QRPass 1\.(?:0|1|2|3)/g, 'QRPass 1.3.1'));
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

      const privacySections = [...document.querySelectorAll('.legal-section')];
      const mailSection = privacySections.find(section => section.querySelector('h3')?.textContent.startsWith('8. Passwort-Zurücksetzung'));
      if (mailSection && !document.querySelector('[data-v13-reminder-privacy]')) {
        const section = document.createElement('section');
        section.className = 'legal-section';
        section.dataset.v13ReminderPrivacy = '1';
        section.innerHTML = '<h3>8a. E-Mail-Erinnerungen</h3><p>Wenn ein Firmen-Admin E-Mail-Erinnerungen aktiviert, verarbeitet QRPass die hinterlegte Empfängeradresse sowie fällige Prüfungs- und Wartungstermine, um die gewünschte Erinnerungs-E-Mail zu erstellen. Für den Versand wird Resend als E-Mail-Dienst eingesetzt. Die Funktion kann vom Admin jederzeit deaktiviert werden.</p>';
        mailSection.after(section);
      }
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
