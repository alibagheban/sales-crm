/* Phone app start-up: Dropbox sign-in, find the Sales folder, load the Sales CRM's own code from
 * the Sales folder in Dropbox (so the phone always runs the same version as the computers), then open it. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CFG = window.SALESCRM_CONFIG || {};
  const CODE = ['_app/css/styles.css', '_app/css/sales-crm.css', '_app/js/vendor/jszip.min.js', '_app/js/xlsx-engine.js', '_app/js/sheet-helpers.js', '_app/js/sales-crm.js'];
  const screen = html => { $('#app').innerHTML = '<div class="boot"><img class="blogo" src="_app/assets/logo-full.png" alt="Machinery Specialist"><h1>Sales CRM</h1>' + html + '</div>'; };
  const fail = e => { console.error(e); screen('<p class="berr">' + esc(e.message || e) + '</p><button class="bbtn" onclick="location.reload()">Try again</button>' + (Dbx.signedIn() ? '<button class="blink" id="bout">Sign out of Dropbox</button>' : '')); const o = $('#bout'); if (o) o.onclick = () => { Dbx.signOut(); location.reload(); }; };

  // ---- small cache of the app's code (IndexedDB), refreshed when the file in Dropbox changes
  const db = () => new Promise((res, rej) => { const r = indexedDB.open('salescrm-phone', 1); r.onupgradeneeded = () => r.result.createObjectStore('code'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const cget = async k => { try { const d = await db(); return await new Promise(res => { const t = d.transaction('code').objectStore('code').get(k); t.onsuccess = () => res(t.result); t.onerror = () => res(null); }); } catch (e) { return null; } };
  const cset = async (k, v) => { try { const d = await db(); await new Promise(res => { const t = d.transaction('code', 'readwrite'); t.objectStore('code').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) { /* ignore */ } };
  let revs = {};
  async function codeText(folder, rel) {
    const path = folder + '/' + rel; const rev = revs[rel.toLowerCase()];
    const c = await cget(path); if (c && rev && c.rev === rev) return c.text;
    const r = await Dbx.content('files/download', { path }); const text = await r.text();
    const meta = JSON.parse(r.headers.get('Dropbox-API-Result') || '{}'); await cset(path, { rev: meta.rev || rev, text });
    return text;
  }
  const addScript = text => new Promise((res, rej) => { const s = document.createElement('script'); s.src = URL.createObjectURL(new Blob([text], { type: 'text/javascript' })); s.onload = res; s.onerror = () => rej(new Error('Couldn’t start the Sales CRM code.')); document.body.appendChild(s); });

  async function loadApp(folder) {
    screen('<p>Opening the Sales CRM…</p><div class="bspin"></div>');
    revs = {};
    try { let j = await Dbx.rpc('files/list_folder', { path: folder + '/_app', recursive: true, limit: 2000 }); const all = j.entries.slice(); while (j.has_more) { j = await Dbx.rpc('files/list_folder/continue', { cursor: j.cursor }); all.push(...j.entries); }
      const base = (folder + '/_app/').toLowerCase(); for (const m of all) if (m['.tag'] === 'file') revs['_app/' + m.path_lower.slice(base.length)] = m.rev; }
    catch (e) { if (/not_found/.test(e.summary || '')) throw new Error('This folder has no Sales CRM program files (_app). Choose the Sales folder.'); throw e; }
    const texts = await Promise.all(CODE.map(p => codeText(folder, p)));
    for (let i = 0; i < CODE.length; i++) if (/\.css$/.test(CODE[i])) { const st = document.createElement('style'); st.textContent = texts[i]; document.head.appendChild(st); }
    window.SALESCRM_HOSTED = true;
    window.SalesCrmAssetUrl = async rel => URL.createObjectURL(new Blob([await codeText(folder, rel)], { type: 'text/javascript' }));
    window.SalesCrmHostedPick = () => { Dbx.setFolder(null); location.reload(); };
    window.SalesCrmHostedSignOut = () => { Dbx.signOut(); location.reload(); };
    for (let i = 0; i < CODE.length; i++) if (/\.js$/.test(CODE[i])) await addScript(texts[i]);
    $('#app').innerHTML = '';
    await window.SalesCrmMount(new DbxDir(folder, folder.split('/').pop()));
  }

  // ---- choose the Sales folder (the one with Sales CRM.xlsx)
  async function browse(path) {
    screen('<p>Finding folders…</p><div class="bspin"></div>');
    const items = await Dbx.list(path);
    const folders = items.filter(m => m['.tag'] === 'folder').sort((a, b) => a.name.localeCompare(b.name));
    const hasCrm = items.some(m => m['.tag'] === 'file' && /^sales\s*crm.*\.xlsx$/i.test(m.name));
    const up = path === '' || path === '/' ? '' : path.replace(/\/[^/]+$/, '') || '/';
    screen('<p>Choose the <b>Sales</b> folder (the one with Sales CRM.xlsx).</p><div class="bpath">' + esc(path || '/') + '</div>' +
      (hasCrm ? '<button class="bbtn" id="buse">Use this folder</button>' : '') +
      '<div class="blist">' + (up !== '' || path ? '<button class="bitem" data-p="' + esc(up === '/' ? '' : up) + '">‹ Back</button>' : '') + folders.map(f => '<button class="bitem" data-p="' + esc(f.path_display) + '">' + esc(f.name) + '</button>').join('') + (folders.length ? '' : '<p class="small">No folders here.</p>') + '</div>');
    document.querySelectorAll('.bitem').forEach(b => b.onclick = () => browse(b.dataset.p).catch(fail));
    const u = $('#buse'); if (u) u.onclick = () => { Dbx.setFolder(path); loadApp(path).catch(fail); };
  }
  async function findFolder() {
    const tries = [CFG.defaultFolder, '/Sales', '/Machinery Specialist/Sales'].filter(Boolean);
    for (const p of tries) { try { const items = await Dbx.list(p); if (items.some(m => m['.tag'] === 'file' && /^sales\s*crm.*\.xlsx$/i.test(m.name))) return items[0] && items[0].path_display ? items[0].path_display.replace(/\/[^/]+$/, '') : p; } catch (e) { /* not there */ } }
    return null;
  }

  async function start() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!Dbx.appKey()) {
      screen('<p>One-time setup: paste the <b>App key</b> of your Dropbox app.</p><input id="bkey" class="binp" placeholder="Dropbox app key" autocomplete="off"><button class="bbtn" id="bsave">Save</button><p class="small">In the Dropbox app settings, add this Redirect URI:<br><code>' + esc(Dbx.redirectUri()) + '</code></p>');
      $('#bsave').onclick = () => { const v = $('#bkey').value.trim(); if (v) { localStorage.setItem('salescrm.dbx.appkey', v); location.reload(); } };
      return;
    }
    if (await Dbx.finishSignIn()) { /* signed in */ }
    if (!Dbx.signedIn()) {
      screen('<p>Sign in with the Dropbox account that has the <b>Sales</b> folder. Only the sales team has access.</p><button class="bbtn" id="bin">Sign in with Dropbox</button>');
      $('#bin').onclick = () => Dbx.signIn().catch(fail); return;
    }
    let folder = Dbx.folder();
    if (!folder) { screen('<p>Looking for the Sales folder…</p><div class="bspin"></div>'); folder = await findFolder(); if (folder) Dbx.setFolder(folder); }
    if (!folder) return browse('');
    await loadApp(folder);
  }
  window.addEventListener('DOMContentLoaded', () => start().catch(fail));
})();
