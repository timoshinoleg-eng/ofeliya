import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
try {
  await server.listen();
  const base=server.resolvedUrls.local[0];
  browser=await chromium.launch({executablePath:process.env.OFELIYA_CHROME_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  await page.goto(base+'?renderer=canvas',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__game&& !document.querySelector('#splash'),{},{timeout:15000});
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, {timeout:15000});
  await page.waitForFunction(async () => (await import('/src/game/DeferredMenuArt.ts')).deferredMenuArtMetrics.organicComplete, null, {timeout:15000});
  const result=await page.evaluate(async()=>{
    const {organicBakeMetrics}=await import('/src/game/OrganicNoise.ts');
    const {deferredMenuArtMetrics}=await import('/src/game/DeferredMenuArt.ts');
    // Separate cache/budget for the pixel contract so the real boot budget is not reset.
    const {prepareOrganicNoise,applyOrganicNoise}=await import('/src/game/OrganicNoise.ts?qa=pixel-contract');
    const marks=window.__startupTrace?.marks||[];
    const start=marks.find(m=>m.name==='boot.textures.start')?.tMs;
    const end=marks.find(m=>m.name==='boot.textures.end')?.tMs;
    const actual={...organicBakeMetrics};
    const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');
    ctx.fillStyle='#a5b6c7';ctx.fillRect(0,0,64,32);
    const before=ctx.getImageData(0,0,64,64).data;
    prepareOrganicNoise();applyOrganicNoise(ctx,64,64);
    const after=ctx.getImageData(0,0,64,64).data;
    const alphaSame=before.every((v,i)=>i%4!==3||v===after[i]);
    const changed=before.some((v,i)=>i%4!==3&&v!==after[i]);
    c.width=c.height=0;
    return {firstFrameMs:deferredMenuArtMetrics.firstFrameMs,organic:actual,bootTextureMs:start!=null&&end!=null?end-start:null,alphaSame,changed};
  });
  console.log('ORGANIC_BOOT_EVIDENCE '+JSON.stringify(result));
  assert.equal(result.organic.skipped,false,'organic bake must not be skipped on this test device');
  assert.ok(result.organic.ms+result.organic.compositeMs<=40,'added bake+composite budget exceeded');
  assert.ok(result.alphaSame&&result.changed,'source-atop must preserve alpha and modify RGB');
} finally {await browser?.close();await server.close();}
