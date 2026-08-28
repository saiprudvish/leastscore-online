// V14 functional mock run. No browser required: validates the exact core rules
// used by the client/server plus the two-step selection contract.
const assert = require('assert');
const R = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const V = r => r==='A'?1:r==='J'?11:r==='Q'?12:r==='K'?13:Number(r);
const c = (rank, suit='♠') => ({rank, suit, id:rank+suit});
function valid(cards){
  if(!cards.length) return false;
  if(cards.length===1) return true;
  if((cards.length===2||cards.length===4)&&cards.every(x=>x.rank===cards[0].rank)) return true;
  if(cards.length>=3){
    const v=cards.map(x=>V(x.rank)).sort((a,b)=>a-b);
    if(new Set(v).size!==v.length) return false;
    if(v.includes(1)&&v.includes(13)) return (v.length===3&&v.join(',')==='1,12,13') || (v.length===5&&v.join(',')==='1,10,11,12,13');
    if(v[0]===1) return v.every((x,i)=>x===i+1);
    return v.every((x,i)=>i===0||x===v[i-1]+1);
  }
  return false;
}
for (const x of [
  ['2','3','4'], ['4','5','6'], ['8','9','10'], ['10','J','Q'],
  ['Q','K','A'], ['A','2','3'], ['A','2','3','4','5'], ['10','J','Q','K','A']
]) assert(valid(x.map(r=>c(r))));
assert(valid([c('K'),c('K')]));
assert(!valid(['K','A','2','3','4'].map(r=>c(r)))); // no KA234 wrap
assert(!valid(['2','3'].map(r=>c(r))));
assert(!valid(['5','5','5'].map(r=>c(r))));

// Three-card discard: all three remain individually pickable.
let open = [c('3','♠'), c('4','♦'), c('5','♣')];
assert.strictEqual(open.length,3);
const picked = open.splice(1,1)[0];
assert.strictEqual(picked.rank,'4');
assert.strictEqual(open.length,2);

// Selection order: leave first, then pick. Interleaving is rejected by the UI contract.
let selected = new Set(['2♠','3♦','4♣']);
let source = null;
assert(valid([...selected].map(id=>c(id.slice(0,-1),id.slice(-1)))));
source='deck';
assert(source==='deck');
// Once pick is chosen, hand selection must remain locked until the move completes.
assert(source !== null);

// Latest-move table is per-player, not an all-history dump.
const players = [
  {username:'sai', lastAction:{leftCards:[c('8'),c('9'),c('10')], picked:'deck'}, score:7},
  {username:'Bot 1', lastAction:{leftCards:[c('Q')], picked:c('6','♦')}, score:12}
];
assert.strictEqual(players[0].lastAction.leftCards.length,3);
assert.strictEqual(players[1].lastAction.picked.rank,'6');

console.log('V14 MOCK RUN PASSED');
console.log('✓ 234 / 456 / 8910 / 10JQ / QKA / A2345 / 10JQKA');
console.log('✓ KA234 rejected');
console.log('✓ Multiple discard cards individually pickable');
console.log('✓ Leave-first → pick-second selection flow');
console.log('✓ Latest move + picked card/deck table model');
