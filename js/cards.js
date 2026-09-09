/* ===================================================================
 * 37 게임 - 카드 데이터 (규칙서 v2.12)
 * 덱 구성: 총 37장, 각 카드는 단 1장씩만 존재
 * ===================================================================
 * type     : offense(공격) / defense(방어) / survival(생존)
 *            disturb(교란) / ancillary(보조) / special(특수)
 * disposal : discard(버림) / exile(소멸) / deckBottom(덱 맨 아래)
 * target   : none / enemy(타 플레이어 1명) / enemy2(타 플레이어 2명)
 * attack   : 공격 카드 여부 (카드 분류가 '공격')
 * trap     : 손패에서 함정으로만 발동 (능동 사용 불가)
 * =================================================================== */

const TYPE_NAME = {
  offense: '공격', defense: '방어', survival: '생존',
  disturb: '교란', ancillary: '보조', special: '특수'
};

const CARDS = [
  /* ---------------- 공격 카드 (7장) ---------------- */
  { id:'gun', name:'총', en:'Gun', type:'offense', cost:1, disposal:'discard',
    target:'enemy', attack:true, dmg:2,
    text:'플레이어 1명에게 피해 2' },

  { id:'katana', name:'카타나', en:'Katana', type:'offense', cost:4, disposal:'discard',
    target:'enemy', attack:true, dmg:3,
    text:'플레이어 1명에게 피해 3. 방어 카드의 피해 감소 효과 무시 (불사조 제외)' },

  { id:'explosion', name:'폭발', en:'Explosion', type:'offense', cost:4, disposal:'discard',
    target:'none', attack:true, dmg:2,
    text:'무작위로 선택된 타 플레이어 2명에게 피해 2, 자신은 피해 1' },

  { id:'warfare', name:'전쟁', en:'Warfare', type:'offense', cost:6, disposal:'discard',
    target:'none', attack:true,
    text:'이번 턴 자신이 사용하는 공격 카드의 피해 +2 (방어 무시 등 기존 효과 유지). 이번 턴 공격 카드 사용은 전쟁 제외 최대 2회' },

  { id:'netherworld', name:'지옥', en:'Netherworld', type:'offense', cost:4, disposal:'discard',
    target:'enemy', attack:true, dmg:7,
    text:'플레이어 1명에게 피해 7, 자신도 피해 2' },

  { id:'zombie', name:'좀비', en:'Zombie', type:'offense', cost:2, disposal:'deckBottom',
    target:'enemy', attack:true, dmg:2,
    text:'플레이어 1명에게 피해 2, 카드 1장 드로우. 드로우한 카드는 사용 가능한 첫 기회에 반드시 사용' },

  { id:'punishment', name:'처벌', en:'Punishment', type:'offense', cost:6, disposal:'discard',
    target:'enemy', attack:true,
    text:'플레이어 1명 지정. 대상의 HP가 7 이하이고 손패가 4장 이상이면, 다음 턴을 진행한 뒤에도 조건을 충족할 시 턴 종료 직후 탈락하는 「처형」을 선고. 단, 선고를 받은 대상이 다음 턴 종료 시까지 사용한 방어 카드들의 총 피해 감소량이 선고 당시 HP 이상이면 처형되지 않음. 불사조·불멸은 무시.' },

  /* ---------------- 방어 카드 (7장) ---------------- */
  { id:'rain', name:'비', en:'Rain', type:'defense', cost:1, disposal:'discard',
    target:'none',
    text:'자신의 다음 턴 시작까지, 자신이 받는 모든 공격 카드 피해 1 감소' },

  { id:'fortune', name:'행운', en:'Fortune', type:'defense', cost:1, disposal:'discard',
    target:'none',
    text:'다음 3번 받는 피해를 각각 1 감소' },

  { id:'haze', name:'실안개', en:'Haze', type:'defense', cost:2, disposal:'discard',
    target:'none', trap:true,
    text:'[함정] 손패에 있는 동안 함정 효과. 자신이 단일 대상 공격 카드의 대상이 되었을 때, 공격 선언 직후 공개하여 발동 가능. 발동 시 즉시 비용을 지불하고 공격자에게 피해 4. 이후 원래 공격은 정상 해결.' },

  { id:'iridescence', name:'훈색', en:'Iridescence', type:'defense', cost:1, disposal:'discard',
    target:'none',
    text:'다음 자신이 받게 되는 공격 카드 1장의 효과 전체를 다음 라운드로 이월' },

  { id:'gate', name:'관문', en:'Gate', type:'defense', cost:3, disposal:'discard',
    target:'none',
    text:'자신의 다음 턴 시작까지 처음 자신을 대상으로 하는 상대 카드 1장 효과 무효 (단, 특수 카드는 제외)' },

  { id:'snowpeak', name:'설산', en:'Snowpeak', type:'defense', cost:1, disposal:'discard',
    target:'none',
    text:'다음 2번 받는 피해 각각 1 감소, 카드 1장 드로우' },

  { id:'phoenix', name:'불사조', en:'Phoenix', type:'defense', cost:5, disposal:'exile',
    target:'none',
    text:'HP가 0 이하가 되면 1회 한정 HP를 5로 복구' },

  /* ---------------- 생존 카드 (7장) ---------------- */
  { id:'gold', name:'금화', en:'Gold', type:'survival', cost:1, disposal:'discard',
    target:'none',
    text:'HP 3 회복 (HP가 1일 때는 사용 불가) (9라운드 이후와 데스매치 시에는 HP 2 회복)' },

  { id:'flower', name:'꽃', en:'Flower', type:'survival', cost:2, disposal:'discard',
    target:'none',
    text:'지속 피해 효과 적용 중이거나 새로 적용될 경우 피해 1 감소, 카드 1장 드로우' },

  { id:'painkiller', name:'진통제', en:'Painkiller', type:'survival', cost:2, disposal:'discard',
    target:'none',
    text:'디버프 제거, HP 1 회복' },

  { id:'diamond', name:'다이아몬드', en:'Diamond', type:'survival', cost:2, disposal:'discard',
    target:'none',
    text:'HP 5 회복 (9라운드 이후와 데스매치 시에는 HP 4 회복)' },

  { id:'light', name:'빛', en:'Light', type:'survival', cost:1, disposal:'discard',
    target:'none',
    text:'모든 플레이어 HP +1, 자신은 추가 +1 (총 +2)' },

  { id:'immortal', name:'불멸', en:'Immortal', type:'survival', cost:4, disposal:'exile',
    target:'none',
    text:'다음 자신의 턴 시작까지, 상대의 카드 효과로 받는 피해는 HP를 1 미만으로 낮추지 못함 (카드 비용 지불 및 자신의 카드로 인한 자해에는 미적용)' },

  { id:'paradise', name:'낙원', en:'Paradise', type:'survival', cost:5, disposal:'exile',
    target:'none',
    text:'HP 4 회복. 다음 자신의 턴에 사용하는 카드 중 하나의 비용을 최대 2 감소 (최소 0)' },

  /* ---------------- 교란 카드 (6장) ---------------- */
  { id:'eclipse', name:'일식', en:'Eclipse', type:'disturb', cost:3, disposal:'exile',
    target:'none',
    text:'다음 라운드 종료 시까지 모든 플레이어는 생존 카드를 사용할 때 HP를 1 추가 지불' },

  { id:'tornado', name:'토네이도', en:'Tornado', type:'disturb', cost:2, disposal:'discard',
    target:'enemy2',
    text:'다른 플레이어 2명의 손패를 무작위로 2장씩 교환' },

  { id:'paranoia', name:'피해망상', en:'Paranoia', type:'disturb', cost:2, disposal:'discard',
    target:'enemy',
    text:'플레이어 1명의 무작위 손패 1장 공개. 해당 카드는 다음 턴까지 사용 불가' },

  { id:'confusion', name:'혼란', en:'Confusion', type:'disturb', cost:6, disposal:'exile',
    target:'none',
    text:'[선택 1] (홀수 라운드에서만) 소멸 카드 최대 3장 지정. 이후 홀수 라운드마다 1장씩 손패로 가져온다(공개). 3장을 모두 가져오면 종료. / [선택 2] 플레이어 2명 지정, 다음 라운드까지 공격 혹은 교란 카드 둘 중 하나 사용 불가 (선택은 지정받은 각 플레이어가 함)' },

  { id:'skeleton', name:'해골', en:'Skeleton', type:'disturb', cost:2, disposal:'discard',
    target:'none',
    text:'버린 카드 더미 맨 위부터 확인하여 비용 2 이하인 첫 카드의 효과 복사 (이동 방식 제외)' },

  { id:'blood', name:'피', en:'Blood', type:'disturb', cost:2, disposal:'discard',
    target:'enemy',
    text:'플레이어 1명 지정. 다음 라운드 시작부터 2라운드 동안 라운드 종료 시 피해 2 (디버프)' },

  /* ---------------- 보조 카드 (8장) ---------------- */
  { id:'time', name:'시간', en:'Time', type:'ancillary', cost:2, disposal:'discard',
    target:'none',
    text:'카드 2장 드로우 (단, 1·2·10라운드에서는 사용 불가)' },

  { id:'stairs', name:'계단', en:'Stairs', type:'ancillary', cost:3, disposal:'discard',
    target:'none',
    text:'덱 위 3장을 확인하고 그중 1장을 손패에 넣음. 나머지는 덱 맨 아래로 이동' },

  { id:'champagne', name:'샴페인', en:'Champagne', type:'ancillary', cost:3, disposal:'discard',
    target:'none',
    text:'다음 자신의 턴에 사용하는 최대 4장의 비용을 각각 1 감소 (다음 자신의 턴이 없으면 이번 라운드 종료 시 즉시 발동)' },

  { id:'piper', name:'피리 부는 사나이', en:'Piper', type:'ancillary', cost:1, disposal:'discard',
    target:'none',
    text:'카드 1장 드로우' },

  { id:'path', name:'도로', en:'Path', type:'ancillary', cost:2, disposal:'discard',
    target:'none',
    text:'덱 맨 위 또는 맨 아래에서 카드 1장을 선택하여 드로우' },

  { id:'prism', name:'프리즘', en:'Prism', type:'ancillary', cost:2, disposal:'discard',
    target:'none',
    text:'비용 2 이하 교란/보조 카드 1장을 소멸 카드를 제외한 덱 전체 범위에서 선택하여 공개 후 그 효과를 복사 (복사한 효과는 다시 복사 불가)' },

  { id:'rainbow', name:'무지개', en:'Rainbow', type:'ancillary', cost:4, disposal:'discard',
    target:'none',
    text:'버린 카드 더미가 10장 이상일 때 사용 가능. 무작위 카드 1장을 뽑아 공개 후 해당 효과 복사 (이동 방식 제외). 뽑은 카드는 버린 카드 더미 맨 아래로. 단, 비용 5 이상인 카드를 뽑을 경우 10라운드를 제외한 짝수 라운드에서만 사용 가능' },

  { id:'epitaph', name:'묘비명', en:'Epitaph', type:'ancillary', cost:5, disposal:'discard',
    target:'none',
    text:'버린 카드 더미 위에서 10장 중 비용 4 이하 카드 1장을 손패로 가져옴 (버린 카드 더미 10장 이상일 때만 발동 가능)' },

  /* ---------------- 특수 카드 (2장) ---------------- */
  { id:'day', name:'낮', en:'Day', type:'special', cost:9, disposal:'exile',
    target:'none',
    text:'무작위로 선택된 타 플레이어 2명의 손패 공개 (3라운드 유지). 공개된 카드 중 3장을 사용자가 임의로 선택하여 공개가 유지되는 동안 사용 금지' },

  { id:'night', name:'밤', en:'Night', type:'special', cost:10, disposal:'exile',
    target:'none',
    text:'이번 턴 손패 최대 6장의 비용을 각각 2 감소' }
];

/* 카드에 표시할 짧은 요약문.
 * 규칙 전문(text)은 툴팁과 규칙 확인용으로 그대로 남겨 둡니다.
 * 요약이라도 핵심(수치·조건·제약)은 빠짐없이 담습니다. */
const SHORT = {
  /* 공격 */
  gun:         '1명에게 피해 2',
  katana:      '1명에게 피해 3.\n방어 카드의 피해 감소 무시 (불사조 제외)',
  explosion:   '무작위 타 2명에게 피해 2.\n나도 피해 1',
  warfare:     '이번 턴 내 공격 카드 피해 +2.\n공격 카드는 2회까지 (전쟁 제외)',
  netherworld: '1명에게 피해 7.\n나도 피해 2',
  zombie:      '1명에게 피해 2, 1장 드로우.\n뽑은 카드는 첫 기회에 반드시 사용',
  punishment:  '1명 지정. HP 7 이하 + 손패 4장 이상이면 처형 선고.\n대상의 다음 턴 종료 시에도 조건 유지되면 탈락.\n선고 후 방어로 막은 피해 ≥ 선고 시 HP면 회피.\n불사조·불멸 무시',

  /* 방어 */
  rain:        '다음 내 턴까지\n받는 공격 카드 피해 -1',
  fortune:     '다음 3번 받는 피해 각각 -1',
  haze:        '[함정] 단일 대상 공격의 대상이 되면 공개해 발동.\n비용을 내고 공격자에게 피해 4.\n원래 공격은 그대로 해결',
  iridescence: '다음에 받는 공격 카드 1장의 효과를\n통째로 다음 라운드로 이월',
  gate:        '다음 내 턴까지,\n나를 노린 상대 카드 1장 무효 (특수 제외)',
  snowpeak:    '다음 2번 받는 피해 각각 -1,\n1장 드로우',
  phoenix:     'HP가 0 이하가 되면\n1회 한정 HP 5로 부활',

  /* 생존 */
  gold:        'HP 3 회복. HP 1이면 사용 불가\n(9R 이후·데스매치는 2)',
  flower:      '지속 피해 -1 (계속 유지),\n1장 드로우',
  painkiller:  '디버프 제거, HP 1 회복',
  diamond:     'HP 5 회복\n(9R 이후·데스매치는 4)',
  light:       '모든 플레이어 HP +1,\n나는 +2',
  immortal:    '다음 내 턴까지 상대 효과로는\nHP가 1 미만이 되지 않음\n(비용 지불·내 자해는 제외)',
  paradise:    'HP 4 회복.\n다음 내 턴 카드 1장 비용 -2',

  /* 교란 */
  eclipse:     '다음 라운드 종료까지\n모두 생존 카드 비용 +1',
  tornado:     '다른 2명이 손패를\n무작위 2장씩 교환',
  paranoia:    '1명의 손패 1장을 무작위 공개.\n그 카드는 다음 턴까지 사용 불가',
  confusion:   '[1] (홀수 R만) 소멸 카드 3장까지 지정,\n홀수 R마다 1장씩 손패로 회수 (공개)\n[2] 2명 지정. 다음 라운드까지\n공격·교란 중 하나 사용 불가 (각자 선택)',
  skeleton:    '버린 더미 위에서부터\n첫 비용 2 이하 카드의 효과 복사',
  blood:       '1명 지정. 다음 라운드부터 2라운드 동안\n라운드 종료 시 피해 2',

  /* 보조 */
  time:        '2장 드로우\n(1·2·10라운드에는 사용 불가)',
  stairs:      '덱 위 3장 확인 → 1장 손패로,\n나머지는 덱 맨 아래로',
  champagne:   '다음 내 턴에 쓰는 4장까지 비용 각각 -1\n(다음 턴이 없으면 이번 라운드 종료 시 발동)',
  piper:       '1장 드로우',
  path:        '덱 맨 위 또는 맨 아래에서\n원하는 쪽으로 1장 드로우',
  prism:       '소멸되지 않은 비용 2 이하 교란·보조 카드\n1장을 공개해 그 효과 복사',
  rainbow:     '버린 더미 10장 이상일 때.\n무작위 1장 공개해 효과 복사 → 더미 맨 아래로.\n비용 5 이상이면 짝수 R에만 발동 (10R 제외)',
  epitaph:     '버린 더미 10장 이상일 때.\n위 10장 중 비용 4 이하 1장을 손패로',

  /* 특수 */
  day:         '무작위 타 2명의 손패 공개 (3라운드).\n그중 3장을 골라 공개 동안 사용 금지',
  night:       '이번 턴 손패 6장까지\n비용 각각 -2'
};

const CARD_BY_ID = {};
CARDS.forEach(c => { c.short = SHORT[c.id] || c.text; CARD_BY_ID[c.id] = c; });

if (CARDS.length !== 37) console.error('덱 구성 오류: ' + CARDS.length + '장');
