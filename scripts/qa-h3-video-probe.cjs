const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors=[]; page.on('pageerror', e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:5400/?qaVideos=h3&video=1');
    await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
    for (const [id, file] of [['immunePrimeIntro','qa-h3-prime.mp4'],['cardiacTitanIntro','qa-h3-titan.mp4'],['bloodstreamToHeart','qa-h3-heart.mp4']]) {
      const played = await page.evaluate(async id => { const {VideoInterstitial}=await import('/src/systems/VideoInterstitial.ts'); window.__videoOutcome=[]; return VideoInterstitial.play(id,{onComplete:()=>window.__videoOutcome.push('complete'),onFail:()=>window.__videoOutcome.push('fail'),maxDurationMs:8000}); }, id);
      assert.equal(played,true,`${id}: overlay started`);
      await page.waitForFunction((file)=>document.querySelector('video')?.src.includes(file),file,{timeout:10000});
      await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.05,null,{timeout:15000});
      await page.locator('[data-ofeliya-video]').click({force:true});
      await page.waitForFunction(()=>window.__videoOutcome.length===1,null,{timeout:10000});
      assert.deepEqual(await page.evaluate(()=>window.__videoOutcome),['complete'],`${id}: skip completes once`);
      assert.equal(await page.locator('[data-ofeliya-video]').count(),0,`${id}: overlay removed`);
      console.log(`PASS ${id}: selected ${file}, decoded, skipped once`);
    }
    // A normal QA URL still selects the existing production asset.
    await page.goto('http://127.0.0.1:5400/?video=1');
    await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
    await page.evaluate(async()=>{const {VideoInterstitial}=await import('/src/systems/VideoInterstitial.ts');window.__videoOutcome=[];VideoInterstitial.play('immunePrimeIntro',{onComplete:()=>window.__videoOutcome.push('complete'),onFail:()=>window.__videoOutcome.push('fail'),maxDurationMs:8000})});
    await page.waitForFunction(()=>document.querySelector('video')?.src.includes('07_immune_prime_intro_v2.mp4'));
    await page.locator('[data-ofeliya-video]').click({force:true});
    await page.waitForFunction(()=>window.__videoOutcome.length===1);
    console.log('PASS default URL: original video selected');
    // The full boss preview must finish naturally within the existing 5 s cap.
    await page.goto('http://127.0.0.1:5400/?qaVideos=h3&video=1');
    await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
    await page.evaluate(async()=>{const {VideoInterstitial}=await import('/src/systems/VideoInterstitial.ts');window.__videoOutcome=[];window.__ended=false;VideoInterstitial.play('cardiacTitanIntro',{onComplete:()=>window.__videoOutcome.push('complete'),onFail:()=>window.__videoOutcome.push('fail'),maxDurationMs:5000});document.querySelector('video').addEventListener('ended',()=>window.__ended=true)});
    await page.waitForFunction(()=>window.__videoOutcome.length===1,null,{timeout:12000});
    assert.equal(await page.evaluate(()=>window.__ended),true,'preview must end naturally before cap');
    assert.deepEqual(await page.evaluate(()=>window.__videoOutcome),['complete']);
    console.log('PASS full boss preview: natural end before 5 s cap');
    // A broken selected asset must release the caller, once.
    await page.route('**/video/qa-h3-heart.mp4',route=>route.fulfill({status:404,body:''}));
    await page.goto('http://127.0.0.1:5400/?qaVideos=h3&video=1');
    await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
    await page.evaluate(async()=>{const {VideoInterstitial}=await import('/src/systems/VideoInterstitial.ts');window.__videoOutcome=[];VideoInterstitial.play('bloodstreamToHeart',{onComplete:()=>window.__videoOutcome.push('complete'),onFail:()=>window.__videoOutcome.push('fail'),maxDurationMs:8000})});
    await page.waitForFunction(()=>window.__videoOutcome.length===1,null,{timeout:15000});
    assert.deepEqual(await page.evaluate(()=>window.__videoOutcome),['fail']);
    assert.equal(await page.locator('[data-ofeliya-video]').count(),0);
    console.log('PASS unavailable preview: fallback once, overlay removed');
    assert.deepEqual(errors,[]); console.log('qa h3 video probe: PASS');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
