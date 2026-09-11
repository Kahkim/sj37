/* ===================================================================
 * 37 게임 - 대기실과 참가자 화면
 *   방 만들기 / 초대코드로 참가 / 좌석 목록 / 게임 시작
 *   참가자는 방장이 보내준 view 를 G 에 옮겨 담아 기존 화면(ui.js)으로 그린다.
 * =================================================================== */
const Lobby = (() => {
  const $ = s => document.querySelector(s);
  const arr = Net.arr;
  let store = null, host = null, guest = null;
  let code = null, isHost = false, lobby = null, meta = null;
  let maxSeats = 4;
  let entered = false;

  const nameKey = 'sj37_name';
  const getName = () => ($('#lbName').value || '').trim().slice(0, 10) || '플레이어';

  /* ---------- 저장소 선택 ---------- */
  async function getStore(){
    if (store) return store;
    if (new URLSearchParams(location.search).get('mp') === 'local'){
      // 테스트: 부모 창(test/mp-ui.html)의 가짜 서버에 붙는다
      const hub = window.parent !== window && window.parent.__SJ37_HUB__;
      if (!hub) throw new Error('로컬 테스트 서버가 없습니다');
      // 창(iframe)마다 다른 ID — window.name 은 창별로 따로 유지되고 새로고침에도 남는다
      let uid = (window.name || '').startsWith('sj37:') ? window.name.slice(5) : '';
      if (!uid){ uid = 'u' + Math.random().toString(36).slice(2, 8); window.name = 'sj37:' + uid; }
      store = Net.LocalStore(hub, uid);
    } else {
      store = await Net.FirebaseStore(window.FIREBASE_CONFIG);
    }
    return store;
  }

  /* ---------- 화면 전환 ---------- */
  function show(which){
    $('#start').hidden = which !== 'start';
    $('#lobby').hidden = which !== 'lobby';
    $('#board').hidden = which !== 'board';
  }
  function error(msg){
    const e = $('#lbError');
    e.textContent = msg || '';
    e.hidden = !msg;
  }
  function busy(on, label){
    ['#lbCreate', '#lbJoin'].forEach(s => { const b = $(s); if (b) b.disabled = on; });
    if (label) $('#lbCreate').dataset.label = label;
  }

  /* ---------- 입장 화면 ---------- */
  function open(prefillCode){
    show('lobby');
    error('');
    $('#lbEntry').hidden = false;
    $('#lbRoom').hidden = true;
    try { $('#lbName').value = localStorage.getItem(nameKey) || ''; } catch (e) {}
    if (prefillCode) $('#lbCode').value = String(prefillCode).toUpperCase().slice(0, 5);
    if (!window.FIREBASE_CONFIG && new URLSearchParams(location.search).get('mp') !== 'local')
      error('멀티플레이 서버가 아직 설정되지 않았습니다. 곧 열립니다!');
    (prefillCode ? $('#lbName') : $('#lbName')).focus();
  }
  function rememberName(){ try { localStorage.setItem(nameKey, getName()); } catch (e) {} }

  async function create(){
    error(''); busy(true); rememberName();
    try {
      const s = await getStore();
      host = Net.Host(s);
      host.onLobby = l => { lobby = l; renderRoom(); };
      code = await host.open(getName(), maxSeats);
      isHost = true;
      showRoom();
    } catch (e){ error(e.message || String(e)); host = null; }
    busy(false);
  }

  async function join(){
    const c = ($('#lbCode').value || '').trim().toUpperCase();
    if (c.length < 4) return error('초대코드 5자리를 입력해 주세요');
    error(''); busy(true); rememberName();
    try {
      const s = await getStore();
      guest = Net.Guest(s);
      guest.onLobby = l => { lobby = l; renderRoom(); maybeEnter(); };
      guest.onMeta  = m => { meta = m; renderRoom(); maybeEnter(); hostBanner(); };
      guest.onView  = v => GV.apply(v);
      code = await guest.join(c, getName());
      isHost = false;
      showRoom();
    } catch (e){ error(e.message || String(e)); guest = null; }
    busy(false);
  }

  /* ---------- 대기실 ---------- */
  function showRoom(){
    $('#lbEntry').hidden = true;
    $('#lbRoom').hidden = false;
    $('#lbCodeBig').textContent = code;
    $('#lbStart').hidden = !isHost;
    history.replaceState(null, '', location.pathname + '?room=' + code +
      (new URLSearchParams(location.search).get('mp') === 'local' ? '&mp=local' : ''));
    renderRoom();
  }

  function renderRoom(){
    if (!lobby || $('#lbRoom').hidden) return;
    const seats = arr(lobby.seats);
    const max = lobby.maxSeats || maxSeats;
    const mine = s => s.uid === (store && store.uid);
    let html = '';
    for (let i = 0; i < max; i++){
      const s = seats[i];
      if (s){
        const tag = s.host ? '<span class="lb-tag host">방장</span>' : '';
        const me  = mine(s) ? '<span class="lb-tag me">나</span>' : '';
        const off = !s.host && !s.online ? '<span class="lb-tag off">연결 끊김</span>' : '';
        html += `<li><span class="lb-no">${i + 1}</span><b>${esc(s.name)}</b>${tag}${me}${off}</li>`;
      } else {
        html += `<li class="empty"><span class="lb-no">${i + 1}</span>빈 자리 — 시작하면 AI가 앉습니다</li>`;
      }
    }
    $('#lbSeats').innerHTML = html;
    $('#lbCount').textContent = `${seats.length} / ${max}`;

    const status = $('#lbStatus');
    if (isHost){
      status.textContent = seats.length > 1
        ? '친구가 모두 들어오면 게임을 시작하세요. 빈 자리는 AI가 채웁니다.'
        : '초대코드나 링크를 친구에게 보내세요. 혼자 시작하면 나머지는 AI입니다.';
    } else {
      const seated = seats.some(mine);
      if (!seated && seats.length >= max) status.textContent = '자리가 가득 찼습니다.';
      else status.textContent = seated ? '방장이 게임을 시작하기를 기다리는 중…' : '입장하는 중…';
    }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

  function inviteLink(){
    return location.origin + location.pathname + '?room=' + code;
  }
  async function copyLink(){
    try { await navigator.clipboard.writeText(inviteLink()); UI.showHint('초대 링크를 복사했습니다'); }
    catch (e){ prompt('이 링크를 복사해 친구에게 보내세요', inviteLink()); }
  }
  async function share(){
    const data = { title:'37 게임', text:`같이 37 게임 해요! 초대코드 ${code}`, url:inviteLink() };
    if (navigator.share){ try { await navigator.share(data); } catch (e) {} }
    else copyLink();
  }

  function startGame(){
    if (!host) return;
    entered = true;
    show('board');
    $('#speedSel').parentElement.hidden = false;
    host.start();
  }

  /* 참가자: 방장이 시작하면 게임 화면으로 */
  function maybeEnter(){
    if (entered || !lobby || !meta) return;
    const seated = arr(lobby.seats).some(s => s.uid === store.uid);
    if (meta.status === 'playing' || meta.status === 'over'){
      if (!seated){
        // 같은 닉네임으로 다시 들어온 경우 방장이 자리를 돌려줄 때까지 잠깐 기다린다
        $('#lbStatus').textContent = '입장 확인 중…';
        clearTimeout(maybeEnter.t);
        maybeEnter.t = setTimeout(() => {
          if (!entered) error('이미 시작된 방입니다. 게임 중에 나갔다면 전과 같은 닉네임으로 다시 참가해 주세요.');
        }, 4000);
        return;
      }
      clearTimeout(maybeEnter.t);
      error('');
      entered = true;
      show('board');
      $('#speedSel').parentElement.hidden = true;     // 진행 속도는 방장이 정한다
      UI.attachGuest(GV.handle);
    }
  }

  function hostBanner(){
    const b = $('#netBanner');
    if (!b) return;
    const lost = entered && meta && meta.hostOnline === false && meta.status === 'playing';
    b.hidden = !lost;
    b.textContent = '방장의 연결이 끊겼습니다. 방장이 다시 연결되면 이어서 진행됩니다.';
  }

  function leave(){
    if (host){ host.close(); host = null; }
    if (guest){ guest.leave(); guest = null; }
    location.href = location.pathname;
  }

  /* ================================================================
   * 참가자 화면: 방장이 보낸 view → G → 기존 화면
   * ================================================================ */
  const GV = (() => {
    let lastEvent = -1, first = true, sent = 0, askShown = 0, askOpen = 0, noticeSeen = 0, overShown = false;
    const state = { myTurn:false, busy:false };

    const handle = {
      state,
      play(cardId){ sent = guest.play(cardId); state.busy = true; UI.render(); },
      endTurn(){ sent = guest.endTurn(); state.busy = true; UI.render(); }
    };

    function mirror(v){
      G.localIdx = v.you;
      G.round = v.round; G.deathmatch = !!v.deathmatch; G.over = !!v.over;
      G.eclipse = v.eclipse || 0;
      G.deck = new Array(v.deck || 0); G.discard = new Array(v.discard || 0);
      G.exiled = new Array(v.exiled || 0); G.carried = new Array(v.carried || 0);
      G.playedNames = new Set(arr(v.played));
      G.players = arr(v.players).map(w => {
        const p = makePlayer(w.idx, w.name, !!w.ai);
        p.hp = w.hp; p.maxHp = w.maxHp || 20; p.alive = !!w.alive;
        p.remote = !!w.remote; p.takeover = !!w.takeover; p.online = w.online !== false;
        p.st = Object.assign(freshStatus(), w.st || {});
        ['blood', 'locks', 'dayBan', 'mustUse'].forEach(k => p.st[k] = arr(p.st[k]));
        if (p.st.confusion) p.st.confusion.cards = arr(p.st.confusion.cards);
        const ids = arr(w.hand);
        p.hand = ids.length ? ids.map(id => ({ ...CARD_BY_ID[id] })) : new Array(w.handCount || 0).fill(null);
        return p;
      });
      G.current = G.players[v.current] || null;
      G.winner  = G.players[v.winner]  || null;
      G.log = arr(v.log).map(e => ({ msg:e.m, cls:e.c }));
      const t = v.turn || {};
      G.turnInfo = { idx:t.idx, deadline:t.left ? Date.now() + t.left : 0 };
    }

    function rehydrate(type, d){
      const P = i => G.players[i];
      switch (type){
        case 'play': return { player:P(d.player), card:CARD_BY_ID[d.card], cost:d.cost,
                              targets:arr(d.targets).map(P).filter(Boolean), trap:!!d.trap };
        default:     return { target:P(d.target), amount:d.amount, prevented:d.prevented || 0 };
      }
    }
    function specFromWire(w){
      const s = { kind:w.kind, prompt:w.prompt, count:w.count || 1, cancel:!!w.cancel };
      if (w.kind === 'players') s.list = arr(w.list).map(i => G.players[i]).filter(Boolean);
      else if (w.kind === 'cards') s.list = arr(w.list).map(id => ({ ...CARD_BY_ID[id] }));
      else if (w.kind === 'options') s.list = arr(w.list);
      return s;
    }
    function answerToWire(s, ans){
      if (ans === undefined) return undefined;          // 창이 닫힘 (시간 초과) — 보내지 않음
      if (ans === null) return null;
      if (s.kind === 'players') return ans.map(p => p.idx);
      if (s.kind === 'cards')   return ans.map(c => c.id);
      return ans;
    }

    function apply(v){
      if (!arr(v.players)[v.you]) return;               // 불완전한 화면은 무시 (다음 화면을 기다린다)
      maybeEnter();
      mirror(v);
      const ask = v.ask;
      state.myTurn = !G.over && v.current === v.you && !ask && G.players[v.you] && G.players[v.you].alive;
      state.busy = sent > (v.ack || 0);
      UI.render();

      // 연출: 처음 받은 화면의 지난 이벤트는 재생하지 않는다 (재접속 시 옛 연출 반복 방지)
      arr(v.events).forEach(e => {
        if (e.seq <= lastEvent) return;
        lastEvent = e.seq;
        if (!first) UI.onEvent(e.t, rehydrate(e.t, e.d));
      });
      first = false;

      if (v.notice && v.notice.id !== noticeSeen){ noticeSeen = v.notice.id; UI.showHint(v.notice.text); }

      // 선택 요청
      if (ask && ask.id !== askShown){
        askShown = askOpen = ask.id;
        const spec = specFromWire(ask.spec);
        UI.ask(spec).then(ans => {
          const id = askOpen; askOpen = 0;
          const w = answerToWire(spec, ans);
          if (w !== undefined && id === ask.id) guest.answer(ask.id, w);
        });
      } else if (!ask && askOpen){
        UI.closeModal();                                  // 방장 쪽에서 시간 초과로 정리됨
      }

      if (G.over && !overShown){ overShown = true; setTimeout(() => UI.gameOver(), 600); }
      if (AUTO === 'guest') autoPlay(v);
    }

    /* 테스트 전용 자동 조작 (로컬 테스트 서버 + ?auto=guest 일 때만) */
    let autoKey = '', autoActs = 0, autoSeq = -1;
    function autoPlay(v){
      if (!state.myTurn || state.busy || v.seq === autoSeq) return;
      autoSeq = v.seq;
      const key = v.round + ':' + v.current;
      if (key !== autoKey){ autoKey = key; autoActs = 0; }
      setTimeout(() => {
        if (!state.myTurn || state.busy) return;
        const me = G.players[G.localIdx];
        const forced = pendingMustUse(me);
        const card = forced[0] || me.hand.find(c => c && whyCannot(me, c) === null);
        if (card && (forced.length || (autoActs < 3 && Math.random() < 0.75))){ autoActs++; handle.play(card.id); }
        else handle.endTurn();
      }, 120);
    }

    return { apply, handle };
  })();

  const QS = new URLSearchParams(location.search);
  const AUTO = QS.get('mp') === 'local' ? QS.get('auto') : null;
  async function autoRun(){
    const wait = (cond, ms) => new Promise(ok => {
      const end = Date.now() + ms;
      (function poll(){ if (cond() || Date.now() > end) ok(cond()); else setTimeout(poll, 30); })();
    });
    open();
    if (AUTO === 'host'){
      $('#lbName').value = QS.get('name') || '방장';
      maxSeats = +QS.get('n') || 3;
      await create();
      window.parent.__SJ37_CODE__ = code;
      await wait(() => lobby && arr(lobby.seats).length >= 1 + (+QS.get('wait') || 0), 20000);
      G.speed = +QS.get('speed') || 250;
      startGame();
    } else {
      $('#lbName').value = QS.get('name') || '친구';
      await wait(() => window.parent.__SJ37_CODE__, 20000);
      await new Promise(r => setTimeout(r, +QS.get('delay') || 0));
      $('#lbCode').value = window.parent.__SJ37_CODE__;
      await join();
    }
  }
  if (AUTO) window.addEventListener('DOMContentLoaded', () => setTimeout(autoRun, 50));

  /* ---------- 버튼 연결 ---------- */
  function init(){
    if (!$('#lobby')) return;
    $('#lbBack').onclick   = leave;
    $('#lbLeave').onclick  = leave;
    $('#lbCreate').onclick = create;
    $('#lbJoin').onclick   = join;
    $('#lbStart').onclick  = startGame;
    $('#lbCopy').onclick   = copyLink;
    $('#lbShare').onclick  = share;
    $('#lbCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('#lbCode').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
    document.querySelectorAll('#lbSize button').forEach(b => b.onclick = () => {
      maxSeats = +b.dataset.n;
      document.querySelectorAll('#lbSize button').forEach(x => x.classList.toggle('on', x === b));
    });
  }
  window.addEventListener('DOMContentLoaded', init);

  return { open, get code(){ return code; } };
})();
