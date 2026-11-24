import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
try{
 await server.listen();
 const port=server.httpServer.address().port,base='http://127.0.0.1:'+port;
 browser=await chromium.launch({executablePath:process.env.OFELIYA_CHROME_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 await page.route('**/*',route=>{const u=route.request().url();if(u===base+'/__share-test')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Share QA</title>'});return u.startsWith(base+'/')?route.continue():route.abort();});
 await page.goto(base+'/__share-test');
 const outcome=await page.evaluate(async()=>{
  const {renderRunShareCard}=await import('/src/ui/runShareCard.ts');
  const canvases=[],create=document.createElement.bind(document);
  document.createElement=(tag,...args)=>{const el=create(tag,...args);if(tag==='canvas')canvases.push(el);return el;};
  try{
   const r=await renderRunShareCard({run:{win:true,timeMs:381000,kills:1008,hostCellsInfected:44,stageOrder:2,highestLevel:23,records:{timeRecord:true,killsRecord:false,levelRecord:false}},platform:'telegram',name:'Длинное имя игрока — тестирование',mutations:['Легендарная мутация с длинным названием','Лизис']});
   const bmp=await createImageBitmap(r.file),raw=new Uint8Array(await r.file.arrayBuffer());
   let b64='';for(const byte of raw)b64+=String.fromCharCode(byte);
   const result={width:bmp.width,height:bmp.height,type:r.file.type,bytes:raw.length,disposed:canvases.every(c=>c.width===0&&c.height===0),base64:btoa(b64)};
   bmp.close();r.dispose();return result;
  }finally{document.createElement=create;}
 });
 assert.equal(outcome.type,'image/png');assert.equal(outcome.width,780);assert.equal(outcome.height,1040);assert.ok(outcome.bytes>10000);assert.equal(outcome.disposed,true);
 if(process.env.OFELIYA_SHARE_CARD_EVIDENCE)writeFileSync(process.env.OFELIYA_SHARE_CARD_EVIDENCE,Buffer.from(outcome.base64,'base64'));
 console.log('runShareCard: PNG '+outcome.width+'x'+outcome.height+' '+outcome.bytes+' bytes; backing canvas released PASS');
}finally{await browser?.close();await server.close();}
