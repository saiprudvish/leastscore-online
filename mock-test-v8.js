const assert = require('assert');
const rankValue=r=>r==='A'?1:r==='J'?11:r==='Q'?12:r==='K'?13:Number(r);
function valid(cards){
 if(!cards.length)return false;
 if(cards.length===1)return true;
 if(cards.length>=2&&cards.length<=4&&cards.every(c=>c.rank===cards[0].rank))return true;
 if(cards.length>=3&&cards.length%2===1){
  const v=cards.map(c=>rankValue(c.rank)).sort((a,b)=>a-b);
  if(new Set(v).size!==v.length)return false;
  if(v.includes(1)&&v.includes(13))return v.length===5&&v.join(',')==='1,10,11,12,13';
  if(v[0]===1)return v.every((x,i)=>x===i+1);
  return v.every((x,i)=>i===0||x===v[i-1]+1);
 }
 return false;
}
const c=r=>({rank:r,suit:['♠','♦','♣'][Math.floor(Math.random()*3)]});
for(const seq of [['2','3','4'],['4','5','6'],['8','9','10'],['10','J','Q'],['A','2','3','4','5'],['10','J','Q','K','A']]) assert(valid(seq.map(c)));
assert(!valid(['2','3','4','5'].map(c)));
assert(valid([c('K'),c('K')]));
assert(!valid([c('K'),c('A'),c('2'),c('3'),c('4')]));
console.log('MOCK TEST V8 PASSED: sequence groups, same-rank groups, odd-length rule, ace rules');
