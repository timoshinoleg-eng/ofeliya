import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
const out = process.env.OFELIYA_VISUAL_EVIDENCE;
if (out) mkdirSync(out, { recursive: true });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.OFELIYA_CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync), headless: true, args: ['--no-sandbox','--enable-unsafe-swiftshader'] });
  for (const [width,height] of [[320,568],[360,640],[390,844]]) {
    const context = await browser.newContext({ viewport: {width,height}, hasTouch: true, serviceWorkers: 'block' });
    await context.route('https://st.max.ru/**', r => r.fulfill({status:200,contentType:'application/javascript',body:''}));
    await context.route('**/api/**', r => r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"entries":[],"ranked":false}'}));
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => { errors.push(String(e)); console.log('page error',String(e)); });
    await page.goto(server.resolvedUrls.local[0], {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, {timeout:20000});
    console.log('completion fixture Menu',width);
    await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
    await page.waitForFunction(() => window.__game.scene.isActive('UI'), null, {timeout:20000});
    await page.evaluate(() => {
      const game = window.__game, gs = game.scene.getScene('Game'), ui = game.scene.getScene('UI');
      ui.dismissProgressionForStageBoundary(); gs.scene.pause();
      window.__completionRes={win:true,reason:'campaign-clear',difficultyId:'standard',runSeed:'visual-report',controlMode:'one-hand',resumed:false,timeMs:999999,kills:99999,hostCellsInfected:999,level:99,highestLevel:99,comboBest:999,stageId:'heart',stageOrder:2,bossesDefeated:2,boss1ClearMs:120000,stacks:{multi:3,pierce:3,dmg:3},evolutions:['prism','halo','singularity'],legendaryIds:['split-geometry','core-predator'],stageBuilds:{},newAchievements:['first-contact'],records:{timeRecord:true,killsRecord:true,levelRecord:true}}; ui.renderGameOver(window.__completionRes);
    });
    console.log('completion fixture result rendered',width);
    if (out) await page.screenshot({path:resolve(out,`${width}-rich-result.png`)});
    const report = await page.evaluate(() => {
      const ui = window.__game.scene.getScene('UI'), c = ui.resultOverlay;
      const details = c.list.filter(o => o.type === 'Text' && /^(КРИТ\.|ЛЕГЕНДАРНЫЕ|ПРОФИЛЬ ШТАММА|РЕЖИМ:|СЧЁТ:|НОВЫЕ ЗАПИСИ|НОВОЕ ДОСТИЖЕНИЕ)/.test(o.text));
      const viewport = c.list.find(o => o.name === 'ofeliya-result-report');
      const rows = viewport ? viewport.list.filter(o => o.type === 'Text') : details;
      const hit = c.getByName('ofeliya-result-report-hit').getBounds(), retry = c.getByName('ofeliya-result-retry-bg').getBounds(), stats = c.getByName('ofeliya-result-stats').getBounds();
      const title = c.getByName('ofeliya-result-title').getBounds(), time = c.getByName('ofeliya-result-time').getBounds();
      window.__completionResult = c;
      return { headerOrder: title.bottom + 8 <= time.top && time.bottom + 8 <= stats.top, rows: rows.map(o => ({text:o.text,font:parseFloat(o.style.fontSize),top:o.y,bottom:o.y+o.height})), overflow:!!c.getByName('ofeliya-result-scroll-hint').text, height:window.innerHeight, hit:{x:hit.centerX,y:hit.centerY,top:hit.top,bottom:hit.bottom}, retry:{x:retry.centerX,y:retry.centerY,top:retry.top}, statsBottom:stats.bottom };
    });
    assert.ok(report.rows.length >= 6, JSON.stringify(report));
    assert.ok(report.headerOrder, 'measured title/time/stats must retain 8px separation');
    assert.ok(report.rows.every(o => o.font >= 11), 'result metadata must stay readable at11px');
    assert.ok(report.rows.every((o,i,a) => i === 0 || o.top >= a[i-1].bottom + 3), 'wrapped report rows must never overlap');
    assert.ok(report.hit.top > report.statsBottom && report.hit.bottom + 16 < report.retry.top, 'report must stay between header and pinned actions');
    await page.mouse.move(report.hit.x,report.hit.y); await page.mouse.down();
    await page.mouse.move(report.retry.x,report.retry.y,{steps:6}); await page.mouse.up();
    assert.ok(await page.evaluate(() => window.__game.scene.getScene('UI').resultOverlay === window.__completionResult), 'scroll release over retry must not invoke it');
    await page.mouse.move(report.hit.x,report.hit.y); await page.mouse.wheel(0,1200); await page.waitForTimeout(100);
    const scrolled = await page.evaluate(() => window.__game.scene.getScene('UI').resultOverlay.getByName('ofeliya-result-report').y);
    if(report.overflow) assert.ok(scrolled < report.hit.top, 'report must expose lower rows by scrolling');
    if(out) await page.screenshot({path:resolve(out,`${width}-rich-result-scrolled.png`)});
    const shareFit=await page.evaluate(()=>{
      const ui=window.__game.scene.getScene('UI');ui.resultOverlay.destroy(true);
      ui.renderGameOver({...window.__completionRes,win:false,difficultyId:'strained',resumed:true});
      const c=ui.resultOverlay,t=c.getByName('ofeliya-result-share-label').getBounds(),b=c.getByName('ofeliya-result-share-bg').getBounds();
      return {fits:t.left>=b.left+4&&t.right<=b.right-4,text:c.getByName('ofeliya-result-share-label').text};
    });
    assert.equal(shareFit.text,'ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ');assert.ok(shareFit.fits,'long share action must fit its hit target');
    if(out) await page.screenshot({path:resolve(out,`${width}-resumed-result.png`)});
    assert.equal(errors.length,0,errors.join('\n'));
    console.log(`visual completion ${width}x${height}: rich result readable, measured rows PASS`);
    await page.evaluate(() => { const ui=window.__game.scene.getScene('UI'); ui.scene.stop('Game'); ui.scene.start('Menu'); });
    await page.waitForFunction(() => window.__game.scene.isActive('Menu'));
    await page.evaluate(() => window.__game.scene.getScene('Menu').showSocialHub());
    await page.waitForTimeout(2800);
    for(const state of ['rich','error']) {
      await page.evaluate(state => {
        const hub=window.__game.scene.getScene('Menu').socialHub;
        const entry={rank:99999,platform:'telegram',timeMs:9999999,kills:999999,relation:'inviter'};
        const detail={status:{daily:'ok',season:'ok',seasonTop:'ok',friends:'ok'},snapshot:{daily:{you:entry,rank:99999,total:99999,dateKey:'2026-10-16'},season:{index:99,daysLeft:99},seasonTop:Array(4).fill(entry),friends:Array(4).fill(entry)}};
        if(state==='error') detail.status={daily:'network',season:'http',seasonTop:'http',friends:'network'};
        hub.render(detail);
      },state);
      if(out) await page.screenshot({path:resolve(out,`${width}-social-${state}.png`)});
      const social = await page.evaluate(() => {
        const hub=window.__game.scene.getScene('Menu').socialHub;
        const texts=hub.body.list.filter(o=>o.type==='Text');
        const box=name=>{const o=hub.body.getByName(name),b=o?.getBounds();return b?{top:b.top,bottom:b.bottom,left:b.left,right:b.right}:null;};
        return {panelBottom:hub.panelTop+hub.panelH,rows:texts.map(o=>({name:o.name,text:o.text,font:parseFloat(o.style.fontSize),...box(o.name)})),daily:box('ofeliya-social-daily-bg')||box('ofeliya-social-daily-disabled'),status:box('ofeliya-social-today-status')};
      });
      assert.ok(social.rows.every(o=>o.font>=11),'social metadata floor11px');
      assert.ok(social.status.bottom<=social.daily.top-2,'daily status must stay above44px action');
      assert.ok(social.rows.filter(o=>o.name).every(o=>o.left>=8&&o.right<=width-8&&o.bottom<social.panelBottom),'social copy must stay inside panel');
      console.log(`visual completion ${width}: SocialHub ${state} PASS`);
    }
    await page.evaluate(()=>window.__game.scene.getScene('Menu').socialHub.destroy());
    await page.evaluate(()=>window.__game.scene.getScene('Menu').showCodex());
    for(const label of ['МУТАЦИИ','ЛЕГЕНДАРНЫЕ','МАСТЕРСТВО']) {
      const point=await page.evaluate(label=>{const c=window.__game.scene.getScene('Menu').codexOverlay,t=c.list.find(o=>o.text===label),b=t.getBounds();return{x:b.centerX,y:b.centerY};},label);
      await page.mouse.click(point.x,point.y);
      if(out) await page.screenshot({path:resolve(out,`${width}-codex-${label}.png`)});
      const overflow=await page.evaluate(()=>{const c=window.__game.scene.getScene('Menu').codexOverlay,all=[];const visit=o=>{if(o.type==='Text'){const b=o.getBounds();if(b.left<4||b.right>innerWidth-4||b.bottom>innerHeight-4)all.push(o.text);}o.list?.forEach(visit);};visit(c);return all;});
      assert.deepEqual(overflow,[],'Codex must fit compact viewport');
    }
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
