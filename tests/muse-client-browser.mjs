import assert from 'node:assert/strict';

export async function checkMuseClient(browser,url) {
 const page=await browser.newPage({viewport:{width:320,height:568},hasTouch:true,reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('https://st.max.ru/**',r=>r.fulfill({body:'',contentType:'application/javascript'}));
 await page.route('**/api/**',r=>r.fulfill({status:503,body:'{}'}));
 await page.addInitScript(()=>localStorage.setItem('ofeliya_save_v1',JSON.stringify({runs:1,muted:true,tutorialDone:true})));
 try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
  const available=await page.evaluate(()=>{const m=window.__game.scene.getScene('Menu');m.showCodex();const overlay=m.children.list.find(o=>o.name==='ofeliya-codex');const dock=overlay?.list.find(o=>o.name==='ofeliya-meta-dock');const has=(name)=>!!dock?.list.find(c=>c.name===name);return {collection:has('ofeliya-meta-dock-collection'),tasks:has('ofeliya-meta-dock-tasks'),codex:has('ofeliya-meta-dock-codex')};});
  assert.equal(available.collection,true,'Muse collection must be reachable from the Codex dock');
  assert.equal(available.tasks,true,'Daily tasks must be reachable from the Codex dock');
  assert.equal(available.codex,true,'the Codex dock must mark the Codex as the active destination');
  const tap=async name=>{
   const point=await page.evaluate(name=>{const s=window.__game.scene.getScene('Menu');const visit=o=>o.name===name?o:o.list?.map(visit).find(Boolean);const o=s.children.list.map(visit).find(Boolean);if(!o)throw Error('missing control '+name);const b=o.getBounds(),r=window.__game.canvas.getBoundingClientRect();return{x:r.x+(b.x+b.width/2)*r.width/s.scale.width,y:r.y+(b.y+b.height/2)*r.height/s.scale.height};},name);
   await page.touchscreen.tap(point.x,point.y);
  };
  await tap('ofeliya-meta-dock-collection');
  await page.waitForFunction(()=>!!window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection'));
  for(const tab of ['milestones','shells','lab']) {
   await tap('ofeliya-collection-'+tab);
   const overflow=await page.evaluate(()=>{const s=window.__game.scene.getScene('Menu'),r=s.children.getByName('ofeliya-collection');return r.list.filter(o=>o.type==='Text').map(o=>({text:o.text,b:o.getBounds()})).filter(({b})=>b.x<0||b.y<0||b.x+b.width>s.scale.width||b.y+b.height>s.scale.height);});
   assert.deepEqual(overflow,[],`${tab} texts stay inside compact viewport`);
  }
  await tap('ofeliya-modal-close-hit');
  await page.waitForFunction(()=>!window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection'));
  await page.evaluate(async()=>{
   const {CollectionBoard}=await import('/src/ui/CollectionBoard.ts');
   const m=window.__game.scene.getScene('Menu');
   window.__collectionListeners=[m.events.listenerCount('shutdown'),m.scale.listenerCount('resize')];
   window.__resizeCollection=new CollectionBoard(m,()=>{});
  });
  await page.setViewportSize({width:390,height:600});
  await page.waitForFunction(()=>window.__game.scale.width===390);
  await page.waitForFunction(()=>!window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection'));
  assert.equal(await page.evaluate(()=>window.__resizeCollection.closed),true,'Menu resize restart destroys open collection');
  await page.evaluate(async()=>{
   window.__resizeCollection.destroy();
   const {CollectionBoard}=await import('/src/ui/CollectionBoard.ts');
   const m=window.__game.scene.getScene('Menu');
   window.__collectionListeners=[m.events.listenerCount('shutdown'),m.scale.listenerCount('resize')];
   for(let i=0;i<10;i++){const b=new CollectionBoard(m,()=>{});b.destroy();b.destroy();}
  });
  assert.deepEqual(await page.evaluate(()=>{const m=window.__game.scene.getScene('Menu');return [m.events.listenerCount('shutdown'),m.scale.listenerCount('resize')];}),await page.evaluate(()=>window.__collectionListeners),'repeated panel close removes all listeners');
  await page.evaluate(()=>{window.__museMenuResized=false;window.__game.scene.getScene('Menu').events.once('create',()=>{window.__museMenuResized=true;});});
  await page.setViewportSize({width:320,height:474});
  await page.waitForFunction(()=>window.__museMenuResized);
  await page.evaluate(()=>{window.__game.scene.getScene('Menu').showCodex();});
  await tap('ofeliya-meta-dock-collection');
  await tap('ofeliya-collection-shells');
  const overlaps=await page.evaluate(()=>{
   const root=window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection');
   const close=root.list.find(o=>o.name==='ofeliya-modal-close-hit').getBounds();
   return root.list.filter(o=>o.name?.startsWith('ofeliya-skin-')).filter(o=>{
    const b=o.getBounds();return b.y<close.bottom&&b.bottom>close.y;
   }).map(o=>o.name);
  });
  assert.deepEqual(overlaps,[],'safe-area-reduced viewport keeps skin controls separate from close');
  await tap('ofeliya-collection-next');
  const shellState=await page.evaluate(()=>{
   const board=window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection');
   const texts=board.list.filter(o=>o.type==='Text').map(o=>o.text);
   return {
    lastSkin:texts.some(t=>t.includes('Золотой прайм')),
    locked:texts.some(t=>t.startsWith('ЗАКРЫТО')),
    lockedSelect:board.list.some(o=>o.name==='ofeliya-skin-skin.gilded-prime'&&Boolean(o.input?.enabled)),
   };
  });
  assert.equal(shellState.lastSkin,true,'pagination keeps last skin reachable');
  assert.equal(shellState.locked,true,'a locked shell states that it is locked');
  assert.equal(shellState.lockedSelect,false,'a locked shell must not offer a select action');
  await tap('ofeliya-collection-lab');
  assert.equal(await page.evaluate(()=>{
   const texts=window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection').list.filter(o=>o.type==='Text');
   return texts.find(o=>o.text.startsWith('Исследование клеток')).getBounds().bottom<=texts.find(o=>o.text.startsWith('Открыто вех')).getBounds().y;
  }),true,'safe-area-reduced lab research and status text do not overlap');
  await tap('ofeliya-modal-close-hit');
  const state=await page.evaluate(async()=>{
   const {ClientCollection}=await import('/src/game/collection/ClientCollection.ts');
   const c=new ClientCollection();c.observeRun({id:'qa-cosmetic-unlock',kills:0,timeMs:0,noDamageMs:0,level:1,combo:50,mutations:[],elites:0,hostCells:0,evolutions:[],legendaryIds:[],won:false});
   c.selectSkin('skin.abyssal-teal');
   const menu=window.__game.scene.getScene('Menu');menu.scene.start('Game');
   return c.snapshot();
  });
  assert.equal(state.selectedSkinId,'skin.abyssal-teal');
  await page.waitForFunction(()=>window.__game.scene.isActive('Game')&&window.__game.scene.isActive('UI'));
  const game=await page.evaluate(()=>{
   const g=window.__game.scene.getScene('Game');g.scene.pause();
   const before=g.runState.run.timeMs;g.hitStopped=false;
   g.update(g.time.now,10000);const elapsed=g.runState.run.timeMs-before;
   const radius=g.player.body.radius*g.player.scaleX;
   g.finish(false);const first=localStorage.getItem('ofeliya.collection.v1');g.finish(false);const second=localStorage.getItem('ofeliya.collection.v1');
   return {elapsed,radius,tint:g.player.tintTopLeft,first,second};
  });
  assert.ok(Math.abs(game.elapsed-50)<1e-9,'real GameScene clamps background frame (IEEE subtraction precision)');
  assert.ok(game.radius>10&&game.radius<14,'cosmetic skin preserves authoritative body radius');
  assert.equal(game.first,game.second,'second finish cannot duplicate collection observation');
  assert.notEqual(game.tint,0xffffff,'earned cosmetic changes player appearance');
  assert.deepEqual(errors,[]);
  console.log('Browser: Muse compact collection/gallery/lab + cosmetic body + clamped Game + terminal idempotency PASS');
 } finally {await page.close();}
}
