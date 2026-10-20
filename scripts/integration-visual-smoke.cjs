const assert=require('node:assert/strict'),fs=require('fs');
const {chromium}=require('playwright-core');const {startCombatFixture}=require('./lib/combat-fixture.cjs');
(async()=>{const browser=await chromium.launch({executablePath:['/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{for(const viewport of [{width:320,height:568},{width:360,height:640},{width:360,height:760},{width:390,height:844},{width:412,height:915}])for(const volume of [0,1])for(const muted of [true,false]){
 const page=await browser.newPage({viewport,reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.route('https://st.max.ru/**',route=>route.fulfill({body:'',contentType:'application/javascript'}));
 await page.addInitScript(({volume,muted})=>localStorage.setItem('ofeliya_save_v1',JSON.stringify({runs:1,muted,musicVolume:volume,sfxVolume:volume})),{volume,muted});
 await page.goto(process.env.OFELIYA_BASE_URL||'http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
 const row=await page.evaluate(()=>{const menu=window.__game.scene.getScene('Menu');return menu.children.list.filter(o=>o.type==='Text'&&/^(муз[·ы]|звук:|эфф[·е]|СВОДКА$|КОДЕКС )/.test(o.text)).map(o=>({text:o.text,font:parseFloat(o.style.fontSize),b:JSON.parse(JSON.stringify(o.getBounds()))})).sort((a,b)=>a.b.x-b.b.x);});
 assert.equal(row.length,5,JSON.stringify(row));for(let i=1;i<row.length;i++)assert.ok(row[i].b.x-(row[i-1].b.x+row[i-1].b.width)>=4-1e-6,JSON.stringify({viewport,volume,muted,row}));for(const item of row){assert.ok(item.font>=(viewport.height<650?11:12));assert.ok(item.b.x>=8-1e-6&&item.b.x+item.b.width<=viewport.width-8+1e-6,JSON.stringify({viewport,volume,muted,row}));}
 assert.deepEqual(errors,[]);console.log('utility variants PASS '+JSON.stringify({viewport,volume,muted}));await page.close();
 }
 for(const reducedMotion of ['reduce','no-preference']){
 const page=await browser.newPage({viewport:{width:390,height:740},reducedMotion});const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.route('https://st.max.ru/**',route=>route.fulfill({body:'',contentType:'application/javascript'}));await page.addInitScript(()=>localStorage.setItem('ofeliya_save_v1',JSON.stringify({runs:1,muted:true})));
 await page.goto(process.env.OFELIYA_BASE_URL||'http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
 const take=()=>page.evaluate(()=>window.__game.scene.getScene('Menu').children.list.filter(o=>['blood-plasma','erythrocyte','host-cell-shadow','virus-player'].includes(o.displayTexture?.key??o.texture?.key)).map(o=>({key:o.displayTexture?.key??o.texture.key,x:o.x,y:o.y,rotation:o.rotation,scale:o.scaleX,alpha:o.alpha,tile:o.tilePositionX??0})));
 const a=await take();await page.waitForTimeout(550);const b=await take();assert.deepEqual(a.map(o=>o.key).sort(),['blood-plasma',...Array(5).fill('erythrocyte'),'host-cell-shadow','virus-player'].sort(),'Menu ambient contract: plasma, five cells, host and hero');if(reducedMotion==='reduce')assert.deepEqual(b,a);else assert.notDeepEqual(b,a);
 await startCombatFixture(page);await page.waitForFunction(()=>window.__game.scene.isActive('Game')&&window.__game.scene.isActive('UI'));
 await page.evaluate(()=>{const gs=window.__game.scene.getScene('Game');gs.runState.stage.hp=1000;gs.runState.stage.maxHp=1_000_000;});
 const alpha=()=>page.evaluate(()=>{const ui=window.__game.scene.getScene('UI');return ui.hpWarn.commandBuffer[3];});await page.waitForTimeout(100);const x=await alpha();await page.waitForTimeout(170);const y=await alpha();assert.ok(x>0&&y>0);if(reducedMotion==='reduce'){assert.equal(x,.22);assert.equal(y,.22);}else assert.notEqual(x,y);
 assert.deepEqual(errors,[]);console.log('motion browser PASS '+reducedMotion);await page.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
