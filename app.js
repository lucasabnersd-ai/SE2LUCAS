let BOOT = window.__SE2__ || { data: [], updatedAt: "", monitoredInit: {}, pagamentosInit: {} };
let BACKUP = window.__SE2_BACKUP__ || { pagamentos_uuid: {}, monitored_uuid: {}, uuids_vistos: [], exportadoEm: "" };
let DATA = BOOT.data || [];
// PAGAMENTOS_INIT / MONITORED_INIT: prioridade ao que vem do Python (datos.js).
// Fallback: usa o que foi salvo no backup.js (gerado do JSON de backup).
let PAGAMENTOS_INIT = (BOOT.pagamentosInit && Object.keys(BOOT.pagamentosInit).length) ? BOOT.pagamentosInit : {};
let MONITORED_INIT = (BOOT.monitoredInit && Object.keys(BOOT.monitoredInit).length) ? BOOT.monitoredInit : {};
// Conjunto de UUIDs da última base (usado em "Novos Títulos" p/ diff com a carga anterior).
let UUIDS_BASE_ANTERIOR = new Set((BACKUP.uuids_vistos || []).map(u => String(u).toUpperCase()));
function normalizeStateUUID(value){
  return String(value ?? '').trim().split('|', 1)[0].trim().toUpperCase();
}
function findRowByStateUUID(value){
  const target = normalizeStateUUID(value);
  if(!target) return null;
  return DATA.find(r => String(r.uuid || '').trim().toUpperCase() === target);
}
function findRowByStateEntry(key, value){
  const byUuid = findRowByStateUUID(key);
  if(byUuid) return byUuid;
  const origId = Number(value && typeof value === 'object' ? value._origId : NaN);
  if(Number.isFinite(origId)) return DATA.find(r => r.id === origId) || null;
  return null;
}
function applyBootMeta(){
  const el = document.getElementById("hdt");
  if(!el || !BOOT.updatedAt) return;
  const d = new Date(BOOT.updatedAt);
  el.textContent = isNaN(d.getTime()) ? String(BOOT.updatedAt) : d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}

// ===== TOAST =====
let _toastTimer = null;
function showToast(msg, type='warn', duration=3500){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type;
  void el.offsetWidth;
  el.classList.add('show');
  if(_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>{ el.classList.remove('show'); }, duration);
}

// ===== FILTRO ESPECIAL: ABERRAÇÃO DE DATA =====
let filterAberracao = false;

const sel = {emp:new Set(), st:new Set()};
const fmtBR = v => 'R$ ' + Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtDt = s => s?s.split('-').reverse().join('/'):'—';
function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
/** Separa "usuario.protheus - 05/02/2025" em nome e data DD/MM/AAAA */
function splitUserDate(s){
  const str = String(s||'').trim();
  if(!str) return {name:'', date:''};
  const m = str.match(/^(.+?)\s*-\s*(\d{2}\/\d{2}\/\d{4})\s*$/);
  if(m) return {name:(m[1]||'').trim()||'—', date:m[2]};
  const m2 = str.match(/(\d{2}\/\d{2}\/\d{4})\s*$/);
  if(m2){
    const name = str.slice(0, m2.index).replace(/\s*-\s*$/,'').trim();
    return {name:name||'—', date:m2[1]};
  }
  return {name:str, date:''};
}
function brDateToISO(d){
  const m = String(d||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function rowMatchesUserFilters(r, pfx){
  const gv = id=>{ const el=document.getElementById(pfx+id); return el?el.value:''; };
  const uq = gv('uuid').trim().toLowerCase().replace(/\s+/g,'');
  if(uq && !String(r.uuid||'').toLowerCase().replace(/\s+/g,'').includes(uq)) return false;
  const incN = gv('inc-name').toLowerCase();
  const inc = splitUserDate(r.usrInc);
  if(incN && !String(inc.name||'').toLowerCase().includes(incN)) return false;
  const isoInc = brDateToISO(inc.date);
  const incDate = gv('inc');
  const incDe = gv('inc1'), incAte = gv('inc2');
  if(incDate && (!isoInc || isoInc !== incDate)) return false;
  if(!incDate && incDe && (!isoInc || isoInc < incDe)) return false;
  if(!incDate && incAte && (!isoInc || isoInc > incAte)) return false;
  const altN = gv('alt-name').toLowerCase();
  const alt = splitUserDate(r.usrAlt);
  if(altN && !String(alt.name||'').toLowerCase().includes(altN)) return false;
  const isoAlt = brDateToISO(alt.date);
  const altDate = gv('alt');
  const altDe = gv('alt1'), altAte = gv('alt2');
  if(altDate && (!isoAlt || isoAlt !== altDate)) return false;
  if(!altDate && altDe && (!isoAlt || isoAlt < altDe)) return false;
  if(!altDate && altAte && (!isoAlt || isoAlt > altAte)) return false;
  return true;
}
function copyToClipboard(btn, field){
  const t = String(btn&&btn.dataset&&btn.dataset[field]!=null?btn.dataset[field]:'').trim();
  if(!t){ alert('Sem valor para copiar'); return; }
  const ok = ()=>{ const o=btn.textContent; btn.textContent='Copiado!'; btn.classList.add('ok'); setTimeout(()=>{ btn.textContent=o||'📋 Copiar'; btn.classList.remove('ok'); }, 1200); };
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(ok).catch(()=>{}); }
  else { const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch(e){} ta.remove(); ok(); }
}
function copyUUID(btn){ copyToClipboard(btn, 'uuid'); }
function copyNatureza(btn){ copyToClipboard(btn, 'natureza'); }
function copyFornec(btn){ copyToClipboard(btn, 'codfornec'); }
// AJUSTE FILTRO EMPRESA: extrai todas as relacoes filial+empresa da base SE2
function companyPairKey(filial, empresa){ return `${String(filial||'').trim()}|${String(empresa||'').trim()}`; }
function companyPairFromRow(r){ return companyPairKey(r?.filial, r?.empresa); }
function buildCompanyPairsFromSE2(){
  const map = new Map();
  DATA.forEach(r=>{
    const filial = String(r?.filial||'').trim();
    const empresa = String(r?.empresa||'').trim();
    if(!filial && !empresa) return;
    const key = companyPairKey(filial, empresa);
    // Filtro exibido: usa empresa se existir, senao filial
    if(!map.has(key)) map.set(key, { key, filial, empresa, label: (empresa || filial).trim() });
  });
  return [...map.values()].sort((a,b)=>{
    // Ordenacao por label (empresa ou filial)
    return a.label.localeCompare(b.label, 'pt-BR');
  });
}
let COMPANY_PAIRS_ALL = buildCompanyPairsFromSE2();
function renderCompanyPills(){
  const el = document.getElementById('emps');
  if(!el) return;
  el.innerHTML = COMPANY_PAIRS_ALL.map(c=>`<span class="pill" data-emp="${c.key}" onclick="togEmp(this)">${c.label}</span>`).join('');
}
function applyPublishedState(){
  BOOT = window.__SE2__ || { data: [], updatedAt: "", monitoredInit: {}, pagamentosInit: {} };
  BACKUP = window.__SE2_BACKUP__ || { pagamentos_uuid: {}, monitored_uuid: {}, uuids_vistos: [], exportadoEm: "" };
  DATA = BOOT.data || [];
  PAGAMENTOS_INIT = (BOOT.pagamentosInit && Object.keys(BOOT.pagamentosInit).length) ? BOOT.pagamentosInit : {};
  MONITORED_INIT = (BOOT.monitoredInit && Object.keys(BOOT.monitoredInit).length) ? BOOT.monitoredInit : {};
  UUIDS_BASE_ANTERIOR = new Set((BACKUP.uuids_vistos || []).map(u => String(u).toUpperCase()));
  COMPANY_PAIRS_ALL = buildCompanyPairsFromSE2();
}
function loadFreshScript(src){
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const url = new URL(src, document.baseURI);
    url.searchParams.set('_se2', `${Date.now()}${Math.random().toString(36).slice(2)}`);
    script.src = url.toString();
    script.async = false;
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => { script.remove(); reject(new Error(`Falha ao carregar ${src}`)); };
    document.head.appendChild(script);
  });
}
async function refreshPublishedAssets(){
  // Em HTML autocontido, os dados ja estao embutidos neste arquivo.
  if(window.__SE2_SINGLE_FILE__){
    applyPublishedState();
    return;
  }
  // Recarrega os arquivos publicados com cache-bust para evitar usar dados antigos.
  try{
    await Promise.all([
      loadFreshScript('backup.js'),
      loadFreshScript('datos.js')
    ]);
  }catch(_err){}
  applyPublishedState();
}
function populateFilialFilter(){
  const selFilial = document.getElementById('f-filial');
  if(selFilial){
    selFilial.innerHTML = `<option value="">Todas</option>` + COMPANY_PAIRS_ALL.map(c=>`<option value="${c.key}">${c.label}</option>`).join('');
  }
  renderCompanyPills();
}
function togEmp(el){ const v=el.dataset.emp; if(sel.emp.has(v)){sel.emp.delete(v);el.classList.remove('on')} else{sel.emp.add(v);el.classList.add('on')} render(true); }
function togSt(el){ const v=el.dataset.st; if(sel.st.has(v)){sel.st.delete(v);el.classList.remove('on')} else{sel.st.add(v);el.classList.add('on')} render(true); }
function clearF(){ filterAberracao=false; ['f-num','f-razao','f-forn','f-vexato','f-vliq','f-em','f-vr','f-tipo','f-hist','f-uuid','f-inc-name','f-inc','f-alt-name','f-alt'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';}); sel.emp.clear(); sel.st.clear(); document.querySelectorAll('#p-all .pill.on').forEach(p=>p.classList.remove('on')); render(true); }

function atrCls(n){ if(!n) return 'atr-0'; if(n>180) return 'atr-crit'; if(n>60) return 'atr-hi'; return 'atr-med'; }
function stCls(s){ return {'Vencido':'st-venc','Baixado':'st-baix','A Vencer':'st-aven','Baixa Parcial':'st-parc'}[s]||''; }

function filtered(){
  const gv=i=>{const el=document.getElementById(i); return el?el.value:'';};
  const q=gv('f-num').toLowerCase(), rz=gv('f-razao').toLowerCase(), fn=gv('f-forn').toLowerCase();
  const tp=gv('f-tipo').toLowerCase(), ht=gv('f-hist').toLowerCase();
  const vexato=gv('f-vexato').trim(), vexatoNum=vexato?parseFloat(vexato):NaN;
  const vliq=gv('f-vliq').trim(), vliqNum=vliq?parseFloat(vliq):NaN;
  const em=gv('f-em'), vr=gv('f-vr');
  return DATA.filter(r=>{
    if(q && !r.num.toLowerCase().includes(q)) return false;
    if(rz && !r.razao.toLowerCase().includes(rz)) return false;
    if(fn && !r.fornecedor.toLowerCase().includes(fn)) return false;
    if(tp && !r.tipo.toLowerCase().includes(tp)) return false;
    if(ht && !r.historico.toLowerCase().includes(ht)) return false;
    if(!isNaN(vexatoNum) && Math.abs(r.valor - vexatoNum) > 0.009) return false;
    if(!isNaN(vliqNum) && Math.abs((r.valLiqBaix||0) - vliqNum) > 0.009) return false;
    if(em && r.emissao !== em) return false;
    if(vr && r.vencReal !== vr) return false;
    if(sel.emp.size && !sel.emp.has(companyPairFromRow(r))) return false;
    if(sel.st.size && !sel.st.has(r.status)) return false;
    if(filterAberracao){ const y=r.vencimento?+r.vencimento.slice(0,4):0; if(y<=2030) return false; }
    if(!rowMatchesUserFilters(r, 'f-')) return false;
    return true;
  });
}



// ===== ESTADO =====
const _pagCollapsed = new Set(); // chaves dos blocos recolhidos na aba Pagamento (ex: 'rej' ou 'dt:2026-05-13')
function togglePagCollapse(key, btn){
  if(_pagCollapsed.has(key)) _pagCollapsed.delete(key); else _pagCollapsed.add(key);
  const box = btn && btn.closest('[data-collapse-key]');
  if(box){
    box.classList.toggle('pag-collapsed');
    btn.textContent = box.classList.contains('pag-collapsed') ? '▸' : '▾';
    btn.title = box.classList.contains('pag-collapsed') ? 'Expandir' : 'Recolher';
  }
}
const pagamentos = {}; // chaveEnvio -> {rowId,obs,dt,acrescimo,decrescimo,statusPag,statusManual}
const monitored  = {}; // id -> {obs,ts}
const selPag = {emp:new Set(), st:new Set()};
const selMon = {emp:new Set(), st:new Set()};
const titulosManuais = []; // títulos inseridos manualmente
let _manualIdCounter = -1; // IDs negativos para manuais

function getManualById(id){ return titulosManuais.find(t=>t.id===id); }
function makePagKey(id){
  return `${id}|${Date.now()}|${Math.random().toString(36).slice(2,7)}`;
}
function getPagRowId(key, val){
  const direct = Number(val && val.rowId);
  if(Number.isFinite(direct)) return direct;
  const first = String(key).split('|', 1)[0];
  const parsed = Number(first);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function pagEntriesRaw(){
  return Object.entries(pagamentos).map(([key,p])=>{
    const rowId = getPagRowId(key, p);
    return {key, rowId, p, r: DATA.find(x=>x.id===rowId)};
  }).filter(e=>e.r);
}
function countPagSendsForRow(id){
  return pagEntriesRaw().filter(e=>e.rowId===id).length;
}
function hasPagSendForRow(id){
  return countPagSendsForRow(id) > 0;
}
function addPagamento(id, data){
  const key = makePagKey(id);
  pagamentos[key] = normalizePagStatusManualFlag({rowId:id, ...(data||{})});
  return key;
}
function isManualOnlyPagStatus(status){
  return ['PG BOLETO','Rejeitado'].includes(String(status||''));
}
function normalizePagStatusManualFlag(entry){
  if(entry && typeof entry === 'object'){
    // Migra status Debitado para Baixado (status removido)
    if(entry.statusPag === 'Debitado') entry.statusPag = 'Baixado';
    if(entry.statusManual == null && isManualOnlyPagStatus(entry.statusPag)){
      entry.statusManual = true;
    }
  }
  return entry;
}
function setPagStatusValue(entry, val, manual=false){
  if(!entry) return;
  entry.statusPag = val;
  if(manual && val) entry.statusManual = true;
  else if(!val) delete entry.statusManual;
}
function updatePagAcrescimo(id, val){
  const v = parseFloat(String(val).replace(',','.')) || 0;
  const isManual = Number(id) < 0;
  if(isManual){
    const m = getManualById(Number(id));
    if(m) m.acrescimo = v;
  } else {
    if(!pagamentos[id]) return;
    pagamentos[id].acrescimo = v;
  }
  salvarEstado(); renderPagTotals();
}
function updatePagDecrescimo(id, val){
  const v = parseFloat(String(val).replace(',','.')) || 0;
  const isManual = Number(id) < 0;
  if(isManual){
    const m = getManualById(Number(id));
    if(m) m.decrescimo = v;
  } else {
    if(!pagamentos[id]) return;
    pagamentos[id].decrescimo = v;
  }
  salvarEstado(); renderPagTotals();
}
function updatePagStatus(id, val, manual=true){
  const isManual = Number(id) < 0;
  if(isManual){
    const m = getManualById(Number(id));
    if(m) setPagStatusValue(m, val, manual);
  } else {
    if(!pagamentos[id]) return;
    setPagStatusValue(pagamentos[id], val, manual);
  }
  salvarEstado();
}function updatePagStatusCell(id, val){
  updatePagStatus(id, val);
  renderPAG();
}
function togAllPag(master, dt){
  // Marca somente os checkboxes do dia (bloco .pag-day com data-dt correspondente).
  // Fallback: se nao encontrar o bloco do dia, sobe ate o <table> mais proximo.
  let scope = null;
  if(dt){
    scope = document.querySelector('#p-pag .pag-day[data-dt="'+dt+'"]');
  }
  if(!scope){
    scope = master.closest('table') || master.closest('.pag-day') || document.getElementById('p-pag');
  }
  const cbs = scope.querySelectorAll('.pag-cb');
  cbs.forEach(cb=>{ cb.checked = master.checked; });
  updateSelCounter('pag');
}
// === Contadores de títulos selecionados (checkbox marcado) ===
function updateSelCounter(which){
  if(!which || which==='all'){
    const el=document.getElementById('sel-cnt-all');
    if(el){
      const n=document.querySelectorAll('#p-all .rcb:checked').length;
      const numEl=el.querySelector('.num'); if(numEl) numEl.textContent=n;
      el.classList.toggle('empty', n===0);
    }
  }
  if(!which || which==='pag'){
    const el=document.getElementById('sel-cnt-pag');
    if(el){
      const n=document.querySelectorAll('#p-pag .pag-cb:checked').length;
      const numEl=el.querySelector('.num'); if(numEl) numEl.textContent=n;
      el.classList.toggle('empty', n===0);
    }
  }
}
// Listeners delegados — atualizam contador a cada clique em checkbox
document.addEventListener('change', function(ev){
  const t=ev.target;
  if(!t) return;
  if(t.classList && t.classList.contains('rcb')) updateSelCounter('all');
  if(t.classList && t.classList.contains('pag-cb')) updateSelCounter('pag');
});
function marcarStatusBulk(status){
  const cbs = [...document.querySelectorAll('#p-pag .pag-cb:checked')];
  if(!cbs.length){ showToast('⚠️ Selecione pelo menos um título','warn'); return; }
  const ids = cbs.map(cb=>cb.dataset.id);
  ids.forEach(id=>updatePagStatus(id, status));
  salvarEstado();
  const lbl = status==='Baixado'?'✅ Baixado':status==='Rejeitado'?'❌ Rejeitado':'🔄 Status limpo';
  showToast(`${lbl} — ${ids.length} título(s) atualizado(s)`, status==='Rejeitado'?'warn':'ok');
  renderPAG();
}
function calcValorTotalPago(saldo, acrescimo, decrescimo){
  return (saldo||0) + (acrescimo||0) - (decrescimo||0);
}

function temDataSE2(value){
  return String(value ?? '').trim() !== '';
}

function classificarStatusPagamentoSE2(row){
  const temBaixa = temDataSE2(row && row.baixa);
  const temBordero = temDataSE2(row && row.dtBordero);
  if(temBaixa) return 'Baixado';
  if(temBordero) return 'No Bordero';
  return 'Aberto';
}

function pagStatusLabel(stPag){
  if(stPag==='PG BOLETO') return 'PG BOLETO';
  if(stPag==='Debitado') return 'Baixado';
  if(stPag==='Rejeitado') return 'Rejeitado';
  if(stPag==='Baixado') return 'Baixado';
  if(stPag==='No Bordero') return 'No Bordero';
  if(stPag==='Aberto' || stPag==='N\u00e3o Baixado' || stPag==='N??o Baixado' || stPag==='N????o Baixado') return 'Aberto';
  return 'Sem status';
}
function renderPagDayStatusSummary(arr){
  const order = ['PG BOLETO','Rejeitado','Baixado','No Bordero','Aberto','Sem status'];
  const counts = {};
  arr.forEach(e=>{
    const label = pagStatusLabel(e.statusPag||e.r.statusPag||'');
    counts[label] = (counts[label]||0) + 1;
  });
  return order.filter(k=>counts[k]).map(k=>`<span class="pag-status-count">${escHtml(k)}: ${counts[k]}</span>`).join('');
}
function renderPagStatusBadge(stPag){
  if(stPag==='Rejeitado') return '<span class="status" style="background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5">❌ Rejeitado</span>';
  if(stPag==='PG BOLETO') return '<span class="status" style="background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc">PG BOLETO</span>';
  if(stPag==='Baixado') return '<span class="status st-baix">✅ Baixado</span>';
  if(stPag==='No Bordero') return '<span class="status st-bordero">📋 No Bordero</span>';
  if(stPag==='Aberto' || stPag==='Não Baixado') return '<span class="status st-aberto">⏳ Aberto</span>';
  return '<span style="color:#94a3b8;font-size:11px">—</span>';
}
function pagStatusSelectClass(stPag){
  if(stPag==='PG BOLETO') return 'st-pag-boleto';
  if(stPag==='Rejeitado') return 'st-pag-rejeitado';
  if(stPag==='Baixado') return 'st-pag-baixado';
  if(stPag==='No Bordero') return 'st-pag-bordero';
  if(stPag==='Aberto' || stPag==='Não Baixado' || stPag==='NÃ£o Baixado') return 'st-pag-aberto';
  return 'st-pag-empty';
}
function renderPagStatusSelect(id, stPag){
  const opts = [
    ['', '---'],
    ['PG BOLETO', '🧾 PG BOLETO'],
    ['Rejeitado', '❌ Rejeitado'],
    ['Baixado', '✅ Baixado'],
    ['No Bordero', '📋 No Bordero'],
    ['Aberto', '⏳ Aberto']
  ];
  const cls = pagStatusSelectClass(stPag);
  return `<select class="pag-status-select ${cls}" onchange="updatePagStatusCell('${escHtml(id)}', this.value)" title="Alterar status do titulo">${opts.map(([v,l])=>`<option value="${escHtml(v)}"${String(stPag||'')===v?' selected':''}>${escHtml(l)}</option>`).join('')}</select>`;
}
// === Verificar Baixa em SE2 (por dia de pagamento) ===
// Regra baseada somente nas colunas DT Baixa e Dt. Bordero:
//   - DT Baixa preenchida = Baixado
//   - Dt. Bordero preenchida e DT Baixa vazia = No Bordero
//   - ambas vazias = Aberto
function verificarBaixaDia(dt){
  const entriesDia = pagEntriesRaw().filter(e => e.p.dt === dt);
  if(!entriesDia.length){
    showToast('⚠️ Nenhum título registrado para esse dia','warn');
    return;
  }
  let bordero=0, baixado=0, aberto=0, naoEncontrado=0, preservados=0;
  entriesDia.forEach(entry=>{
    // Permite verificar baixa alterar status PG BOLETO (statusManual); preserva outros manuais
    const stAtual = entry.p && entry.p.statusPag;
    if(entry.p && entry.p.statusManual && stAtual !== 'PG BOLETO'){ preservados++; return; }
    const linhaPag = entry.r;
    if(!linhaPag) { naoEncontrado++; return; }
    const uuidAlvo = String(linhaPag.uuid||'').trim().toUpperCase();
    if(!uuidAlvo){ naoEncontrado++; return; }
    // Localiza o titulo na SE2 pelo UUID (associacao por UUID, conforme solicitado)
    const row = DATA.find(x => String(x.uuid||'').trim().toUpperCase() === uuidAlvo);
    if(!row){ naoEncontrado++; return; }
    const status = classificarStatusPagamentoSE2(row);
    setPagStatusValue(pagamentos[entry.key], status, false);
    // Se baixado: auto-calcula acréscimo (multa+juros) e usa valLiqBaix como total pago
    if(status === 'Baixado'){
      const multa = parseFloat(row.multa)||0;
      const juros = parseFloat(row.juros)||0;
      const acrescimoSE2 = multa + juros;
      if(acrescimoSE2 > 0){
        pagamentos[entry.key].acrescimo = Math.round(acrescimoSE2 * 100) / 100;
      }
      // Grava valLiqBaix da SE2 para usar como vlr total pago
      if(row.valLiqBaix && row.valLiqBaix > 0){
        pagamentos[entry.key]._valLiqBaix = Math.round(row.valLiqBaix * 100) / 100;
      }
      baixado++;
    } else if(status === 'No Bordero'){
      bordero++;
    } else {
      aberto++;
    }
  });
  salvarEstado();
  renderPAG();
  const partes = [`${baixado} baixado(s)`,`${bordero} no bordero`,`${aberto} aberto(s)`];
  if(preservados) partes.push(`${preservados} manual(is) preservado(s)`);
  if(naoEncontrado) partes.push(`${naoEncontrado} sem UUID`);
  showToast(`Verificar Baixa ${fmtDt(dt)} - ${partes.join(' | ')}`, (bordero||aberto)?'info':'ok');
}
// === Verificar Borderô — compara títulos enviados vs dtBordero do dia ===
let _borderoPendentes = []; // títulos pendentes de envio no modal

function verificarBordero(){
  const dateInput = document.getElementById('bordero-check-date');
  const dtCheck = (dateInput && dateInput.value) ? dateInput.value : today();

  // 1) IDs dos títulos já enviados para pagamento nessa data
  const idsEnviadosNoDia = new Set();
  pagEntriesRaw().forEach(e => {
    if(e.p.dt === dtCheck) idsEnviadosNoDia.add(e.rowId);
  });

  // 2) Todos os títulos em DATA cujo dtBordero bate com a data verificada
  const titulosNoBordero = DATA.filter(r => {
    const dtB = String(r.dtBordero||'').trim();
    return dtB === dtCheck;
  });

  if(!titulosNoBordero.length){
    showToast(`📋 Nenhum título com Dt. Borderô em ${fmtDt(dtCheck)}`, 'warn');
    return;
  }

  // 3) Separar: já enviados vs esquecidos (não enviados)
  const enviados = [];
  const esquecidos = [];
  titulosNoBordero.forEach(r => {
    if(idsEnviadosNoDia.has(r.id) || hasPagSendForRow(r.id)){
      enviados.push(r);
    } else {
      esquecidos.push(r);
    }
  });

  // 4) Montar resumo
  const totalBordero = titulosNoBordero.length;
  const totalEnviados = enviados.length;
  const totalEsquecidos = esquecidos.length;
  const valorEsquecidos = esquecidos.reduce((s,r) => s + (r.saldo||r.valor||0), 0);

  document.getElementById('mdl-bordero-title').textContent = `📋 Verificar Borderô — ${fmtDt(dtCheck)}`;
  document.getElementById('mdl-bordero-desc').textContent = totalEsquecidos
    ? `Encontrados ${totalEsquecidos} título(s) no borderô que NÃO foram enviados para pagamento.`
    : `Todos os ${totalBordero} título(s) no borderô já foram enviados para pagamento!`;

  document.getElementById('mdl-bordero-summary').innerHTML = `
    <div class="brd-stat"><div class="l">No Borderô</div><div class="v" style="color:#0f766e">${totalBordero}</div></div>
    <div class="brd-stat"><div class="l">Já Enviados</div><div class="v" style="color:#16a34a">${totalEnviados}</div></div>
    <div class="brd-stat"><div class="l">Esquecidos</div><div class="v" style="color:${totalEsquecidos?'#b91c1c':'#16a34a'}">${totalEsquecidos}</div></div>
    <div class="brd-stat"><div class="l">Valor Esquecidos</div><div class="v" style="color:#b91c1c">${fmtBR(valorEsquecidos)}</div></div>`;

  // 5) Montar lista — esquecidos primeiro, depois já enviados
  _borderoPendentes = esquecidos.slice();
  let listHTML = '';

  esquecidos.forEach(r => {
    listHTML += `<div class="mdl-bordero-item" id="brd-item-${r.id}">
      <div class="brd-info">
        <div class="brd-title">${escHtml(r.empresa||r.filial)} · ${escHtml(r.tipo)} ${escHtml(r.num)} - ${escHtml(r.parcela||'')}</div>
        <div class="brd-detail">${escHtml(r.razao)} · Venc: ${fmtDt(r.vencReal||r.vencimento)} · Fornec: ${escHtml(r.fornecedor||'—')}</div>
      </div>
      <div class="brd-val">${fmtBR(r.saldo||r.valor||0)}</div>
      <div class="brd-actions">
        <button class="brd-btn-add" onclick="enviarBorderoUnico(${r.id},'${dtCheck}')">💰 Enviar</button>
      </div>
    </div>`;
  });

  enviados.forEach(r => {
    listHTML += `<div class="mdl-bordero-item enviado">
      <div class="brd-info">
        <div class="brd-title">${escHtml(r.empresa||r.filial)} · ${escHtml(r.tipo)} ${escHtml(r.num)} - ${escHtml(r.parcela||'')}</div>
        <div class="brd-detail">${escHtml(r.razao)} · Venc: ${fmtDt(r.vencReal||r.vencimento)}</div>
      </div>
      <div class="brd-val">${fmtBR(r.saldo||r.valor||0)}</div>
      <div class="brd-actions"><span class="brd-badge-ok">✅ Enviado</span></div>
    </div>`;
  });

  document.getElementById('mdl-bordero-list').innerHTML = listHTML;
  document.getElementById('mdl-bordero-all').style.display = totalEsquecidos ? '' : 'none';
  document.getElementById('mdl-bordero').classList.add('on');
}

function enviarBorderoUnico(id, dt){
  if(hasPagSendForRow(id)) showToast('ℹ️ Título já possui envio anterior. Novo envio registrado.', 'warn');
  addPagamento(id, { obs:'Enviado via Verificar Borderô', dt:dt });
  salvarEstado();
  // Atualizar item no modal
  const item = document.getElementById('brd-item-'+id);
  if(item){
    item.classList.add('enviado');
    const actDiv = item.querySelector('.brd-actions');
    if(actDiv) actDiv.innerHTML = '<span class="brd-badge-ok">✅ Enviado</span>';
  }
  // Remover dos pendentes
  _borderoPendentes = _borderoPendentes.filter(r => r.id !== id);
  // Atualizar contagem do badge
  document.getElementById('b-pag').textContent = Object.keys(pagamentos).length + titulosManuais.length;
  if(!_borderoPendentes.length){
    document.getElementById('mdl-bordero-all').style.display = 'none';
  }
  showToast(`✅ Título enviado para pagamento`, 'ok');
}

function enviarTodosBordero(){
  if(!_borderoPendentes.length){
    showToast('✅ Todos os títulos já foram enviados!','ok');
    return;
  }
  const dateInput = document.getElementById('bordero-check-date');
  const dt = (dateInput && dateInput.value) ? dateInput.value : today();
  let count = 0;
  _borderoPendentes.forEach(r => {
    if(true){
      if(hasPagSendForRow(r.id)) showToast(`ℹ️ ${r.num} já tinha envio anterior. Novo envio registrado.`, 'warn', 4000);
      addPagamento(r.id, { obs:'Enviado via Verificar Borderô', dt:dt });
      count++;
      const item = document.getElementById('brd-item-'+r.id);
      if(item){
        item.classList.add('enviado');
        const actDiv = item.querySelector('.brd-actions');
        if(actDiv) actDiv.innerHTML = '<span class="brd-badge-ok">✅ Enviado</span>';
      }
    }
  });
  _borderoPendentes = [];
  salvarEstado();
  document.getElementById('b-pag').textContent = Object.keys(pagamentos).length + titulosManuais.length;
  document.getElementById('mdl-bordero-all').style.display = 'none';
  showToast(`✅ ${count} título(s) enviados para pagamento`, 'ok');
}

function closeBorderoMdl(){
  document.getElementById('mdl-bordero').classList.remove('on');
  populateEmps('pag');
  renderPAG();
}

function renderPagTotals(){
  // Atualiza apenas os campos de valor total pago visíveis na tela
  document.querySelectorAll('.pag-vtp').forEach(el=>{
    const saldo = parseFloat(el.dataset.saldo)||0;
    const idVal = el.dataset.id;
    const valLiqBaix = parseFloat(el.dataset.valliqbaix)||0;
    const stPag = el.dataset.stpag||'';
    let acr=0, dec=0;
    const acrEl = document.querySelector(`.pag-acr-input[data-id="${idVal}"]`);
    const decEl = document.querySelector(`.pag-dec-input[data-id="${idVal}"]`);
    if(acrEl) acr = parseFloat(String(acrEl.value).replace(',','.'))||0;
    if(decEl) dec = parseFloat(String(decEl.value).replace(',','.'))||0;
    // Se baixado e tem valLiqBaix da SE2, usa como total pago
    const vtp = (stPag === 'Baixado' && valLiqBaix > 0) ? valLiqBaix : calcValorTotalPago(saldo, acr, dec);
    el.textContent = fmtBR(vtp);
  });
  // Atualiza estatísticas
  updatePagStats();
}
function updatePagStats(){
  let allEntries = pagEntriesRaw().map(e=>({r:e.r,...e.p,_id:e.key,rowId:e.rowId}));
  titulosManuais.forEach(m=>{ allEntries.push({r:m, ...m, _id:m.id}); });
  const totPago = allEntries.reduce((s,e)=>{
    const saldo = e.r.saldo||0;
    const acr = e.acrescimo||e.r.acrescimo||0;
    const dec = e.decrescimo||e.r.decrescimo||0;
    const stPag = e.statusPag||e.r.statusPag||'';
    const valLiqBaix = e._valLiqBaix || (pagamentos[e._id] && pagamentos[e._id]._valLiqBaix) || 0;
    const vtp = (stPag === 'Baixado' && valLiqBaix > 0) ? valLiqBaix : calcValorTotalPago(saldo, acr, dec);
    return s + vtp;
  },0);
  const totSaldo = allEntries.reduce((s,e)=>s+(e.r.saldo||0),0);
  const statEl = document.getElementById('pag-stats');
  if(statEl){
    const hj = allEntries.filter(e=>e.dt===today()).length;
    const dias = new Set(allEntries.map(e=>e.dt)).size;
    statEl.innerHTML = `
      <div class="pag-stat"><div class="l">Títulos</div><div class="v">${allEntries.length}</div></div>
      <div class="pag-stat"><div class="l">Saldo Total</div><div class="v">${fmtBR(totSaldo)}</div></div>
      <div class="pag-stat"><div class="l">Total Pago</div><div class="v">${fmtBR(totPago)}</div></div>
      <div class="pag-stat"><div class="l">Dias com envios</div><div class="v">${dias}</div></div>
      <div class="pag-stat"><div class="l">Enviados hoje</div><div class="v">${hj}</div></div>`;
  }
}


// ===== PERSISTÊNCIA DE ESTADO (localStorage + UUID) =====
function _buildUUIDState(){
  // Converte estado atual (por ID) para estado por UUID (para exportação segura)
  const pagUUID = {}, monUUID = {};
  Object.entries(pagamentos).forEach(([id, val]) => {
    const rowId = getPagRowId(id, val);
    const r = DATA.find(x => x.id === rowId);
    if(r && r.uuid) pagUUID[`${r.uuid}|${id}`] = {...val, rowId};
  });
  Object.entries(monitored).forEach(([id, val]) => {
    const r = DATA.find(x => x.id === +id);
    if(r && r.uuid) monUUID[r.uuid] = val;
  });
  return {pagUUID, monUUID};
}

function salvarEstado(){
  // A fonte persistente oficial e o arquivo backup.js.
  // A memoria da pagina ja contem as alteracoes ate o usuario salvar o backup.
}

function restaurarEstado(){
  try{
    // Limpa estado anterior para evitar acúmulo em chamadas repetidas (auto-refresh)
    Object.keys(pagamentos).forEach(k => delete pagamentos[k]);
    Object.keys(monitored).forEach(k => delete monitored[k]);
    titulosManuais.length = 0;

    // FONTE ÚNICA DE VERDADE: backup.js (pagamentos_uuid / monitored_uuid)
    // O datos.js pode conter pagamentosInit/monitoredInit stale do Python,
    // por isso ignoramos e usamos SOMENTE o backup.js salvo pelo usuário.
    if(BACKUP.pagamentos_uuid){
      Object.entries(BACKUP.pagamentos_uuid).forEach(([uuid, val]) => {
        const r = findRowByStateEntry(uuid, val);
        if(r){
          const key = String(uuid).includes('|') ? String(uuid).split('|').slice(1).join('|') : String(r.id);
          pagamentos[key] = normalizePagStatusManualFlag({...val, rowId:r.id});
        }
      });
    }
    if(BACKUP.monitored_uuid){
      Object.entries(BACKUP.monitored_uuid).forEach(([uuid, val]) => {
        const r = findRowByStateEntry(uuid, val);
        if(r && monitored[r.id] === undefined) monitored[r.id] = val;
      });
    }
    // 3) Titulos manuais tambem vêm somente do backup.js.
    if(Array.isArray(BACKUP.titulosManuais)){
      BACKUP.titulosManuais.forEach(m=>{
        if(m && typeof m === 'object' && !titulosManuais.find(x=>x.id===m.id)){
          titulosManuais.push(normalizePagStatusManualFlag({...m}));
        }
      });
      if(titulosManuais.length) _manualIdCounter = Math.min(_manualIdCounter, ...titulosManuais.map(m=>m.id)) - 1;
    }
    // 4) Remove caches antigos para impedir mistura com backups locais velhos.
    try{
      ['se2_pagamentos','se2_monitored','se2_pagamentos_uuid','se2_monitored_uuid','se2_titulos_manuais']
        .forEach(k=>localStorage.removeItem(k));
    }catch(_){}
    document.getElementById('b-pag').textContent=Object.keys(pagamentos).length + titulosManuais.length;
    document.getElementById('b-mon').textContent=Object.keys(monitored).length;
  }catch(e){ console.error('Erro ao restaurar estado:', e); }
}

function exportarEstado(){
  salvarEstado();
  const {pagUUID, monUUID} = _buildUUIDState();
  const estado={
    pagamentos: pagamentos,
    monitored:  monitored,
    pagamentos_uuid: pagUUID,
    monitored_uuid:  monUUID,
    uuids_vistos: DATA.map(r=>r.uuid),
    exportadoEm: new Date().toISOString(),
    titulosManuais: titulosManuais,
    pendencias: typeof getPendenciasEstado === 'function' ? getPendenciasEstado() : ((window.__SE2_BACKUP__ && window.__SE2_BACKUP__.pendencias) || []),
    totalPag: Object.keys(pagamentos).length + titulosManuais.length,
    totalMon: Object.keys(monitored).length
  };
  const blob=new Blob([JSON.stringify(estado,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='se2_estado.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  setTimeout(()=>{
    alert(
      '✅ Estado exportado com sucesso!\n\n' +
      '📌 Títulos em monitoramento: ' + estado.totalMon + '\n' +
      '💰 Títulos enviados p/ pagamento: ' + estado.totalPag + '\n\n' +
      '▶ Próximos passos:\n' +
      '1. Salve o arquivo se2_estado.json junto aos arquivos publicados\n' +
      '2. Rode a rotina de atualização da base\n' +
      '3. Publique novamente os arquivos estáticos no GitHub Pages ou no host que estiver usando'
    );
  },200);
}

// ===== SALVAR ESTADO como backup.js (persistência sem servidor) =====
function salvarBackupJS(){
  salvarEstado();
  const {pagUUID, monUUID} = _buildUUIDState();
  const estado = {
    pagamentos: pagamentos,
    monitored:  monitored,
    pagamentos_uuid: pagUUID,
    monitored_uuid:  monUUID,
    uuids_vistos: DATA.map(r => r.uuid),
    exportadoEm: new Date().toISOString(),
    titulosManuais: titulosManuais,
    pendencias: typeof getPendenciasEstado === 'function' ? getPendenciasEstado() : ((window.__SE2_BACKUP__ && window.__SE2_BACKUP__.pendencias) || []),
    totalMon: Object.keys(monitored).length,
    totalPag: Object.keys(pagamentos).length + titulosManuais.length
  };
  let conteudo = '// Estado salvo em ' + new Date().toLocaleString('pt-BR') + '\n';
  conteudo += 'window.__SE2_BACKUP__ = ' + JSON.stringify(estado) + ';\n';

  const blob = new Blob([conteudo], {type: 'application/javascript;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'backup.js';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast(
    `💾 backup.js salvo! (${estado.totalPag} pgto · ${estado.totalMon} monit.) — Substitua o arquivo na pasta.`,
    'ok', 5000
  );
}

function today(){ return new Date().toISOString().slice(0,10); }

// Modal genérico
function openModal(title,desc,onOk){
  document.getElementById('mdl-title').textContent=title;
  document.getElementById('mdl-desc').textContent=desc;
  document.getElementById('mdl-obs').value='';
  document.getElementById('mdl').classList.add('on');
  document.getElementById('mdl-ok').onclick=()=>{onOk(document.getElementById('mdl-obs').value); closeMdl();};
}
function closeMdl(){ document.getElementById('mdl').classList.remove('on'); }

// Envios
function getPagSendDate(){
  const el = document.getElementById('pag-date-send');
  return (el && el.value) ? el.value : today();
}
function sendPag(id){
  const r=DATA.find(x=>x.id===id); if(!r) return;
  const enviadosAntes = countPagSendsForRow(id);
  if(enviadosAntes) showToast(`ℹ️ "${r.num}" já tem ${enviadosAntes} envio(s). Novo envio será registrado.`, 'warn', 4500);
  openModal('💰 Enviar para Pagamento',`${r.num} — ${r.razao} — ${fmtBR(r.valor)}`,obs=>{
    addPagamento(id,{obs,dt:getPagSendDate()}); salvarEstado(); populateEmps('pag'); renderPAG(); document.getElementById('b-pag').textContent=Object.keys(pagamentos).length+titulosManuais.length;
    showToast(`✅ Envio do título ${r.num} registrado para Pagamento`, 'ok');
    const cb=document.querySelector(`.rcb[data-id="${id}"]`); if(cb) cb.checked=false;
  });
}
function sendPagBulk(){
  const ids=[...document.querySelectorAll('#p-all .rcb:checked')].map(c=>+c.dataset.id);
  if(!ids.length){alert('Selecione pelo menos um título'); return;}
  const jaEnviados = ids.filter(id=>hasPagSendForRow(id));
  if(jaEnviados.length){ showToast(`ℹ️ ${jaEnviados.length} título(s) já tinham envio anterior. Novos envios serão registrados.`, 'warn', 5000); }
  openModal(`💰 Enviar ${ids.length} títulos`,'Observação aplicada a todos',obs=>{
    const dtEnvio = getPagSendDate();
    ids.forEach(id=>addPagamento(id,{obs,dt:dtEnvio})); salvarEstado(); populateEmps('pag'); renderPAG(); document.getElementById('b-pag').textContent=Object.keys(pagamentos).length+titulosManuais.length;
    showToast(`✅ ${ids.length} envio(s) registrados para Pagamento`, 'ok');
    document.querySelectorAll('#p-all .rcb:checked').forEach(cb=>cb.checked=false);
    document.querySelector('#p-all thead input[type=checkbox]').checked=false;
  });
}
function openMonitor(id){
  const r=DATA.find(x=>x.id===id); if(!r) return;
  if(monitored[id]){
    showToast(`⚠️ "${r.num} — ${r.razao.slice(0,30)}" já está em Monitoramento!`, 'warn');
    return;
  }
  openModal('📌 Monitorar',`${r.num} — ${r.razao}`,obs=>{
    const snap={status:DATA.find(x=>x.id===id)?.status,saldo:DATA.find(x=>x.id===id)?.saldo,atraso:DATA.find(x=>x.id===id)?.atraso,vencimento:DATA.find(x=>x.id===id)?.vencimento};
    monitored[id]={obs,ts:today(),snap}; salvarEstado(); populateEmps('mon'); renderMON(); document.getElementById('b-mon').textContent=Object.keys(monitored).length;
    showToast(`✅ Título ${r.num} adicionado ao Monitoramento`, 'ok');
    const cb=document.querySelector(`.rcb[data-id="${id}"]`); if(cb) cb.checked=false;
  });
}
function openMonitorBulk(){
  const ids=[...document.querySelectorAll('#p-all .rcb:checked')].map(c=>+c.dataset.id);
  if(!ids.length){alert('Selecione pelo menos um título'); return;}
  const jaMonitorados = ids.filter(id=>monitored[id]);
  if(jaMonitorados.length === ids.length){ showToast(`⚠️ Todos os ${ids.length} títulos selecionados já estão em Monitoramento!`, 'warn'); return; }
  if(jaMonitorados.length){ showToast(`ℹ️ ${jaMonitorados.length} título(s) já monitorados serão ignorados.`, 'warn', 4000); }
  const novos = ids.filter(id=>!monitored[id]);
  openModal(`📌 Monitorar ${novos.length} títulos`,'',obs=>{
    novos.forEach(id=>{const rx=DATA.find(x=>x.id===id); const snap={status:rx?.status,saldo:rx?.saldo,atraso:rx?.atraso,vencimento:rx?.vencimento}; monitored[id]={obs,ts:today(),snap};}); salvarEstado(); populateEmps('mon'); renderMON(); document.getElementById('b-mon').textContent=Object.keys(monitored).length;
    showToast(`✅ ${novos.length} título(s) adicionados ao Monitoramento`, 'ok');
    document.querySelectorAll('#p-all .rcb:checked').forEach(cb=>cb.checked=false);
    document.querySelector('#p-all thead input[type=checkbox]').checked=false;
  });
}
function removePag(id){delete pagamentos[id]; salvarEstado(); renderPAG(); document.getElementById('b-pag').textContent=Object.keys(pagamentos).length+titulosManuais.length;}
function removeMon(id){delete monitored[id]; salvarEstado(); renderMON(); document.getElementById('b-mon').textContent=Object.keys(monitored).length;}
function editPagObs(id){
  const cur=pagamentos[id]||{}; 
  const rowId = getPagRowId(id, cur);
  const r=DATA.find(x=>x.id===rowId); if(!r) return;
  document.getElementById('mdl-title').textContent='✏️ Editar Observação';
  document.getElementById('mdl-desc').textContent=`${r.num} — ${r.razao}`;
  document.getElementById('mdl-obs').value=cur.obs||'';
  document.getElementById('mdl').classList.add('on');
  document.getElementById('mdl-ok').onclick=()=>{ pagamentos[id]={...cur, obs:document.getElementById('mdl-obs').value}; salvarEstado(); closeMdl(); renderPAG(); };
}
function editMonObs(id){
  const r=DATA.find(x=>x.id===id); if(!r) return;
  const cur=monitored[id]||{};
  document.getElementById('mdl-title').textContent='✏️ Editar Observação';
  document.getElementById('mdl-desc').textContent=`${r.num} — ${r.razao}`;
  document.getElementById('mdl-obs').value=cur.obs||'';
  document.getElementById('mdl').classList.add('on');
  document.getElementById('mdl-ok').onclick=()=>{ monitored[id]={...cur, obs:document.getElementById('mdl-obs').value}; salvarEstado(); closeMdl(); renderMON(); };
}

// === TÍTULOS MANUAIS ===
function editManualObs(id){
  const m = getManualById(id); if(!m) return;
  document.getElementById('mdl-title').textContent='✏️ Editar Observação';
  document.getElementById('mdl-desc').textContent=`Manual: ${m.empresa||m.filial} · ${m.tipo}`;
  document.getElementById('mdl-obs').value=m.obs||'';
  document.getElementById('mdl').classList.add('on');
  document.getElementById('mdl-ok').onclick=()=>{ m.obs=document.getElementById('mdl-obs').value; salvarEstado(); closeMdl(); renderPAG(); };
}
function removeManual(id){
  const idx = titulosManuais.findIndex(t=>t.id===id);
  if(idx>=0) titulosManuais.splice(idx,1);
  salvarEstado(); renderPAG();
}
// === Controle de Rejeitados: nova data, debitar e remover ===
function _getRejectedEntryIdsForRow(rowId){
  const ids = [];
  const numRowId = Number(rowId);
  Object.entries(pagamentos).forEach(([key, p])=>{
    const pRowId = getPagRowId(key, p);
    if(pRowId === numRowId && String(p && p.statusPag || '') === 'Rejeitado'){
      ids.push(key);
    }
  });
  titulosManuais.forEach(m=>{
    if(m.id === numRowId && String(m.statusPag||'') === 'Rejeitado'){
      ids.push(m.id);
    }
  });
  return ids;
}
function updateRejNovaData(rowId, val){
  const ids = _getRejectedEntryIdsForRow(rowId);
  if(!ids.length){ showToast('Nenhum título rejeitado encontrado para esse registro','warn'); return; }
  ids.forEach(id=>{
    const isManual = Number(id) < 0;
    if(isManual){
      const m = getManualById(Number(id));
      if(m) m.novaDataPag = val;
    } else if(pagamentos[id]){
      pagamentos[id].novaDataPag = val;
    }
  });
  salvarEstado();
  showToast(val ? '📅 Nova data de pagamento salva' : '📅 Nova data removida', 'ok');
}
function marcarRejDebitado(rowId){
  const ids = _getRejectedEntryIdsForRow(rowId);
  if(!ids.length){ showToast('Nenhum título rejeitado encontrado','warn'); return; }
  if(!confirm(`Marcar ${ids.length} título(s) rejeitado(s) como Baixado?`)) return;
  ids.forEach(id=>updatePagStatus(id, 'Baixado'));
  salvarEstado();
  showToast(`✅ Baixado — ${ids.length} título(s) atualizado(s)`, 'ok');
  renderPAG();
}
function removerRej(rowId){
  const ids = _getRejectedEntryIdsForRow(rowId);
  if(!ids.length){ showToast('Nenhum título rejeitado encontrado','warn'); return; }
  if(!confirm(`Remover ${ids.length} título(s) rejeitado(s) da lista?\n\nIsso vai apagar o(s) envio(s) marcado(s) como Rejeitado.`)) return;
  ids.forEach(id=>{
    const isManual = Number(id) < 0;
    if(isManual){
      const idx = titulosManuais.findIndex(t=>t.id===Number(id));
      if(idx>=0) titulosManuais.splice(idx,1);
    } else {
      delete pagamentos[id];
    }
  });
  salvarEstado();
  document.getElementById('b-pag').textContent = Object.keys(pagamentos).length + titulosManuais.length;
  showToast(`🗑 ${ids.length} título(s) removido(s)`, 'ok');
  renderPAG();
}
function openInsertManual(){
  const mdl = document.getElementById('mdl-manual');
  if(mdl) mdl.classList.add('on');
  // Limpar campos
  ['man-tipo','man-fornecedor','man-saldo','man-acrescimo','man-decrescimo','man-vencimento','man-dt-envio'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  // Data de envio padrão = hoje
  const dtEnvioEl = document.getElementById('man-dt-envio'); if(dtEnvioEl) dtEnvioEl.value = today();
  const sel = document.getElementById('man-status'); if(sel) sel.value='';
  // Popular dropdown de Filial-Empresa
  const dd = document.getElementById('man-filial-empresa');
  if(dd){
    const empsMap = new Map();
    DATA.forEach(r=>{
      const filial = String(r.filial||'').trim();
      const empresa = String(r.empresa||'').trim();
      const key = filial+'|'+empresa;
      if(!empsMap.has(key)) empsMap.set(key, {filial, empresa, label: (empresa || filial).trim()});
    });
    const opts = [...empsMap.values()].sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));
    dd.innerHTML = '<option value="">Selecione...</option>' + opts.map(o=>`<option value="${escHtml(o.filial)}|${escHtml(o.empresa)}">${escHtml(o.label)}</option>`).join('');
  }
  // Reset VTP
  const vtpEl = document.getElementById('man-vtp'); if(vtpEl) vtpEl.textContent = 'R$ 0,00';
}
function closeManualMdl(){ const mdl=document.getElementById('mdl-manual'); if(mdl) mdl.classList.remove('on'); }
function salvarManual(){
  const feVal = (document.getElementById('man-filial-empresa').value||'').trim();
  if(!feVal){ showToast('⚠️ Selecione uma Empresa','warn'); return; }
  const [filial, empresa] = feVal.split('|');
  const tipo = (document.getElementById('man-tipo').value||'').trim();
  const fornecedor = (document.getElementById('man-fornecedor').value||'').trim();
  const saldo = parseFloat(String(document.getElementById('man-saldo').value||'0').replace(',','.'))||0;
  const acrescimo = parseFloat(String(document.getElementById('man-acrescimo').value||'0').replace(',','.'))||0;
  const decrescimo = parseFloat(String(document.getElementById('man-decrescimo').value||'0').replace(',','.'))||0;
  const vencimento = document.getElementById('man-vencimento').value||'';
  const dtEnvio = document.getElementById('man-dt-envio').value || today();
  const statusPag = document.getElementById('man-status').value || '';
  const id = _manualIdCounter--;
  titulosManuais.push({
    id, filial, empresa, tipo, num:'MANUAL', parcela:'', razao:empresa,
    fornecedor:fornecedor, emissao:today(), vencimento:vencimento||today(), vencReal:vencimento||today(),
    valor:saldo, saldo, status:'Manual', atraso:0, baixa:'', historico:'Inserido manualmente',
    valLiqBaix:0, numBordero:'', dtBordero:'', dtLiberacao:'', tipoPgto:'', cnpj:'', uuid:'',
    usrInc:'', usrAlt:'',
    acrescimo, decrescimo, statusPag, statusManual: !!statusPag,
    obs:'', dt:dtEnvio
  });
  salvarEstado(); closeManualMdl(); populateEmps('pag'); renderPAG();
  showToast('✅ Título manual inserido com sucesso','ok');
}

function calcManualVTP(){
  const s = parseFloat(String(document.getElementById('man-saldo').value||'0').replace(',','.'))||0;
  const a = parseFloat(String(document.getElementById('man-acrescimo').value||'0').replace(',','.'))||0;
  const d = parseFloat(String(document.getElementById('man-decrescimo').value||'0').replace(',','.'))||0;
  document.getElementById('man-vtp').textContent = fmtBR(calcValorTotalPago(s, a, d));
}

// Empresa pills populate
function populateEmps(kind){
  const src = kind==='pag'?pagamentos:monitored;
  const cont = document.getElementById(kind+'-emps');
  if(!cont) return;
  const empsMap = new Map();
  const baseEntries = kind==='pag' ? pagEntriesRaw().map(e=>e.r) : Object.keys(src).map(id=>DATA.find(x=>x.id===+id)).filter(Boolean);
  baseEntries.forEach(r=>{
    if(!r) return;
    const key = companyPairFromRow(r);
    if(!key || empsMap.has(key)) return;
    const filial = String(r.filial||'').trim();
    const empresa = String(r.empresa||'').trim();
    empsMap.set(key, { key, filial, empresa, label: (empresa || filial).trim() || key });
  });
  // Incluir empresas de títulos manuais na aba pagamentos
  if(kind==='pag'){
    titulosManuais.forEach(m=>{
      const key = companyPairFromRow(m);
      if(!key || empsMap.has(key)) return;
      const filial = String(m.filial||'').trim();
      const empresa = String(m.empresa||'').trim();
      empsMap.set(key, { key, filial, empresa, label: (empresa || filial).trim() || key });
    });
  }
  const emps=[...empsMap.values()].sort((a,b)=>{
    return a.label.localeCompare(b.label, 'pt-BR');
  });
  cont.innerHTML = emps.map(e=>`<span class="pill" data-emp="${e.key}" onclick="togEmpX(this,'${kind}')">${escHtml(e.label)}</span>`).join('');
}
function togEmpX(el,kind){
  const s = kind==='pag'?selPag:selMon; const v=el.dataset.emp;
  if(s.emp.has(v)){s.emp.delete(v); el.classList.remove('on');} else {s.emp.add(v); el.classList.add('on');}
  kind==='pag'?renderPAG():renderMON();
}
function togStX(el,kind){
  const s = kind==='pag'?selPag:selMon; const v=el.dataset.st;
  if(s.st.has(v)){s.st.delete(v); el.classList.remove('on');} else {s.st.add(v); el.classList.add('on');}
  kind==='pag'?renderPAG():renderMON();
}

// Filtro compartilhado
function applyFilters(kind, entries){
  const gv=i=>{const el=document.getElementById(kind+'-'+i); return el?el.value:'';};
  const num=gv('num').toLowerCase(), rz=gv('razao').toLowerCase(), fn=gv('forn').toLowerCase(), tp=gv('tipo').toLowerCase();
  const vexatoStr=gv('vexato').trim(), vexatoNum=vexatoStr?parseFloat(vexatoStr):NaN;
  const vliqStr=gv('vliq').trim(), vliqNum=vliqStr?parseFloat(vliqStr):NaN;
  const d1=gv('d1'), d2=kind==='mon'?gv('d2'):'';
  const s = kind==='pag'?selPag:selMon;
  return entries.filter(e=>{
    const r=e.r;
    if(num && !r.num.toLowerCase().includes(num)) return false;
    if(rz && !r.razao.toLowerCase().includes(rz)) return false;
    if(fn && !r.fornecedor.toLowerCase().includes(fn)) return false;
    if(tp && !r.tipo.toLowerCase().includes(tp)) return false;
    if(!isNaN(vexatoNum) && Math.abs(r.valor - vexatoNum) > 0.009) return false;
    if(!isNaN(vliqNum)){
      const valLiqBaix = Number(e._valLiqBaix ?? r.valLiqBaix ?? 0);
      if(Math.abs(valLiqBaix - vliqNum) > 0.009) return false;
    }
    if(kind==='pag' && d1 && e.dt!==d1) return false;
    if(kind==='pag'){
      const stFilter = gv('status');
      if(stFilter){
        const stEntry = String(e.statusPag||e.r.statusPag||'');
        if(stFilter==='__sem__'){
          if(stEntry) return false;
        } else if(stEntry !== stFilter){
          return false;
        }
      }
    }
    if(kind==='mon'){ if(d1 && r.vencimento<d1) return false; if(d2 && r.vencimento>d2) return false; }
    if(s.emp.size && !s.emp.has(companyPairFromRow(r))) return false;
    if(s.st.size && !s.st.has(r.status)) return false;
    if(!rowMatchesUserFilters(r, kind+'-')) return false;
    return true;
  });
}

function clearPAG(){ ['num','forn','vexato','vliq','d1','tipo','uuid','status','inc-name','inc','alt-name','alt'].forEach(i=>{const el=document.getElementById('pag-'+i);if(el)el.value='';}); const pr=document.getElementById('pag-razao');if(pr)pr.value=''; selPag.emp.clear(); selPag.st.clear(); document.querySelectorAll('#p-pag .pill.on').forEach(p=>p.classList.remove('on')); renderPAG(); }
function clearMON(){ ['num','forn','vmin','vmax','d1','d2','tipo','uuid','inc-name','inc1','inc2','alt-name','alt1','alt2'].forEach(i=>{const el=document.getElementById('mon-'+i);if(el)el.value='';}); const mr=document.getElementById('mon-razao');if(mr)mr.value=''; selMon.emp.clear(); selMon.st.clear(); document.querySelectorAll('#p-mon .pill.on').forEach(p=>p.classList.remove('on')); renderMON(); }
function clearNEW(){ ['uuid','inc-name','inc1','inc2','alt-name','alt1','alt2'].forEach(i=>{const el=document.getElementById('new-'+i);if(el)el.value='';}); renderNEW(); }

// Renderização
function renderPAG(){
  let entries = pagEntriesRaw().map(e=>({r:e.r,...e.p,_id:e.key,rowId:e.rowId}));
  // Incluir títulos manuais
  titulosManuais.forEach(m=>{ entries.push({r:m, ...m, _id:m.id}); });
  entries = applyFilters('pag', entries);
  // Stats
  const totSaldo = entries.reduce((s,e)=>s+(e.r.saldo||0),0);
  const totPago = entries.reduce((s,e)=>{
    const acr = e.acrescimo||e.r.acrescimo||0;
    const dec = e.decrescimo||e.r.decrescimo||0;
    const stPag = e.statusPag||e.r.statusPag||'';
    const valLiqBaix = e._valLiqBaix || (pagamentos[e._id] && pagamentos[e._id]._valLiqBaix) || 0;
    const vtp = (stPag === 'Baixado' && valLiqBaix > 0) ? valLiqBaix : calcValorTotalPago(e.r.saldo||0, acr, dec);
    return s + vtp;
  },0);
  const hj = entries.filter(e=>e.dt===today()).length;
  const dias = new Set(entries.map(e=>e.dt)).size;
  document.getElementById('pag-stats').innerHTML = `
    <div class="pag-stat"><div class="l">Títulos</div><div class="v">${entries.length}</div></div>
    <div class="pag-stat"><div class="l">Saldo Total</div><div class="v">${fmtBR(totSaldo)}</div></div>
    <div class="pag-stat"><div class="l">Total Pago</div><div class="v">${fmtBR(totPago)}</div></div>
    <div class="pag-stat"><div class="l">Dias com envios</div><div class="v">${dias}</div></div>
    <div class="pag-stat"><div class="l">Enviados hoje</div><div class="v">${hj}</div></div>`;
  // Contador por empresa
  const empMap={};
  entries.forEach(e=>{
    const key = (e.r.empresa || e.r.filial || '').trim();
    if(!empMap[key]) empMap[key]={cnt:0,saldo:0};
    empMap[key].cnt++;
    empMap[key].saldo += (e.r.saldo||0);
  });
  const empKeys = Object.keys(empMap).sort();
  document.getElementById('pag-emp-stats').innerHTML = empKeys.length ? `<div class="pag-emp-grid">${empKeys.map(k=>`<div class="pag-emp-card"><div class="emp-name">${escHtml(k)}</div><div class="emp-row"><span class="emp-cnt"><b>${empMap[k].cnt}</b> título(s)</span><span class="emp-val">${fmtBR(empMap[k].saldo)}</span></div></div>`).join('')}</div>` : '';
  const groups={}; entries.forEach(e=>{(groups[e.dt]=groups[e.dt]||[]).push(e);});
  const days = Object.keys(groups).sort().reverse();
  if(!days.length){ document.getElementById('pag-list').innerHTML='<div style="text-align:center;padding:40px;color:#64748b">Nenhum título enviado.</div>'; return; }
  const rejeitados = entries.filter(e=>(e.statusPag||e.r.statusPag||'')==='Rejeitado');
  const rejMap = {};
  rejeitados.forEach(e=>{
    const k = e.rowId || e.r.id;
    if(!rejMap[k]) rejMap[k] = {r:e.r, count:0, last:'', rowId:k, novaData:'', dates:[], valor:null, uuid:''};
    rejMap[k].count++;
    if(rejMap[k].valor == null){
      const baseValor = (e.r.valor != null && e.r.valor !== '') ? Number(e.r.valor)||0 : Number(e.r.saldo)||0;
      rejMap[k].valor = calcValorTotalPago(baseValor, e.acrescimo||e.r.acrescimo||0, e.decrescimo||e.r.decrescimo||0);
    }
    if(!rejMap[k].uuid && e.r.uuid) rejMap[k].uuid = e.r.uuid;
    const dtStr = String(e.dt||'');
    if(dtStr) rejMap[k].dates.push(dtStr);
    if(!rejMap[k].last || dtStr > rejMap[k].last) rejMap[k].last = dtStr;
    const nd = e.novaDataPag || e.r.novaDataPag || '';
    if(nd) rejMap[k].novaData = nd;
  });
  const rejRows = Object.values(rejMap).sort((a,b)=>b.count-a.count || String(b.last).localeCompare(String(a.last)));
  const renderRejDates = (x)=>{
    const counts = {};
    (x.dates||[]).forEach(d=>{ counts[d] = (counts[d]||0) + 1; });
    const sortedDts = Object.keys(counts).sort((a,b)=>b.localeCompare(a));
    if(!sortedDts.length) return fmtDt(x.last);
    return sortedDts.map((d,i)=>{
      const badge = counts[d] > 1 ? ` <span style="background:#fee2e2;color:#b91c1c;border-radius:8px;padding:0 6px;font-size:10px;font-weight:700">×${counts[d]}</span>` : '';
      const style = i===0 ? 'font-weight:700;color:#b91c1c' : 'font-size:10.5px;color:#64748b';
      return `<div style="${style}">${fmtDt(d)}${badge}</div>`;
    }).join('');
  };
  const rejCollapsed = _pagCollapsed.has('rej');
  const rejeitadosHTML = rejRows.length ? `<div class="fbox pag-rej-box${rejCollapsed?' pag-collapsed':''}" data-collapse-key="rej" style="border-left-color:#b91c1c;margin-bottom:12px">
    <div class="sec-title" style="margin:0 0 8px"><h2><button class="pag-collapse-btn" onclick="togglePagCollapse('rej', this)" title="${rejCollapsed?'Expandir':'Recolher'}">${rejCollapsed?'▸':'▾'}</button>Controle de rejeitados</h2><span class="cnt">${rejeitados.length} rejeição(ões) em ${rejRows.length} título(s)</span></div>
    <div class="drag-scroll" style="overflow-x:auto"><table style="font-size:11.5px"><thead><tr><th>Empresa</th><th>Título</th><th>Fornecedor</th><th class="num">Valor</th><th style="text-align:center">UUID</th><th class="num">Qtd. rejeitada</th><th>Histórico de rejeições</th><th>Nova Data de Pagamento</th><th style="text-align:center">Ações</th></tr></thead><tbody>${rejRows.map(x=>`<tr><td style="white-space:nowrap;font-weight:600">${escHtml(x.r.empresa||x.r.filial||'')}</td><td>${escHtml(x.r.tipo)} ${escHtml(x.r.num)} - ${escHtml(x.r.parcela||'')}</td><td>${escHtml(x.r.razao||x.r.fornecedor||'')}</td><td class="num" style="font-weight:800;white-space:nowrap;color:#15803d">${fmtBR(x.valor||0)}</td><td style="text-align:center;white-space:nowrap">${x.uuid?`<button type="button" class="uuid-copy-btn" data-uuid="${escHtml(x.uuid)}" onclick="copyUUID(this)" title="Copiar UUID: ${escHtml(x.uuid)}">Copiar UUID</button>`:'<span style="color:#94a3b8;font-size:11px">&mdash;</span>'}</td><td class="num" style="font-weight:800;color:#b91c1c">${x.count}</td><td style="min-width:120px">${renderRejDates(x)}</td><td><input type="date" class="rej-nova-data" value="${escHtml(x.novaData||'')}" onchange="updateRejNovaData(${x.rowId}, this.value)" style="padding:4px 6px;border:1px solid #dde1ee;border-radius:5px;font-size:12px"></td><td style="text-align:center;white-space:nowrap"><button onclick="marcarRejDebitado(${x.rowId})" title="Marcar como Baixado" style="background:#15803d;color:#fff;border:0;border-radius:5px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">✅ Baixar</button><button onclick="removerRej(${x.rowId})" title="Remover título(s) rejeitado(s)" style="background:#b91c1c;color:#fff;border:0;border-radius:5px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer">🗑 Remover</button></td></tr>`).join('')}</tbody></table></div>
  </div>` : '';
  document.getElementById('pag-list').innerHTML = rejeitadosHTML + days.map(dt=>{
    const arr=groups[dt];
    const tSaldo=arr.reduce((s,e)=>s+(e.r.saldo||0),0);
    const lbl = dt===today()?' · 📍 HOJE':'';
    const statusResumo = renderPagDayStatusSummary(arr);
    const dayCollapseKey = 'dt:'+dt;
    const dayCollapsed = _pagCollapsed.has(dayCollapseKey);
    return `<div class="pag-day${dayCollapsed?' pag-collapsed':''}" data-dt="${dt}" data-collapse-key="${dayCollapseKey}"><h4><span style="display:flex;align-items:center;gap:6px"><button class="pag-collapse-btn" onclick="togglePagCollapse('${dayCollapseKey}', this)" title="${dayCollapsed?'Expandir':'Recolher'}">${dayCollapsed?'▸':'▾'}</button>📅 ${fmtDt(dt)}${lbl}</span><span style="font-size:12px;color:#64748b;font-weight:500;display:flex;align-items:center;gap:10px">${arr.length} título(s) · Saldo: ${fmtBR(tSaldo)}<span class="pag-day-status-summary">${statusResumo}</span><button class="btn-verif-baixa" onclick="verificarBaixaDia('${dt}')" title="DT Baixa preenchida = Baixado; Dt. Borderô sem baixa = No Bordero; sem as duas datas = Aberto">🔎 Verificar Baixa</button></span></h4>
      <div class="drag-scroll" style="overflow-x:auto;cursor:grab;user-select:none"><table><thead><tr>
        <th style="width:26px"><input type="checkbox" onchange="togAllPag(this,'${dt}')"></th>
        <th>EMPRESA</th><th>TIPO</th><th>Nº TÍTULO</th><th>PARCELA</th>
        <th>FORNECEDOR</th><th>NOME FORNECE</th>
        <th>VENCIMENTO</th><th>VENCTO REAL</th>
        <th class="num">VLR. TÍTULO</th><th class="num">SALDO</th>
        <th class="num" style="min-width:110px">ACRÉSCIMO</th><th class="num" style="min-width:110px">DECRÉSCIMO</th>
        <th class="num" style="background:#f0fdf4;color:#15803d;min-width:140px">VLR. TOTAL PAGO</th>
        <th style="min-width:100px">STATUS</th>
        <th style="width:80px;text-align:center">UUID</th>
        <th>OBS</th><th></th></tr></thead>
      <tbody>${(()=>{ let prevEmp=null; return arr.map((e,idx)=>{
        const isManual = Number(e._id) < 0;
        const entryId = String(e._id);
        const entryIdEsc = escHtml(entryId);
        const acr = e.acrescimo||e.r.acrescimo||0;
        const dec = e.decrescimo||e.r.decrescimo||0;
        const saldo = e.r.saldo||0;
        // Se título baixado e tem _valLiqBaix da SE2, usa como vlr total pago
        const valLiqBaixSE2 = e._valLiqBaix || (pagamentos[e._id] && pagamentos[e._id]._valLiqBaix) || 0;
        const stPag = e.statusPag||e.r.statusPag||'';
        const vtp = (stPag === 'Baixado' && valLiqBaixSE2 > 0) ? valLiqBaixSE2 : calcValorTotalPago(saldo, acr, dec);
        const empKey = escHtml((e.r.empresa || e.r.filial || '').trim());
        const isSep = (idx>0 && empKey!==prevEmp);
        prevEmp = empKey;
        const trClass = isSep?' class="emp-sep"':'';
        const trStyle = isManual?' style="background:#fffef0"':'';
        return `<tr${trClass}${trStyle}>
        <td><input type="checkbox" class="pag-cb" data-id="${entryIdEsc}"></td>
        <td class="filemp" style="white-space:nowrap;font-weight:600">${empKey}</td>
        <td>${escHtml(e.r.tipo)}</td><td>${escHtml(e.r.num||'—')}</td><td>${escHtml(e.r.parcela||'—')}</td>
        <td>${escHtml(e.r.fornecedor||'—')}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(e.r.razao)}">${escHtml(e.r.razao)}</td>
        <td>${fmtDt(e.r.vencimento)}</td><td>${fmtDt(e.r.vencReal)}</td>
        <td class="num" style="white-space:nowrap">${fmtBR(e.r.valor||saldo)}</td>
        <td class="num" style="white-space:nowrap;min-width:130px">${fmtBR(saldo)}</td>
        <td class="num"><input type="text" class="pag-acr-input" data-id="${entryIdEsc}" value="${acr?acr.toFixed(2).replace('.',','):''}" placeholder="0,00" oninput="updatePagAcrescimo('${entryIdEsc}',this.value)" style="width:90px;padding:4px 6px;border:1px solid #dde1ee;border-radius:5px;font-size:12px;text-align:right"></td>
        <td class="num"><input type="text" class="pag-dec-input" data-id="${entryIdEsc}" value="${dec?dec.toFixed(2).replace('.',','):''}" placeholder="0,00" oninput="updatePagDecrescimo('${entryIdEsc}',this.value)" style="width:90px;padding:4px 6px;border:1px solid #dde1ee;border-radius:5px;font-size:12px;text-align:right"></td>
        <td class="num pag-vtp" data-saldo="${saldo}" data-id="${entryIdEsc}" data-valliqbaix="${valLiqBaixSE2}" data-stpag="${escHtml(stPag)}" style="font-weight:700;white-space:nowrap;background:#f0fdf4;color:#15803d">${fmtBR(vtp)}</td>
        <td style="text-align:center">${renderPagStatusSelect(entryId, stPag)}</td>
        <td style="text-align:center">${e.r.uuid?`<button type="button" class="uuid-copy-btn" data-uuid="${escHtml(e.r.uuid)}" onclick="copyUUID(this)" title="Copiar UUID: ${escHtml(e.r.uuid)}">📋</button>`:'<span style="color:#94a3b8;font-size:11px">—</span>'}</td>
        <td style="padding:6px 8px;min-width:200px"><div class="obs-box"><span class="obs-txt ${e.obs?'':'vazio'}">${e.obs||'Clique para adicionar...'}</span><button class="obs-edit-btn" onclick="${isManual?`editManualObs(${e._id})`:`editPagObs('${entryIdEsc}')`}" title="Editar observação">✏️</button></div></td>
        <td><button class="ab-mn" onclick="${isManual?`removeManual(${e._id})`:`removePag('${entryIdEsc}')`}">✕</button></td>
      </tr>`;
}).join(''); })()}</tbody></table></div></div>`;
  }).join('');
  applyDrag('#p-pag');
  document.getElementById('b-pag').textContent = Object.keys(pagamentos).length + titulosManuais.length;
  updateSelCounter('pag');
}

function buildDiff(snap,r){
  if(!snap) return '<span class="diff-badge diff-neutral">Sem snapshot</span>';
  const lines=[];
  if(snap.status!==r.status){const cls=r.status==='Baixado'?'diff-ok':r.status==='Vencido'?'diff-alert':'diff-warn'; lines.push(`<span class="diff-badge ${cls}">Status: ${snap.status} → ${r.status}</span>`);}
  else{lines.push(`<span class="diff-badge diff-neutral">Status: ${r.status}</span>`);}
  const sdiff=r.saldo-(snap.saldo||0);
  if(Math.abs(sdiff)>0.01){const cls=sdiff<0?'diff-ok':'diff-alert';const sign=sdiff>0?'+':''; lines.push(`<span class="diff-badge ${cls}">Saldo: ${sign}${fmtBR(sdiff)}</span>`);}
  const adiff=(r.atraso||0)-(snap.atraso||0);
  if(adiff!==0){const cls=adiff>0?'diff-alert':'diff-ok';const sign=adiff>0?'+':''; lines.push(`<span class="diff-badge ${cls}">Atraso: ${sign}${adiff}d</span>`);}
  if(snap.vencimento&&snap.vencimento!==r.vencimento){lines.push(`<span class="diff-badge diff-warn">Venc: ${fmtDt(snap.vencimento)} → ${fmtDt(r.vencimento)}</span>`);}
  if(lines.length<=1&&sdiff===0&&adiff===0){lines.push('<span class="diff-badge diff-ok">✓ Sem alterações</span>');}
  return lines.join(' &nbsp;');
}

function renderMON(){
  let entries=Object.entries(monitored).map(([id,m])=>({r:DATA.find(x=>x.id===+id),...m})).filter(e=>e.r);
  entries=applyFilters('mon',entries);
  const tot=entries.reduce((s,e)=>s+e.r.saldo,0);
  const venc=entries.filter(e=>e.r.status==='Vencido').length;
  const altered=entries.filter(e=>e.snap&&(e.snap.status!==e.r.status||Math.abs((e.r.saldo||0)-(e.snap.saldo||0))>0.01||(e.r.atraso||0)!==(e.snap.atraso||0))).length;
  document.getElementById('mon-stats').innerHTML=`
    <div class="pag-stat" style="border-left-color:#d97706"><div class="l">Títulos</div><div class="v" style="color:#d97706">${entries.length}</div></div>
    <div class="pag-stat" style="border-left-color:#d97706"><div class="l">Saldo Total</div><div class="v" style="color:#d97706">${fmtBR(tot)}</div></div>
    <div class="pag-stat" style="border-left-color:#b91c1c"><div class="l">Vencidos</div><div class="v" style="color:#b91c1c">${venc}</div></div>
    <div class="pag-stat" style="border-left-color:#7c3aed"><div class="l">Com alteração</div><div class="v" style="color:#7c3aed">${altered}</div></div>`;
  if(!entries.length){document.getElementById('mon-list').innerHTML='<div style="text-align:center;padding:40px;color:#64748b">Nenhum título monitorado.</div>'; return;}
  const head=`<tr>
    <th style="font-size:12px">EMPRESA</th>
    <th style="font-size:12px">TIPO</th>
    <th style="font-size:12px">Nº TÍTULO</th>
    <th style="font-size:12px">PARC.</th>
    <th style="font-size:12px">FORNECEDOR</th>
    <th style="font-size:12px">UUID</th>
    <th style="font-size:12px">EMISSÃO</th>
    <th style="font-size:12px">VENC. REAL</th>
    <th style="font-size:12px;padding:10px 4px" class="num">VALOR</th>
    <th style="font-size:12px;padding:10px 4px" class="num">SALDO</th>
    <th style="font-size:12px">STATUS</th>
    <th style="font-size:12px;background:#fef2f2;color:#991b1b">ATRASO</th>
    <th style="font-size:12px">DT. BAIXA</th>
    <th style="font-size:12px;background:#f3e8ff;color:#7c3aed;min-width:260px">📊 COMPARAÇÃO</th>
    <th style="font-size:12px">OBSERVAÇÃO</th>
    <th style="font-size:12px">DT. MONIT.</th>
    <th style="font-size:12px">NOME INC</th>
    <th style="font-size:12px">DATA INC</th>
    <th style="font-size:12px">NOME ALT</th>
    <th style="font-size:12px">DATA ALT</th>
    <th style="font-size:12px"></th></tr>`; 
  const body=entries.map(e=>{const r=e.r;
    const hasChange=e.snap&&(e.snap.status!==r.status||Math.abs((r.saldo||0)-(e.snap.saldo||0))>0.01||(r.atraso||0)!==(e.snap.atraso||0));
    const i=splitUserDate(r.usrInc), alt=splitUserDate(r.usrAlt);
    return `<tr style="${hasChange?'background:#fffef0':''}">
    <td style="white-space:nowrap;font-size:13px;font-weight:600;color:#1e2340">${r.empresa||r.filial}</td>
    <td style="white-space:nowrap;font-size:13px">${r.tipo}</td>
    <td style="white-space:nowrap;font-size:13px">${r.num}</td>
    <td style="white-space:nowrap;font-size:13px">${r.parcela||'—'}</td>
    <td style="white-space:nowrap;font-size:13px;color:#475569" title="${r.razao} | ${r.fornecedor}">${r.fornecedor}</td>
    <td style="text-align:center;white-space:nowrap;font-size:13px">${r.uuid?`<button type="button" class="uuid-copy-btn" data-uuid="${escHtml(r.uuid)}" onclick="copyUUID(this)" title="Copiar UUID">📋</button>`:'—'}</td>
    <td style="white-space:nowrap;font-size:13px">${fmtDt(r.emissao)}</td>
    <td style="white-space:nowrap;font-size:13px">${fmtDt(r.vencReal)}</td>
    <td class="num" style="white-space:nowrap;font-size:13px;min-width:90px;padding:9px 4px">${fmtBR(r.valor)}</td>
    <td class="num" style="white-space:nowrap;font-size:13px;min-width:90px;padding:9px 4px">${fmtBR(r.saldo)}</td>
    <td style="white-space:nowrap;font-size:13px"><span class="status ${stCls(r.status)}">${r.status}</span></td>
    <td style="white-space:nowrap;font-size:13px;text-align:center"><span class="${atrCls(r.atraso)}">${r.atraso||'—'}</span></td>
    <td style="white-space:nowrap;font-size:13px">${fmtDt(r.baixa)}</td>
    <td style="background:#faf5ff;white-space:nowrap;vertical-align:middle;padding:6px 10px">${buildDiff(e.snap,r)}</td>
    <td style="padding:6px 8px;min-width:210px"><div class="obs-box"><span class="obs-txt ${e.obs?'':'vazio'}">${e.obs||'Clique para adicionar...'}</span><button class="obs-edit-btn" onclick="editMonObs(${r.id})" title="Editar observação">✏️</button></div></td>
    <td style="white-space:nowrap;font-size:13px">${fmtDt(e.ts)}</td>
    <td style="white-space:nowrap;font-size:13px">${escHtml(i.name)}</td>
    <td style="white-space:nowrap;font-size:13px">${i.date||'—'}</td>
    <td style="white-space:nowrap;font-size:13px">${escHtml(alt.name)}</td>
    <td style="white-space:nowrap;font-size:13px">${alt.date||'—'}</td>
    <td style="white-space:nowrap"><button class="ab-mn" onclick="removeMon(${r.id})">✕</button></td></tr>`;}).join('');
  document.getElementById('mon-list').innerHTML=`<div class="drag-scroll" style="overflow-x:auto;cursor:grab;user-select:none"><table style="font-size:13px"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  applyDrag('#p-mon');
}


function applyDrag(sel){
  document.querySelectorAll(sel+' .drag-scroll').forEach(el=>{
    if(el.dataset.drag) return; el.dataset.drag='1';
    let d=false,sx=0,sl=0;
    el.addEventListener('mousedown',ev=>{if(ev.target.tagName==='BUTTON'||ev.target.tagName==='INPUT'||ev.target.tagName==='SELECT'||ev.target.tagName==='OPTION')return; d=true;sx=ev.pageX-el.offsetLeft;sl=el.scrollLeft;el.style.cursor='grabbing';ev.preventDefault();});
    el.addEventListener('mouseleave',()=>{d=false;el.style.cursor='grab';});
    el.addEventListener('mouseup',()=>{d=false;el.style.cursor='grab';});
    el.addEventListener('mousemove',ev=>{if(!d)return;el.scrollLeft=sl-(ev.pageX-el.offsetLeft-sx);});
  });
}

function downloadPAG(){
  let entries = pagEntriesRaw().map(e=>({r:e.r,...e.p,_id:e.key,rowId:e.rowId}));
  titulosManuais.forEach(m=>{ entries.push({r:m, ...m, _id:m.id}); });
  entries = applyFilters('pag', entries);
  if(!entries.length){alert('Nada para baixar'); return;}
  const head='DataEnvio;Empresa;Tipo;Num;Parcela;Fornecedor;NomeFornece;Vencimento;VenctoReal;VlrTitulo;Saldo;Acrescimo;Decrescimo;ValorTotalPago;Status;Observacao';
  const body=entries.map(e=>{
    const acr=e.acrescimo||e.r.acrescimo||0;
    const dec=e.decrescimo||e.r.decrescimo||0;
    const saldo=e.r.saldo||0;
    const vtp=calcValorTotalPago(saldo,acr,dec);
    const st=e.statusPag||e.r.statusPag||'';
    return [e.dt,(e.r.empresa||e.r.filial),e.r.tipo,e.r.num,e.r.parcela,e.r.fornecedor,e.r.razao,e.r.vencimento,e.r.vencReal,e.r.valor||saldo,saldo,acr,dec,vtp,st,(e.obs||'').replace(/;/g,',')].join(';');
  }).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+head+'\n'+body],{type:'text/csv;charset=utf-8'})); a.download='pagamentos.csv'; a.click();
}
function downloadMON(){
  let entries = Object.entries(monitored).map(([id,m])=>({r:DATA.find(x=>x.id===+id),...m})).filter(e=>e.r);
  entries = applyFilters('mon', entries);
  if(!entries.length){alert('Nada para baixar'); return;}
  const head='Empresa;Tipo;Num;Razao;Fornecedor;Vencimento;Valor;Saldo;Status;Atraso;Observacao;DtMonit';
  const body=entries.map(e=>[(e.r.empresa||e.r.filial),e.r.tipo,e.r.num,e.r.razao,e.r.fornecedor,e.r.vencimento,e.r.valor,e.r.saldo,e.r.status,e.r.atraso,(e.obs||'').replace(/;/g,','),e.ts].join(';')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+head+'\n'+body],{type:'text/csv;charset=utf-8'})); a.download='monitoramento.csv'; a.click();
}

// Ordenação por clique no cabeçalho
const SORT_MAP = ['','empresa','tipo','num','parcela','razao','fornecedor','codFornec','emissao','vencimento','vencReal','valor','saldo','status','natureza','baixa','historico','valLiqBaix','numBordero','dtBordero','dtLiberacao','tipoPgto','cnpj','uuid','usrIncName','usrIncDate','usrAltName','usrAltDate',''];
let sortKey=null, sortAsc=true;
const PAGE_SIZE = 300;
let currentPage = 1;
function setupSort(){
  document.querySelectorAll('#p-all thead th').forEach((th,i)=>{
    const k = SORT_MAP[i]; if(!k) return;
    th.style.cursor='pointer'; th.title='Clique para ordenar';
    th.onclick=()=>{
      if(sortKey===k) sortAsc=!sortAsc; else { sortKey=k; sortAsc=true; }
      document.querySelectorAll('#p-all thead th .sort-ind').forEach(e=>e.remove());
      const ind=document.createElement('span'); ind.className='sort-ind'; ind.textContent=sortAsc?' ▲':' ▼'; ind.style.color='#2563eb'; th.appendChild(ind);
      render();
    };
  });
}

function sortData(rows){
  if(!sortKey) return rows;
  return [...rows].sort((a,b)=>{
    let va, vb;
    if(sortKey==='usrIncName'){ va=splitUserDate(a.usrInc).name; vb=splitUserDate(b.usrInc).name; }
    else if(sortKey==='usrIncDate'){ va=brDateToISO(splitUserDate(a.usrInc).date); vb=brDateToISO(splitUserDate(b.usrInc).date); }
    else if(sortKey==='usrAltName'){ va=splitUserDate(a.usrAlt).name; vb=splitUserDate(b.usrAlt).name; }
    else if(sortKey==='usrAltDate'){ va=brDateToISO(splitUserDate(a.usrAlt).date); vb=brDateToISO(splitUserDate(b.usrAlt).date); }
    else { va=a[sortKey]; vb=b[sortKey]; }
    if(va===undefined||va===null) va=''; if(vb===undefined||vb===null) vb='';
    if(typeof va==='number'&&typeof vb==='number') return sortAsc?va-vb:vb-va;
    return sortAsc?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));
  });
}

// Inicialização
async function bootstrapApp(){
  await refreshPublishedAssets();
  applyBootMeta();
  restaurarEstado();
  populateFilialFilter();
  populateEmps('pag');
  populateEmps('mon');
  render();
  setupSort();
  renderNEW();
  document.dispatchEvent(new Event('se2:ready'));
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => { void bootstrapApp(); }, { once: true });
} else {
  void bootstrapApp();
}

function render(resetPage=false){
  if(resetPage) currentPage = 1;
  const d=sortData(filtered());
  const totalPages = Math.max(1, Math.ceil(d.length / PAGE_SIZE));
  if(currentPage > totalPages) currentPage = totalPages;
  if(currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = d.slice(start, start + PAGE_SIZE);
  document.getElementById('tb').innerHTML = pageRows.map(r=>`
    <tr>
      <td><input type="checkbox" class="rcb" data-id="${r.id}"></td>
      <td class="filemp" style="white-space:nowrap">${r.empresa||r.filial}</td>
      <td>${r.tipo}</td><td>${r.num}</td><td>${r.parcela||'—'}</td>
      <td title="${r.razao}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.razao}</td>
      <td title="${r.fornecedor}" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px">${r.fornecedor}</td>
      <td style="text-align:center">${r.codFornec?`<button type="button" class="copy-mini" data-codfornec="${escHtml(r.codFornec)}" onclick="copyFornec(this)" title="Copiar Cód. Fornecedor: ${escHtml(r.codFornec)}">${escHtml(r.codFornec)} 📋</button>`:'—'}</td>
      <td>${fmtDt(r.emissao)}</td><td>${fmtDt(r.vencimento)}</td><td>${fmtDt(r.vencReal)}</td>
      <td class="num" style="white-space:nowrap">${fmtBR(r.valor)}</td><td class="num" style="white-space:nowrap;min-width:130px">${fmtBR(r.saldo)}</td>
      <td><span class="status ${stCls(r.status)}">${r.status}</span></td>
      <td style="text-align:center">${r.natureza?`<button type="button" class="copy-mini" data-natureza="${escHtml(r.natureza)}" onclick="copyNatureza(this)" title="Copiar Natureza: ${escHtml(r.natureza)}">${escHtml(r.natureza)} 📋</button>`:'—'}</td>
      <td>${fmtDt(r.baixa)}</td>
      <td style="max-width:220px;font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.historico}">${r.historico}</td>
      <td class="num">${fmtBR(r.valLiqBaix)}</td>
      <td>${r.numBordero||'—'}</td><td>${fmtDt(r.dtBordero)}</td>
      <td>${fmtDt(r.dtLiberacao)}</td><td>${r.tipoPgto||'—'}</td>
      <td style="font-family:monospace;font-size:11px">${r.cnpj||'—'}</td>
      <td style="text-align:center">${r.uuid?`<button type="button" class="uuid-copy-btn" data-uuid="${escHtml(r.uuid)}" onclick="copyUUID(this)" title="Copiar UUID">📋 Copiar</button>`:'—'}</td>
      <td style="font-size:11px;color:#334155" title="${escHtml(r.usrInc||'')}">${escHtml(splitUserDate(r.usrInc).name)}</td>
      <td style="font-size:11px;color:#64748b">${splitUserDate(r.usrInc).date||'—'}</td>
      <td style="font-size:11px;color:#334155" title="${escHtml(r.usrAlt||'')}">${escHtml(splitUserDate(r.usrAlt).name)}</td>
      <td style="font-size:11px;color:#64748b">${splitUserDate(r.usrAlt).date||'—'}</td>
      <td><div style="display:flex;gap:4px"><button class="ab-pg" onclick="sendPag(${r.id})" title="Enviar para pagamento">💰</button><button class="ab-mn" onclick="openMonitor(${r.id})" title="Monitorar">📌</button></div></td>
    </tr>`).join('');
  document.getElementById('cnt').textContent = `${d.length} de ${DATA.length} títulos`;
  document.getElementById('b-all').textContent = DATA.length;
  document.getElementById('pager').innerHTML = `
    <span class="pg-info">Página ${currentPage}/${totalPages} · exibindo ${pageRows.length} de ${d.length}</span>
    <button class="pg-btn" ${currentPage<=1?'disabled':''} onclick="setPage(1)">« Primeira</button>
    <button class="pg-btn" ${currentPage<=1?'disabled':''} onclick="setPage(${currentPage-1})">‹ Anterior</button>
    <button class="pg-btn" ${currentPage>=totalPages?'disabled':''} onclick="setPage(${currentPage+1})">Próxima ›</button>
    <button class="pg-btn" ${currentPage>=totalPages?'disabled':''} onclick="setPage(${totalPages})">Última »</button>
  `;
  renderAlertsTop();
  updateSelCounter('all');
}

function setPage(p){
  currentPage = p;
  render(false);
}

function renderStatusComparativo(monEntries){
  const wrap = document.getElementById('comparacao-status');
  const tbody = document.getElementById('status-comparativo-body');
  if(!wrap || !tbody) return;
  const statusList = ["Vencido", "A Vencer", "Baixado", "Baixa Parcial"];
  tbody.innerHTML = statusList.map(status=>{
    const qtdTodos = DATA.filter(t=>t.status===status).length;
    const qtdMonitoramento = monEntries.filter(e=>e.r && e.r.status===status).length;
    return `<tr><td>${status}</td><td class="num">${qtdTodos}</td><td class="num">${qtdMonitoramento}</td></tr>`;
  }).join('');
  wrap.style.display = '';
}




function getAberr(){ return DATA.filter(r=>{ if(!r.vencimento) return false; const y=+r.vencimento.slice(0,4); return y>2030; }); }
function getAberrCrit(){ return DATA.filter(r=>{ if(!r.vencimento) return false; const y=+r.vencimento.slice(0,4); return y>3000; }); }


function analisarAberracao(){
  filterAberracao = true;
  sel.emp.clear(); sel.st.clear();
  document.querySelectorAll('#p-all .pill.on').forEach(p=>p.classList.remove('on'));
  tab('all');
  render(true);
  showToast(`🔍 Filtrando títulos com aberração de data (vencimento após 2030)`, 'warn', 4000);
}

function renderAlertsTop(){
  const parc = DATA.filter(r=>r.status==='Baixa Parcial');
  const c180 = DATA.filter(r=>r.atraso>180);
  const fmtLst = a => a.slice(0,3).map(r=>`${r.razao.slice(0,35)}: ${fmtBR(r.saldo)} — ${r.atraso}d`).join(' | ');
  const sum = a => a.reduce((s,r)=>s+r.saldo,0);
  let html = '';
  if(c180.length) html += `<div class="alert"><div><div class="at">⚠ ${c180.length} título(s) SE2 vencidos há +180 dias</div><div class="ad">${fmtLst(c180)}<br><b>Total: ${fmtBR(sum(c180))}</b></div></div><div class="av" onclick="goStatus('Vencido')">→ ver títulos</div></div>`;
  const aberr = getAberr(); if(aberr.length) html += `<div class="alert" style="border-left-color:#7c3aed"><div><div class="at">🚨 ${aberr.length} título(s) com ABERRAÇÃO DE DATA (vencimento após 2030)</div><div class="ad">${aberr.slice(0,3).map(r=>`${r.razao.slice(0,35)}: venc. ${fmtDt(r.vencimento)} — ${fmtBR(r.saldo)}`).join(' | ')}</div></div><div class="av" onclick="analisarAberracao()">→ analisar títulos</div></div>`;
  if(parc.length) html += `<div class="alert info"><div><div class="at">ℹ ${parc.length} título(s) com Baixa Parcial</div><div class="ad">${parc.slice(0,3).map(r=>`${r.razao.slice(0,35)}: ${fmtBR(r.saldo)} — ${r.atraso}d`).join(' | ')}<br><b>Saldo em aberto: ${fmtBR(sum(parc))}</b></div></div><div class="av" onclick="goStatus('Baixa Parcial')">→ ver títulos</div></div>`;
  document.getElementById('alerts-top').innerHTML = html;
}

function goStatus(s){ tab('all'); sel.st.clear(); sel.st.add(s); document.querySelectorAll('[data-st]').forEach(p=>p.classList.toggle('on',p.dataset.st===s)); render(true); }
function tab(t){ if(t==='pag') setTimeout(renderPAG,0); if(t==='mon') setTimeout(renderMON,0); if(t==='new') setTimeout(renderNEW,0); if(t==='pend') setTimeout(renderPEND,0); document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===t)); document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active')); document.getElementById('p-'+t).classList.add('active'); }
function togAll(cb){ document.querySelectorAll('.rcb').forEach(c=>c.checked=cb.checked); updateSelCounter('all'); }

function download(){
  const checked=[...document.querySelectorAll('.rcb:checked')].map(c=>+c.dataset.id);
  const rows = checked.length?DATA.filter(r=>checked.includes(r.id)):filtered();
  if(!rows.length){ alert('Nada para baixar'); return; }
  const cols=['empresa','filial','tipo','num','parcela','razao','fornecedor','emissao','vencimento','vencReal','valor','saldo','status','atraso','baixa','historico','valLiqBaix','numBordero','dtBordero','dtLiberacao','tipoPgto','cnpj','uuid','usrInc','usrAlt'];
  const csv='\ufeff'+cols.join(';')+'\n'+rows.map(r=>cols.map(c=>{let v=r[c]??'';v=String(v).replace(/"/g,'""');return /[;"\n]/.test(v)?`"${v}"`:v;}).join(';')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download='SE2_parcial.csv'; a.click();
}


// ========= MONITORAMENTO & PAGAMENTO =========
// today() já definida acima

// Drag horizontal scroll
(function(){
  document.querySelectorAll('.drag-scroll').forEach(el=>{
    let down=false,sx=0,sl=0;
    el.addEventListener('mousedown',e=>{if(e.target.tagName==='INPUT'||e.target.tagName==='BUTTON'||e.target.tagName==='SELECT'||e.target.tagName==='OPTION')return; down=true; sx=e.pageX-el.offsetLeft; sl=el.scrollLeft; el.style.cursor='grabbing'; e.preventDefault();});
    el.addEventListener('mouseleave',()=>{down=false; el.style.cursor='grab';});
    el.addEventListener('mouseup',()=>{down=false; el.style.cursor='grab';});
    el.addEventListener('mousemove',e=>{if(!down)return; el.scrollLeft=sl-(e.pageX-el.offsetLeft-sx);});
  });
})();


// ========= NOVOS TÍTULOS =========
// Estratégia:
//   1) Se backup.js trouxer "uuids_vistos" (lista da última base publicada),
//      novos = qualquer título cujo UUID NÃO está nessa lista. Este é o caso
//      ideal — compara contra a base anterior, como pediu o usuário.
//   2) Fallback: usa localStorage (comportamento antigo).
//   3) Último recurso: marca como novos os títulos cuja data em usrInc é hoje.
function computeNewTitles(){
  const todayStr = today();
  // 1) Diff contra a base anterior via backup.js
  if(UUIDS_BASE_ANTERIOR && UUIDS_BASE_ANTERIOR.size){
    return DATA.filter(r => {
      const u = String(r.uuid||'').toUpperCase();
      return u && !UUIDS_BASE_ANTERIOR.has(u);
    });
  }
  // 2) Fallback histórico (localStorage) + atualização do registro
  const STORE_IDS = 'se2_seen_ids';
  const STORE_DATE = 'se2_seen_date';
  let newTitles = [];
  try {
    const seenDate = localStorage.getItem(STORE_DATE);
    const seenIdsStr = localStorage.getItem(STORE_IDS);
    const currentIds = DATA.map(r=>r.id);
    if(!seenIdsStr || !seenDate){
      newTitles = DATA.filter(r=>{
        const m = String(r.usrInc||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if(!m) return false;
        const d = `${m[3]}-${m[2]}-${m[1]}`;
        return d >= todayStr;
      });
    } else if(seenDate !== todayStr) {
      const seenIds = JSON.parse(seenIdsStr);
      newTitles = DATA.filter(r=>!seenIds.includes(r.id));
      if(!newTitles.length){
        newTitles = DATA.filter(r=>{
          const m = String(r.usrInc||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if(!m) return false;
          const d = `${m[3]}-${m[2]}-${m[1]}`;
          return d >= todayStr;
        });
      }
    } else {
      const seenIds = JSON.parse(seenIdsStr);
      newTitles = DATA.filter(r=>!seenIds.includes(r.id));
    }
    localStorage.setItem(STORE_IDS, JSON.stringify(currentIds));
    localStorage.setItem(STORE_DATE, todayStr);
  } catch(e){
    // 3) Último recurso
    newTitles = DATA.filter(r=>{
      const m = String(r.usrInc||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if(!m) return false;
      const d = `${m[3]}-${m[2]}-${m[1]}`;
      return d >= todayStr;
    });
  }
  return newTitles;
}

function resetNewSeen(){
  try{ localStorage.removeItem('se2_seen_ids'); localStorage.removeItem('se2_seen_date'); }catch(e){}
  renderNEW();
}

function renderNEW(){
  const raw = computeNewTitles();
  const rows = raw.filter(r=>rowMatchesUserFilters(r,'new-'));
  document.getElementById('b-new').textContent = raw.length;
  const tot = rows.reduce((s,r)=>s+r.saldo,0);
  // Indicador da base de referência (do backup.js)
  const refEl = document.getElementById('new-ref-info');
  if(refEl){
    const modoBackup = UUIDS_BASE_ANTERIOR && UUIDS_BASE_ANTERIOR.size;
    if(modoBackup){
      let dt = '';
      try{
        if(BACKUP.exportadoEm){
          const d = new Date(BACKUP.exportadoEm);
          dt = isNaN(d.getTime()) ? String(BACKUP.exportadoEm) : d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
        }
      }catch(_){ dt = String(BACKUP.exportadoEm||''); }
      refEl.textContent = `Base anterior (backup): ${UUIDS_BASE_ANTERIOR.size} UUIDs${dt?` · ${dt}`:''}`;
    } else {
      refEl.textContent = 'Sem backup.js · usando fallback local (localStorage)';
    }
  }
  document.getElementById('new-stats').innerHTML = rows.length
    ? `<div class="pag-stat" style="border-left-color:#7c3aed"><div class="l">Exibindo (filtros)</div><div class="v" style="color:#7c3aed">${rows.length} / ${raw.length}</div></div>
       <div class="pag-stat" style="border-left-color:#7c3aed"><div class="l">Saldo Total (filtrado)</div><div class="v" style="color:#7c3aed">${fmtBR(tot)}</div></div>`
    : (raw.length ? `<div class="pag-stat" style="border-left-color:#7c3aed"><div class="l">Novos (total)</div><div class="v" style="color:#7c3aed">${raw.length}</div></div><div class="pag-stat"><div class="l">Após filtros</div><div class="v">0</div></div>` : '');
  if(!raw.length){
    document.getElementById('new-list').innerHTML='<div style="text-align:center;padding:40px;color:#64748b">✅ Nenhum título novo identificado em relação à sessão anterior.</div>';
    return;
  }
  if(!rows.length){
    document.getElementById('new-list').innerHTML='<div style="text-align:center;padding:40px;color:#64748b">Nenhum título corresponde aos filtros atuais. Ajuste UUID / usuários ou limpe os filtros.</div>';
    return;
  }
  const head=`<tr>
    <th>EMPRESA</th><th>TIPO</th><th>Nº TÍTULO</th><th>PARC.</th>
    <th>RAZÃO SOCIAL</th><th>FORNECEDOR</th>
    <th style="background:#f0fdf4;color:#15803d">CÓD. FORNEC.</th>
    <th>EMISSÃO</th><th>VENCIMENTO</th><th>VENC. REAL</th>
    <th class="num">VALOR</th><th class="num">SALDO</th>
    <th>STATUS</th><th style="background:#f0fdf4;color:#15803d">NATUREZA</th>
    <th style="background:#fef2f2;color:#991b1b">ATRASO</th>
    <th>HISTÓRICO</th>
    <th>UUID</th><th>NOME INC</th><th>DATA INC</th><th>NOME ALT</th><th>DATA ALT</th>
    <th>AÇÕES</th></tr>`;
  const body=rows.map(r=>{
    const i=splitUserDate(r.usrInc), alt=splitUserDate(r.usrAlt);
    return `<tr style="background:#faf5ff">
      <td class="filemp" style="white-space:nowrap">${r.empresa||r.filial}</td>
      <td>${r.tipo}</td><td>${r.num}</td><td>${r.parcela||'—'}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.razao}">${r.razao}</td>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px">${r.fornecedor}</td>
      <td style="text-align:center">${r.codFornec?`<button type="button" class="copy-mini" data-codfornec="${escHtml(r.codFornec)}" onclick="copyFornec(this)" title="Copiar Cód. Fornecedor: ${escHtml(r.codFornec)}">${escHtml(r.codFornec)} 📋</button>`:'—'}</td>
      <td>${fmtDt(r.emissao)}</td><td>${fmtDt(r.vencimento)}</td><td>${fmtDt(r.vencReal)}</td>
      <td class="num" style="white-space:nowrap">${fmtBR(r.valor)}</td>
      <td class="num" style="white-space:nowrap">${fmtBR(r.saldo)}</td>
      <td><span class="status ${stCls(r.status)}">${r.status}</span></td>
      <td style="text-align:center">${r.natureza?`<button type="button" class="copy-mini" data-natureza="${escHtml(r.natureza)}" onclick="copyNatureza(this)" title="Copiar Natureza: ${escHtml(r.natureza)}">${escHtml(r.natureza)} 📋</button>`:'—'}</td>
      <td class="atraso"><span class="${atrCls(r.atraso)}">${r.atraso||'—'}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#64748b" title="${r.historico}">${r.historico}</td>
      <td style="text-align:center;white-space:nowrap;font-size:13px">${r.uuid?`<button type="button" class="uuid-copy-btn" data-uuid="${escHtml(r.uuid)}" onclick="copyUUID(this)" title="Copiar UUID">📋</button>`:'—'}</td>
      <td style="font-size:11px;color:#334155">${escHtml(i.name)}</td>
      <td style="font-size:11px;color:#64748b;background:#ede9fe">${i.date||'—'}</td>
      <td style="font-size:11px;color:#334155">${escHtml(alt.name)}</td>
      <td style="font-size:11px;color:#64748b">${alt.date||'—'}</td>
      <td><div style="display:flex;gap:4px"><button class="ab-pg" onclick="sendPag(${r.id})" title="Enviar para pagamento">💰</button><button class="ab-mn" onclick="openMonitor(${r.id})" title="Monitorar">📌</button></div></td>
    </tr>`;
  }).join('');
  document.getElementById('new-list').innerHTML=`<div class="drag-scroll" style="overflow-x:auto;cursor:grab;user-select:none"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  applyDrag('#p-new');
}

// =====================================================
// ===== AUTO-REFRESH: atualiza dados sem F5 manual =====
// =====================================================
const AUTO_REFRESH = {
  intervalId: null,
  active: false,
  seconds: 30,
  lastFingerprint: null,
  refreshCount: 0,

  fingerprint(){
    const n = DATA.length;
    const upd = String(BOOT.updatedAt || '');
    const soma = DATA.reduce((s, r) => s + (r.saldo || 0), 0);
    return `${upd}|${n}|${soma.toFixed(2)}`;
  },

  async poll(){
    try {
      const oldFP = this.fingerprint();
      // Salva estado atual da sessão (em memória) antes de recarregar assets
      const sessionState = _buildUUIDState();
      const sessionManuais = titulosManuais.slice();
      await refreshPublishedAssets();
      const newFP = this.fingerprint();
      if(newFP !== oldFP){
        // Injeta estado da sessão no BACKUP para preservar alterações feitas pelo usuário
        BACKUP.pagamentos_uuid = sessionState.pagUUID;
        BACKUP.monitored_uuid = sessionState.monUUID;
        BACKUP.titulosManuais = sessionManuais;
        restaurarEstado();
        populateFilialFilter();
        populateEmps('pag');
        populateEmps('mon');
        applyBootMeta();
        render();
        renderPAG();
        renderMON();
        renderNEW();
        this.refreshCount++;
        showToast('🔄 Dados atualizados automaticamente!', 'info', 3000);
        console.log(`[Auto-Refresh] Mudança detectada. Refresh #${this.refreshCount}`);
      }
      this.lastFingerprint = newFP;
    } catch(err) {
      console.warn('[Auto-Refresh] Erro no polling:', err);
    }
  },

  start(seconds){
    if(seconds) this.seconds = seconds;
    this.stop();
    this.active = true;
    this.lastFingerprint = this.fingerprint();
    this.intervalId = setInterval(() => this.poll(), this.seconds * 1000);
    this.savePreference();
    this.updateUI();
  },

  stop(){
    this.active = false;
    if(this.intervalId){ clearInterval(this.intervalId); this.intervalId = null; }
    this.savePreference();
    this.updateUI();
  },

  toggle(){
    if(this.active) this.stop();
    else this.start(this.seconds);
  },

  setInterval(seconds){
    this.seconds = seconds;
    if(this.active) this.start(seconds);
    else this.savePreference();
    this.updateUI();
  },

  async forceRefresh(){
    showToast('🔄 Atualizando...', 'info', 1500);
    await this.poll();
  },

  savePreference(){
    try {
      localStorage.setItem('se2_autorefresh', JSON.stringify({
        active: this.active,
        seconds: this.seconds
      }));
    } catch(_){}
  },

  loadPreference(){
    try {
      const raw = localStorage.getItem('se2_autorefresh');
      if(raw){
        const p = JSON.parse(raw);
        if(p.seconds) this.seconds = p.seconds;
        if(p.active) this.start(p.seconds || this.seconds);
      }
    } catch(_){}
    this.updateUI();
  },

  updateUI(){
    const btn = document.getElementById('ar-toggle');
    const sel = document.getElementById('ar-interval');
    const dot = document.getElementById('ar-dot');
    if(btn) btn.textContent = this.active ? '⏸' : '▶';
    if(btn) btn.title = this.active ? 'Pausar auto-refresh' : 'Iniciar auto-refresh';
    if(sel) sel.value = String(this.seconds);
    if(dot) dot.style.background = this.active ? '#22c55e' : '#94a3b8';
  },

  injectUI(){
    const hdate = document.querySelector('.hdate');
    if(!hdate || document.getElementById('ar-box')) return;
    const box = document.createElement('div');
    box.id = 'ar-box';
    box.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';
    box.innerHTML = `
      <span id="ar-dot" style="width:8px;height:8px;border-radius:50%;background:#94a3b8;flex-shrink:0" title="Status auto-refresh"></span>
      <span style="font-size:10px;color:#a0aec0;font-weight:600;letter-spacing:.4px;text-transform:uppercase">Auto</span>
      <button id="ar-toggle" onclick="AUTO_REFRESH.toggle()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:6px;color:#fff;font-size:13px;padding:3px 8px;cursor:pointer;line-height:1" title="Iniciar auto-refresh">▶</button>
      <select id="ar-interval" onchange="AUTO_REFRESH.setInterval(+this.value)" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:6px;color:#fff;font-size:11px;padding:3px 6px;cursor:pointer">
        <option value="15">15s</option>
        <option value="30" selected>30s</option>
        <option value="60">1 min</option>
        <option value="120">2 min</option>
        <option value="300">5 min</option>
      </select>
      <button onclick="AUTO_REFRESH.forceRefresh()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:6px;color:#fff;font-size:13px;padding:3px 8px;cursor:pointer;line-height:1" title="Atualizar agora">🔄</button>
    `;
    hdate.parentElement.appendChild(box);
    this.updateUI();
  }
};

// =====================================================
// ===== BOTÃO: Copiar comando Python p/ terminal ======
// =====================================================
function copyPythonCmd(){
  const cmd = 'python "C:\\Users\\lucas\\Downloads\\se2 - sistema\\atualizar.py"';
  const ok = () => showToast('📋 Comando copiado! Cole no terminal (CMD) e pressione Enter.', 'ok', 4000);
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(cmd).then(ok).catch(()=>{});
  } else {
    const ta=document.createElement('textarea'); ta.value=cmd; document.body.appendChild(ta); ta.select();
    try{document.execCommand('copy');}catch(e){} ta.remove(); ok();
  }
}

// Inicializar auto-refresh e botão Python após o bootstrap
document.addEventListener('se2:ready', () => {
  AUTO_REFRESH.injectUI();
  AUTO_REFRESH.loadPreference();

  // Injeta botão "Rodar Python" no header
  const headerBtns = document.querySelector('.header > div:last-child');
  if(headerBtns && !document.getElementById('btn-python')){
    const btn = document.createElement('button');
    btn.id = 'btn-python';
    btn.innerHTML = '🐍 Copiar Comando Python';
    btn.title = 'Copia o comando para rodar atualizar.py no terminal';
    btn.style.cssText = 'background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.28);border-radius:8px;color:#fff;font-size:12px;font-weight:600;padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;font-family:inherit;transition:.15s';
    btn.onmouseover = function(){ this.style.background='rgba(255,255,255,.22)'; };
    btn.onmouseout = function(){ this.style.background='rgba(255,255,255,.13)'; };
    btn.onclick = copyPythonCmd;
    headerBtns.insertBefore(btn, headerBtns.firstChild);
  }
}, { once: true });

// ===== ABA PENDÊNCIAS =====
(function(){
const _pendencias = [];
let _pendIdCounter = 1;
const localISODate = ()=>{
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};

function _loadPendencias(){
  _pendencias.length = 0;
  _pendIdCounter = 1;
  const bk = window.__SE2_BACKUP__;
  if(bk && Array.isArray(bk.pendencias)){
    bk.pendencias.forEach(p => {
      _pendencias.push({...p});
      if(p.id >= _pendIdCounter) _pendIdCounter = p.id + 1;
    });
  }
}

function _savePendencias(){
  // Atualiza BACKUP em memória para que salvarBackupJS inclua pendências
  if(!window.__SE2_BACKUP__) window.__SE2_BACKUP__ = {};
  window.__SE2_BACKUP__.pendencias = _pendencias.slice();
}

window.addPendencia = function(){
  const inp = document.getElementById('pend-input');
  const txt = (inp.value||'').trim();
  if(!txt){ return; }
  _pendencias.push({
    id: _pendIdCounter++,
    texto: txt,
    criado: localISODate(),
    concluido: null
  });
  inp.value = '';
  _savePendencias();
  renderPEND();
};

window.togglePendencia = function(id){
  const p = _pendencias.find(x=>x.id===id);
  if(!p) return;
  if(p.concluido){
    p.concluido = null;
  } else {
    p.concluido = localISODate();
  }
  _savePendencias();
  renderPEND();
};

window.deletePendencia = function(id){
  const idx = _pendencias.findIndex(x=>x.id===id);
  if(idx<0) return;
  _pendencias.splice(idx,1);
  _savePendencias();
  renderPEND();
};

function fmtDtBR(d){ if(!d) return ''; const p=d.split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d; }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

window.renderPEND = function(){
  const total = _pendencias.length;
  const concluidas = _pendencias.filter(p=>p.concluido).length;
  const pendentes = total - concluidas;
  const el = id => document.getElementById(id);
  if(el('pend-total')) el('pend-total').textContent = total;
  if(el('pend-pendentes')) el('pend-pendentes').textContent = pendentes;
  if(el('pend-concluidas')) el('pend-concluidas').textContent = concluidas;
  if(el('b-pend')) el('b-pend').textContent = pendentes;
  const list = el('pend-list');
  if(!list) return;
  if(!total){
    list.innerHTML = '<div class="pend-empty">Nenhuma pendência cadastrada.</div>';
    return;
  }
  // Pendentes primeiro, depois concluídas (mais recentes primeiro)
  const sorted = _pendencias.slice().sort((a,b)=>{
    if(!!a.concluido !== !!b.concluido) return a.concluido ? 1 : -1;
    return b.id - a.id;
  });
  list.innerHTML = sorted.map(p => `
    <div class="pend-item${p.concluido?' done':''}">
      <input type="checkbox" class="pend-check" ${p.concluido?'checked':''} onchange="togglePendencia(${p.id})">
      <div class="pend-text">${esc(p.texto)}</div>
      <span class="pend-date" title="Criado em">📅 ${fmtDtBR(p.criado)}</span>
      ${p.concluido?`<span class="pend-done-date" title="Concluído em">✅ ${fmtDtBR(p.concluido)}</span>`:''}
      <button class="pend-del" onclick="deletePendencia(${p.id})">🗑 Excluir</button>
    </div>
  `).join('');
};

window.getPendenciasEstado = function(){
  return _pendencias.slice();
};

// Carrega pendências na inicialização
document.addEventListener('DOMContentLoaded', ()=>{
  _loadPendencias();
  renderPEND();
});
document.addEventListener('se2:ready', ()=>{
  _loadPendencias();
  renderPEND();
});
})();
