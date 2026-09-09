/* ===================================================================
 * 37 게임 - UI
 * =================================================================== */
const UI = (() => {
  const $ = s => document.querySelector(s);
  let busy = false;         // 비동기 처리 중
  let endTurnResolve = null;
  let myTurn = false;

  const me = () => G.players[0];

  /* 개발용: index.html?autotest 로 열면 사람 자리도 AI가 자동 플레이 (UI 스모크 테스트) */
  const AUTOTEST = /[?&]autotest/.test(location.search);
  function autoAnswer(spec){
    switch (spec.kind){
      case 'confirm': return true;
      case 'players': return spec.list.slice(0, spec.count);
      case 'options': { const a = spec.list.filter(o => !o.disabled); return (a[0] || spec.list[0]).value; }
      case 'cards':   return spec.list.slice(0, spec.count);
    }
    return null;
  }

  /* ---------- 카드 엘리먼트 ---------- */
  function cardEl(card, o){
    o = o || {};
    const d = document.createElement('div');
    // 설명이 긴 카드만 글자를 한 단계 줄여 잘리지 않게 한다
    const dense = card.short.length > 78 ? ' dense' : '';
    d.className = 'card t-' + card.type + dense + (o.cls ? ' ' + o.cls : '');
    const cost = o.owner ? costOf(o.owner, card) : card.cost;
    const changed = o.owner && cost !== card.cost;
    d.innerHTML =
      `<div class="c-top">
         <span class="c-cost${changed ? ' c-mod' : ''}">${cost}</span>
         <span class="c-type">${TYPE_NAME[card.type]}</span>
       </div>
       <div class="c-name">${card.name}</div>
       <div class="c-en">${card.en}</div>
       <div class="c-text">${card.short}</div>
       <div class="c-disp">${card.disposal === 'exile' ? '소멸' : card.disposal === 'deckBottom' ? '덱 맨 아래' : '버림'}</div>`;
    return d;
  }

  /* ---------- 상태 뱃지 ---------- */
  function badges(p){
    const b = [];
    const s = p.st;
    if (s.rain)        b.push(['비', '공격 피해 -1 (다음 턴 시작까지)', 'def']);
    if (s.fortune)     b.push(['행운 ' + s.fortune, `다음 ${s.fortune}번 피해 -1`, 'def']);
    if (s.snowpeak)    b.push(['설산 ' + s.snowpeak, `다음 ${s.snowpeak}번 피해 -1`, 'def']);
    if (s.gate)        b.push(['관문', '상대 카드 1장 무효', 'def']);
    if (s.immortal)    b.push(['불멸', 'HP 1 미만으로 내려가지 않음', 'def']);
    if (s.iridescence) b.push(['훈색', '다음 공격 카드 1장 이월', 'def']);
    if (s.phoenix)     b.push(['불사조', 'HP 0 이하 시 HP 5 복구', 'def']);
    if (s.flower)      b.push(['꽃', '지속 피해 -1', 'def']);
    if (s.warfare)     b.push(['전쟁 ' + s.warfare.left, `공격 피해 +2 / 공격 ${s.warfare.left}회 남음`, 'atk']);
    if (s.night)       b.push(['밤 ' + s.night, `${s.night}장 비용 -2`, 'buff']);
    if (s.champagne && !s.champagnePending) b.push(['샴페인 ' + s.champagne, '비용 -1', 'buff']);
    if (s.champagnePending) b.push(['샴페인 예약', '다음 턴 최대 4장 비용 -1', 'buff']);
    if (s.paradise && !s.paradisePending) b.push(['낙원', '카드 1장 비용 -2', 'buff']);
    if (s.paradisePending) b.push(['낙원 예약', '다음 턴 카드 1장 비용 -2', 'buff']);
    s.blood.forEach(x => b.push(['피 ' + x.left, `라운드 종료 시 피해 2 (${x.left}회 남음)`, 'bad']));
    if (s.punish)      b.push(['처형 선고', `다음 턴 종료 시 판정 (방어 감소 ${s.punish.defenseSum}/${s.punish.sentenceHP})`, 'bad']);
    if (s.ban)         b.push([(s.ban.kind === 'offense' ? '공격' : '교란') + ' 금지', '「혼란」 효과', 'bad']);
    s.locks.forEach(l => b.push(['피해망상: ' + CARD_BY_ID[l.cardId].name, '사용 불가', 'bad']));
    if (s.reveal)      b.push(['손패 공개', '「낮」 효과', 'bad']);
    s.dayBan.forEach(id => b.push(['금지: ' + CARD_BY_ID[id].name, '「낮」 효과', 'bad']));
    if (s.confusion)   b.push(['혼란 ' + s.confusion.cards.length, '홀수 라운드마다 소멸 카드 회수', 'buff']);
    if (s.mustUse.length) b.push(['강제 사용', '좀비로 드로우한 카드는 반드시 사용', 'bad']);
    return b.map(x => `<span class="badge bg-${x[2]}" title="${x[1]}">${x[0]}</span>`).join('');
  }

  function hpBar(p){
    const pct = Math.max(0, Math.min(100, p.hp / p.maxHp * 100));
    const cls = p.hp <= 5 ? 'low' : p.hp <= 10 ? 'mid' : '';
    return `<div class="hpbar"><div class="hpfill ${cls}" style="width:${pct}%"></div>
            <span class="hptext">${Math.max(0, p.hp)} / ${p.maxHp}</span></div>`;
  }

  /* ---------- 렌더 ---------- */
  function render(){
    if (!G.players.length) return;

    $('#roundInfo').textContent = (G.deathmatch ? '데스매치 R' : '라운드 ') + G.round + (G.deathmatch ? '' : ' / 10');
    $('#pileInfo').innerHTML =
      `덱 <b>${G.deck.length}</b> · 버림 <b>${G.discard.length}</b> · 소멸 <b>${G.exiled.length}</b>` +
      (G.eclipse >= G.round ? ' · <span class="warn">🌑 일식(생존 카드 비용 +1)</span>' : '') +
      (G.carried.length ? ` · <span class="warn">↪ 이월 ${G.carried.length}</span>` : '');

    // 상대
    const box = $('#opponents');
    box.innerHTML = '';
    G.players.slice(1).forEach(p => {
      const el = document.createElement('div');
      el.className = 'opp' + (p.alive ? '' : ' dead') + (G.current === p ? ' active' : '');
      el.dataset.idx = p.idx;
      el.innerHTML =
        `<div class="opp-head"><span class="opp-name">${p.name}</span>
           <span class="opp-hand">🂠 ${p.hand.length}</span></div>
         ${hpBar(p)}
         <div class="badges">${badges(p)}</div>`;
      if (p.st.reveal){
        const hd = document.createElement('div');
        hd.className = 'reveal';
        hd.innerHTML = '<div class="reveal-t">공개된 손패</div>';
        const row = document.createElement('div'); row.className = 'mini-row';
        p.hand.forEach(c => {
          const m = document.createElement('span');
          m.className = 'mini t-' + c.type + (p.st.dayBan.includes(c.id) ? ' banned' : '');
          m.textContent = c.name;
          m.title = c.text;
          row.appendChild(m);
        });
        hd.appendChild(row); el.appendChild(hd);
      }
      if (!p.alive) el.insertAdjacentHTML('beforeend', '<div class="deadmark">탈락</div>');
      box.appendChild(el);
    });

    // 나
    const p0 = me();
    $('#myPanel').innerHTML =
      `<div class="opp-head"><span class="opp-name">${p0.name}${G.current === p0 ? ' <span class="turnmark">내 턴</span>' : ''}</span>
         <span class="opp-hand">🂠 ${p0.hand.length}</span></div>
       ${hpBar(p0)}
       <div class="badges">${badges(p0)}</div>` +
      (p0.alive ? '' : '<div class="deadmark">탈락</div>');

    // 손패
    const hand = $('#hand');
    hand.innerHTML = '';
    p0.hand.forEach(c => {
      const reason = whyCannot(p0, c);
      const playable = myTurn && !busy && reason === null;
      const el = cardEl(c, { owner:p0, cls: playable ? 'playable' : 'unplayable' });
      if (p0.st.mustUse.includes(c.id)) el.classList.add('must');
      el.title = `${c.name} (${TYPE_NAME[c.type]} / 비용 ${costOf(p0, c)})\n${c.text}` +
                 (reason ? `\n\n※ ${reason}` : '');
      el.onclick = () => onCardClick(c, reason);
      hand.appendChild(el);
    });

    // 턴 종료 버튼
    const et = $('#endTurnBtn');
    const forced = myTurn ? pendingMustUse(p0) : [];
    et.disabled = !myTurn || busy || forced.length > 0;
    et.textContent = forced.length ? `「${forced[0].name}」을(를) 반드시 사용해야 합니다` : '턴 종료';

    renderLog();
  }

  function renderLog(){
    const box = $('#log');
    if (!box) return;
    box.innerHTML = G.log.map(e => `<div class="lg ${e.cls}">${e.msg}</div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  /* 터치 환경에는 툴팁이 없으므로 사용 불가 사유를 잠깐 띄워 준다 */
  let hintTimer = null;
  function showHint(msg){
    const h = $('#hint');
    h.textContent = msg;
    h.hidden = false;
    h.style.animation = 'none'; void h.offsetWidth; h.style.animation = '';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { h.hidden = true; }, 1800);
  }

  /* 클릭 한 번으로 바로 사용 (대상 지정이 필요한 카드는 대상 선택 창에서 취소 가능) */
  function onCardClick(card, reason){
    if (busy) return;
    if (!myTurn) return showHint('내 턴이 아닙니다');
    if (reason)  return showHint(`「${card.name}」 · ${reason}`);
    doPlay(card);
  }

  async function doPlay(card){
    if (busy) return;
    busy = true; render();
    try { await playCard(me(), card); }
    catch (e){ console.error(e); L('오류: ' + e.message, 'warn'); }
    busy = false;
    render();
    // 자신이 탈락했거나 게임이 끝났으면 턴을 자동 종료
    if ((!me().alive || G.over) && endTurnResolve) endTurnResolve();
  }

  /* ---------- 사람 턴 ---------- */
  function humanTurn(p){
    myTurn = true;
    render();
    if (AUTOTEST){
      return AI.takeTurn(p).then(() => { myTurn = false; render(); });
    }
    return new Promise(res => {
      endTurnResolve = () => { myTurn = false; endTurnResolve = null; render(); res(); };
      if (!p.alive) endTurnResolve();
    });
  }

  /* ---------- 모달 (선택 요청) ---------- */
  function ask(spec){
    if (AUTOTEST) return Promise.resolve(autoAnswer(spec));
    return new Promise(resolve => {
      const m  = $('#modal');
      const bd = $('#modalBody');
      m.hidden = false;
      bd.innerHTML = `<div class="m-prompt">${(spec.prompt || '').replace(/\n/g, '<br>')}</div>`;
      const wrap = document.createElement('div');
      wrap.className = 'm-body';
      bd.appendChild(wrap);
      const foot = document.createElement('div');
      foot.className = 'm-foot';
      bd.appendChild(foot);

      const done = v => { m.hidden = true; bd.innerHTML = ''; resolve(v); };

      if (spec.kind === 'confirm'){
        const y = mkBtn('발동한다', 'primary', () => done(true));
        const n = mkBtn('발동하지 않는다', '', () => done(false));
        foot.append(y, n);
      }
      else if (spec.kind === 'options'){
        spec.list.forEach(o => {
          const b = mkBtn(o.label + (o.desc ? ` (${o.desc})` : ''), 'wide', () => done(o.value));
          b.disabled = !!o.disabled;
          wrap.appendChild(b);
        });
        wrap.classList.add('col');
      }
      else if (spec.kind === 'players'){
        const chosen = [];
        wrap.classList.add('row');
        spec.list.forEach(pl => {
          const b = document.createElement('button');
          b.className = 'pbtn';
          b.innerHTML = `<div class="pb-name">${pl.name}</div><div class="pb-hp">HP ${pl.hp}</div>
                         <div class="pb-hand">손패 ${pl.hand.length}장</div>`;
          b.onclick = () => {
            if (spec.count === 1) return done([pl]);
            const i = chosen.indexOf(pl);
            if (i >= 0){ chosen.splice(i, 1); b.classList.remove('on'); }
            else if (chosen.length < spec.count){ chosen.push(pl); b.classList.add('on'); }
            okBtn.disabled = chosen.length !== spec.count;
          };
          wrap.appendChild(b);
        });
        const okBtn = mkBtn('확인', 'primary', () => done(chosen.slice()));
        if (spec.count > 1){ okBtn.disabled = true; foot.appendChild(okBtn); }
        if (spec.cancel) foot.appendChild(mkBtn('취소', '', () => done(null)));
      }
      else if (spec.kind === 'cards'){
        const chosen = [];
        wrap.classList.add('cards');
        spec.list.forEach(c => {
          const el = cardEl(c, { cls:'pick' });
          el.onclick = () => {
            if (spec.count === 1) return done([c]);
            const i = chosen.indexOf(c);
            if (i >= 0){ chosen.splice(i, 1); el.classList.remove('selected'); }
            else if (chosen.length < spec.count){ chosen.push(c); el.classList.add('selected'); }
            okBtn.disabled = chosen.length !== spec.count;
          };
          wrap.appendChild(el);
        });
        const okBtn = mkBtn(`확인 (${spec.count}장 선택)`, 'primary', () => done(chosen.slice()));
        if (spec.count > 1){ okBtn.disabled = true; foot.appendChild(okBtn); }
      }
    });
  }

  function mkBtn(label, cls, fn){
    const b = document.createElement('button');
    b.className = 'btn ' + (cls || '');
    b.textContent = label;
    b.onclick = fn;
    return b;
  }

  /* ---------- 종료 ---------- */
  function gameOver(){
    myTurn = false;
    render();
    const rank = G.players.slice().sort((a, b) => (b.alive - a.alive) || (b.hp - a.hp));
    const rows = rank.map((p, i) =>
      `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.alive ? 'HP ' + p.hp : '탈락'}</td></tr>`).join('');
    $('#modalBody').innerHTML =
      `<div class="m-prompt big">${G.winner ? '🏆 ' + G.winner.name + ' 승리!' : '게임 종료'}</div>
       <table class="rank"><tr><th>순위</th><th>플레이어</th><th>결과</th></tr>${rows}</table>`;
    const foot = document.createElement('div');
    foot.className = 'm-foot';
    foot.appendChild(mkBtn('다시 하기', 'primary', () => location.reload()));
    $('#modalBody').appendChild(foot);
    $('#modal').hidden = false;
  }

  function onLog(){ renderLog(); }

  /* ---------- 연출 (팝업 + HP 바 피격 애니메이션) ---------- */
  const fx = { nodes:[], combo:{}, timer:null, toastTimer:null };

  function fxClear(){
    fx.nodes.forEach(n => { n.classList.add('fx-gone'); setTimeout(() => n.remove(), 280); });
    fx.nodes = []; fx.combo = {};
    clearTimeout(fx.timer); fx.timer = null;
  }

  function barRect(idx){
    const el = document.querySelector(`[data-idx="${idx}"] .hpbar`);
    return el ? el.getBoundingClientRect() : null;
  }

  /* HP 바 위에 수치를 띄우고, 같은 카드로 연속 피격되면 콤보처럼 쌓아 올린다 */
  function fxHit(idx, text, cls){
    const r = barRect(idx);
    if (!r) return;
    const layer = $('#fx');
    const n = (fx.combo[idx] = (fx.combo[idx] || 0) + 1);

    const num = document.createElement('div');
    num.className = 'fx-num ' + cls;
    num.textContent = text;
    num.style.left = `${r.left + r.width / 2 + (n - 1) * 30}px`;
    num.style.top  = `${r.top - 4 - (n - 1) * 15}px`;
    layer.appendChild(num);
    fx.nodes.push(num);

    const flash = document.createElement('div');
    flash.className = 'fx-flash ' + cls;
    flash.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    layer.appendChild(flash);
    setTimeout(() => flash.remove(), 600);

    // 다음 공격이 없어도 일정 시간 뒤에는 사라지도록
    clearTimeout(fx.timer);
    fx.timer = setTimeout(fxClear, Math.max(2000, G.speed * 3));
  }

  const TYPE_ICON = { offense:'⚔️', defense:'🛡️', survival:'💖',
                      disturb:'🌀', ancillary:'🧩', special:'🌟' };

  function showToast(d){
    const t = $('#toast');
    const tgt = d.targets && d.targets.length
      ? `<span class="tt-arrow">→</span><span class="tt-target">${d.targets.map(x => x.name).join(', ')}</span>` : '';
    t.innerHTML =
      `<div class="tt-ribbon">${d.player.name}</div>` +
      (d.trap ? '<div class="tt-trap">함정 발동!</div>' : '') +
      `<span class="tt-icon">${TYPE_ICON[d.card.type]}</span>` +
      `<span class="tt-card">「${d.card.name}」</span>` +
      `<div class="tt-sub"><span class="tt-cost">비용 ${d.cost}</span>${tgt}</div>`;
    t.className = 't-' + d.card.type;
    t.hidden = false;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';   // 재생 리셋
    clearTimeout(fx.toastTimer);
    fx.toastTimer = setTimeout(() => { t.hidden = true; }, Math.max(1400, G.speed * 2.4));
  }

  function onEvent(type, d){
    switch (type){
      case 'play':
        fxClear();                       // 다음 공격이 나오면 이전 콤보 표시는 사라진다
        showToast(d);
        break;
      case 'damage':
        if (d.amount > 0)        fxHit(d.target.idx, '-' + d.amount, 'dmg');
        else if (d.prevented > 0) fxHit(d.target.idx, '방어', 'block');
        break;
      case 'heal':   fxHit(d.target.idx, '+' + d.amount, 'heal'); break;
      case 'revive': fxHit(d.target.idx, '부활!', 'revive'); break;
      case 'out':    fxHit(d.target.idx, '탈락', 'elim'); break;
    }
  }

  /* ---------- 초기화 ---------- */
  function init(){
    G.io = { ask };
    $('#endTurnBtn').onclick = () => { if (endTurnResolve) endTurnResolve(); };
    $('#rulesBtn').onclick   = () => { $('#rules').hidden = !$('#rules').hidden; };
    $('#speedSel').onchange  = e => { G.speed = +e.target.value; };

    document.querySelectorAll('#start .pcount').forEach(b => {
      b.onclick = () => {
        $('#start').hidden = true;
        $('#board').hidden = false;
        startGame(+b.dataset.n, '나');
      };
    });

    /* 개발용: index.html?fxdemo — 게임을 진행하지 않고 연출만 한 번 재생 */
    if (/[?&]fxdemo/.test(location.search)){
      G.players = [makePlayer(0,'나',false), makePlayer(1,'봇 알파',true), makePlayer(2,'봇 베타',true)];
      G.order = [0,1,2]; G.round = 4; G.deck = CARDS.map(c => ({ ...c }));
      // 설명문이 가장 긴 카드들로 손패를 채워 최악의 경우 레이아웃을 확인
      ['punishment','confusion','rainbow','haze','champagne','immortal']
        .forEach(id => G.players[0].hand.push({ ...CARD_BY_ID[id] }));
      G.players[1].hand = G.deck.splice(0,4);
      G.players[2].hand = G.deck.splice(0,4);
      G.players[0].hp = 13; G.players[1].hp = 17; G.players[2].hp = 16;
      $('#start').hidden = true; $('#board').hidden = false;
      render();
      setTimeout(() => {
        onEvent('play',   { player:G.players[2], card:CARD_BY_ID.netherworld, cost:4, targets:[G.players[0]] });
        onEvent('damage', { target:G.players[0], amount:7, prevented:0 });
        onEvent('damage', { target:G.players[0], amount:3, prevented:1 });
        onEvent('damage', { target:G.players[2], amount:2, prevented:0 });
        onEvent('heal',   { target:G.players[1], amount:3 });
      }, 60);
      return;
    }

    if (AUTOTEST){
      window.__uiErrors = [];
      window.addEventListener('error', e => window.__uiErrors.push(String(e.message)));
      window.addEventListener('unhandledrejection', e => window.__uiErrors.push(String(e.reason)));
      const sp = /speed=(\d+)/.exec(location.search);
      G.speed = sp ? +sp[1] : 0;
      $('#start').hidden = true; $('#board').hidden = false;
      startGame(4, '나').then(() => {
        const d = document.createElement('div');
        d.id = 'autotestResult';
        const de = document.documentElement;
        // #hand 는 의도적으로 가로 스크롤되므로 그 안쪽은 제외
        const wide = [...document.querySelectorAll('#board *')]
          .filter(el => !el.closest('#hand') && el.getBoundingClientRect().right > de.clientWidth + 1)
          .slice(0, 5).map(el => el.id || el.className).join(',');
        d.textContent = `AUTOTEST-DONE round=${G.round} winner=${G.winner ? G.winner.name : 'none'} ` +
                        `errors=${window.__uiErrors.length}${window.__uiErrors.length ? ':' + window.__uiErrors.join('|') : ''} ` +
                        `scrollW=${de.scrollWidth} clientW=${de.clientWidth}` + (wide ? ` overflow=[${wide}]` : '');
        document.body.appendChild(d);
      });
    }
  }

  return { render, humanTurn, gameOver, onLog, onEvent, init, ask };
})();

window.addEventListener('DOMContentLoaded', UI.init);
