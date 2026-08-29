const fs=require('fs');
const js=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');
const srv=fs.readFileSync('server.js','utf8');
const checks=[
 ['all discard cards rendered',/cards\.map\(\(c,i\)=>/.test(js)],
 ['no discard slice -3',!js.includes('slice(-3).map')],
 ['pick can be chosen before leave',!js.includes('Select a valid group to leave first.')],
 ['selection keeps picked source',!js.includes('selectedSource=null; selectedPickId=null; updateSelectionUI(); document.querySelectorAll')],
 ['auto marker',js.includes(' (Auto)')],
 ['3 result headers',html.includes('<span>PLAYER</span><span>RESULT</span><span>SCORE</span>')],
 ['username only auth',!html.includes('id="email"')],
 ['server no email required',!srv.includes('Enter a valid email address.')],
 ['rectangular discard CSS',css.includes('.open-choice{width:58px')],
 ['compact board',css.includes('.table-felt{height:300px')],
 ['chat icon',html.includes('💬')],
 ['live deal timer',js.includes('state.status==="roundOver"&&state.dealDeadline')]
];
let ok=true;for(const [n,v] of checks){console.log((v?'PASS':'FAIL'),n);if(!v)ok=false}process.exit(ok?0:1)
