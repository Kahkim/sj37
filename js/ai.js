/* ===================================================================
 * 37 게임 - AI 플레이어
 * =================================================================== */
const AI = (() => {

  /* 밸런스 조절 파라미터 — 값이 클수록 공격적으로 플레이합니다.
   * 조기 종료(누군가 탈락해 1명만 남음) vs 데스매치(10라운드 HP 공동 1위)의
   * 발생 비율은 이 값들로 조절합니다. test/tune.html 로 스윕할 수 있습니다. */
  const TUNE = {
    atkDmg:      2.9,   // 공격 점수 = 예상피해 * atkDmg - 비용 * atkCost
    atkCost:     1.2,
    finishBonus: 40,    // 상대를 탈락시킬 수 있을 때 가산
    healW:       1.0,   // 회복 카드 가중 (낮을수록 덜 회복 = 더 잘 죽음)
    reserveEarly: 7,    // 7라운드 이하에서 남겨두려는 HP
    reserveLate:  5,    // 8라운드 이후
    reservePen:  1.9,   // 여유분 미달 1당 감점
    tieBreak:    20     // 10라운드 동점 회피 가중 (클수록 데스매치가 덜 발생, 20 이상은 포화)
  };
  /* 처치 보너스 +5 규칙에 맞춘 값. 1200게임(독립 시드열 4개) 기준
   * 데스매치 100 : 조기종료 254 ≒ 1 : 2.54.
   * 처치 보너스 도입 전 값(공격 2.3/1.6, 여유분 10/7)으로는 1 : 1.2 까지 떨어졌다.
   * 처치로 HP를 되찾으면 킬러가 오래 살아남아 10라운드까지 가는 판이 늘기 때문.
   * (test/tune.html 로 재측정 가능) */

  /* 이 카드로 실제로 오를 HP (동점 회피 판단용) */
  function healValue(p, card){
    const missing = p.maxHp - p.hp;
    switch (card.id){
      case 'gold':       return Math.min(missing, lateGame() ? 2 : 3);
      case 'diamond':    return Math.min(missing, lateGame() ? 4 : 5);
      case 'light':      return Math.min(missing, 2);
      case 'paradise':   return Math.min(missing, 4);
      case 'painkiller': return Math.min(missing, 1);
      default:           return 0;
    }
  }

  /* 상대에게 실제로 들어갈 것으로 예상되는 피해 */
  function expectedDamage(p, t, card){
    if (!card.dmg) return 0;
    let d = card.dmg + ((p.st.warfare && card.attack) ? 2 : 0);
    if (card.id !== 'katana'){
      if (t.st.rain) d -= 1;
      if (t.st.fortune > 0) d -= 1;
      if (t.st.snowpeak > 0) d -= 1;
    }
    if (t.st.gate) d = 0;
    if (t.st.iridescence) d = 0;
    if (t.st.immortal) d = Math.min(d, Math.max(0, t.hp - 1));
    return Math.max(0, d);
  }

  /* 위협도가 가장 높은 상대 (HP 1위 우선, 동률이면 손패 많은 쪽) */
  function bestTarget(p){
    const c = others(p);
    if (!c.length) return null;
    return c.slice().sort((a, b) => (b.hp - a.hp) || (b.hand.length - a.hand.length))[0];
  }
  function weakestTarget(p){
    const c = others(p);
    if (!c.length) return null;
    return c.slice().sort((a, b) => a.hp - b.hp)[0];
  }

  /* 카드 1장의 사용 가치 점수 */
  function score(p, card){
    const cost    = costOf(p, card);
    const after   = p.hp - cost;
    const missing = p.maxHp - p.hp;
    const lead    = bestTarget(p);
    const weak    = weakestTarget(p);
    const lastRound = (G.round >= 10 && !G.deathmatch);
    let s = 0;

    // HP를 0 이하로 만드는 소모는 회복 카드가 아닌 이상 금지
    const healers = { gold:1, diamond:1, light:1, painkiller:1, paradise:1 };
    if (after <= 0 && !healers[card.id]) return -999;
    if (after <= 1 && !healers[card.id] && !(weak && expectedDamage(p, weak, card) >= weak.hp)) return -999;

    switch (card.id){
      /* --- 공격 --- */
      case 'gun': case 'katana': case 'netherworld': case 'zombie': {
        const tg = weak && expectedDamage(p, weak, card) >= weak.hp ? weak : lead;
        if (!tg) return -999;
        const dmg = expectedDamage(p, tg, card);
        if (dmg <= 0) return -50;
        s = dmg * TUNE.atkDmg - cost * TUNE.atkCost;
        if (dmg >= tg.hp) s += TUNE.finishBonus;              // 마무리
        if (card.id === 'netherworld' && p.hp <= 8) s -= 12;   // 자해 위험
        if (card.id === 'zombie') s += 1.5;                    // 드로우 부가가치
        if (lastRound) s += 3;
        break;
      }
      case 'explosion': {
        const tg = others(p);
        if (tg.length < 2) return -30;
        const dmg = tg.reduce((a, x) => a + expectedDamage(p, x, card), 0) / tg.length * 2;
        s = dmg * 1.6 - cost * 1.4 - 2;
        if (p.hp <= 6) s -= 15;
        break;
      }
      case 'warfare': {
        const atk = p.hand.filter(c => c.attack && c.id !== 'warfare' && c.dmg).length;
        if (atk < 2 || p.hp < 12) return -30;
        s = 6 + atk * 2 - cost;
        break;
      }
      case 'punishment': {
        const cand = others(p).filter(x => x.hp <= 7 && x.hand.length >= 4);
        if (!cand.length) return -60;
        s = 22 - cost;
        break;
      }

      /* --- 방어 --- */
      case 'rain':     s = (p.hp <= 14 ? 6 : 2) - cost; break;
      case 'fortune':  s = (p.hp <= 14 ? 7 : 3) - cost; break;
      case 'snowpeak': s = (p.hp <= 14 ? 7 : 4) - cost; break;   // 드로우 포함
      case 'gate':     s = (p.hp <= 12 ? 8 : 3) - cost; break;
      case 'iridescence': s = (p.hp <= 10 ? 6 : 2) - cost; break;
      case 'phoenix':  s = (p.hp <= 12 && p.hp > 6 ? 12 : 1) - cost * 0.5; break;
      case 'haze':     return -999;                              // 함정 전용

      /* --- 생존 --- */
      case 'gold':     s = Math.min(missing, lateGame() ? 2 : 3) * 3.0 * TUNE.healW - cost; break;
      case 'diamond':  s = Math.min(missing, lateGame() ? 4 : 5) * 2.8 * TUNE.healW - cost; break;
      case 'light':    s = Math.min(missing, 2) * 2.6 * TUNE.healW - cost - (lastRound ? 0 : 1.5); break;
      case 'flower': {
        const dot = p.st.blood.reduce((a, b) => a + b.left, 0);
        s = dot * 4 + 2.5 - cost;          // 드로우 부가가치 포함
        break;
      }
      case 'painkiller': {
        const deb = p.st.blood.length + p.st.locks.length + (p.st.ban ? 1 : 0) + p.st.dayBan.length;
        s = deb * 5 + Math.min(missing, 1) * 2 - cost;
        break;
      }
      case 'immortal': s = (p.hp <= 9 ? 14 : 2) - cost; break;
      case 'paradise': s = Math.min(missing, 4) * 2.4 * TUNE.healW + 2 - cost; break;

      /* --- 교란 --- */
      case 'eclipse':  s = (p.hp >= 14 ? 5 : 0) - cost; break;
      case 'tornado':  s = (others(p).length >= 2 ? 4 : -30) - cost; break;
      case 'paranoia': s = 4 - cost + (lead && lead.hand.length >= 4 ? 2 : 0); break;
      case 'confusion': s = (p.hp >= 15 ? 7 : -20) - cost * 0.5; break;
      case 'skeleton': s = G.discard.some(c => c.cost <= 2) ? 5 - cost : -30; break;
      case 'blood':    s = (G.round <= 7 ? 8 : 2) - cost; break;

      /* --- 보조 --- */
      case 'time':      s = (p.hand.length <= 6 ? 7 : 2) - cost; break;
      case 'piper':     s = (p.hand.length <= 7 ? 5 : 1) - cost; break;
      case 'path':      s = (p.hand.length <= 6 ? 5 : 1) - cost; break;
      case 'stairs':    s = (p.hand.length <= 6 ? 6 : 1) - cost; break;
      case 'champagne': s = (p.hp >= 12 ? 5 : 0) - cost; break;
      case 'prism':     s = 5 - cost; break;
      case 'rainbow':   s = 5 - cost; break;
      case 'epitaph':   s = 6 - cost; break;

      /* --- 특수 --- */
      case 'day':
        s = (p.hp >= 17 && others(p).some(x => x.hand.length >= 3) ? 7 : -30) - cost * 0.3;
        break;
      case 'night': s = (p.hp >= 19 && p.hand.length >= 5 ? 6 : -40); break;

      default: s = 0;
    }

    // 마지막 라운드 동점 회피: 공동 1위는 데스매치로 끌려가므로 단독 1위를 노린다
    if (lastRound && TUNE.tieBreak){
      const hps = alive().map(x => x.hp);
      const top = Math.max(...hps);
      if (p.hp === top && hps.filter(h => h === top).length > 1){
        const net = healValue(p, card) - cost;          // 회복으로 순증하는 HP
        if (net > 0) s += TUNE.tieBreak;
        const co = others(p).filter(x => x.hp === top);  // 공동 1위 끌어내리기
        if (card.dmg && co.some(x => expectedDamage(p, x, card) > cost)) s += TUNE.tieBreak;
      }
    }

    // HP 자체가 승리 조건이므로 여유분을 남기도록 가중
    // (마무리 한 방이면 예외적으로 감수)
    const finisher = weak && expectedDamage(p, weak, card) >= weak.hp;
    const reserve = finisher ? 3 : lastRound ? 4
                  : (G.round <= 7 ? TUNE.reserveEarly : TUNE.reserveLate);
    if (after < reserve) s -= (reserve - after) * TUNE.reservePen;
    if (after < 4 && !finisher) s -= 8;
    if (lastRound && !card.attack && !['gold','diamond','light','paradise','painkiller'].includes(card.id)) s -= 4;
    return s;
  }

  function chooseTargetsFor(p, card){
    if (card.target === 'enemy'){
      const weak = weakestTarget(p);
      if (weak && card.dmg && expectedDamage(p, weak, card) >= weak.hp) return [weak];
      if (card.id === 'punishment'){
        const cand = others(p).filter(x => x.hp <= 7 && x.hand.length >= 4)
                              .sort((a,b) => b.hp - a.hp);
        if (cand.length) return [cand[0]];
      }
      return [bestTarget(p)].filter(Boolean);
    }
    if (card.target === 'enemy2') return pickN(others(p), 2);
    return [];
  }

  async function takeTurn(p){
    for (let step = 0; step < 14; step++){
      if (!p.alive || G.over) return;

      // 좀비로 드로우한 카드는 반드시 사용
      const forced = pendingMustUse(p);
      if (forced.length){
        await playCard(p, forced[0], { targets: chooseTargetsFor(p, forced[0]) });
        await sleep(G.speed * 0.7);
        continue;
      }

      const options = p.hand
        .filter(c => canPlay(p, c))
        .map(c => ({ card:c, s:score(p, c) }))
        .filter(o => o.s > 1.5)
        .sort((a, b) => b.s - a.s);

      if (!options.length) return;
      const best = options[0];
      await playCard(p, best.card, { targets: chooseTargetsFor(p, best.card) });
      await sleep(G.speed * 0.7);
    }
  }

  /* AI의 선택 요청 자동 응답 */
  function answer(p, spec){
    switch (spec.kind){
      case 'confirm': {
        // 실안개: 상대 HP가 낮거나 내 HP에 여유가 있으면 발동
        return p.hp >= 6;
      }
      case 'players': {
        const list = spec.list.slice().sort((a, b) => (b.hp - a.hp));
        return list.slice(0, spec.count);
      }
      case 'options': {
        const avail = spec.list.filter(o => !o.disabled);
        // 「혼란」 지정을 받은 경우: 손패에 많은 쪽을 남기는 선택
        if (avail.some(o => o.value === 'offense')){
          const atk = p.hand.filter(c => c.attack).length;
          const dis = p.hand.filter(c => c.type === 'disturb').length;
          return atk <= dis ? 'offense' : 'disturb';
        }
        return avail.length ? avail[0].value : spec.list[0].value;
      }
      case 'cards': {
        const ranked = spec.list.slice().sort((a, b) => score(p, b) - score(p, a));
        return ranked.slice(0, spec.count);
      }
      default: return null;
    }
  }

  return { takeTurn, answer, score, expectedDamage,
           TUNE, tune(o){ Object.assign(TUNE, o); } };
})();
