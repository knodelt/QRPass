const STORE_KEY='qrpass-v0.1';
let state=loadState();
const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');

function uid(prefix='id'){return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`}
function isoDate(d=new Date()){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function addDays(date,days){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+Number(days||0));return isoDate(d)}
function fmtDate(date){if(!date)return '–';return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${date}T12:00:00`))}
function fmtDateTime(value){return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
function esc(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function daysUntil(date){const a=new Date(`${isoDate()}T12:00:00`),b=new Date(`${date}T12:00:00`);return Math.round((b-a)/86400000)}

function demoState(){
  const now=new Date().toISOString();
  const today=isoDate();
  return {machines:[
    {id:'demo_presse_04',name:'Presse 04',assetId:'PR-004',area:'Halle 2',manufacturer:'Schuler',model:'Presse',serial:'',interval:90,lastMaintenance:addDays(today,-75),notes:'Demo-Maschine',createdAt:now,history:[{id:uid('h'),type:'maintenance',title:'Wartung durchgeführt',text:'Sichtprüfung und Schmierung durchgeführt.',createdAt:new Date(Date.now()-75*86400000).toISOString()}]},
    {id:'demo_pumpe_12',name:'Kühlmittelpumpe 12',assetId:'P-012',area:'Halle 1',manufacturer:'KSB',model:'',serial:'',interval:180,lastMaintenance:addDays(today,-40),notes:'Demo-Maschine',createdAt:now,history:[{id:uid('h'),type:'fault',title:'Leckage am Anschluss',text:'Leichte Undichtigkeit festgestellt.',createdAt:new Date(Date.now()-2*86400000).toISOString(),resolved:false}]},
    {id:'demo_kompressor_02',name:'Kompressor 02',assetId:'K-002',area:'Technikraum',manufacturer:'Kaeser',model:'',serial:'',interval:365,lastMaintenance:addDays(today,-120),notes:'Demo-Maschine',createdAt:now,history:[]}
  ]};
}
function loadState(){try{const raw=localStorage.getItem(STORE_KEY);return raw?JSON.parse(raw):demoState()}catch(e){return demoState()}}
function saveState(){localStorage.setItem(STORE_KEY,JSON.stringify(state))}
function machineNextDue(m){return m.lastMaintenance?addDays(m.lastMaintenance,m.interval||0):null}
function openFaults(m){return (m.history||[]).filter(h=>h.type==='fault'&&!h.resolved)}
function machineStatus(m){
  if(openFaults(m).length)return {key:'danger',label:'Störung offen'};
  const due=machineNextDue(m);if(!due)return {key:'warn',label:'Wartung fehlt'};
  const days=daysUntil(due);if(days<0)return {key:'danger',label:'Wartung überfällig'};
  if(days<=14)return {key:'warn',label:'Wartung bald fällig'};
  return {key:'ok',label:'In Ordnung'};
}
function getMachine(id){return state.machines.find(m=>m.id===id)}
function currentMachineId(){const m=location.hash.match(/^#machine\/(.+)$/);return m?decodeURIComponent(m[1]):null}

function render(){const id=currentMachineId();if(id)return renderDetail(id);renderDashboard()}
function renderDashboard(){
  const machines=[...state.machines];
  const faults=machines.reduce((n,m)=>n+openFaults(m).length,0);
  const due=machines.filter(m=>{const d=machineNextDue(m);return d&&daysUntil(d)<=14}).length;
  app.innerHTML=`
    <section class="hero"><div><p class="eyebrow">Digitales Maschinenbuch</p><h1>Was braucht Aufmerksamkeit?</h1><p>Maschine öffnen, QR scannen, Störung oder Wartung dokumentieren. Fertig.</p></div></section>
    <section class="stats" aria-label="Kennzahlen">
      <article class="stat"><span>Maschinen</span><strong>${machines.length}</strong></article>
      <article class="stat"><span>Offene Störungen</span><strong>${faults}</strong></article>
      <article class="stat"><span>Wartung fällig</span><strong>${due}</strong></article>
    </section>
    <section class="panel" id="machines">
      <div class="panel-head"><h2>Maschinen</h2><input id="machine-search" class="search" type="search" placeholder="Maschine, Nummer oder Bereich suchen…" aria-label="Maschinen suchen"></div>
      <div id="machine-list" class="machine-list"></div>
    </section>`;
  renderMachineList(machines);
  document.querySelector('#machine-search')?.addEventListener('input',e=>{
    const q=e.target.value.trim().toLowerCase();
    renderMachineList(machines.filter(m=>[m.name,m.assetId,m.area,m.manufacturer].some(v=>String(v||'').toLowerCase().includes(q))));
  });
}
function renderMachineList(machines){
  const root=document.querySelector('#machine-list');if(!root)return;
  if(!machines.length){root.innerHTML='<div class="empty"><strong>Keine Maschine gefunden</strong>Lege eine neue Maschine an oder ändere die Suche.</div>';return}
  root.innerHTML=machines.map(m=>{const s=machineStatus(m);const due=machineNextDue(m);return `
    <article class="machine-row">
      <div class="machine-main"><button data-action="open-machine" data-id="${esc(m.id)}">${esc(m.name)}</button><small>${esc(m.assetId||'Keine Anlagennummer')} · ${esc(m.area||'Kein Bereich')}</small></div>
      <div class="machine-cell"><small>Nächste Wartung</small><strong>${fmtDate(due)}</strong></div>
      <div class="machine-cell"><small>Offene Störungen</small><strong>${openFaults(m).length}</strong></div>
      <span class="status status-${s.key}">${s.label}</span>
    </article>`}).join('');
}
function renderDetail(id){
  const m=getMachine(id);
  if(!m){app.innerHTML='<section class="panel empty"><strong>Maschine nicht gefunden</strong>Dieser QR-Code gehört nicht zu den Daten auf diesem Gerät.<br><br><button class="button button-primary" data-action="home">Zur Übersicht</button></section>';return}
  const s=machineStatus(m), due=machineNextDue(m), faults=openFaults(m);
  const history=[...(m.history||[])].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  app.innerHTML=`
    <section class="detail-head">
      <div><button class="button button-ghost button-small" data-action="home">← Übersicht</button><p class="eyebrow" style="margin-top:18px">${esc(m.assetId||'Maschine')}</p><h1>${esc(m.name)}</h1><p>${esc(m.area||'Kein Bereich')} · <span class="status status-${s.key}">${s.label}</span></p></div>
      <div class="detail-actions"><button class="button button-danger" data-action="report-fault" data-id="${esc(m.id)}">Störung melden</button><button class="button button-primary" data-action="add-maintenance" data-id="${esc(m.id)}">Wartung eintragen</button></div>
    </section>
    <section class="detail-grid">
      <div class="panel">
        <div class="panel-head"><h2>Maschinendaten</h2><div><button class="button button-small" data-action="show-qr" data-id="${esc(m.id)}">QR-Code</button> <button class="button button-small" data-action="edit-machine" data-id="${esc(m.id)}">Bearbeiten</button></div></div>
        <div class="info-grid">
          <div class="info-box"><span>Anlagennummer</span><strong>${esc(m.assetId||'–')}</strong></div>
          <div class="info-box"><span>Bereich</span><strong>${esc(m.area||'–')}</strong></div>
          <div class="info-box"><span>Hersteller</span><strong>${esc(m.manufacturer||'–')}</strong></div>
          <div class="info-box"><span>Modell</span><strong>${esc(m.model||'–')}</strong></div>
          <div class="info-box"><span>Letzte Wartung</span><strong>${fmtDate(m.lastMaintenance)}</strong></div>
          <div class="info-box"><span>Nächste Wartung</span><strong>${fmtDate(due)}</strong></div>
        </div>
        ${m.notes?`<div style="padding:0 18px 18px"><small class="muted">Notiz</small><p>${esc(m.notes)}</p></div>`:''}
        ${faults.map(f=>`<div class="fault-card"><strong>${esc(f.title)}</strong><p>${esc(f.text||'Keine Beschreibung')}</p><button class="button button-small" data-action="resolve-fault" data-machine="${esc(m.id)}" data-entry="${esc(f.id)}">Als erledigt markieren</button></div>`).join('')}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Verlauf</h2><button class="button button-small" data-action="add-note" data-id="${esc(m.id)}">+ Notiz</button></div>
        <div class="history">${history.length?history.map(h=>`<article class="history-item"><span class="dot ${h.type}"></span><div><p>${esc(h.title)}${h.type==='fault'&&h.resolved?' · erledigt':''}</p><small>${esc(h.text||'')}</small></div><time>${fmtDateTime(h.createdAt)}</time></article>`).join(''):'<div class="empty"><strong>Noch kein Verlauf</strong>Wartungen, Störungen und Notizen erscheinen hier.</div>'}</div>
      </div>
    </section>`;
}

function openModal({eyebrow='',title,body,onReady}){
  const tpl=document.querySelector('#modal-template').content.cloneNode(true);modalRoot.innerHTML='';modalRoot.append(tpl);
  modalRoot.querySelector('#modal-eyebrow').textContent=eyebrow;modalRoot.querySelector('#modal-title').textContent=title;modalRoot.querySelector('#modal-body').innerHTML=body;
  onReady?.(modalRoot);setTimeout(()=>modalRoot.querySelector('input,textarea,button')?.focus(),30);
}
function closeModal(){modalRoot.innerHTML=''}
function machineForm(m={}){return `<form id="machine-form" class="form-grid">
  <div class="field full"><label>Name der Maschine *</label><input name="name" required value="${esc(m.name||'')}" placeholder="z. B. Presse 04"></div>
  <div class="field"><label>Anlagennummer</label><input name="assetId" value="${esc(m.assetId||'')}" placeholder="z. B. PR-004"></div>
  <div class="field"><label>Bereich</label><input name="area" value="${esc(m.area||'')}" placeholder="z. B. Halle 2"></div>
  <div class="field"><label>Hersteller</label><input name="manufacturer" value="${esc(m.manufacturer||'')}"></div>
  <div class="field"><label>Modell</label><input name="model" value="${esc(m.model||'')}"></div>
  <div class="field"><label>Letzte Wartung</label><input name="lastMaintenance" type="date" value="${esc(m.lastMaintenance||'')}"></div>
  <div class="field"><label>Wartungsintervall in Tagen</label><input name="interval" type="number" min="1" value="${esc(m.interval||90)}"></div>
  <div class="field full"><label>Notiz</label><textarea name="notes" placeholder="Optional">${esc(m.notes||'')}</textarea></div>
  <div class="form-actions full"><button type="button" class="button" data-action="close-modal">Abbrechen</button><button class="button button-primary" type="submit">Speichern</button></div>
</form>`}
function showMachineForm(machine){
  openModal({eyebrow:machine?'Maschine bearbeiten':'Neue Maschine',title:machine?machine.name:'Maschine anlegen',body:machineForm(machine),onReady:root=>root.querySelector('#machine-form').addEventListener('submit',e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);const data=Object.fromEntries(fd.entries());data.interval=Number(data.interval)||90;
    if(machine){Object.assign(machine,data)}else{const m={id:uid('machine'),...data,createdAt:new Date().toISOString(),history:[]};state.machines.unshift(m)}
    saveState();closeModal();toast('Maschine gespeichert');render();
  })});
}
function showFaultForm(m){openModal({eyebrow:m.assetId||'Störung',title:`Störung · ${m.name}`,body:`<form id="fault-form"><div class="form-grid"><div class="field full"><label>Was ist passiert? *</label><input name="title" required placeholder="z. B. Ölverlust am Zylinder"></div><div class="field full"><label>Beschreibung</label><textarea name="text" placeholder="Kurz beschreiben, was auffällt."></textarea></div></div><div class="form-actions"><button type="button" class="button" data-action="close-modal">Abbrechen</button><button class="button button-danger" type="submit">Störung speichern</button></div></form>`,onReady:root=>root.querySelector('#fault-form').addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget).entries());m.history.push({id:uid('fault'),type:'fault',...d,resolved:false,createdAt:new Date().toISOString()});saveState();closeModal();toast('Störung gemeldet');render()})})}
function showMaintenanceForm(m){openModal({eyebrow:m.assetId||'Wartung',title:`Wartung · ${m.name}`,body:`<form id="maintenance-form"><div class="form-grid"><div class="field"><label>Datum *</label><input name="date" type="date" required value="${isoDate()}"></div><div class="field"><label>Durchgeführt von</label><input name="person" placeholder="Name"></div><div class="field full"><label>Was wurde gemacht?</label><textarea name="text" placeholder="z. B. Sichtprüfung, Schmierung, Filter gewechselt"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-action="close-modal">Abbrechen</button><button class="button button-primary" type="submit">Wartung speichern</button></div></form>`,onReady:root=>root.querySelector('#maintenance-form').addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget).entries());m.lastMaintenance=d.date;m.history.push({id:uid('maint'),type:'maintenance',title:`Wartung durchgeführt${d.person?` · ${d.person}`:''}`,text:d.text,createdAt:new Date(`${d.date}T12:00:00`).toISOString()});saveState();closeModal();toast('Wartung gespeichert');render()})})}
function showNoteForm(m){openModal({eyebrow:m.assetId||'Notiz',title:`Notiz · ${m.name}`,body:`<form id="note-form"><div class="field"><label>Notiz *</label><textarea name="text" required placeholder="Kurze Information für den Verlauf"></textarea></div><div class="form-actions"><button type="button" class="button" data-action="close-modal">Abbrechen</button><button class="button button-primary" type="submit">Notiz speichern</button></div></form>`,onReady:root=>root.querySelector('#note-form').addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget).entries());m.history.push({id:uid('note'),type:'note',title:'Notiz',text:d.text,createdAt:new Date().toISOString()});saveState();closeModal();toast('Notiz gespeichert');render()})})}
function showQR(m){
  const url=`${location.origin}${location.pathname}#machine/${encodeURIComponent(m.id)}`;
  openModal({eyebrow:m.assetId||'QR-Code',title:m.name,body:`<div class="qr-wrap"><div class="qr-label"><div id="qr-code" class="qr-box"></div><strong>${esc(m.name)}</strong><span>${esc(m.assetId||'')}</span></div><p class="qr-help">Diesen QR-Code an der Maschine anbringen. Beim Scannen öffnet QRPass direkt diese Maschine.</p><div class="form-actions" style="justify-content:center"><button class="button" data-action="copy-qr-link" data-url="${esc(url)}">Link kopieren</button><button class="button button-primary" data-action="print-qr">QR drucken</button></div></div>`,onReady:()=>{
    const target=document.querySelector('#qr-code');if(window.QRCode)new QRCode(target,{text:url,width:190,height:190,colorDark:'#111827',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});else target.innerHTML=`<p>QR-Code konnte nicht geladen werden.</p><small>${esc(url)}</small>`;
  }});
}
function showHelp(){openModal({eyebrow:'QRPass 0.1',title:'In drei Schritten',body:`<div class="help-list"><div class="help-step"><span>1</span><div><strong>Maschine anlegen</strong><p>Name, Nummer, Bereich und Wartungsintervall reichen.</p></div></div><div class="help-step"><span>2</span><div><strong>QR-Code drucken</strong><p>QR an der Maschine anbringen und später direkt dorthin scannen.</p></div></div><div class="help-step"><span>3</span><div><strong>Dokumentieren</strong><p>Störung, Wartung oder kurze Notiz eintragen. Alles landet im Verlauf.</p></div></div><p class="muted"><strong>Version 0.1:</strong> Daten werden aktuell auf diesem Gerät gespeichert. Gemeinsame Firmendatenbank und Benutzer kommen als nächster technischer Schritt.</p></div>`})}
function toast(text){const el=document.createElement('div');el.className='toast';el.textContent=text;document.querySelector('#toast-root').append(el);setTimeout(()=>el.remove(),2600)}

function handleClick(e){
  if(e.target.closest('[data-stop-close]')&&e.target.dataset.action!=='close-modal')e.stopPropagation();
  const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
  if(action==='home'){location.hash='';render()}
  if(action==='show-machines'){location.hash='';render();setTimeout(()=>document.querySelector('#machines')?.scrollIntoView({behavior:'smooth'}),50)}
  if(action==='add-machine')showMachineForm();
  if(action==='open-machine')location.hash=`machine/${encodeURIComponent(b.dataset.id)}`;
  if(action==='edit-machine')showMachineForm(getMachine(b.dataset.id));
  if(action==='report-fault')showFaultForm(getMachine(b.dataset.id));
  if(action==='add-maintenance')showMaintenanceForm(getMachine(b.dataset.id));
  if(action==='add-note')showNoteForm(getMachine(b.dataset.id));
  if(action==='show-qr')showQR(getMachine(b.dataset.id));
  if(action==='show-help')showHelp();
  if(action==='close-modal')closeModal();
  if(action==='resolve-fault'){const m=getMachine(b.dataset.machine),h=m?.history.find(x=>x.id===b.dataset.entry);if(h){h.resolved=true;h.resolvedAt=new Date().toISOString();saveState();toast('Störung erledigt');render()}}
  if(action==='print-qr')window.print();
  if(action==='copy-qr-link'){navigator.clipboard?.writeText(b.dataset.url).then(()=>toast('Link kopiert'))}
}
document.addEventListener('click',handleClick);
window.addEventListener('hashchange',render);
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
render();
