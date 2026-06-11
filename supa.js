/* ============================================================
   supa.js - Camada Supabase do relatorio SE2 (Fase 2)
   - Login (email/senha) obrigatorio para ver/gravar modificacoes
   - Carrega o estado do banco ao logar e aplica no app
   - Salva automaticamente (debounce) cada alteracao no banco
   Acesso controlado por RLS (allowlist de e-mail) no Supabase.
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = "https://pyrniqluywejmgzqkari.supabase.co";
  var SUPABASE_KEY = "sb_publishable_fXWQGDirOvs5xfxZDaSOtg_Jgd7vcbu";
  var ROW_ID = "main";

  var sb = null, sessionUser = null, saveTimer = null, lastSavedJson = "", carregado = false;

  // ---------- util UI ----------
  function el(tag, css, html) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function overlay() {
    var o = document.getElementById('se2-login');
    if (o) return o;
    o = el('div', 'position:fixed;inset:0;z-index:999999;background:linear-gradient(135deg,#1e2340,#2d3a6e);' +
      'display:flex;align-items:center;justify-content:center;font-family:Segoe UI,Arial,sans-serif');
    o.id = 'se2-login';
    o.innerHTML =
      '<div style="background:#fff;border-radius:14px;padding:28px 26px;width:340px;box-shadow:0 12px 40px rgba(0,0,0,.35)">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
      '<div style="width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">SE2</div>' +
      '<div><div style="font-size:17px;font-weight:700;color:#1e2340">Contas a Pagar — SE2</div>' +
      '<div style="font-size:12px;color:#64748b">Acesso restrito</div></div></div>' +
      '<label style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase">E-mail</label>' +
      '<input id="se2-email" type="email" autocomplete="username" style="width:100%;padding:9px 11px;margin:4px 0 12px;border:1px solid #dde1ee;border-radius:7px;font-size:14px">' +
      '<label style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase">Senha</label>' +
      '<input id="se2-pass" type="password" autocomplete="current-password" style="width:100%;padding:9px 11px;margin:4px 0 14px;border:1px solid #dde1ee;border-radius:7px;font-size:14px">' +
      '<button id="se2-btn-entrar" style="width:100%;padding:10px;border:none;border-radius:7px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Entrar</button>' +
      '<button id="se2-btn-criar" style="width:100%;padding:9px;margin-top:8px;border:1px solid #2563eb;border-radius:7px;background:#fff;color:#2563eb;font-weight:600;font-size:13px;cursor:pointer">Criar conta (1ª vez)</button>' +
      '<div id="se2-msg" style="font-size:12.5px;color:#b91c1c;margin-top:10px;min-height:16px"></div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.4">Suas marcações ficam salvas na nuvem e sincronizam entre dispositivos.</div>' +
      '</div>';
    document.body.appendChild(o);
    var msg = o.querySelector('#se2-msg');
    function setMsg(t, ok) { msg.textContent = t || ''; msg.style.color = ok ? '#15803d' : '#b91c1c'; }
    function creds() {
      return { email: (o.querySelector('#se2-email').value || '').trim(), password: o.querySelector('#se2-pass').value || '' };
    }
    o.querySelector('#se2-btn-entrar').onclick = async function () {
      var c = creds(); if (!c.email || !c.password) { setMsg('Preencha e-mail e senha.'); return; }
      setMsg('Entrando…', true);
      var r = await sb.auth.signInWithPassword(c);
      if (r.error) { setMsg('E-mail ou senha inválidos.'); return; }
    };
    o.querySelector('#se2-btn-criar').onclick = async function () {
      var c = creds(); if (!c.email || !c.password) { setMsg('Preencha e-mail e senha.'); return; }
      if (c.password.length < 6) { setMsg('A senha precisa de ao menos 6 caracteres.'); return; }
      setMsg('Criando conta…', true);
      var r = await sb.auth.signUp(c);
      if (r.error) { setMsg('Erro: ' + r.error.message); return; }
      if (r.data && r.data.session) { setMsg('Conta criada!', true); }
      else { setMsg('Conta criada. Se for pedida confirmação, verifique seu e-mail e depois clique em Entrar.', true); }
    };
    o.querySelector('#se2-pass').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') o.querySelector('#se2-btn-entrar').click(); });
    o._setMsg = setMsg;
    return o;
  }
  function showLogin(t) { var o = overlay(); o.style.display = 'flex'; if (t && o._setMsg) o._setMsg(t); }
  function hideLogin() { var o = document.getElementById('se2-login'); if (o) o.style.display = 'none'; }

  function badge() {
    var b = document.getElementById('se2-sync');
    if (b) return b;
    b = el('div', 'position:fixed;right:12px;bottom:12px;z-index:999998;background:#1e2340;color:#fff;' +
      'font:600 12px Segoe UI,Arial;padding:7px 12px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.25);opacity:.92');
    b.id = 'se2-sync';
    document.body.appendChild(b);
    return b;
  }
  function status(t, color) {
    var b = badge();
    b.innerHTML = '☁ ' + t + ' &nbsp;<span id="se2-sair" style="cursor:pointer;text-decoration:underline;color:#a5b4fc">Sair</span>';
    if (color) b.style.background = color;
    var s = document.getElementById('se2-sair');
    if (s) s.onclick = async function () { await sb.auth.signOut(); location.reload(); };
  }

  // ---------- supabase-js ----------
  function loadLib() {
    return new Promise(function (res, rej) {
      if (window.supabase && window.supabase.createClient) return res();
      var s = document.createElement('script');
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload = res; s.onerror = function () { rej(new Error('Falha ao carregar supabase-js (sem internet?)')); };
      document.head.appendChild(s);
    });
  }

  // ---------- estado <-> app ----------
  function buildEstado() {
    var uuidState = (typeof _buildUUIDState === 'function') ? _buildUUIDState() : { pagUUID: {}, monUUID: {} };
    return {
      pagamentos: (typeof pagamentos !== 'undefined') ? pagamentos : {},
      monitored: (typeof monitored !== 'undefined') ? monitored : {},
      pagamentos_uuid: uuidState.pagUUID,
      monitored_uuid: uuidState.monUUID,
      uuids_vistos: (typeof DATA !== 'undefined') ? DATA.map(function (r) { return r.uuid; }) : [],
      exportadoEm: new Date().toISOString(),
      titulosManuais: (typeof titulosManuais !== 'undefined') ? titulosManuais : [],
      pendencias: (typeof getPendenciasEstado === 'function') ? getPendenciasEstado() : ((window.__SE2_BACKUP__ && window.__SE2_BACKUP__.pendencias) || []),
      totalMon: (typeof monitored !== 'undefined') ? Object.keys(monitored).length : 0,
      totalPag: ((typeof pagamentos !== 'undefined') ? Object.keys(pagamentos).length : 0) + ((typeof titulosManuais !== 'undefined') ? titulosManuais.length : 0)
    };
  }

  function applyEstado(estado) {
    window.__SE2_BACKUP__ = estado || {};
    if (typeof applyPublishedState === 'function') applyPublishedState();
    if (typeof restaurarEstado === 'function') restaurarEstado();
    try { document.dispatchEvent(new Event('se2:ready')); } catch (_) {}
    if (typeof render === 'function') render(true);
  }

  async function carregar() {
    status('Carregando…');
    var r = await sb.from('se2_estado').select('estado').eq('id', ROW_ID).maybeSingle();
    if (r.error) throw r.error;
    if (r.data && r.data.estado && Object.keys(r.data.estado).length) {
      applyEstado(r.data.estado);
      lastSavedJson = JSON.stringify(r.data.estado);
      status('Sincronizado');
    } else {
      // 1ª vez: semeia o banco com o estado atual (vindo do backup.js em memória)
      var est = buildEstado();
      var up = await sb.from('se2_estado').upsert({ id: ROW_ID, estado: est, atualizado_por: sessionUser && sessionUser.email });
      if (up.error) throw up.error;
      lastSavedJson = JSON.stringify(est);
      status('Migrado para a nuvem');
    }
    carregado = true;
  }

  async function salvar() {
    if (!sb || !sessionUser || !carregado) return;
    var est = buildEstado();
    var js = JSON.stringify(est);
    if (js === lastSavedJson) return;
    status('Salvando…');
    var r = await sb.from('se2_estado').upsert({ id: ROW_ID, estado: est, atualizado_por: sessionUser.email });
    if (r.error) { status('Erro ao salvar', '#b91c1c'); console.error('[supa] salvar', r.error); return; }
    lastSavedJson = js;
    status('Salvo ' + new Date().toLocaleTimeString('pt-BR'));
  }
  function agendarSalvar() { clearTimeout(saveTimer); saveTimer = setTimeout(salvar, 8000); }

  // O app chama salvarEstado() apos cada alteracao (originalmente vazio).
  window.salvarEstado = function () { agendarSalvar(); };

  async function onLogged(user) {
    sessionUser = user;
    hideLogin();
    try {
      await carregar();
    } catch (e) {
      console.error('[supa] carregar', e);
      var code = (e && (e.code || e.status)) || '';
      if (String(code) === '42501' || /permission|policy|row-level/i.test(e && e.message || '')) {
        await sb.auth.signOut();
        sessionUser = null;
        showLogin('Este e-mail não tem permissão de acesso. Fale com o administrador.');
      } else {
        showLogin('Erro ao carregar dados: ' + (e && e.message || e));
      }
    }
  }

  async function init() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', init, { once: true }); return; }
    showLogin('Carregando…');
    try { await loadLib(); } catch (e) { showLogin('Sem conexão para carregar o login. Verifique a internet.'); return; }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

    var s = await sb.auth.getSession();
    if (s.data && s.data.session && s.data.session.user) {
      onLogged(s.data.session.user);
    } else {
      showLogin('');
    }
    sb.auth.onAuthStateChange(function (_evt, sess) {
      if (sess && sess.user) { if (!sessionUser) onLogged(sess.user); }
    });

    // Rede de seguranca: salva mudancas nao capturadas (ex.: pendencias)
    setInterval(function () { try { salvar(); } catch (_) {} }, 180000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { try { salvar(); } catch (_) {} } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
