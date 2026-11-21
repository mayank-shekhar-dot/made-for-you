/* Arpita & Mayank Love ♡  (Vercel + Supabase version)
   Everything runs in the browser. Supabase keeps the chat, files and live updates. */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const cfg = window.LOVE_CONFIG || {};
const BUCKET = 'love';
const URL_TTL = 43200;                       // photo/video links stay valid for 12 hours
const EMAIL = { Arpita: 'arpita@example.com', Mayank: 'mayank@example.com' };
const QUICK = ['❤️', '😂', '😮', '😢', '👍', '🙏', '🔥', '🥰'];   // must match setup.sql
const SOS_URL = 'https://ncert.nic.in/textbook/pdf/jemh1ps.pdf';
const EMERGENCY_LOGOUT = false;              // true = also log out when pressing the emergency button
const MAX_IMG = 10 * 1024 * 1024, MAX_VID = 50 * 1024 * 1024;

const state = {
  me: null, other: null, byName: {}, byId: {}, urls: new Map(),
  messages: [], reactions: {}, oldest: null, hasMore: false, epoch: null,
  tab: 'chat', unread: 0, otherOnline: false, lastSeen: null, otherTyping: false,
  typingHide: null, typingSent: false, typingTimer: null, pendingFiles: [], editing: null,
  memFile: null, db: null, room: null, pingT: null, loadedOnce: false, fallbackT: null,
};
let sb = null;

// ---------------------------------------------------------------- helpers
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3200);
}
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayLabel(iso) {
  const d = new Date(iso), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}
function lastSeenText(iso) {
  if (!iso) return 'offline';
  const d = new Date(iso), t = fmtTime(iso);
  if (d.toDateString() === new Date().toDateString()) return `last seen today at ${t}`;
  return `last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${t}`;
}
function show(id) {
  ['welcome', 'login', 'app'].forEach(v => $('#' + v).classList.toggle('hidden', v !== id));
  $('#themeFloat').classList.toggle('hidden', id === 'app');
}
const errText = e => (e && e.message) ? e.message : 'Kuch gadbad ho gayi. Dobara try karo.';

// signed links for private files
const urlOf = p => { const e = state.urls.get(p); return e && e.exp > Date.now() ? e.url : ''; };
async function signPaths(paths) {
  const need = [...new Set(paths.filter(Boolean))].filter(p => !urlOf(p));
  if (!need.length) return;
  for (let i = 0; i < need.length; i += 100) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), URL_TTL);
    (data || []).forEach(d => { if (d && d.signedUrl) state.urls.set(d.path, { url: d.signedUrl, exp: Date.now() + (URL_TTL - 300) * 1000 }); });
  }
}
async function resign(el, path) {
  if (el.dataset.retry) return;
  el.dataset.retry = '1'; state.urls.delete(path);
  try { await signPaths([path]); if (urlOf(path)) el.src = urlOf(path); } catch (e) { /* ignore */ }
}

function fillAvatar(el) {
  const name = el.dataset.user; el.textContent = '';
  const p = state.byName[name], url = p && p.avatar_path ? urlOf(p.avatar_path) : '';
  if (url) {
    const img = new Image(); img.src = url; img.alt = name;
    img.addEventListener('error', () => { el.textContent = name[0]; });
    el.appendChild(img);
  } else el.textContent = name ? name[0] : '';
}
async function refreshAvatars() {
  try { await signPaths(Object.values(state.byName).map(p => p.avatar_path)); } catch (e) { /* ignore */ }
  $$('.avatar[data-user]').forEach(fillAvatar);
}

// ------------------------------------------------------- floating hearts
function floatHeart() {
  if (document.hidden) return;
  const h = document.createElement('span');
  h.className = 'fl';
  h.textContent = ['♡', '♥', '✦', '✧', '❀'][Math.floor(Math.random() * 5)];
  h.style.left = Math.random() * 100 + 'vw';
  h.style.fontSize = 12 + Math.random() * 22 + 'px';
  h.style.animationDuration = 9 + Math.random() * 8 + 's';
  h.style.color = ['var(--h1)', 'var(--h2)', 'var(--h3)', 'var(--h1)'][Math.floor(Math.random() * 4)];
  $('#hearts').appendChild(h);
  h.addEventListener('animationend', () => h.remove());
}
setInterval(floatHeart, 1400);
for (let i = 0; i < 5; i++) setTimeout(floatHeart, i * 300);
function burst(el) {
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('span');
    s.className = 'burst'; s.textContent = '♡';
    s.style.left = r.left + r.width / 2 + 'px'; s.style.top = r.top + 'px';
    s.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
    s.style.setProperty('--dy', -(40 + Math.random() * 70) + 'px');
    s.style.fontSize = 12 + Math.random() * 12 + 'px';
    document.body.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }
}

// ------------------------------------------------------------ day / night
function applyTheme(t, animate) {
  const root = document.documentElement;
  if (animate) { root.classList.add('theme-anim'); setTimeout(() => root.classList.remove('theme-anim'), 600); }
  root.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch (e) { /* ignore */ }
  const night = t === 'dark';
  $$('.theme-toggle').forEach(b => { b.textContent = night ? '☀️' : '🌙'; b.title = night ? 'Switch to day' : 'Switch to night'; });
  $('#themeMeta').setAttribute('content', night ? '#14110e' : '#fbf8f3');
}
$$('.theme-toggle').forEach(b => b.addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true)));
applyTheme(document.documentElement.dataset.theme || 'light', false);

// ---------------------------------------------------------- welcome/login
$('#enterBtn').addEventListener('click', () => show('login'));
$('#backBtn').addEventListener('click', () => show('welcome'));
$('#pwToggle').addEventListener('click', () => { const p = $('#pw'); p.type = p.type === 'password' ? 'text' : 'password'; });
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const who = $('input[name=who]:checked'), err = $('#loginErr'); err.textContent = '';
  if (!who) { err.textContent = 'Pehle apna naam chuno.'; return; }
  const btn = $('#loginBtn'); btn.disabled = true;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL[who.value], password: $('#pw').value });
    if (error) throw new Error(/rate|too many/i.test(error.message) ? 'Bahut baar try kiya, thodi der baad aana ♡' : 'Password sahi nahi hai.');
    $('#pw').value = '';
    await startSession(data.user);
  } catch (ex) { err.textContent = errText(ex); }
  btn.disabled = false;
});

async function startSession(user) {
  const { data: profs, error } = await sb.from('profiles').select('*');
  const mine = (profs || []).find(p => p.id === user.id);
  const theirs = (profs || []).find(p => p.id !== user.id);
  if (error || !mine) { await sb.auth.signOut(); throw new Error('Ye account is chat ka hissa nahi hai.'); }
  if (!theirs) { await sb.auth.signOut(); throw new Error('Doosra account abhi bana nahi hai (README ka step 3 dekho).'); }
  state.byName = {}; state.byId = {};
  profs.forEach(p => { state.byName[p.name] = p; state.byId[p.id] = p; });
  state.me = { id: mine.id, name: mine.name }; state.other = { id: theirs.id, name: theirs.name };
  await enterApp();
}

function stopRealtime() {
  clearInterval(state.pingT); clearTimeout(state.fallbackT);
  try { sb.removeAllChannels(); } catch (e) { /* ignore */ }
  state.db = null; state.room = null;
}
function goLogin() {
  stopRealtime();
  Object.assign(state, { me: null, other: null, messages: [], reactions: {}, oldest: null, unread: 0, loadedOnce: false, editing: null });
  $('#msgList').textContent = ''; $('#gallery').textContent = '';
  show('login');
}
$('#logoutBtn').addEventListener('click', async () => {
  try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
  goLogin();
});

async function enterApp() {
  $('#otherName').textContent = state.other.name;
  $('#otherAvatar').dataset.user = state.other.name;
  $('#meBtn').dataset.user = state.me.name;
  $('#profileAvatar').dataset.user = state.me.name;
  state.otherOnline = false; state.otherTyping = false;
  state.lastSeen = state.byName[state.other.name].last_seen;
  updateStatus(); switchTab('chat'); show('app');
  refreshAvatars();
  try { const { data } = await sb.from('chat_meta').select('epoch').eq('id', 1).maybeSingle(); state.epoch = data && data.epoch; } catch (e) { /* ignore */ }
  connectRealtime();
  state.fallbackT = setTimeout(() => { if (!state.loadedOnce) loadMessages(true); }, 4000);
  startPing();
}

function updateStatus() {
  const st = $('#status');
  st.classList.toggle('on', state.otherOnline);
  st.classList.toggle('typing', state.otherTyping);
  $('span', st).textContent = state.otherTyping ? 'typing…' : state.otherOnline ? 'online' : lastSeenText(state.lastSeen);
  $('#typingRow').classList.toggle('hidden', !state.otherTyping);
  if (state.otherTyping) scrollBottom(true);
}
function setConn(ok) { $('#conn').classList.toggle('hidden', ok); }

function startPing() {
  clearInterval(state.pingT);
  const ping = () => {
    if (!state.me || document.hidden) return;
    sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', state.me.id).then(() => {}, () => {});
  };
  ping(); state.pingT = setInterval(ping, 60000);
}

// --------------------------------------------------------------- realtime
function connectRealtime() {
  stopRealtime();
  state.db = sb.channel('db-' + state.me.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onInsert(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, p => onUpdate(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, p => {
      const mid = (p.new && p.new.message_id) || (p.old && p.old.message_id); if (mid) refreshReactions(mid);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memories' }, () => { if (state.tab === 'memories') loadMemories(); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_meta' }, p => onCleared(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, p => onProfile(p.new))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') { setConn(true); loadMessages(true); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConn(false);
    });

  state.room = sb.channel('love-room', { config: { private: true, presence: { key: state.me.name } } })
    .on('presence', { event: 'sync' }, () => {
      const was = state.otherOnline, s = state.room.presenceState();
      state.otherOnline = !!(s[state.other.name] && s[state.other.name].length);
      if (was && !state.otherOnline) { state.lastSeen = new Date().toISOString(); state.otherTyping = false; }
      updateStatus();
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.name !== state.other.name) return;
      state.otherTyping = !!payload.typing;
      clearTimeout(state.typingHide);
      if (payload.typing) state.typingHide = setTimeout(() => { state.otherTyping = false; updateStatus(); }, 5000);
      updateStatus();
    })
    .subscribe(status => { if (status === 'SUBSCRIBED') state.room.track({ at: Date.now() }); });
}

function onProfile(p) {
  state.byId[p.id] = { ...state.byId[p.id], ...p }; state.byName[p.name] = state.byId[p.id];
  if (p.id === state.other.id && !state.otherOnline) { state.lastSeen = p.last_seen; updateStatus(); }
  refreshAvatars();
}
function onCleared(meta) {
  if (!meta || meta.epoch === state.epoch) return;
  state.epoch = meta.epoch;
  clearLocal();
  if (meta.cleared_by !== state.me.id) toast(`${state.other.name} ne chat clear kar di ♡`);
}
function clearLocal() {
  state.messages = []; state.reactions = {}; state.oldest = null; state.hasMore = false; state.unread = 0;
  $('#msgList').textContent = ''; $('#olderBtn').classList.add('hidden'); updateBadge();
}

// --------------------------------------------------------------- messages
const chatVisible = () => state.tab === 'chat' && !document.hidden;
function markSeen() {
  if (!state.me) return;
  (chatVisible() ? sb.rpc('mark_read') : sb.rpc('mark_delivered')).then(() => {}, () => {});
}

function norm(r) {
  const sp = state.byId[r.sender];
  const files = Array.isArray(r.attachments) ? r.attachments.filter(a => a && a.path).map(a => ({ path: a.path, kind: a.kind })) : [];
  return { id: r.id, sender: sp ? sp.name : '?', body: r.body || '', files, created_at: r.created_at,
    delivered_at: r.delivered_at, read_at: r.read_at, edited_at: r.edited_at, reactions: state.reactions[r.id] || {} };
}
async function loadReactions(ids) {
  if (!ids.length) return;
  const { data } = await sb.from('reactions').select('*').in('message_id', ids);
  (data || []).forEach(r => {
    const p = state.byId[r.user_id]; if (!p) return;
    state.reactions[r.message_id] = state.reactions[r.message_id] || {};
    state.reactions[r.message_id][p.name] = r.emoji;
  });
}
async function prepare(rows) {
  await loadReactions(rows.map(r => r.id));
  const msgs = rows.map(norm);
  try { await signPaths(msgs.flatMap(m => m.files.map(f => f.path))); } catch (e) { /* ignore */ }
  return msgs;
}

async function loadMessages(reset) {
  try {
    let q = sb.from('messages').select('*').order('id', { ascending: false }).limit(60);
    if (!reset && state.oldest) q = q.lt('id', state.oldest);
    const { data, error } = await q;
    if (error) throw error;
    const msgs = await prepare(data.reverse());
    state.messages = reset ? msgs : [...msgs, ...state.messages];
    state.hasMore = data.length === 60;
    state.oldest = state.messages.length ? state.messages[0].id : null;
    state.loadedOnce = true;
    renderAll(reset);
    if (reset) { state.unread = 0; updateBadge(); markSeen(); }
  } catch (e) { toast(errText(e)); }
}
$('#olderBtn').addEventListener('click', () => loadMessages(false));

async function onInsert(row) {
  if (state.messages.some(x => x.id === row.id)) return;
  const [m] = await prepare([row]);
  if (state.messages.some(x => x.id === m.id)) return;
  addMessage(m);
  if (m.sender !== state.me.name) {
    if (chatVisible()) markSeen(); else { state.unread++; updateBadge(); markSeen(); }
  }
}
function onUpdate(row) {
  const m = state.messages.find(x => x.id === row.id); if (!m) return;
  if (row.body !== m.body || row.edited_at !== m.edited_at) applyEdit({ id: m.id, body: row.body, edited_at: row.edited_at });
  m.delivered_at = row.delivered_at; m.read_at = row.read_at; patchTicks(m);
}
async function refreshReactions(mid) {
  const m = state.messages.find(x => x.id === mid); if (!m) return;
  const { data } = await sb.from('reactions').select('*').eq('message_id', mid);
  const map = {};
  (data || []).forEach(r => { const p = state.byId[r.user_id]; if (p) map[p.name] = r.emoji; });
  state.reactions[mid] = map; m.reactions = map;
  const row = $(`.row[data-id="${mid}"]`); if (row) fillReacts(row, m);
}

function tickInfo(m) {
  if (m.read_at) return ['✓✓', 'seen', 'Seen'];
  if (m.delivered_at) return ['✓✓', 'delivered', 'Delivered'];
  return ['✓', 'sent', 'Sent'];
}
function patchTicks(m) {
  const tk = $(`.row[data-id="${m.id}"] .tick`);
  if (tk) { const [txt, cls, title] = tickInfo(m); tk.textContent = txt; tk.className = `tick ${cls}`; tk.title = title; }
}

function buildMessage(m, prev) {
  const frag = document.createDocumentFragment();
  if (!prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)) {
    const d = document.createElement('div'); d.className = 'day';
    const sp = document.createElement('span'); sp.textContent = dayLabel(m.created_at);
    d.appendChild(sp); frag.appendChild(d);
  }
  frag.appendChild(buildRow(m, prev));
  return frag;
}
function buildFile(f, bubble) {
  let el;
  const url = urlOf(f.path);
  if (f.kind === 'video') {
    el = document.createElement('video'); el.controls = true; el.preload = 'metadata'; el.playsInline = true; el.src = url;
    el.addEventListener('loadedmetadata', () => { if (bubble.dataset.stick) scrollBottom(true); });
  } else if (f.kind === 'audio') {
    el = document.createElement('audio'); el.controls = true; el.preload = 'metadata'; el.src = url;
  } else {
    el = new Image(); el.src = url; el.alt = 'Shared photo'; el.loading = 'lazy'; el.className = 'media-img';
    el.addEventListener('click', () => openLightbox(urlOf(f.path) || el.src));
    el.addEventListener('load', () => { if (bubble.dataset.stick) scrollBottom(true); });
  }
  el.addEventListener('error', () => resign(el, f.path));
  return el;
}
function buildRow(m, prev) {
  const mine = m.sender === state.me.name;
  const cont = prev && prev.sender === m.sender && dayLabel(prev.created_at) === dayLabel(m.created_at)
    && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60000;
  const row = document.createElement('div');
  row.className = `row ${mine ? 'mine' : 'theirs'}${cont ? ' cont' : ''}`;
  row.dataset.id = m.id;
  const av = document.createElement('div'); av.className = 'avatar'; av.dataset.user = m.sender; fillAvatar(av);
  const wrap = document.createElement('div'); wrap.className = 'bwrap';
  const b = document.createElement('div'); b.className = `bubble ${m.sender}`;
  if (m.files.length) {
    const g = document.createElement('div'); g.className = 'media' + (m.files.length > 1 ? ' multi' : '');
    m.files.forEach(f => g.appendChild(buildFile(f, b)));
    b.appendChild(g);
    if (m.files.some(f => f.kind !== 'image')) b.classList.add('wide');
  }
  if (m.body) { const t = document.createElement('div'); t.className = 'txt'; t.textContent = m.body; b.appendChild(t); }
  const meta = document.createElement('div'); meta.className = 'meta';
  if (m.edited_at) { const e = document.createElement('span'); e.className = 'edited'; e.textContent = 'edited'; meta.appendChild(e); }
  const time = document.createElement('span'); time.textContent = fmtTime(m.created_at); meta.appendChild(time);
  if (mine) {
    const [txt, cls, title] = tickInfo(m);
    const tk = document.createElement('span'); tk.className = `tick ${cls}`; tk.textContent = txt; tk.title = title; meta.appendChild(tk);
  }
  b.appendChild(meta);
  b.addEventListener('click', e => { if (e.target.closest('img,video,audio')) return; e.stopPropagation(); openMenu(m.id, b); });
  const rc = document.createElement('div'); rc.className = 'reacts';
  wrap.append(b, rc); row.append(av, wrap);
  fillReacts(row, m);
  return row;
}
function renderAll(toBottom) {
  const box = $('#messages'), list = $('#msgList'), prevH = box.scrollHeight;
  list.textContent = '';
  state.messages.forEach((m, i) => list.appendChild(buildMessage(m, state.messages[i - 1])));
  $('#olderBtn').classList.toggle('hidden', !state.hasMore);
  if (toBottom) scrollBottom(false); else box.scrollTop = box.scrollHeight - prevH;
}
function scrollBottom(smooth) {
  const box = $('#messages'); box.style.scrollBehavior = smooth ? 'smooth' : 'auto'; box.scrollTop = box.scrollHeight;
}
function addMessage(m) {
  if (state.messages.some(x => x.id === m.id)) return;
  const box = $('#messages'), near = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  const prev = state.messages[state.messages.length - 1];
  state.messages.push(m);
  const frag = buildMessage(m, prev);
  const bub = $('.bubble', frag); if (near || m.sender === state.me.name) bub.dataset.stick = '1';
  $('#msgList').appendChild(frag);
  state.otherTyping = false; updateStatus();
  if (near || m.sender === state.me.name) scrollBottom(true);
}
function updateBadge() { const b = $('#unread'); b.textContent = state.unread; b.classList.toggle('hidden', state.unread === 0); }

// ---------------------------------------- reactions + edit (message menu)
function fillReacts(row, m) {
  const rc = $('.reacts', row); rc.textContent = '';
  const counts = {};
  Object.values(m.reactions || {}).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
  Object.entries(counts).forEach(([e, n]) => { const s = document.createElement('span'); s.textContent = n > 1 ? `${e} ${n}` : e; rc.appendChild(s); });
  rc.title = Object.entries(m.reactions || {}).map(([u, e]) => `${u}: ${e}`).join('   ');
  row.classList.toggle('has-react', rc.children.length > 0);
}
function applyEdit({ id, body, edited_at }) {
  const m = state.messages.find(x => x.id === id); if (!m) return;
  m.body = body; m.edited_at = edited_at;
  const row = $(`.row[data-id="${id}"]`); if (!row) return;
  const b = $('.bubble', row), meta = $('.meta', b);
  let t = $('.txt', b);
  if (!t) { t = document.createElement('div'); t.className = 'txt'; b.insertBefore(t, meta); }
  t.textContent = body;
  if (!$('.edited', meta)) { const e = document.createElement('span'); e.className = 'edited'; e.textContent = 'edited'; meta.prepend(e); }
}
function closeMenu() { $('#msgMenu').classList.add('hidden'); }
function openMenu(id, bubble) {
  const m = state.messages.find(x => x.id === id); if (!m) return;
  const menu = $('#msgMenu'); menu.textContent = '';
  const em = document.createElement('div'); em.className = 'em';
  QUICK.forEach(e => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = e;
    if ((m.reactions || {})[state.me.name] === e) b.classList.add('on');
    b.addEventListener('click', async ev => {
      ev.stopPropagation(); closeMenu();
      const { error } = await sb.rpc('react', { p_message_id: m.id, p_emoji: e });
      if (error) toast(errText(error)); else refreshReactions(m.id);
    });
    em.appendChild(b);
  });
  menu.appendChild(em);
  if (m.sender === state.me.name) {
    const eb = document.createElement('button'); eb.type = 'button'; eb.className = 'act'; eb.textContent = '✏️ Message edit karo';
    eb.addEventListener('click', ev => { ev.stopPropagation(); closeMenu(); startEdit(m); });
    menu.appendChild(eb);
  }
  menu.style.visibility = 'hidden'; menu.classList.remove('hidden');
  const r = bubble.getBoundingClientRect(), w = menu.offsetWidth, hgt = menu.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  let top = r.top - hgt - 8;
  if (top < 70) top = Math.min(r.bottom + 8, window.innerHeight - hgt - 8);
  menu.style.left = left + 'px'; menu.style.top = top + 'px'; menu.style.visibility = '';
}
document.addEventListener('click', closeMenu);
$('#msgMenu').addEventListener('click', e => e.stopPropagation());
$('#messages').addEventListener('scroll', closeMenu, { passive: true });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

// -------------------------------------------------------------- composer
const input = $('#input');
function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 130) + 'px'; }
function sendTyping(typing) {
  if (state.room) state.room.send({ type: 'broadcast', event: 'typing', payload: { name: state.me.name, typing } }).catch(() => {});
}
input.addEventListener('input', () => {
  autoGrow();
  if (!state.typingSent) { sendTyping(true); state.typingSent = true; }
  clearTimeout(state.typingTimer); state.typingTimer = setTimeout(stopTyping, 1800);
});
function stopTyping() {
  clearTimeout(state.typingTimer);
  if (state.typingSent) sendTyping(false);
  state.typingSent = false;
}
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); $('#composer').requestSubmit(); }
});

async function insertMessage(body, attachments) {
  const row = { body };
  if (attachments && attachments.length) row.attachments = attachments;
  const { data, error } = await sb.from('messages').insert(row).select().single();
  if (error) throw error;
  const [m] = await prepare([data]);
  addMessage(m);
}

$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  const body = input.value.trim(), sendBtn = $('#sendBtn');
  if (state.editing) {
    const id = state.editing, m = state.messages.find(x => x.id === id);
    if (!body) { toast('Message khali nahi ho sakta'); return; }
    if (m && m.body === body) { cancelEdit(); return; }
    const { error } = await sb.rpc('edit_message', { p_id: id, p_body: body });
    if (error) { toast(errText(error)); return; }
    applyEdit({ id, body, edited_at: new Date().toISOString() });
    cancelEdit(); stopTyping(); return;
  }
  if (state.pendingFiles.length) {
    sendBtn.disabled = true; toast('Bhej rahe hain…');
    try { await sendMedia(state.pendingFiles, body, false); clearPending(); input.value = ''; autoGrow(); burst(sendBtn); }
    catch (ex) { toast(errText(ex)); }
    sendBtn.disabled = false; stopTyping(); return;
  }
  if (!body) return;
  sendBtn.disabled = true;
  try { await insertMessage(body); input.value = ''; autoGrow(); stopTyping(); burst(sendBtn); $('#emojiPanel').classList.add('hidden'); }
  catch (ex) { toast(errText(ex)); }
  sendBtn.disabled = false;
});

// image helpers: shrink + strip hidden location data before upload
async function prepImage(file) {
  if (file.type === 'image/gif') return { blob: file, type: 'image/gif', ext: 'gif' };
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { try { bmp = await createImageBitmap(file); } catch (e2) { throw new Error('Ye photo khul nahi paayi. JPG ya PNG try karo.'); } }
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Photo process nahi ho payi.');
  return { blob, type: 'image/jpeg', ext: 'jpg' };
}
async function cropSquare(file, size) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  if (!blob) throw new Error('Photo process nahi ho payi.');
  return { blob, type: 'image/jpeg', ext: 'jpg' };
}
const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
function audioInfo(type) {
  const t = (type || 'audio/webm').split(';')[0];
  return { type: t, ext: t.includes('mp4') ? 'm4a' : t.includes('ogg') ? 'ogg' : t.includes('mpeg') ? 'mp3' : 'webm' };
}
async function uploadBlob(blob, type, ext) {
  const path = `${state.me.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(/size|exceed/i.test(error.message) ? 'File bahut badi hai (50 MB tak).' : 'Upload nahi ho paya: ' + error.message);
  return path;
}
async function sendMedia(files, caption, voice) {
  const atts = [];
  try {
    for (const f of files) {
      if (voice) { const a = audioInfo(f.type); atts.push({ path: await uploadBlob(f, a.type, a.ext), kind: 'audio' }); }
      else if (f.type.startsWith('video/')) atts.push({ path: await uploadBlob(f, f.type, VIDEO_EXT[f.type] || 'mp4'), kind: 'video' });
      else { const p = await prepImage(f); atts.push({ path: await uploadBlob(p.blob, p.type, p.ext), kind: 'image' }); }
    }
    await insertMessage(caption, atts);
  } catch (ex) {
    if (atts.length) sb.storage.from(BUCKET).remove(atts.map(a => a.path)).then(() => {}, () => {});
    throw ex;
  }
}

// edit mode
function startEdit(m) { clearPending(); state.editing = m.id; $('#editBar').classList.remove('hidden'); input.value = m.body || ''; autoGrow(); input.focus(); }
function cancelEdit() { state.editing = null; $('#editBar').classList.add('hidden'); input.value = ''; autoGrow(); }
$('#editCancel').addEventListener('click', cancelEdit);

// photos + videos (several at once)
$('#attachBtn').addEventListener('click', () => {
  if (state.editing) { toast('Pehle edit poora ya cancel karo'); return; }
  $('#chatFile').click();
});
$('#chatFile').addEventListener('change', e => {
  const picked = [...e.target.files]; e.target.value = '';
  for (const f of picked) {
    const img = /^image\/(jpeg|png|gif|webp)$/.test(f.type), vid = /^video\/(mp4|webm|quicktime)$/.test(f.type);
    if (!img && !vid) { toast('Sirf JPG/PNG/GIF/WEBP photo ya MP4/WEBM/MOV video bhejo.'); continue; }
    if (img && f.size > MAX_IMG * 2) { toast('Photo bahut badi hai.'); continue; }
    if (vid && f.size > MAX_VID) { toast('Video 50 MB se badi hai.'); continue; }
    if (state.pendingFiles.length >= 10) { toast('Ek baar mein 10 files tak.'); break; }
    state.pendingFiles.push(f);
  }
  renderPending(); input.focus();
});
function renderPending() {
  const box = $('#previewThumbs'); box.textContent = '';
  state.pendingFiles.forEach(f => {
    if (!f._url) f._url = URL.createObjectURL(f);
    const th = document.createElement('div'); th.className = 'th';
    if (f.type.startsWith('video/')) {
      const v = document.createElement('video'); v.src = f._url; v.muted = true; v.preload = 'metadata'; th.appendChild(v);
      const b = document.createElement('b'); b.textContent = '🎬'; th.appendChild(b);
    } else { const i = new Image(); i.src = f._url; i.alt = ''; th.appendChild(i); }
    box.appendChild(th);
  });
  const n = state.pendingFiles.length;
  $('#previewLabel').textContent = `${n} file${n > 1 ? 's' : ''} ready. Caption likho aur bhejo ♡`;
  $('#preview').classList.toggle('hidden', n === 0);
}
function clearPending() {
  state.pendingFiles.forEach(f => f._url && URL.revokeObjectURL(f._url));
  state.pendingFiles = []; renderPending();
}
$('#previewCancel').addEventListener('click', clearPending);

// voice messages (recorded clips, not calls)
const rec = { mr: null, chunks: [], stream: null, timer: null, t0: 0, send: false };
function recMime() {
  if (!window.MediaRecorder) return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '';
}
async function startRec() {
  if (state.editing) { toast('Pehle edit poora ya cancel karo'); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Voice message ke liye Chrome aur HTTPS chahiye.'); return; }
  try { rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('Microphone allow nahi hua. Chrome settings mein allow karo.'); return; }
  const mime = recMime(); rec.chunks = []; rec.send = false;
  rec.mr = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined);
  rec.mr.ondataavailable = ev => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
  rec.mr.onstop = onRecStop;
  rec.mr.start(); rec.t0 = Date.now();
  $('#composer').classList.add('recording'); $('#recTime').textContent = '0:00';
  rec.timer = setInterval(() => {
    const s = Math.floor((Date.now() - rec.t0) / 1000);
    $('#recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 300) stopRec(true);
  }, 250);
}
function stopRec(send) {
  rec.send = send; clearInterval(rec.timer);
  $('#composer').classList.remove('recording');
  if (rec.mr && rec.mr.state !== 'inactive') rec.mr.stop();
  if (rec.stream) rec.stream.getTracks().forEach(t => t.stop());
}
async function onRecStop() {
  if (!rec.send || !rec.chunks.length) return;
  const type = (rec.mr && rec.mr.mimeType) || 'audio/webm';
  const blob = new Blob(rec.chunks, { type });
  if (blob.size < 1500) { toast('Voice bahut chhoti thi, dobara try karo.'); return; }
  toast('Voice bhej rahe hain…');
  try { await sendMedia([blob], '', true); burst($('#micBtn')); } catch (ex) { toast(errText(ex)); }
}
$('#micBtn').addEventListener('click', startRec);
$('#recSend').addEventListener('click', () => stopRec(true));
$('#recCancel').addEventListener('click', () => stopRec(false));

// emoji picker
const EMOJI = {
  '😊': '😀 😃 😄 😁 😆 🥹 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😜 🤪 😎 🤗 🤭 🫶 😏 😴 🥺 😢 😭 😤 😳 🤍 🫣 🤤 😈'.split(' '),
  '💖': '❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💖 💗 💓 💞 💕 💘 💝 💌 💋 💍 🌹 🌸 🌷 🌺 💐 🌼 ✨ 🌟 ⭐ 💫 🦋 🕊️ 🎀 🧸 🍓 🍒 🍰 🍫 🧁 ☁️ 🌈 🌙'.split(' '),
  '🤗': '👋 🤝 🙏 👏 🙌 🫂 💪 👍 🤞 ✌️ 🤟 🫰 🤌 👀 🥂 🍷 ☕ 🍕 🍔 🍦 🎂 🎁 🎉 🎶 📸 🏖️ 🌅 🌃 ✈️ 🏡 🚗 🌧️ ☀️ 🔥'.split(' '),
};
const tabsEl = $('#emojiTabs');
Object.keys(EMOJI).forEach((k, i) => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = k; if (!i) b.classList.add('on');
  b.addEventListener('click', () => { $$('button', tabsEl).forEach(x => x.classList.remove('on')); b.classList.add('on'); fillEmoji(k); });
  tabsEl.appendChild(b);
});
function fillEmoji(k) {
  const g = $('#emojiGrid'); g.textContent = '';
  EMOJI[k].forEach(em => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = em;
    b.addEventListener('click', () => {
      const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
      input.value = input.value.slice(0, s) + em + input.value.slice(e);
      input.focus(); input.selectionStart = input.selectionEnd = s + em.length; autoGrow();
      input.dispatchEvent(new Event('input'));
    });
    g.appendChild(b);
  });
}
fillEmoji('😊');
$('#emojiBtn').addEventListener('click', () => $('#emojiPanel').classList.toggle('hidden'));

// ------------------------------------------------------------------- tabs
function switchTab(t) {
  state.tab = t;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $$('.pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t));
  if (t === 'chat') { state.unread = 0; updateBadge(); markSeen(); setTimeout(() => scrollBottom(false), 30); }
  if (t === 'memories') loadMemories();
}
$$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.addEventListener('visibilitychange', () => {
  if (!state.me) return;
  if (chatVisible()) { markSeen(); state.unread = 0; updateBadge(); }
  if (document.hidden) sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', state.me.id).then(() => {}, () => {});
  else startPing();
});
window.addEventListener('focus', () => { if (state.me && chatVisible()) markSeen(); });

// --------------------------------------------------------------- memories
async function loadMemories() {
  try {
    const { data, error } = await sb.from('memories').select('*').order('id', { ascending: false });
    if (error) throw error;
    await signPaths(data.map(m => m.path));
    const g = $('#gallery'); g.textContent = '';
    $('#galleryEmpty').classList.toggle('hidden', data.length > 0);
    data.forEach((m, i) => {
      const who = state.byId[m.uploader] ? state.byId[m.uploader].name : '?';
      const pin = document.createElement('figure'); pin.className = 'pin'; pin.style.margin = '0 0 12px';
      pin.style.animationDelay = Math.min(i, 10) * 40 + 'ms';
      const img = new Image(); img.src = urlOf(m.path); img.alt = m.caption || 'A memory'; img.loading = 'lazy';
      img.addEventListener('error', () => resign(img, m.path));
      img.addEventListener('click', () => openLightbox(urlOf(m.path) || img.src));
      pin.appendChild(img);
      if (m.caption) { const c = document.createElement('div'); c.className = 'cap'; c.textContent = m.caption; pin.appendChild(c); }
      const by = document.createElement('div'); by.className = 'by';
      const sp = document.createElement('span');
      sp.textContent = `${who} · ${new Date(m.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`;
      by.appendChild(sp);
      if (m.uploader === state.me.id) {
        const del = document.createElement('button'); del.className = 'del'; del.textContent = '🗑'; del.title = 'Remove this memory';
        del.addEventListener('click', async () => {
          if (!confirm('Remove this memory?')) return;
          const { error: e1 } = await sb.from('memories').delete().eq('id', m.id);
          if (e1) { toast(errText(e1)); return; }
          sb.storage.from(BUCKET).remove([m.path]).then(() => {}, () => {});
          loadMemories();
        });
        by.appendChild(del);
      }
      pin.appendChild(by); g.appendChild(pin);
    });
  } catch (e) { toast(errText(e)); }
}
$('#addMemBtn').addEventListener('click', () => $('#memFile').click());
$('#memFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) { toast('Sirf JPG, PNG, GIF ya WEBP photo.'); return; }
  if (f.size > MAX_IMG * 2) { toast('Photo bahut badi hai.'); return; }
  state.memFile = f; $('#memPreview').src = URL.createObjectURL(f);
  $('#memCaption').value = ''; $('#memErr').textContent = ''; $('#memDialog').showModal();
});
$('#memCancel').addEventListener('click', () => $('#memDialog').close());
$('#memForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#memSave'); btn.disabled = true;
  try {
    const p = await prepImage(state.memFile);
    const path = await uploadBlob(p.blob, p.type, p.ext);
    const { error } = await sb.from('memories').insert({ path, caption: $('#memCaption').value.trim() });
    if (error) { sb.storage.from(BUCKET).remove([path]).then(() => {}, () => {}); throw error; }
    $('#memDialog').close(); loadMemories(); toast('Memory saved ♡');
  } catch (ex) { $('#memErr').textContent = errText(ex); }
  btn.disabled = false;
});

// ---------------------------------------------------------------- profile
$('#meBtn').addEventListener('click', () => { $('#avatarErr').textContent = ''; $('#profileDialog').showModal(); });
$('#profileClose').addEventListener('click', () => $('#profileDialog').close());
$('#avatarBtn').addEventListener('click', () => $('#avatarFile').click());
$('#avatarFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const p = await cropSquare(f, 400);
    const path = await uploadBlob(p.blob, p.type, p.ext);
    const old = state.byName[state.me.name].avatar_path;
    const { error } = await sb.from('profiles').update({ avatar_path: path }).eq('id', state.me.id);
    if (error) throw error;
    state.byName[state.me.name].avatar_path = path;
    if (old) sb.storage.from(BUCKET).remove([old]).then(() => {}, () => {});
    await refreshAvatars(); toast('Picture updated ♡');
  } catch (ex) { $('#avatarErr').textContent = errText(ex); }
});

// -------------------------------------------------------------- clear chat
$('#clearBtn').addEventListener('click', async () => {
  if (!confirm('Poori chat (photos, videos, voice ke saath) Arpita aur Mayank, dono ke liye delete ho jayegi. Pakka clear karna hai?')) return;
  const { data, error } = await sb.rpc('clear_chat');
  if (error) { toast(errText(error)); return; }
  const paths = Array.isArray(data) ? data : [];
  for (let i = 0; i < paths.length; i += 100) sb.storage.from(BUCKET).remove(paths.slice(i, i + 100)).then(() => {}, () => {});
  clearLocal(); toast('Chat clear ho gayi ♡');
});

// --------------------------------------------------------------- lightbox
function openLightbox(src) { $('#lightImg').src = src; $('#lightbox').showModal(); }
$('#lightbox').addEventListener('click', () => $('#lightbox').close());

// -------------------------------------------------------- emergency button
$('#sosBtn').addEventListener('click', () => {
  try { if (rec.stream) rec.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
  try { sb.removeAllChannels(); } catch (e) { /* ignore */ }
  if (EMERGENCY_LOGOUT) { try { sb.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ } }
  document.documentElement.style.visibility = 'hidden';
  document.body.textContent = '';
  window.location.replace(SOS_URL);
});

// ------------------------------------------------------------------- boot
(async function boot() {
  const bad = !cfg.url || !cfg.key || /PASTE_/.test(cfg.url + cfg.key) || typeof supabase === 'undefined';
  if (bad) {
    show('welcome');
    $('.tagline').textContent = typeof supabase === 'undefined'
      ? 'Internet ya Supabase library load nahi hui. Page refresh karo.'
      : 'Setup baaki hai: config.js mein Supabase ka URL aur key paste karo.';
    $('#enterBtn').disabled = true;
    return;
  }
  sb = supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && state.me) goLogin(); });
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) { await startSession(data.session.user); return; }
  } catch (e) { /* fall through to welcome */ }
  show('welcome');
})();
})();
