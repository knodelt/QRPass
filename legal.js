(() => {
  const config = {
    operatorName: '', businessName: '', street: '', postalCode: '', city: '', country: 'Deutschland',
    email: '', phone: '', vatId: '', updatedAt: '18.08.2026',
    ...(window.QRPassLegalConfig || {})
  };

  function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function missingLegalData() {
    return !config.operatorName || !config.street || !config.postalCode || !config.city || !config.email;
  }

  function contactMarkup() {
    const addressComplete = config.street && config.postalCode && config.city;
    return `
      <div class="legal-contact">
        ${config.businessName ? `<strong>${esc(config.businessName)}</strong>` : ''}
        <strong>${esc(config.operatorName || 'Betreiber noch einzutragen')}</strong>
        ${addressComplete
          ? `<span>${esc(config.street)}</span><span>${esc(config.postalCode)} ${esc(config.city)}</span><span>${esc(config.country)}</span>`
          : '<span class="legal-missing">Anschrift noch zu ergänzen</span>'}
        ${config.email
          ? `<span>E-Mail: <a href="mailto:${esc(config.email)}">${esc(config.email)}</a></span>`
          : '<span class="legal-missing">Öffentliche Kontakt-E-Mail noch zu ergänzen</span>'}
        ${config.phone ? `<span>Telefon: ${esc(config.phone)}</span>` : ''}
        ${config.vatId ? `<span>USt-IdNr.: ${esc(config.vatId)}</span>` : ''}
      </div>`;
  }

  function imprintMarkup() {
    return `
      ${missingLegalData() ? `
        <div class="legal-warning">
          Dieses Impressum ist noch nicht vollständig veröffentlichtauglich. Anschrift und öffentliche Kontakt-E-Mail fehlen noch und werden nicht automatisch aus privaten Kontodaten abgeleitet.
        </div>` : ''}
      <section class="legal-section">
        <h3>Angaben gemäß § 5 DDG</h3>
        ${contactMarkup()}
      </section>
      <section class="legal-section">
        <h3>Kontakt</h3>
        <p>Für Anfragen zu QRPass ist die oben angegebene Kontaktmöglichkeit zu verwenden.</p>
      </section>
      <section class="legal-section">
        <h3>Register- und Steuerangaben</h3>
        <p>Registerangaben oder eine Umsatzsteuer-Identifikationsnummer werden nur aufgeführt, sofern sie für den Betreiber tatsächlich vorhanden und gesetzlich anzugeben sind.</p>
      </section>
      <div class="legal-note">Stand: ${esc(config.updatedAt)} · QRPass 1.0</div>`;
  }

  function privacyMarkup() {
    return `
      ${missingLegalData() ? `
        <div class="legal-warning">
          Die Datenschutzerklärung ist technisch auf QRPass abgestimmt. Die Kontaktdaten des Verantwortlichen müssen vor dem öffentlichen Produktivbetrieb noch mit vollständiger Anschrift und Kontakt-E-Mail ergänzt werden.
        </div>` : ''}

      <section class="legal-section">
        <h3>1. Verantwortlicher</h3>
        ${contactMarkup()}
      </section>

      <section class="legal-section">
        <h3>2. Welche Daten QRPass verarbeitet</h3>
        <ul>
          <li>Admin-Kontodaten wie E-Mail-Adresse sowie technisch abgeleitete Passwortwerte und Salts. Klartext-Passwörter werden nicht in der QRPass-Datenbank gespeichert.</li>
          <li>Mitarbeiterdaten wie Anzeigename, technisch abgeleitete PIN-Werte, Status und Sitzungsdaten.</li>
          <li>Firmeneinstellungen wie Firmenname, Logo und Farbauswahl.</li>
          <li>Maschinen- und Betriebsdaten wie Maschinenname, Anlagennummer, Bereich, Wartungsintervalle, Störungen, Wartungen, Notizen und Verlauf.</li>
          <li>Nachvollziehbarkeitsdaten wie Ersteller bzw. Bearbeiter eines Eintrags und Zeitpunkte von Aktionen.</li>
        </ul>
      </section>

      <section class="legal-section">
        <h3>3. Zweck und Rechtsgrundlagen</h3>
        <p>Die Verarbeitung erfolgt zur Bereitstellung und Absicherung des QRPass-Dienstes, zur Verwaltung von Firmenkonten, Maschinen, Wartungen und Störungen sowie zur Nachvollziehbarkeit betrieblicher Einträge. Je nach Nutzung stützt sich die Verarbeitung insbesondere auf Art. 6 Abs. 1 lit. b DSGVO zur Vertragsdurchführung bzw. vorvertraglichen Durchführung und Art. 6 Abs. 1 lit. f DSGVO für den sicheren und zuverlässigen Betrieb des Dienstes.</p>
      </section>

      <section class="legal-section">
        <h3>4. Firmen- und Beschäftigtendaten</h3>
        <p>Soweit ein Kundenunternehmen innerhalb von QRPass personenbezogene Daten seiner Beschäftigten oder anderer Personen einträgt, ist grundsätzlich das jeweilige Kundenunternehmen für die Rechtmäßigkeit dieser Eingaben verantwortlich. Soweit QRPass solche Daten im Auftrag verarbeitet, ist vor dem entsprechenden Produktivbetrieb ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO erforderlich.</p>
      </section>

      <section class="legal-section">
        <h3>5. Hosting über Cloudflare</h3>
        <p>QRPass wird technisch über Cloudflare Workers und Cloudflare D1 bereitgestellt. Dabei können zur Auslieferung und Absicherung des Dienstes technische Verbindungsdaten, insbesondere IP-Adresse, Zeitpunkt, angeforderte Ressource und Geräte-/Browserinformationen verarbeitet werden. Die in QRPass gespeicherten Firmen- und Anwendungsdaten werden über die angebundene D1-Datenbank verarbeitet.</p>
      </section>

      <section class="legal-section">
        <h3>6. QR-Code-Bibliothek über jsDelivr</h3>
        <p>Für die Erzeugung der QR-Codes lädt QRPass derzeit die Bibliothek qrcodejs in fest definierter Version über das CDN jsDelivr. Beim Laden dieser Datei kann der Browser technisch notwendige Verbindungsdaten wie die IP-Adresse an den CDN-Anbieter übermitteln. Der eigentliche Maschinenlink wird anschließend im Browser zum QR-Code verarbeitet.</p>
      </section>

      <section class="legal-section">
        <h3>7. Cookies und lokale Speicherung</h3>
        <p>QRPass verwendet keine Marketing- oder Tracking-Cookies. Für die Anmeldung wird das technisch notwendige Sitzungs-Cookie <strong>qrpass_session</strong> verwendet. Außerdem nutzt QRPass lokale Browser-Speicher für technisch notwendige Funktionen wie die einmalige Datenmigration, das Merken einer gescannten Maschine während des Logins und den PWA-/Offline-Cache. Diese Funktionen dienen ausschließlich der Bereitstellung des ausdrücklich gewünschten Dienstes.</p>
      </section>

      <section class="legal-section">
        <h3>8. Passwort-Zurücksetzung per E-Mail</h3>
        <p>Die Funktion „Passwort vergessen“ wird nur angezeigt, wenn ein E-Mail-Versanddienst für QRPass eingerichtet ist. Reset-Links sind einmalig und zeitlich begrenzt. Vor Aktivierung des öffentlichen E-Mail-Versands werden die Angaben zum eingesetzten Versanddienst in dieser Datenschutzerklärung ergänzt.</p>
      </section>

      <section class="legal-section">
        <h3>9. Speicherdauer</h3>
        <p>Firmen-, Maschinen- und Verlaufsdaten werden grundsätzlich gespeichert, bis sie innerhalb von QRPass gelöscht oder das Firmenkonto vollständig gelöscht wird. Sitzungen sind technisch zeitlich begrenzt. Passwort-Reset-Tokens sind nur kurzfristig gültig. Gesetzliche Aufbewahrungspflichten können im Einzelfall eine längere Speicherung bestimmter Vertrags- oder Abrechnungsdaten erforderlich machen.</p>
      </section>

      <section class="legal-section">
        <h3>10. Empfänger und Drittlandverarbeitung</h3>
        <p>Technische Dienstleister können Daten erhalten, soweit dies für Hosting, Sicherheit oder einen ausdrücklich aktivierten E-Mail-Versand erforderlich ist. Soweit Dienstleister Daten außerhalb der Europäischen Union oder des Europäischen Wirtschaftsraums verarbeiten, sind die jeweils anwendbaren datenschutzrechtlichen Voraussetzungen und geeigneten Garantien zu beachten.</p>
      </section>

      <section class="legal-section">
        <h3>11. Ihre Rechte</h3>
        <p>Betroffene Personen haben im Rahmen der gesetzlichen Voraussetzungen insbesondere Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Außerdem besteht das Recht, sich bei einer zuständigen Datenschutzaufsichtsbehörde zu beschweren.</p>
      </section>

      <section class="legal-section">
        <h3>12. Sicherheit</h3>
        <p>QRPass setzt technische Schutzmaßnahmen ein. Dazu gehören unter anderem verschlüsselte HTTPS-Übertragung, sichere Sitzungscookies, rollenbasierte serverseitige Berechtigungsprüfungen und die Speicherung technisch abgeleiteter Passwort- bzw. PIN-Werte statt Klartext-Zugangsdaten.</p>
      </section>

      <div class="legal-note">Stand: ${esc(config.updatedAt)} · Diese Datenschutzerklärung beschreibt den technischen Stand von QRPass 1.0.</div>`;
  }

  function closeLegal() {
    document.querySelector('#legal-backdrop')?.remove();
  }

  function openLegal(type) {
    const privacy = type === 'privacy';
    closeLegal();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="legal-backdrop" id="legal-backdrop">
        <section class="legal-panel" role="dialog" aria-modal="true" aria-labelledby="legal-title">
          <header class="legal-head">
            <div><small>QRPass 1.0</small><h2 id="legal-title">${privacy ? 'Datenschutz' : 'Impressum'}</h2></div>
            <button type="button" class="legal-close" data-legal-close aria-label="Schließen">×</button>
          </header>
          <div class="legal-body">${privacy ? privacyMarkup() : imprintMarkup()}</div>
        </section>
      </div>`);
  }

  function injectAuthLinks() {
    const authBox = document.querySelector('.auth-box');
    if (!authBox || authBox.querySelector('.auth-legal-links')) return;
    const links = document.createElement('div');
    links.className = 'auth-legal-links';
    links.innerHTML = `
      <button type="button" data-legal-open="imprint">Impressum</button>
      <span class="footer-sep">·</span>
      <button type="button" data-legal-open="privacy">Datenschutz</button>`;
    authBox.append(links);
  }

  document.addEventListener('click', event => {
    const open = event.target.closest('[data-legal-open]');
    if (open) {
      openLegal(open.dataset.legalOpen);
      return;
    }
    if (event.target.closest('[data-legal-close]')) closeLegal();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeLegal();
  });

  const observer = new MutationObserver(injectAuthLinks);
  observer.observe(document.body, { childList: true, subtree: true });
  injectAuthLinks();
})();
