// V9 logic smoke test: run with `node mock-test-v9.js`
const assert = require("assert");
const R = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const V = r => r==="A"?1:r==="J"?11:r==="Q"?12:r==="K"?13:Number(r);
function valid(cards){
  if(!cards.length) return false;
  if(cards.length===1) return true;
  if((cards.length===2||cards.length===4)&&cards.every(c=>c.rank===cards[0].rank)) return true;
  if(cards.length>=3 && cards.length%2===1){
    const v=cards.map(c=>V(c.rank)).sort((a,b)=>a-b);
    if(new Set(v).size!==v.length) return false;
    if(v.includes(1)&&v.includes(13)) return v.length===5 && v.join(",")==="1,10,11,12,13";
    if(v[0]===1) return v.every((x,i)=>x===i+1);
    return v.every((x,i)=>i===0||x===v[i-1]+1);
  }
  return false;
}
const c=r=>({rank:r});
for(const x of [["2","3","4"],["4","5","6"],["8","9","10"],["10","J","Q"],["A","2","3","4","5"],["10","J","Q","K","A"]]) assert(valid(x.map(c)));
assert(valid(["K","K"].map(c)));
assert(!valid(["2","3"].map(c)));
assert(!valid(["K","A","2","3","4"].map(c)));
assert(!valid(["5","5","5"].map(c)));
console.log("V9 MOVE/SEQUENCE SMOKE TEST PASSED");
