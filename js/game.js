/* ===================================================================
 * 37 게임 - 규칙 엔진 (규칙서 v2.12)
 * =================================================================== */

/* ---------------- 유틸 ---------------- */
/* 시드를 주면 재현 가능한 난수 (밸런스 튜닝/테스트용, 시드 미설정이면 Math.random)
 * 인접한 시드끼리 상관이 생기지 않도록 splitmix32로 시드를 흩뜨린 뒤 mulberry32를 씁니다. */
let _seed = 0, _seeded = false;
function setSeed(s){
  let z = (((s >>> 0) + 0x9E3779B9) >>> 0);
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  _seed = (z ^ (z >>> 15)) >>> 0;
  _seeded = true;
}
function clearSeed(){ _seeded = false; }
function rand(){
  if (!_seeded) return Math.random();
  _seed = (_seed + 0x6D2B79F5) >>> 0;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=(rand()*(i+1))|0; const t=a[i]; a[i]=a[j]; a[j]=t;} return a; }
function rnd(a){ return a[(rand()*a.length)|0]; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function pickN(arr,n){ return shuffle(arr.slice()).slice(0,n); }

/* ---------------- 상태 ---------------- */
function freshStatus(){
  return {
    rain:false,          // 비: 다음 턴 시작까지 공격 피해 -1
    fortune:0,           // 행운: 남은 횟수
    snowpeak:0,          // 설산: 남은 횟수
    gate:false,          // 관문: 다음 상대 카드 1장 무효
    immortal:false,      // 불멸
    iridescence:false,   // 훈색
    phoenix:false,       // 불사조 대기
    flower:false,        // 꽃: 지속 피해 -1 (영구)
    paradise:0,          // 낙원: 다음 턴 카드 1장 비용 -2
    paradisePending:false,
    champagne:0,         // 샴페인: 다음 턴 최대 4장 비용 -1
    champagnePending:false,
    night:0,             // 밤: 이번 턴 최대 6장 비용 -2
    warfare:null,        // {left:2}
    blood:[],            // [{from:라운드, left:2}]
    punish:null,         // {sentenceHP, defenseSum, by}
    ban:null,            // {kind:'offense'|'disturb', until:라운드}
    locks:[],            // [{cardId, turns}] 피해망상
    reveal:0,            // 손패 공개 유지 라운드
    dayBan:[],           // 낮으로 사용 금지된 카드 id
    confusion:null,      // {cards:[cardId...]}
    mustUse:[]           // 반드시 사용해야 하는 카드 id (좀비)
  };
}

function makePlayer(idx, name, isAI){
  return { idx, name, isAI, hp:20, maxHp:20, alive:true, hand:[], st:freshStatus(),
           lastHitBy:null,   // 마지막으로 HP를 깎은 상대 (없으면 자해·비용 지불)
           killedBy:null };
}

const G = {
  players:[], deck:[], discard:[], exiled:[],
  round:1, order:[], turnPtr:0, current:null,
  eclipse:0,            // 이 라운드까지 일식 유효 (0 = 없음)
  carried:[],           // 훈색 이월 패킷
  deathmatch:false, over:false, winner:null,
  playedNames:null, log:[], io:null, speed:1200,  // 연출 대기 기준값 (ms)
  killBonus:5           // 추가 규칙: 플레이어를 탈락시키면 즉시 HP 회복 (0이면 비활성)
};

/* ---------------- 연출 이벤트 ----------------
 * UI가 팝업/피격 애니메이션을 그릴 수 있도록 구조화된 사건을 전달합니다.
 * type: play(카드 사용) | damage(피해) | heal(회복) | revive(불사조) | out(탈락) */
function emit(type, data){
  if (typeof UI !== 'undefined' && UI.onEvent) UI.onEvent(type, data);
}

/* ---------------- 로그 ---------------- */
function L(msg, cls){
  G.log.push({ round:G.round, msg, cls:cls||'' });
  if (G.log.length > 400) G.log.shift();
  if (typeof UI !== 'undefined' && UI.onLog) UI.onLog();
}

/* ---------------- 조회 ---------------- */
const alive      = () => G.players.filter(p => p.alive);
const others     = (p) => G.players.filter(x => x.alive && x !== p);
const lateGame   = () => G.deathmatch || G.round >= 9;

/* ---------------- 덱 ---------------- */
function buildDeck(){
  G.deck = shuffle(CARDS.map(c => ({ ...c })));
}
function rebuildDeck(){
  if (!G.discard.length) return false;
  G.deck = shuffle(G.discard.splice(0, G.discard.length));
  L('덱이 소진되어 버린 카드 더미를 섞어 새 덱을 만듭니다. (소멸 카드 제외)', 'sys');
  return true;
}
function drawOne(p){
  if (!G.deck.length && !rebuildDeck()) return null;
  const c = G.deck.shift();
  p.hand.push(c);
  return c;
}
function draw(p, n, silent){
  const got = [];
  for (let i=0;i<n;i++){ const c = drawOne(p); if (!c) break; got.push(c); }
  if (!silent && got.length) L(`${p.name}: 카드 ${got.length}장 드로우`, 'draw');
  return got;
}
function toDiscard(card){ G.discard.unshift(card); }        // discard[0] = 맨 위
function toDiscardBottom(card){ G.discard.push(card); }
function dispose(card){
  if (card.disposal === 'exile'){ G.exiled.push(card); L(`  └ ${card.name} 소멸`, 'dim'); }
  else if (card.disposal === 'deckBottom'){ G.deck.push(card); L(`  └ ${card.name} 덱 맨 아래로`, 'dim'); }
  else toDiscard(card);
}

/* ---------------- 비용 ---------------- */
function costOf(p, card){
  let disc = 0;
  if (p.st.night > 0)                               disc += 2;
  if (p.st.champagne > 0 && !p.st.champagnePending) disc += 1;
  if (p.st.paradise  > 0 && !p.st.paradisePending)  disc += 2;
  let c = Math.max(0, card.cost - disc);          // 감소 효과를 모두 적용한 뒤
  if (G.eclipse >= G.round && card.type === 'survival') c += 1;   // 추가 비용 계산
  return c;
}
function consumeDiscounts(p, card){
  if (p.st.night > 0) p.st.night--;
  if (p.st.paradise > 0 && !p.st.paradisePending) p.st.paradise--;
  else if (p.st.champagne > 0 && !p.st.champagnePending) p.st.champagne--;
}

/* ---------------- 사용 가능 판정 ---------------- */
function whyCannot(p, card){
  if (card.trap) return '함정 카드 (능동 사용 불가)';
  if (p.st.locks.some(l => l.cardId === card.id)) return '피해망상으로 사용 불가';
  if (p.st.dayBan.includes(card.id)) return '「낮」 효과로 사용 금지';
  if (p.st.ban && p.st.ban.until >= G.round){
    if (p.st.ban.kind === 'offense' && card.attack) return '「혼란」으로 공격 카드 사용 불가';
    if (p.st.ban.kind === 'disturb' && card.type === 'disturb') return '「혼란」으로 교란 카드 사용 불가';
  }
  if (G.playedNames && G.playedNames.has(card.name)) return '같은 턴에 같은 이름의 카드 사용 불가';
  if (p.st.warfare && card.attack && card.id !== 'warfare' && p.st.warfare.left <= 0)
    return '「전쟁」 제한: 이번 턴 공격 카드 2회 소진';
  if (card.id === 'gold' && p.hp === 1) return 'HP가 1일 때는 사용 불가';
  if (card.id === 'time' && !G.deathmatch && [1,2,10].includes(G.round)) return '1·2·10라운드에는 사용 불가';
  if (card.id === 'rainbow' && G.discard.length < 10) return '버린 카드 더미 10장 이상 필요';
  if (card.id === 'epitaph' && G.discard.length < 10) return '버린 카드 더미 10장 이상 필요';
  if (card.id === 'confusion' && G.round % 2 === 0 && !others(p).length) return '지정할 대상 없음';
  if ((card.target === 'enemy' || card.target === 'enemy2') && others(p).length < (card.target==='enemy2'?2:1))
    return '대상이 부족합니다';
  if (p.hp < costOf(p, card)) return 'HP 부족';
  return null;
}
const canPlay = (p, card) => whyCannot(p, card) === null;

/* ---------------- 피해 / 회복 ---------------- */
/* kind: 'attack' (공격 카드 피해) | 'dot' (지속 피해) | 'effect' */
function dealDamage(src, tgt, raw, opts){
  opts = opts || {};
  if (!tgt.alive || raw <= 0) return 0;
  const kind = opts.kind || 'attack';
  let reduce = 0;

  if (!opts.ignoreDefense){
    if (kind === 'attack' && tgt.st.rain) reduce += 1;
    if (tgt.st.fortune > 0){ reduce += 1; tgt.st.fortune--; }
    if (tgt.st.snowpeak > 0){ reduce += 1; tgt.st.snowpeak--; }
    if (kind === 'dot' && tgt.st.flower) reduce += 1;
  }

  let final = Math.max(0, raw - reduce);
  const prevented = raw - final;

  // 처벌: 방어 카드로 실제 감소시킨 피해량 누적
  if (tgt.st.punish) tgt.st.punish.defenseSum += prevented;

  // 불멸: 상대의 카드 효과로 받는 피해는 HP를 1 미만으로 낮추지 못함
  if (tgt.st.immortal && src && src !== tgt && kind !== 'self'){
    const cap = Math.max(0, tgt.hp - 1);
    if (final > cap){ L(`  └ ${tgt.name} 「불멸」: 피해 ${final} → ${cap}`, 'def'); final = cap; }
  }

  tgt.hp -= final;
  // 마지막으로 HP를 깎은 주체를 기록 — 처치 보너스를 누구에게 줄지 판단한다
  if (final > 0) tgt.lastHitBy = (src && src !== tgt) ? src.idx : null;
  const redTxt = prevented > 0 ? ` (방어 ${prevented} 감소)` : '';
  L(`  └ ${tgt.name} 피해 ${final}${redTxt} → HP ${Math.max(tgt.hp,0)}`, 'dmg');
  emit('damage', { target:tgt, amount:final, prevented, hp:Math.max(tgt.hp,0), kind });
  return final;
}

/* 카드에 의한 대상 지정 판정: 관문(무효) / 훈색(이월) */
function guard(src, tgt, card){
  if (!card || tgt === src) return 'ok';
  if (tgt.st.gate && card.type !== 'special'){
    tgt.st.gate = false;
    L(`  └ ${tgt.name} 「관문」: ${card.name}의 효과 무효`, 'def');
    return 'negated';
  }
  return 'ok';
}

/* 공격 카드 피해 전달 (관문/훈색 처리 포함) */
function hit(src, tgt, amount, opts){
  opts = opts || {};
  const card = opts.card;
  if (!tgt.alive) return 0;
  if (card && tgt !== src && !opts.carried){
    if (guard(src, tgt, card) === 'negated'){
      // 관문도 방어 카드이므로, 무효화로 막은 피해량을 처벌 판정에 산입
      if (tgt.st.punish) tgt.st.punish.defenseSum += amount;
      return 0;
    }
    if (card.attack && tgt.st.iridescence){
      tgt.st.iridescence = false;
      G.carried.push({ src:src.idx, tgt:tgt.idx, amount, ignoreDefense:!!opts.ignoreDefense, cardName:card.name });
      L(`  └ ${tgt.name} 「훈색」: ${card.name}의 효과를 다음 라운드로 이월`, 'def');
      return 0;
    }
  }
  return dealDamage(src, tgt, amount, { kind:'attack', ignoreDefense:opts.ignoreDefense });
}

function heal(p, n){
  if (n <= 0) return 0;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + n);
  const got = p.hp - before;
  L(`  └ ${p.name} HP ${got} 회복 → HP ${p.hp}`, 'heal');
  if (got > 0) emit('heal', { target:p, amount:got, hp:p.hp });
  return got;
}

function checkDeaths(){
  // 동시 탈락을 한 묶음으로 처리해야 처치 보너스가 순서에 좌우되지 않는다
  const dying = G.players.filter(p => p.alive && p.hp <= 0);
  const fallen = [];
  dying.forEach(p => {
    if (p.st.phoenix){
      p.st.phoenix = false; p.hp = 5;
      L(`🔥 ${p.name} 「불사조」 발동! HP 5로 복구`, 'big');
      emit('revive', { target:p, hp:5 });
    } else { eliminate(p, null, p.lastHitBy); fallen.push(p); }
  });
  fallen.forEach(p => awardKillBonus(p.killedBy, p));
  checkEarlyEnd();
}

/* 탈락시킨 플레이어에게 HP 보너스.
 * 같은 묶음에서 함께 탈락한 플레이어는 받지 못한다. */
function awardKillBonus(killerIdx, victim){
  if (G.killBonus <= 0 || killerIdx == null) return;
  const k = G.players[killerIdx];
  if (!k || !k.alive || k === victim) return;
  const before = k.hp;
  k.hp = Math.min(k.maxHp, k.hp + G.killBonus);     // 회복이므로 최대 HP 20 상한 적용
  const got = k.hp - before;
  L(`💀 ${k.name}: ${victim.name} 처치 보너스 HP +${got} → HP ${k.hp}`, 'big');
  emit('killbonus', { target:k, amount:got, victim });
}

function eliminate(p, reason, killerIdx){
  if (!p.alive) return;
  p.alive = false;
  p.hp = Math.min(p.hp, 0);
  p.killedBy = (killerIdx != null && G.players[killerIdx] !== p) ? killerIdx : null;
  L(`☠️ ${p.name} 탈락${reason ? ' ('+reason+')' : ''}`, 'big');
  emit('out', { target:p, reason });
  while (p.hand.length) toDiscard(p.hand.pop());
}
function checkEarlyEnd(){
  const a = alive();
  if (a.length <= 1 && !G.over){
    G.over = true;
    G.winner = a[0] || null;
    L(G.winner ? `🏆 ${G.winner.name} 승리! (조기 종료)` : '전원 탈락', 'big');
  }
}

/* ---------------- 선택 요청 ---------------- */
async function ask(p, spec){
  if (p.isAI) return AI.answer(p, spec);
  return G.io.ask(spec);
}

/* ---------------- 카드 사용 ---------------- */
async function playCard(p, card, opts){
  opts = opts || {};
  const reason = whyCannot(p, card);
  if (reason && !opts.force){ L(`${p.name}: ${card.name} 사용 불가 - ${reason}`, 'warn'); return false; }

  // 1) 대상 지정 (선언의 일부, 취소 가능)
  let targets = opts.targets || null;
  if (!targets){
    targets = await pickTargets(p, card);
    if (targets === null) return false;   // 취소
  }

  // 2) 비용 지불
  const cost = costOf(p, card);
  consumeDiscounts(p, card);
  p.hp -= cost;
  p.lastHitBy = null;          // 비용 지불로 쓰러지면 처치 보너스 대상이 아니다

  // 3) 사용 선언
  const i = p.hand.indexOf(card);
  if (i >= 0) p.hand.splice(i, 1);
  p.st.mustUse = p.st.mustUse.filter(id => id !== card.id);
  G.playedNames.add(card.name);
  if (p.st.warfare && card.attack && card.id !== 'warfare') p.st.warfare.left--;
  const tnames = targets.length ? ` → ${targets.map(t=>t.name).join(', ')}` : '';
  L(`▶ ${p.name}: 「${card.name}」 사용 (비용 ${cost}, HP ${Math.max(p.hp,0)})${tnames}`, 'play');
  emit('play', { player:p, card, cost, hp:Math.max(p.hp,0), targets });

  // 4) 실안개 함정 (단일 대상 공격 카드)
  if (card.attack && card.target === 'enemy' && targets[0]) await hazeTrap(p, targets[0], card);

  // 5) 효과 해결
  // 자기소멸 예외: 비용 지불로 HP가 0 이하가 되어도 효과는 정상 해결
  await resolveCard(p, card, { targets, card });

  // 6) 버림 또는 소멸
  dispose(card);

  // 7) 자기소멸 예외 판정 포함 사망 처리
  checkDeaths();
  if (typeof UI !== 'undefined') UI.render();
  return true;
}

async function pickTargets(p, card){
  const cand = others(p);
  if (card.target === 'enemy'){
    if (cand.length === 1) return [cand[0]];
    const r = await ask(p, { kind:'players', list:cand, count:1, cancel:true, prompt:`「${card.name}」의 대상을 지정하세요` });
    return r ? [r[0]] : null;
  }
  if (card.target === 'enemy2'){
    if (cand.length === 2) return cand.slice();
    const r = await ask(p, { kind:'players', list:cand, count:2, cancel:true, prompt:`「${card.name}」의 대상 2명을 지정하세요` });
    return r ? r : null;
  }
  return [];
}

/* 실안개 */
async function hazeTrap(attacker, target, card){
  const haze = target.hand.find(c => c.id === 'haze');
  if (!haze) return;
  const cost = costOf(target, haze);
  if (target.hp <= cost) return;   // 비용 지불 불가
  const use = await ask(target, {
    kind:'confirm',
    prompt:`${attacker.name}의 「${card.name}」 대상이 되었습니다.\n손패의 「실안개」를 발동하시겠습니까? (비용 ${cost}, 공격자에게 피해 4)`
  });
  if (!use) return;
  target.hand.splice(target.hand.indexOf(haze), 1);
  target.hp -= cost;
  target.lastHitBy = null;
  L(`  ⚠ ${target.name} 「실안개」 발동! (비용 ${cost})`, 'trap');
  emit('play', { player:target, card:haze, cost, hp:Math.max(target.hp,0), targets:[attacker], trap:true });
  dealDamage(target, attacker, 4, { kind:'attack' });
  toDiscard(haze);
  checkDeaths();
}

/* ---------------- 효과 해결 ---------------- */
async function resolveCard(p, card, ctx){
  const copied = !!ctx.copied;
  if (copied && ['skeleton','rainbow','prism'].includes(card.id)){
    L('  └ 복사한 효과는 다시 다른 효과를 복사할 수 없습니다.', 'warn');
    return;
  }
  let T = ctx.targets;
  if (!T){ T = await pickTargets(p, card); if (T === null) T = []; }
  const t = T[0];
  const bonus = (p.st.warfare && card.attack) ? 2 : 0;

  switch (card.id){
    /* ===== 공격 ===== */
    case 'gun':
      if (t) hit(p, t, 2 + bonus, { card });
      break;

    case 'katana':
      if (t) hit(p, t, 3 + bonus, { card, ignoreDefense:true });
      break;

    case 'explosion': {
      const tg = pickN(others(p), 2);
      if (!tg.length) L('  └ 대상이 없습니다.', 'dim');
      tg.forEach(x => { L(`  └ 무작위 대상: ${x.name}`, 'dim'); hit(p, x, 2 + bonus, { card }); });
      dealDamage(p, p, 1, { kind:'self' });
      break;
    }

    case 'warfare':
      p.st.warfare = { left:2 };
      L('  └ 이번 턴 공격 카드 피해 +2 / 공격 카드 사용 최대 2회', 'buff');
      break;

    case 'netherworld':
      if (t) hit(p, t, 7 + bonus, { card });
      dealDamage(p, p, 2, { kind:'self' });
      break;

    case 'zombie': {
      if (t) hit(p, t, 2 + bonus, { card });
      const got = draw(p, 1);
      if (got[0]){
        p.st.mustUse.push(got[0].id);
        L(`  └ 「${got[0].name}」 드로우 - 사용 가능한 첫 기회에 반드시 사용해야 합니다`, 'warn');
      }
      break;
    }

    case 'punishment': {
      if (!t) break;
      if (guard(p, t, card) === 'negated') break;
      if (t.hp <= 7 && t.hand.length >= 4){
        t.st.punish = { sentenceHP:t.hp, defenseSum:0, by:p.idx };
        L(`  └ ⚖️ ${t.name}에게 「처형」 선고! (선고 시 HP ${t.hp}) 다음 턴 종료 시 판정`, 'big');
      } else {
        L(`  └ 조건 미충족 (HP ${t.hp}, 손패 ${t.hand.length}장) - 선고되지 않음`, 'dim');
      }
      break;
    }

    /* ===== 방어 ===== */
    case 'rain':        p.st.rain = true; L('  └ 다음 턴 시작까지 공격 카드 피해 -1', 'buff'); break;
    case 'fortune':     p.st.fortune = 3; L('  └ 다음 3번 받는 피해 각각 -1', 'buff'); break;
    case 'iridescence': p.st.iridescence = true; L('  └ 다음 받는 공격 카드 1장을 다음 라운드로 이월', 'buff'); break;
    case 'gate':        p.st.gate = true; L('  └ 다음 턴 시작까지 상대 카드 1장 무효 (특수 제외)', 'buff'); break;
    case 'snowpeak':    p.st.snowpeak = 2; L('  └ 다음 2번 받는 피해 각각 -1', 'buff'); draw(p,1); break;
    case 'phoenix':     p.st.phoenix = true; L('  └ HP 0 이하가 되면 1회 한정 HP 5로 복구', 'buff'); break;
    case 'haze':        L('  └ 실안개는 함정으로만 발동합니다.', 'dim'); break;

    /* ===== 생존 ===== */
    case 'gold':       heal(p, lateGame() ? 2 : 3); break;
    case 'diamond':    heal(p, lateGame() ? 4 : 5); break;
    case 'flower':     p.st.flower = true; L('  └ 지속 피해 1 감소 (지속)', 'buff'); draw(p,1); break;
    case 'painkiller': clearDebuffs(p); heal(p, 1); break;
    case 'light':
      alive().forEach(x => { x.hp = Math.min(x.maxHp, x.hp + 1); });
      L('  └ 모든 플레이어 HP +1', 'heal');
      heal(p, 1);
      break;
    case 'immortal':  p.st.immortal = true; L('  └ 다음 턴 시작까지 상대 효과로 HP가 1 미만이 되지 않음', 'buff'); break;
    case 'paradise':  heal(p, 4); p.st.paradise = 1; p.st.paradisePending = true;
                      L('  └ 다음 자신의 턴에 사용하는 카드 1장 비용 -2', 'buff'); break;

    /* ===== 교란 ===== */
    case 'eclipse':
      G.eclipse = G.round + 1;
      L('  └ 다음 라운드 종료 시까지 모든 생존 카드 비용 +1', 'buff');
      break;

    case 'tornado': {
      const [a, b] = T.length === 2 ? T : pickN(others(p), 2);
      if (!a || !b){ L('  └ 대상 부족', 'dim'); break; }
      const ca = pickN(a.hand, Math.min(2, a.hand.length));
      const cb = pickN(b.hand, Math.min(2, b.hand.length));
      ca.forEach(c => a.hand.splice(a.hand.indexOf(c),1));
      cb.forEach(c => b.hand.splice(b.hand.indexOf(c),1));
      ca.forEach(c => b.hand.push(c));
      cb.forEach(c => a.hand.push(c));
      L(`  └ ${a.name} ↔ ${b.name} 손패 ${ca.length}/${cb.length}장 교환`, 'buff');
      break;
    }

    case 'paranoia': {
      if (!t) break;
      if (guard(p, t, card) === 'negated') break;
      if (!t.hand.length){ L('  └ 대상의 손패가 없습니다.', 'dim'); break; }
      const c = rnd(t.hand);
      t.st.locks.push({ cardId:c.id, turns:1 });
      L(`  └ ${t.name}의 손패 공개: 「${c.name}」 - 다음 턴까지 사용 불가`, 'buff');
      break;
    }

    case 'confusion':  await confusionEffect(p); break;

    case 'skeleton': {
      const src = G.discard.find(c => c.cost <= 2);
      if (!src){ L('  └ 버린 카드 더미에 비용 2 이하 카드가 없습니다.', 'dim'); break; }
      L(`  └ 「${src.name}」의 효과 복사`, 'buff');
      await resolveCard(p, src, { copied:true });
      break;
    }

    case 'blood': {
      if (!t) break;
      if (guard(p, t, card) === 'negated') break;
      t.st.blood.push({ from:G.round + 1, left:2, src:p.idx });
      L(`  └ ${t.name}에게 디버프: 다음 라운드부터 2라운드 동안 라운드 종료 시 피해 2`, 'buff');
      break;
    }

    /* ===== 보조 ===== */
    case 'time':   draw(p, 2); break;
    case 'piper':  draw(p, 1); break;

    case 'stairs': {
      if (!G.deck.length) rebuildDeck();
      const top = G.deck.splice(0, Math.min(3, G.deck.length));
      if (!top.length){ L('  └ 덱이 비어 있습니다.', 'dim'); break; }
      const r = await ask(p, { kind:'cards', list:top, count:1, prompt:'덱 위 3장 중 1장을 손패로 (나머지는 덱 맨 아래로)' });
      const chosen = (r && r[0]) || top[0];
      p.hand.push(chosen);
      top.filter(c => c !== chosen).forEach(c => G.deck.push(c));
      L(`  └ 「${chosen.name}」 손패로, 나머지 ${top.length-1}장 덱 맨 아래로`, 'draw');
      break;
    }

    case 'champagne':
      p.st.champagne = 4; p.st.champagnePending = true;
      L('  └ 다음 자신의 턴에 최대 4장의 비용 각각 -1', 'buff');
      break;

    case 'path': {
      if (!G.deck.length) rebuildDeck();
      if (!G.deck.length){ L('  └ 덱이 비어 있습니다.', 'dim'); break; }
      const where = await ask(p, { kind:'options', prompt:'어디에서 드로우하시겠습니까?',
        list:[{value:'top', label:'덱 맨 위'}, {value:'bottom', label:'덱 맨 아래'}] });
      const c = (where === 'bottom') ? G.deck.pop() : G.deck.shift();
      p.hand.push(c);
      L(`  └ 덱 ${where === 'bottom' ? '맨 아래' : '맨 위'}에서 1장 드로우`, 'draw');
      break;
    }

    case 'prism': {
      const pool = CARDS.filter(d =>
        d.cost <= 2 && (d.type === 'disturb' || d.type === 'ancillary') &&
        !G.exiled.some(e => e.id === d.id));
      if (!pool.length){ L('  └ 복사할 수 있는 카드가 없습니다.', 'dim'); break; }
      const r = await ask(p, { kind:'cards', list:pool, count:1, prompt:'복사할 비용 2 이하 교란/보조 카드를 선택 (공개)' });
      const sel = (r && r[0]) || rnd(pool);
      L(`  └ 「${sel.name}」 공개 - 효과 복사`, 'buff');
      await resolveCard(p, sel, { copied:true });
      break;
    }

    case 'rainbow': {
      const c = rnd(G.discard);
      if (!c){ L('  └ 버린 카드 더미가 비어 있습니다.', 'dim'); break; }
      G.discard.splice(G.discard.indexOf(c), 1);
      L(`  └ 무작위 공개: 「${c.name}」(비용 ${c.cost})`, 'buff');
      if (c.cost >= 5 && !(G.round % 2 === 0 && G.round !== 10)){
        L('  └ 비용 5 이상 카드는 10라운드를 제외한 짝수 라운드에서만 사용 가능 - 효과 불발', 'warn');
      } else {
        await resolveCard(p, c, { copied:true });
      }
      toDiscardBottom(c);
      break;
    }

    case 'epitaph': {
      const top10 = G.discard.slice(0, 10).filter(c => c.cost <= 4);
      if (!top10.length){ L('  └ 위 10장 중 비용 4 이하 카드가 없습니다.', 'dim'); break; }
      const r = await ask(p, { kind:'cards', list:top10, count:1, prompt:'버린 카드 더미 위 10장 중 비용 4 이하 1장을 손패로' });
      const sel = (r && r[0]) || top10[0];
      G.discard.splice(G.discard.indexOf(sel), 1);
      p.hand.push(sel);
      L(`  └ 「${sel.name}」을(를) 손패로 가져옴`, 'draw');
      break;
    }

    /* ===== 특수 ===== */
    case 'day': {
      const tg = pickN(others(p), 2);
      if (!tg.length){ L('  └ 대상이 없습니다.', 'dim'); break; }
      tg.forEach(x => { x.st.reveal = G.round + 2; L(`  └ ${x.name}의 손패 공개 (3라운드 유지)`, 'buff'); });
      const pool = [];
      tg.forEach(x => x.hand.forEach(c => pool.push({ card:c, owner:x })));
      if (!pool.length) break;
      const n = Math.min(3, pool.length);
      const r = await ask(p, { kind:'cards', list:pool.map(o=>o.card), count:n,
        prompt:`공개된 카드 중 ${n}장을 선택하여 공개 유지 동안 사용 금지` });
      const sel = (r && r.length) ? r : pickN(pool.map(o=>o.card), n);
      sel.forEach(c => {
        const o = pool.find(x => x.card === c);
        if (o){ o.owner.st.dayBan.push(c.id); L(`  └ ${o.owner.name}의 「${c.name}」 사용 금지`, 'warn'); }
      });
      break;
    }

    case 'night': {
      p.st.night = 6;
      L('  └ 이번 턴 손패 최대 6장의 비용 각각 -2', 'buff');
      break;
    }

    default:
      L(`  └ (미구현 효과: ${card.id})`, 'warn');
  }
}

function clearDebuffs(p){
  const had = p.st.blood.length || p.st.locks.length || p.st.ban || p.st.dayBan.length;
  p.st.blood = []; p.st.locks = []; p.st.ban = null; p.st.dayBan = [];
  L(had ? '  └ 디버프 제거' : '  └ 제거할 디버프 없음', had ? 'buff' : 'dim');
}

async function confusionEffect(p){
  const opts = [];
  const canOpt1 = (G.round % 2 === 1) && G.exiled.length > 0;
  opts.push({ value:1, label:'[선택 1] 소멸 카드 최대 3장 지정 후 홀수 라운드마다 1장씩 회수',
              disabled:!canOpt1, desc: canOpt1 ? '' : '홀수 라운드 + 소멸 카드 필요' });
  opts.push({ value:2, label:'[선택 2] 플레이어 2명 지정 - 다음 라운드까지 공격/교란 중 하나 사용 불가',
              disabled: others(p).length < 1 });
  const choice = canOpt1 ? await ask(p, { kind:'options', prompt:'「혼란」 효과를 선택하세요', list:opts }) : 2;

  if (choice === 1){
    const n = Math.min(3, G.exiled.length);
    const r = await ask(p, { kind:'cards', list:G.exiled.slice(), count:n, prompt:`회수할 소멸 카드 ${n}장을 지정` });
    const sel = (r && r.length) ? r : pickN(G.exiled, n);
    p.st.confusion = { cards: sel.map(c => c.id) };
    L(`  └ 지정: ${sel.map(c=>c.name).join(', ')} - 이후 홀수 라운드마다 1장씩 손패로 (공개)`, 'buff');
  } else {
    const cand = others(p);
    const cnt = Math.min(2, cand.length);
    const r = cand.length <= cnt ? cand :
      await ask(p, { kind:'players', list:cand, count:cnt, prompt:`「혼란」 대상 ${cnt}명을 지정` });
    const sel = r || pickN(cand, cnt);
    for (const x of sel){
      if (guard(p, x, CARD_BY_ID.confusion) === 'negated') continue;
      const kind = await ask(x, { kind:'options', prompt:`「혼란」 지정됨 - 다음 라운드까지 사용 불가할 카드 종류를 선택하세요`,
        list:[{value:'offense', label:'공격 카드 사용 불가'}, {value:'disturb', label:'교란 카드 사용 불가'}] });
      x.st.ban = { kind, until: G.round + 1 };
      L(`  └ ${x.name}: 다음 라운드까지 ${kind === 'offense' ? '공격' : '교란'} 카드 사용 불가`, 'warn');
    }
  }
}

/* ---------------- 턴 ---------------- */
function beginTurn(p){
  G.current = p;
  G.playedNames = new Set();
  // "다음 자신의 턴 시작까지" 효과 종료
  p.st.rain = false; p.st.gate = false; p.st.immortal = false;
  p.st.champagnePending = false;   // 예약된 비용 감소가 이번 턴부터 유효
  p.st.paradisePending  = false;
  L(`— ${p.name}의 턴 (HP ${p.hp}) —`, 'turn');
  const got = draw(p, 1, true);
  if (got[0]) L(`${p.name}: 카드 1장 드로우`, 'draw');
}

function endTurn(p){
  // 처벌 판정
  if (p.st.punish){
    const pu = p.st.punish;
    if (p.hp <= 7 && p.hand.length >= 4 && pu.defenseSum < pu.sentenceHP){
      L(`⚖️ 「처형」 집행: ${p.name} (HP ${p.hp}, 손패 ${p.hand.length}장, 방어 감소 합계 ${pu.defenseSum} < ${pu.sentenceHP})`, 'big');
      p.st.phoenix = false;                       // 불사조·불멸 무시
      eliminate(p, '처형', pu.by);
      awardKillBonus(p.killedBy, p);
    } else {
      L(`  └ ${p.name} 처형 회피 (HP ${p.hp}, 손패 ${p.hand.length}장, 방어 감소 합계 ${pu.defenseSum}/${pu.sentenceHP})`, 'def');
    }
    p.st.punish = null;
  }
  // 피해망상 잠금 해제
  p.st.locks.forEach(l => l.turns--);
  p.st.locks = p.st.locks.filter(l => l.turns > 0);
  // 이번 턴 한정 효과 종료
  p.st.warfare = null;
  p.st.night = 0;
  if (!p.st.paradisePending)  p.st.paradise = 0;
  if (!p.st.champagnePending) p.st.champagne = 0;
  // 강제 사용 의무는 카드가 손패를 떠날 때까지 유지 (사용 가능한 첫 기회에 반드시 사용)
  p.st.mustUse = p.st.mustUse.filter(id => p.hand.some(c => c.id === id));
  checkEarlyEnd();
}

/* 강제 사용(좀비) 남았는지 */
function pendingMustUse(p){
  return p.st.mustUse
    .map(id => p.hand.find(c => c.id === id))
    .filter(c => c && canPlay(p, c));
}

/* ---------------- 라운드 ---------------- */
function roundStart(){
  L(`════ ${G.deathmatch ? '데스매치 ' : ''}라운드 ${G.round} 시작 ════`, 'round');
  // 훈색 이월 효과 해결
  if (G.carried.length){
    const list = G.carried.splice(0, G.carried.length);
    list.forEach(pk => {
      const s = G.players[pk.src], t = G.players[pk.tgt];
      L(`↪ 이월된 「${pk.cardName}」 해결 (${s.name} → ${t.name})`, 'sys');
      dealDamage(s, t, pk.amount, { kind:'attack', ignoreDefense:pk.ignoreDefense });
    });
    checkDeaths();
  }
  // 혼란 [선택 1] 회수 (홀수 라운드)
  if (G.round % 2 === 1){
    G.players.forEach(p => {
      if (!p.alive || !p.st.confusion || !p.st.confusion.cards.length) return;
      const id = p.st.confusion.cards.shift();
      const i = G.exiled.findIndex(c => c.id === id);
      if (i >= 0){
        const c = G.exiled.splice(i, 1)[0];
        p.hand.push(c);
        L(`↩ ${p.name} 「혼란」: 소멸된 「${c.name}」을(를) 손패로 회수 (공개)`, 'sys');
      }
      if (!p.st.confusion.cards.length){ p.st.confusion = null; L('  └ 「혼란」 지속 효과 종료', 'dim'); }
    });
  }
}

async function roundEnd(){
  L(`──── 라운드 ${G.round} 종료 처리 ────`, 'round');
  // 지속 피해(피) — 턴 순서대로
  G.order.forEach(idx => {
    const p = G.players[idx];
    if (!p.alive) return;
    p.st.blood.forEach(b => {
      if (b.left > 0 && G.round >= b.from){
        L(`🩸 ${p.name} 「피」 지속 피해`, 'dmg');
        dealDamage(G.players[b.src] || null, p, 2, { kind:'dot' });
        b.left--;
      }
    });
    p.st.blood = p.st.blood.filter(b => b.left > 0);
  });
  checkDeaths();
  if (G.over) return;

  // 샴페인: 다음 자신의 턴이 없는 경우 즉시 발동 (탈락자)
  // (생존자는 다음 턴에 정상 적용)

  // 공개/금지 만료
  G.players.forEach(p => {
    if (p.st.reveal && p.st.reveal <= G.round){ p.st.reveal = 0; p.st.dayBan = []; L(`  └ ${p.name} 손패 공개 종료`, 'dim'); }
    if (p.st.ban && p.st.ban.until <= G.round){ p.st.ban = null; L(`  └ ${p.name} 「혼란」 제한 해제`, 'dim'); }
  });
  if (G.eclipse && G.eclipse <= G.round){ G.eclipse = 0; L('  └ 「일식」 효과 종료', 'dim'); }

  // 10라운드 종료: 모든 이월 피해/효과 즉시 처리
  if (!G.deathmatch && G.round >= 10){
    if (G.carried.length){
      L('⏱ 이월 피해 예외: 남은 이월 효과를 즉시 처리합니다.', 'sys');
      G.carried.splice(0, G.carried.length).forEach(pk => {
        const s = G.players[pk.src], t = G.players[pk.tgt];
        dealDamage(s, t, pk.amount, { kind:'attack', ignoreDefense:pk.ignoreDefense });
      });
    }
    G.players.forEach(p => {
      if (p.alive && p.st.punish){
        const pu = p.st.punish;
        if (p.hp <= 7 && p.hand.length >= 4 && pu.defenseSum < pu.sentenceHP){
          L(`⚖️ 「처형」 즉시 집행: ${p.name}`, 'big');
          p.st.phoenix = false; eliminate(p, '처형', pu.by);
          awardKillBonus(p.killedBy, p);
        }
        p.st.punish = null;
      }
      p.st.blood.forEach(b => {
        if (b.left > 0){
          L(`🩸 ${p.name} 「피」 잔여 지속 피해 즉시 처리 (${b.left}회)`, 'dmg');
          for (let k = 0; k < b.left; k++) dealDamage(G.players[b.src] || null, p, 2, { kind:'dot' });
          b.left = 0;
        }
      });
    });
    checkDeaths();
    if (!G.over) finishMainGame();
  }
}

function finishMainGame(){
  const a = alive();
  if (!a.length){ G.over = true; L('전원 탈락 - 승자 없음', 'big'); return; }
  const top = Math.max(...a.map(p => p.hp));
  const leaders = a.filter(p => p.hp === top);
  if (leaders.length === 1){
    G.over = true; G.winner = leaders[0];
    L(`🏆 10라운드 종료 — ${G.winner.name} 승리! (HP ${top})`, 'big');
    return;
  }
  // 데스매치
  L(`⚔️ HP 공동 1위(${top}) 발생 — 데스매치 시작!`, 'big');
  G.players.forEach(p => {
    if (!leaders.includes(p)){
      if (p.alive) eliminate(p, '데스매치 비진출');
    }
  });
  leaders.forEach(p => {
    const keepHand = p.hand;
    p.st = freshStatus();
    p.hand = keepHand;
    p.hp = 10;
  });
  G.eclipse = 0;
  G.carried = [];
  G.deathmatch = true;
  G.round = 0;          // 루프에서 ++ 되어 데스매치 라운드 1부터 시작
  L('  └ 생존자 HP 10으로 변경, 모든 지속 효과·디버프·이월 효과 취소. 손패/덱/버린 더미 유지', 'sys');
}

/* ---------------- 게임 루프 ---------------- */
async function startGame(playerCount, humanName){
  G.players = [];
  G.players.push(makePlayer(0, humanName || '나', false));
  const botNames = ['봇 알파', '봇 베타', '봇 감마'];
  for (let i=1;i<playerCount;i++) G.players.push(makePlayer(i, botNames[i-1], true));
  G.deck = []; G.discard = []; G.exiled = []; G.carried = [];
  G.round = 1; G.eclipse = 0; G.over = false; G.winner = null;
  G.deathmatch = false; G.log = []; G.playedNames = new Set();
  G.order = G.players.map(p => p.idx);

  buildDeck();
  G.players.forEach(p => draw(p, 5, true));
  L(`게임 시작 — ${playerCount}인전, 시작 HP 20, 시작 손패 5장, 덱 37장`, 'sys');
  if (typeof UI !== 'undefined') UI.render();

  while (!G.over){
    roundStart();
    if (typeof UI !== 'undefined') UI.render();
    for (const idx of G.order){
      const p = G.players[idx];
      if (!p.alive) continue;
      if (G.over) break;
      beginTurn(p);
      if (typeof UI !== 'undefined') UI.render();
      if (p.isAI){ await sleep(G.speed*0.6); await AI.takeTurn(p); }
      else await UI.humanTurn(p);
      endTurn(p);
      if (typeof UI !== 'undefined') UI.render();
      if (G.over) break;
      await sleep(G.speed*0.3);
    }
    if (G.over) break;
    await roundEnd();
    if (typeof UI !== 'undefined') UI.render();
    if (G.over) break;
    G.round++;
    if (G.deathmatch && G.round > 20){        // 무한 진행 방지
      const a = alive().sort((x,y) => y.hp - x.hp);
      G.over = true; G.winner = a[0] || null;
      L(G.winner ? `🏆 데스매치 장기전 종료 — ${G.winner.name} 승리 (HP ${G.winner.hp})` : '게임 종료', 'big');
      break;
    }
    await sleep(G.speed*0.4);
  }
  if (typeof UI !== 'undefined') UI.gameOver();
}
