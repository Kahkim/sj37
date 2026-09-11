/* ===================================================================
 * 37 게임 - 멀티플레이
 *
 * 방장 권한 방식
 *   - 방장 브라우저가 규칙 엔진(game.js)을 그대로 돌린다.
 *   - 참가자는 자기에게 보여도 되는 화면 정보(view)만 받아서 그리고,
 *     카드 사용 / 턴 종료 / 선택 응답만 방장에게 보낸다.
 *   - 손패는 각자 자기 것만 받는다. (「낮」으로 공개된 손패는 예외)
 *
 * 저장소 구조  rooms/{code}/
 *   meta          방 정보 (방장만 씀)
 *   lobby         좌석 목록 (방장만 씀)
 *   presence/uid  접속 여부 (본인만 씀, 끊기면 자동 삭제)
 *   joins/uid     입장 요청 (본인만 씀, 방장만 읽음)
 *   view/uid      그 플레이어가 볼 화면 (방장만 씀, 본인만 읽음)
 *   inbox/uid     그 플레이어의 입력 (본인만 씀, 방장만 읽음)
 * =================================================================== */
const Net = (() => {

  const CFG = { turnMs:60000, askMs:45000, syncMs:120 };
  const debug = [];                 // 거절된 응답 기록 (문제 추적용)
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 헷갈리는 0 O 1 I L 제외

  /* Firebase 는 빈 배열을 지우고 배열을 객체로 돌려주기도 하므로 항상 이걸로 읽는다 */
  const arr = x => Array.isArray(x) ? x
    : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : []);
  /* undefined 가 섞이면 Firebase 가 쓰기를 거부하므로 JSON 으로 한 번 정리 */
  const clean = v => v === undefined ? null : JSON.parse(JSON.stringify(v));

  function newCode(n){
    let s = '';
    for (let i = 0; i < (n || 5); i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    return s;
  }

  /* ================================================================
   * 저장소 1: 로컬 (테스트용) — Firebase Realtime Database 흉내
   * ================================================================ */
  function LocalHub(){
    const root = {};
    const valueL = [], childL = [];
    let pushN = 0;
    const split = p => p.split('/').filter(Boolean);

    // Firebase 처럼 null 과 빈 배열·빈 객체를 지운다
    function fbLike(v){
      if (v === null || v === undefined) return null;
      if (Array.isArray(v)){
        const a = v.map(fbLike);
        return a.length ? a : null;
      }
      if (typeof v === 'object'){
        const o = {};
        for (const k of Object.keys(v)){ const x = fbLike(v[k]); if (x !== null) o[k] = x; }
        return Object.keys(o).length ? o : null;
      }
      return v;
    }
    function getAt(path){
      let n = root;
      for (const k of split(path)){ if (n == null || typeof n !== 'object') return null; n = n[k]; }
      return n === undefined ? null : n;
    }
    function setAt(path, val){
      const ks = split(path);
      let n = root;
      for (let i = 0; i < ks.length - 1; i++){
        if (typeof n[ks[i]] !== 'object' || n[ks[i]] === null) n[ks[i]] = {};
        n = n[ks[i]];
      }
      const last = ks[ks.length - 1];
      const v = fbLike(clean(val));
      if (v === null) delete n[last]; else n[last] = v;
    }
    const related = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

    function notify(path){
      valueL.forEach(l => {
        if (!related(l.path, path)) return;
        const snap = clean(getAt(l.path));
        setTimeout(() => l.deliver(snap), 0);
      });
      childL.forEach(l => {
        if (!related(l.path, path)) return;
        const node = getAt(l.path) || {};
        Object.keys(node).forEach(k => {
          if (l.seen.has(k)) return;
          l.seen.add(k);
          const snap = clean(node[k]);
          setTimeout(() => l.deliver(k, snap), 0);
        });
      });
    }
    function write(path, val){ setAt(path, val); notify(path); }

    return {
      getAt, write,
      pushKey: () => 'k' + String(++pushN).padStart(8, '0'),
      addValue(l){ valueL.push(l); const snap = clean(getAt(l.path)); setTimeout(() => l.deliver(snap), 0);
                   return () => valueL.splice(valueL.indexOf(l), 1); },
      addChild(l){ childL.push(l); const node = getAt(l.path) || {};
                   Object.keys(node).forEach(k => { l.seen.add(k); const s = clean(node[k]); setTimeout(() => l.deliver(k, s), 0); });
                   return () => childL.splice(childL.indexOf(l), 1); },
      dump: () => clean(root)
    };
  }

  function LocalStore(hub, uid){
    let online = true;
    const queued = [], onDisc = [], connL = [], listeners = [];
    const doWrite = (path, val) => online ? hub.write(path, val) : queued.push([path, val]);

    const S = {
      uid, kind:'local',
      set:    (p, v) => { doWrite(p, v); return Promise.resolve(); },
      remove: (p)    => { doWrite(p, null); return Promise.resolve(); },
      update: (p, o) => { Object.keys(o).forEach(k => doWrite(p + '/' + k, o[k])); return Promise.resolve(); },
      push:   (p, v) => { const k = hub.pushKey(); doWrite(p + '/' + k, v); return k; },
      get:    (p)    => Promise.resolve(clean(hub.getAt(p))),
      on(p, cb){
        const l = { path:p, deliver: v => { if (online) cb(v); } };
        listeners.push(l);
        return hub.addValue(l);
      },
      onChild(p, cb){
        const l = { path:p, seen:new Set(), deliver: (k, v) => { if (online) cb(k, v); } };
        return hub.addChild(l);
      },
      onDisconnect(p, action){ onDisc.push([p, action]); },
      cancelDisconnect(p){ for (let i = onDisc.length - 1; i >= 0; i--) if (onDisc[i][0] === p) onDisc.splice(i, 1); },
      onConnected(cb){ connL.push(cb); setTimeout(() => cb(online), 0); },

      /* 테스트용: 연결 끊김/복구 흉내 */
      simulateDisconnect(){
        online = false;
        onDisc.splice(0).forEach(([p, a]) => hub.write(p, a === 'remove' ? null : a.set));
        connL.forEach(cb => cb(false));
      },
      simulateReconnect(){
        online = true;
        queued.splice(0).forEach(([p, v]) => hub.write(p, v));
        connL.forEach(cb => cb(true));
        listeners.forEach(l => l.deliver(clean(hub.getAt(l.path))));   // 재동기화
      }
    };
    return S;
  }

  /* ================================================================
   * 저장소 2: Firebase Realtime Database (실제 서비스)
   * ================================================================ */
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  function loadScript(src){
    return new Promise((ok, fail) => {
      if (document.querySelector(`script[src="${src}"]`)) return ok();
      const s = document.createElement('script');
      s.crossOrigin = 'anonymous';          // 라이브러리 안에서 난 오류 내용이 가려지지 않도록
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Firebase 라이브러리를 불러오지 못했습니다'));
      document.head.appendChild(s);
    });
  }

  /* opts.app: 앱 이름 (테스트에서 한 페이지에 여러 계정을 띄울 때)
   * opts.persistence: 'session'(기본) | 'none'(메모리 — 테스트용) */
  async function FirebaseStore(config, opts){
    opts = opts || {};
    if (!config || !config.databaseURL) throw new Error('멀티플레이 서버가 아직 설정되지 않았습니다');
    await loadScript(SDK + 'firebase-app-compat.js');
    await loadScript(SDK + 'firebase-auth-compat.js');
    await loadScript(SDK + 'firebase-database-compat.js');
    const name = opts.app || '[DEFAULT]';
    const app = firebase.apps.find(a => a.name === name)
             || (opts.app ? firebase.initializeApp(config, opts.app) : firebase.initializeApp(config));
    const auth = app.auth();
    // 로그인은 탭 단위로 유지한다: 같은 브라우저의 탭 두 개가 서로 다른 플레이어가 되고,
    // 같은 탭을 새로고침하면 같은 ID 로 자기 자리에 돌아온다.
    const P = firebase.auth.Auth.Persistence;
    await auth.setPersistence(opts.persistence === 'none' ? P.NONE : P.SESSION);
    // 저장된 익명 로그인이 복원될 때까지 기다린다
    const restored = await new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
    const user = restored || (await auth.signInAnonymously()).user;
    const db = app.database();
    const ref = p => db.ref(p);

    return {
      uid: user.uid, kind:'firebase',
      set:    (p, v) => ref(p).set(clean(v)),
      remove: (p)    => ref(p).remove(),
      update: (p, o) => ref(p).update(clean(o)),
      push:   (p, v) => ref(p).push(clean(v)).key,
      get:    async p => (await ref(p).get()).val(),
      on(p, cb){ const r = ref(p), h = s => cb(s.val()); r.on('value', h); return () => r.off('value', h); },
      onChild(p, cb){ const r = ref(p), h = s => cb(s.key, s.val()); r.on('child_added', h); return () => r.off('child_added', h); },
      onDisconnect(p, action){
        const od = ref(p).onDisconnect();
        return action === 'remove' ? od.remove() : od.set(clean(action.set));
      },
      cancelDisconnect: p => ref(p).onDisconnect().cancel(),
      onConnected(cb){ const r = ref('.info/connected'), h = s => cb(!!s.val()); r.on('value', h); return () => r.off('value', h); },
      /* 테스트용: 연결을 실제로 끊었다 붙인다 (서버가 onDisconnect 를 실행) */
      simulateDisconnect: () => db.goOffline(),
      simulateReconnect:  () => db.goOnline()
    };
  }

  /* ================================================================
   * 선택 요청(ask)·연출 이벤트 직렬화
   * 플레이어는 자리 번호, 카드는 id 로 주고받는다.
   * ================================================================ */
  function specToWire(spec){
    const w = { kind:spec.kind, prompt:spec.prompt || '', count:spec.count || 1, cancel:!!spec.cancel };
    if (spec.kind === 'players') w.list = spec.list.map(p => p.idx);
    else if (spec.kind === 'cards') w.list = spec.list.map(c => c.id);
    else if (spec.kind === 'options')
      w.list = spec.list.map(o => ({ value:o.value, label:o.label, desc:o.desc || '', disabled:!!o.disabled }));
    return w;
  }
  /* 참가자가 보낸 답을 엔진 객체로 되돌린다. 이상한 답이면 ok:false */
  function answerFromWire(spec, raw){
    if (raw === null || raw === undefined) return spec.cancel ? { ok:true, value:null } : { ok:false };
    if (spec.kind === 'confirm') return typeof raw === 'boolean' ? { ok:true, value:raw } : { ok:false };
    if (spec.kind === 'options'){
      const o = spec.list.find(o => o.value === raw && !o.disabled);
      return o ? { ok:true, value:o.value } : { ok:false };
    }
    const key = spec.kind === 'players' ? (x => x.idx) : (x => x.id);
    const picked = [];
    arr(raw).forEach(k => { const x = spec.list.find(o => key(o) === k); if (x && !picked.includes(x)) picked.push(x); });
    const need = Math.min(spec.count || 1, spec.list.length);
    return picked.length === need ? { ok:true, value:picked } : { ok:false };
  }
  function eventToWire(type, d){
    const i = x => (x && x.idx != null) ? x.idx : -1;
    switch (type){
      case 'play':      return { player:i(d.player), card:d.card.id, cost:d.cost, targets:(d.targets || []).map(i), trap:!!d.trap };
      case 'damage':    return { target:i(d.target), amount:d.amount, prevented:d.prevented || 0 };
      case 'heal':      return { target:i(d.target), amount:d.amount };
      case 'killbonus': return { target:i(d.target), amount:d.amount };
      case 'revive': case 'out': return { target:i(d.target) };
    }
    return null;
  }

  /* 다른 플레이어에게 보여줄 상태이상: 반드시 사용해야 하는 카드가 무엇인지는 숨긴다 */
  function statusFor(st, self){
    const s = clean(st);
    if (!self) s.mustUse = arr(st.mustUse).map(() => '?');
    return s;
  }

  /* ================================================================
   * 방장
   * ================================================================ */
  function Host(store){
    let code = null, base = null;
    let meta = null;
    const seats = [];                // [{ uid, name, host }]
    const presence = {};
    const queues = {}, waiters = {}, lastMsgId = {}, ack = {}, notice = {};
    const pending = {};              // 자리번호 → 진행 중인 선택 요청
    const events = [];
    let eventSeq = 0, viewSeq = 0, askSeq = 0, noticeSeq = 0;
    let syncTimer = null;
    let turn = { idx:-1, deadline:0 };
    let started = false;
    const unsubs = [];

    const H = {
      isHost:true, get code(){ return code; }, get seats(){ return seats; },
      get turn(){ return turn; }, presence, onLobby:null, onError:null
    };

    const playerOf = uid => G.players.find(p => p.uid === uid);
    const isOnline = p => !p.remote || !!presence[p.uid];

    function lobbyData(){
      return { maxSeats:meta.maxSeats, status:meta.status,
               seats:seats.map(s => ({ uid:s.uid, name:s.name, host:!!s.host, online:!!presence[s.uid] || !!s.host })) };
    }
    function writeLobby(){
      store.set(base + '/lobby', lobbyData());
      if (H.onLobby) H.onLobby(lobbyData());
    }

    /* 방 만들기 */
    H.open = async (name, maxSeats) => {
      for (let tries = 0; tries < 8; tries++){
        const c = newCode(5);
        if (!(await store.get('rooms/' + c + '/meta'))){ code = c; break; }
      }
      if (!code) throw new Error('초대코드를 만들지 못했습니다. 다시 시도해 주세요');
      base = 'rooms/' + code;
      meta = { host:store.uid, status:'lobby', maxSeats, createdAt:Date.now(), hostOnline:true, v:1 };
      await store.set(base + '/meta', meta);
      seats.push({ uid:store.uid, name, host:true });

      unsubs.push(store.onConnected(on => {
        if (!on) return;
        store.set(base + '/presence/' + store.uid, true);
        store.onDisconnect(base + '/presence/' + store.uid, 'remove');
        store.update(base + '/meta', { hostOnline:true });
        store.onDisconnect(base + '/meta/hostOnline', { set:false });
      }));
      unsubs.push(store.on(base + '/presence', m => onPresence(m || {})));
      unsubs.push(store.onChild(base + '/joins', (uid, v) => onJoin(uid, v || {})));
      writeLobby();
      return code;
    };

    function listenInbox(uid){
      if (queues[uid]) return;
      queues[uid] = [];
      unsubs.push(store.onChild(base + '/inbox/' + uid, (key, msg) => onInbox(uid, key, msg)));
    }

    function onJoin(uid, v){
      const name = String(v.name || '플레이어').slice(0, 12);
      const seated = seats.find(s => s.uid === uid);
      if (seated){
        if (!seated.host) seated.name = name;
      } else if (!started && seats.length < meta.maxSeats){
        seats.push({ uid, name });
      } else if (started){
        // 탭을 닫았다가 다시 들어오면 새 ID 가 된다 → 같은 닉네임의 연결 끊긴 자리를 돌려준다
        const p = G.players.find(p => p.remote && p.alive && p.name === name && !presence[p.uid]);
        if (!p) return;
        const s = seats.find(s => s.uid === p.uid);
        if (s) s.uid = uid;
        p.uid = uid;
        listenInbox(uid);
        L(`🔁 ${p.name} 새 연결로 자리에 돌아옴`, 'sys');
        writeLobby();
        if (presence[uid]) goOnline(p);
        scheduleSync();
        return;
      } else return;                             // 가득 참 → 좌석 없음 (참가자가 lobby 로 판단)
      listenInbox(uid);
      writeLobby();
    }

    function onPresence(m){
      const before = { ...presence };
      Object.keys(presence).forEach(k => delete presence[k]);
      Object.keys(m).forEach(k => { if (m[k]) presence[k] = true; });

      if (!started){
        // 대기실에서 나간 참가자는 자리를 비운다
        for (let i = seats.length - 1; i >= 0; i--)
          if (!seats[i].host && before[seats[i].uid] && !presence[seats[i].uid]) seats.splice(i, 1);
        writeLobby();
        return;
      }
      G.players.forEach(p => {
        if (!p.remote) return;
        const was = !!before[p.uid], now = !!presence[p.uid];
        if (was && !now) goOffline(p);
        if (!was && now) goOnline(p);
      });
      scheduleSync();
    }

    function goOffline(p){
      if (p.isAI || !p.alive) return;
      p.isAI = true; p.aiTakeover = true;
      L(`🔌 ${p.name} 연결 끊김 — AI가 대신 플레이합니다`, 'sys');
      if (pending[p.idx]) pending[p.idx].fallback('연결 끊김');
      if (waiters[p.uid]) waiters[p.uid]('offline');
      if (typeof UI !== 'undefined') UI.render();
    }
    function goOnline(p){
      if (!p.aiTakeover) return;
      if (G.current === p){ p.releaseAfterTurn = true; return; }   // AI가 진행 중인 턴은 마저 끝낸다
      release(p);
    }
    function release(p){
      p.isAI = false; p.aiTakeover = false; p.releaseAfterTurn = false;
      L(`🔌 ${p.name} 다시 연결됨 — 다음 턴부터 직접 플레이합니다`, 'sys');
      scheduleSync();
    }

    /* 참가자 입력 */
    function onInbox(uid, key, msg){
      store.remove(base + '/inbox/' + uid + '/' + key);
      if (!msg || typeof msg.id !== 'number') return;
      if (msg.id <= (lastMsgId[uid] || 0)) return;            // 중복·재전송 무시
      lastMsgId[uid] = msg.id;
      const p = playerOf(uid);
      if (!p) return;

      if (msg.type === 'answer'){
        const pa = pending[p.idx];
        if (pa && pa.id === msg.askId) pa.answer(msg.value);
        return;
      }
      if (msg.type === 'play' || msg.type === 'end'){
        if (G.current !== p || p.isAI){ reject(p, msg, '지금은 내 턴이 아닙니다'); return; }
        if (waiters[uid]) waiters[uid](msg); else queues[uid].push(msg);
      }
    }
    function reject(p, msg, text){
      ack[p.uid] = Math.max(ack[p.uid] || 0, msg.id);
      notice[p.uid] = { id:++noticeSeq, text };
      scheduleSync();
    }
    function nextAction(p, deadline){
      const q = queues[p.uid];
      if (q.length) return Promise.resolve(q.shift());
      return new Promise(resolve => {
        const t = setTimeout(() => { waiters[p.uid] = null; resolve('timeout'); }, Math.max(0, deadline - Date.now()));
        waiters[p.uid] = m => { clearTimeout(t); waiters[p.uid] = null; resolve(m); };
      });
    }

    /* ---------- 엔진 연결 ---------- */

    H.beforeTurn = p => {
      if (p.releaseAfterTurn) release(p);
      const human = !p.isAI && (p.remote || p.idx === G.localIdx);
      turn = { idx:p.idx, deadline: human ? Date.now() + CFG.turnMs : 0 };
      G.turnInfo = turn;
      scheduleSync();
    };

    H.remoteTurn = async p => {
      queues[p.uid].length = 0;                   // 이전 턴에 쌓인 입력은 버린다
      while (!G.over && p.alive){
        if (p.isAI){ await AI.takeTurn(p); break; }      // 턴 도중 끊기면 AI가 마무리
        const msg = await nextAction(p, turn.deadline);
        if (msg === 'offline') continue;
        if (msg === 'timeout'){ L(`⏱ ${p.name}: 시간 초과 — 턴 종료`, 'warn'); break; }
        if (msg.type === 'end'){
          const forced = pendingMustUse(p);
          if (forced.length){ reject(p, msg, `「${forced[0].name}」을(를) 먼저 사용해야 합니다`); continue; }
          ack[p.uid] = msg.id;
          break;
        }
        const card = p.hand.find(c => c.id === msg.cardId);
        const why = card ? whyCannot(p, card) : '손패에 없는 카드입니다';
        if (why){ reject(p, msg, why); continue; }
        await playCard(p, card);
        ack[p.uid] = msg.id;
        scheduleSync();
      }
      turn = { idx:-1, deadline:0 };
      G.turnInfo = turn;
      scheduleSync();
    };

    H.askRemote = (p, spec) => new Promise(resolve => {
      const id = ++askSeq;
      let timer = null;
      const done = v => {
        clearTimeout(timer);
        if (pending[p.idx] && pending[p.idx].id === id) delete pending[p.idx];
        syncNow();
        resolve(v);
      };
      const fallback = why => {
        if (why) L(`  └ ${p.name}: ${why} — 자동으로 선택합니다`, 'dim');
        done(AI.answer(p, spec));
      };
      pending[p.idx] = {
        id, wire:specToWire(spec), deadline:Date.now() + CFG.askMs,
        answer: raw => {
          const r = answerFromWire(spec, raw);
          if (r.ok) return done(r.value);
          debug.push({ kind:spec.kind, count:spec.count, list:specToWire(spec).list, raw });
          if (debug.length > 20) debug.shift();
          fallback('잘못된 응답');
        },
        fallback
      };
      if (p.isAI || !isOnline(p)) return fallback(null);
      timer = setTimeout(() => fallback('응답 시간 초과'), CFG.askMs);
      syncNow();
    });

    H.onEngineEvent = (type, d) => {
      const w = eventToWire(type, d);
      if (!w) return;
      events.push({ seq:++eventSeq, t:type, d:w });
      if (events.length > 40) events.shift();
      scheduleSync();
    };

    H.onGameOver = () => {
      store.update(base + '/meta', { status:'over' });
      syncNow();
      store.onDisconnect(base, 'remove');                        // 방장이 나가면 방 정리
    };

    /* ---------- 화면 동기화 ---------- */

    H.viewFor = v => {
      const pa = pending[v.idx];
      const now = Date.now();
      return {
        seq:++viewSeq, you:v.idx,
        round:G.round, deathmatch:G.deathmatch, over:G.over,
        winner:G.winner ? G.winner.idx : -1, eclipse:G.eclipse || 0,
        current:G.current ? G.current.idx : -1,
        deck:G.deck.length, discard:G.discard.length, exiled:G.exiled.length, carried:G.carried.length,
        played:(G.current === v && G.playedNames) ? [...G.playedNames] : [],
        players:G.players.map(p => ({
          idx:p.idx, name:p.name, hp:p.hp, maxHp:p.maxHp, alive:p.alive,
          ai:!!p.isAI && !p.aiTakeover, remote:!!p.remote, takeover:!!p.aiTakeover,
          online:isOnline(p),
          handCount:p.hand.length,
          hand:(p === v || p.st.reveal) ? p.hand.map(c => c.id) : [],
          st:statusFor(p.st, p === v)
        })),
        log:G.log.slice(-40).map(e => { const t = logTextFor(e, v.idx); return t == null ? null : { m:t, c:e.cls }; })
                            .filter(Boolean),
        events:events.slice(),
        ask:pa ? { id:pa.id, spec:pa.wire, left:Math.max(0, pa.deadline - now) } : null,
        ack:ack[v.uid] || 0,
        notice:notice[v.uid] || null,
        turn:{ idx:turn.idx, left:turn.deadline ? Math.max(0, turn.deadline - now) : 0 }
      };
    };
    function syncNow(){
      clearTimeout(syncTimer); syncTimer = null;
      if (!started) return;
      G.players.forEach(p => { if (p.remote) store.set(base + '/view/' + p.uid, H.viewFor(p)); });
    }
    function scheduleSync(){
      if (!started || syncTimer) return;
      syncTimer = setTimeout(syncNow, CFG.syncMs);
    }
    H.scheduleSync = scheduleSync;
    H.syncNow = syncNow;

    /* 게임 시작: 빈 자리는 AI 로 채운다 */
    H.start = () => {
      started = true;
      meta.status = 'playing';
      store.update(base + '/meta', { status:'playing' });
      const bots = ['봇 알파', '봇 베타', '봇 감마'];
      const setup = seats.map(s => s.host ? { name:s.name, kind:'local' } : { name:s.name, kind:'remote', uid:s.uid });
      let b = 0;
      while (setup.length < meta.maxSeats) setup.push({ name:bots[b++], kind:'ai' });
      writeLobby();
      G.mp = H;
      return startGame(setup.length, null, setup);
    };

    H.close = () => {
      unsubs.forEach(u => u && u());
      if (base){
        // 연결이 끊길 때 쓰도록 예약해 둔 값이 지운 방에 찌꺼기를 남기지 않도록 먼저 취소
        store.cancelDisconnect(base + '/meta/hostOnline');
        store.cancelDisconnect(base + '/presence/' + store.uid);
        store.cancelDisconnect(base);
        store.remove(base);
      }
      G.mp = null;
    };
    return H;
  }

  /* ================================================================
   * 참가자
   * 받은 화면(view)을 어떻게 쓸지는 onView 를 단 쪽이 정한다.
   * (실제 화면은 lobby.js 가, 테스트는 봇이 처리)
   * ================================================================ */
  function Guest(store){
    let code = null, base = null;
    let lastId = 0;
    const G2 = {
      isGuest:true, uid:store.uid,
      get code(){ return code; },
      onView:null, onLobby:null, onMeta:null
    };
    const nextId = () => (lastId = Math.max(lastId + 1, Date.now()));   // 새로고침해도 계속 증가
    const send = msg => { msg.id = nextId(); store.push(base + '/inbox/' + store.uid, msg); return msg.id; };

    G2.join = async (c, name) => {
      code = String(c || '').trim().toUpperCase();
      base = 'rooms/' + code;
      const meta = await store.get(base + '/meta');
      if (!meta) throw new Error('방을 찾을 수 없습니다. 초대코드를 확인해 주세요');
      if (meta.host === store.uid)
        throw new Error('이 창은 이 방의 방장입니다. 친구는 다른 기기나 다른 탭에서 참가해 주세요');
      store.onConnected(on => {
        if (!on) return;
        store.set(base + '/presence/' + store.uid, true);
        store.onDisconnect(base + '/presence/' + store.uid, 'remove');
      });
      await store.set(base + '/joins/' + store.uid, { name:String(name || '플레이어').slice(0, 12), t:Date.now() });
      store.on(base + '/meta',  m => G2.onMeta  && G2.onMeta(m));
      store.on(base + '/lobby', l => G2.onLobby && G2.onLobby(l));
      store.on(base + '/view/' + store.uid, v => v && G2.onView && G2.onView(v));
      return code;
    };
    G2.play    = cardId => send({ type:'play', cardId });
    G2.endTurn = ()     => send({ type:'end' });
    G2.answer  = (askId, value) => send({ type:'answer', askId, value:value === undefined ? null : value });
    G2.leave   = () => { if (base) store.remove(base + '/presence/' + store.uid); };
    return G2;
  }

  return {
    CFG, arr, clean, newCode, debug,
    LocalHub, LocalStore, FirebaseStore,
    Host, Guest,
    specToWire, answerFromWire, eventToWire
  };
})();
