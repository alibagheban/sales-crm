/* Dropbox as a folder for the Sales CRM on phones (no server needed).
 * Sign-in: OAuth 2 with PKCE (no secret); the refresh token stays on this device only.
 * DbxDir / DbxFile mimic the browser's folder-handle API that the Sales CRM uses on computers,
 * so the same app code reads and saves Sales CRM.xlsx straight in Dropbox. */
(function () {
  'use strict';
  const LS = 'salescrm.dbx.';
  const ls = { get: k => { try { return localStorage.getItem(LS + k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(LS + k) : localStorage.setItem(LS + k, v); } catch (e) { /* ignore */ } } };
  const API = 'https://api.dropboxapi.com/2/', CONTENT = 'https://content.dropboxapi.com/2/';
  // Dropbox-API-Arg must be plain ASCII
  const argJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const redirectUri = () => location.origin + location.pathname.replace(/[^/]*$/, '');
  const appKey = () => (window.SALESCRM_CONFIG && window.SALESCRM_CONFIG.dropboxAppKey) || ls.get('appkey') || '';

  class NotFound extends Error { constructor(p) { super('Not found: ' + p); this.name = 'NotFoundError'; } }
  class Conflict extends Error { constructor(p) { super('Someone else saved “' + p.split('/').pop() + '” in Dropbox just now. Refresh and try again.'); this.name = 'NoModificationAllowedError'; this.conflict = true; } }

  const Dbx = {
    appKey, redirectUri,
    signedIn: () => !!ls.get('refresh'),
    async signIn() {
      const key = appKey(); if (!key) throw new Error('No Dropbox app key set.');
      const ver = b64url(crypto.getRandomValues(new Uint8Array(48)));
      const ch = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ver)));
      const st = b64url(crypto.getRandomValues(new Uint8Array(16)));
      sessionStorage.setItem('salescrm.pkce', JSON.stringify({ ver, st }));
      location.href = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({ client_id: key, response_type: 'code', code_challenge: ch, code_challenge_method: 'S256', token_access_type: 'offline', redirect_uri: redirectUri(), state: st });
    },
    // back from Dropbox with ?code=…
    async finishSignIn() {
      const q = new URLSearchParams(location.search); const code = q.get('code'); if (!code) return false;
      const saved = JSON.parse(sessionStorage.getItem('salescrm.pkce') || '{}');
      history.replaceState(null, '', redirectUri());
      if (!saved.ver || saved.st !== q.get('state')) throw new Error('Sign-in didn’t finish — please try again.');
      const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams({ code, grant_type: 'authorization_code', code_verifier: saved.ver, client_id: appKey(), redirect_uri: redirectUri() }) });
      const j = await r.json(); if (!r.ok) throw new Error('Dropbox sign-in failed: ' + (j.error_description || j.error || r.status));
      ls.set('refresh', j.refresh_token); Dbx._tok = j.access_token; Dbx._exp = Date.now() + (j.expires_in - 60) * 1000;
      sessionStorage.removeItem('salescrm.pkce'); return true;
    },
    signOut() { ls.set('refresh', null); ls.set('root', null); ls.set('folder', null); Dbx._tok = null; },
    async token() {
      if (Dbx._tok && Date.now() < Dbx._exp) return Dbx._tok;
      const rt = ls.get('refresh'); if (!rt) throw new Error('Not signed in to Dropbox.');
      const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: appKey() }) });
      const j = await r.json(); if (!r.ok) { if (r.status === 400) ls.set('refresh', null); throw new Error('Dropbox sign-in expired — sign in again.'); }
      Dbx._tok = j.access_token; Dbx._exp = Date.now() + (j.expires_in - 60) * 1000; return Dbx._tok;
    },
    // team Dropbox: work from the team space root so team folders (e.g. "Machinery Specialist") are visible
    async rootHeader() {
      let root = ls.get('root');
      if (!root) { const acc = await Dbx.rpc('users/get_current_account', null, true); root = acc.root_info && acc.root_info.root_namespace_id || ''; ls.set('root', root || '-'); }
      return root && root !== '-' ? { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root }) } : {};
    },
    async rpc(ep, body, noRoot) {
      for (let i = 0; i < 4; i++) {
        const h = Object.assign({ Authorization: 'Bearer ' + await Dbx.token() }, noRoot ? {} : await Dbx.rootHeader());
        if (body != null) h['Content-Type'] = 'application/json';
        const r = await fetch(API + ep, { method: 'POST', headers: h, body: body == null ? null : JSON.stringify(body) });
        if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 800 * (i + 1))); continue; }
        if (r.status === 401) { Dbx._tok = null; continue; }
        const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) { /* text */ }
        if (!r.ok) { const s = (j && j.error_summary) || txt; const e = new Error(s); e.summary = s; e.status = r.status; throw e; }
        return j;
      }
      throw new Error('Dropbox is busy — try again in a moment.');
    },
    async content(ep, arg, body) {
      for (let i = 0; i < 4; i++) {
        const h = Object.assign({ Authorization: 'Bearer ' + await Dbx.token(), 'Dropbox-API-Arg': argJson(arg) }, await Dbx.rootHeader());
        if (body != null) h['Content-Type'] = 'application/octet-stream';
        const r = await fetch(CONTENT + ep, { method: 'POST', headers: h, body: body == null ? null : body });
        if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 800 * (i + 1))); continue; }
        if (r.status === 401) { Dbx._tok = null; continue; }
        if (!r.ok) { const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) { /* text */ } const s = (j && j.error_summary) || txt; const e = new Error(s); e.summary = s; e.status = r.status; throw e; }
        return r;
      }
      throw new Error('Dropbox is busy — try again in a moment.');
    },
    async list(path) {
      let j = await Dbx.rpc('files/list_folder', { path: path === '/' ? '' : path, limit: 2000 }); const out = j.entries.slice();
      while (j.has_more) { j = await Dbx.rpc('files/list_folder/continue', { cursor: j.cursor }); out.push(...j.entries); }
      return out;
    },
    async meta(path) {
      try { return await Dbx.rpc('files/get_metadata', { path }); }
      catch (e) { if (/not_found/.test(e.summary || '')) throw new NotFound(path); throw e; }
    },
    folder: () => ls.get('folder'),
    setFolder: p => ls.set('folder', p),
  };
  const lm = m => (m.server_modified ? Date.parse(m.server_modified) : 0) + (parseInt(String(m.rev || '').slice(-3), 16) || 0) % 1000;
  const join = (a, b) => (a === '/' ? '' : a) + '/' + b;

  class DbxFile {
    constructor(path, m) { this.kind = 'file'; this.path = path; this.name = path.split('/').pop(); this.m = m || null; this.rev = m && m.rev; }
    async getFile() {
      const m = this.m && this.fresh ? this.m : await Dbx.meta(this.path); this.m = m; this.fresh = false;
      const self = this;
      const dl = async () => { const r = await Dbx.content('files/download', { path: self.path }); const meta = JSON.parse(r.headers.get('Dropbox-API-Result') || '{}'); if (meta.rev) self.rev = meta.rev; return r.blob(); };
      return { name: this.name, size: m.size, lastModified: lm(m), type: '', arrayBuffer: async () => (await dl()).arrayBuffer(), text: async () => (await dl()).text(), blob: dl };
    }
    async createWritable() {
      const parts = []; const self = this;
      return {
        async write(d) { parts.push(d instanceof Blob ? d : new Blob([d])); },
        async abort() { parts.length = 0; },
        async close() {
          const body = new Blob(parts); const mode = self.guard && self.rev ? { '.tag': 'update', update: self.rev } : 'overwrite';
          try {
            const r = await Dbx.content('files/upload', { path: self.path, mode, autorename: false, mute: true, strict_conflict: !!self.guard }, body);
            const m = await r.json(); self.m = m; self.rev = m.rev; self.fresh = true;
          } catch (e) { if (/conflict/.test(e.summary || '')) throw new Conflict(self.path); throw e; }
        },
      };
    }
  }
  class DbxDir {
    constructor(path, name) { this.kind = 'directory'; this.path = path; this.name = name || path.split('/').pop() || 'Dropbox'; }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async getDirectoryHandle(name, opts = {}) {
      const p = join(this.path, name);
      try { const m = await Dbx.meta(p); if (m['.tag'] !== 'folder') throw new NotFound(p); }
      catch (e) { if (!(e instanceof NotFound) || !opts.create) throw e; try { await Dbx.rpc('files/create_folder_v2', { path: p, autorename: false }); } catch (e2) { if (!/conflict/.test(e2.summary || '')) throw e2; } }
      return new DbxDir(p, name);
    }
    async getFileHandle(name, opts = {}) {
      const p = join(this.path, name);
      try { const m = await Dbx.meta(p); if (m['.tag'] !== 'file') throw new NotFound(p); const f = new DbxFile(p, m); f.guard = /\.xlsx$/i.test(name); return f; }
      catch (e) { if (!(e instanceof NotFound) || !opts.create) throw e; const f = new DbxFile(p, null); f.guard = false; return f; }
    }
    async *entries() {
      for (const m of await Dbx.list(this.path)) {
        const p = m.path_display || join(this.path, m.name);
        if (m['.tag'] === 'folder') yield [m.name, new DbxDir(p, m.name)];
        else if (m['.tag'] === 'file') { const f = new DbxFile(p, m); f.fresh = true; f.guard = /\.xlsx$/i.test(m.name); yield [m.name, f]; }
      }
    }
    async *values() { for await (const [, h] of this.entries()) yield h; }    // the app's own code files, for "a new version is available"
    async codeStamp() {
      const j = await Dbx.rpc('files/list_folder', { path: this.path + '/_app', recursive: true, limit: 2000 });
      return j.entries.filter(m => m['.tag'] === 'file' && /(sales-crm|sheet-helpers|xlsx-engine)\.(js|css)$/i.test(m.name)).map(m => m.name + ':' + m.rev).sort().join(';');
    }
  }
  window.Dbx = Dbx; window.DbxDir = DbxDir;
})();
