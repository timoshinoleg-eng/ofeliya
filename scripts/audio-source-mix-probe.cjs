// DEV-server source-sample mixture; procedural tones and full-file extrema are outside this probe.
const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const BASE=process.env.OFELIYA_BASE_URL||'http://127.0.0.1:5173/';
const OUTPUT=process.env.OFELIYA_AUDIO_DIR||'/tmp/ofeliya-audio';
fs.mkdirSync(OUTPUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let results;try{
 const page=await browser.newPage();await page.route('https://st.max.ru/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
 await page.goto(BASE,{waitUntil:'domcontentloaded'});
 results=await page.evaluate(async()=>{
  const M=await import('/src/systems/audioMixMath.ts'),decode=new AudioContext(),rows=[];
  const beds=['loop0.ogg','loop1.ogg','loop2.ogg','loop3.mp3','loop4.mp3','loop5.mp3','loop6.mp3'];
  const old={shoot:.5,hit:.45,pickup:.5,levelup:.7,hurt:.7,click:.6,nova:.7,elite:.7,boss:.8,gameover:.8,victory:.8};
  const read=async f=>decode.decodeAudioData(await(await fetch('/audio/'+f)).arrayBuffer());
  const buffers=Object.fromEntries(await Promise.all(Object.keys(old).map(async n=>[n,await read('sfx/'+n+'.ogg')])));
  const normalization=Object.fromEntries(Object.keys(old).map(n=>[n,M.scanNormalizationTrim(buffers[n])]));
  const stats=b=>{let peak=0,sum=0,clippedSamples=0,sampleCount=0;for(let c=0;c<b.numberOfChannels;c++)for(const x of b.getChannelData(c)){if(!Number.isFinite(x))throw Error('nonfinite');peak=Math.max(peak,Math.abs(x));sum+=x*x;clippedSamples+=Math.abs(x)>=1;sampleCount++;}return{peak,rms:Math.sqrt(sum/sampleCount),clippedSamples,sampleCount};};
  for(let index=0;index<7;index++){const bed=await read('music/'+beds[index]);for(const revised of [false,true]){
   const ctx=new OfflineAudioContext(2,48000*6,48000),master=ctx.createGain();master.gain.value=revised?M.MASTER_GAIN:.5;
   if(revised){const c=ctx.createDynamicsCompressor();c.threshold.value=-8;c.knee.value=6;c.ratio.value=4;c.attack.value=.003;c.release.value=.12;master.connect(c);c.connect(ctx.destination);}else master.connect(ctx.destination);
   const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=2500*Math.pow(14000/2500,.12);filter.Q.value=.9;filter.connect(master);
   const gain=ctx.createGain();gain.gain.value=revised?M.MUSIC_GAIN:.35;gain.connect(filter);
   const trim=ctx.createGain();trim.gain.value=revised?M.MUSIC_BED_TRIMS[index]:1;trim.connect(gain);
   const music=ctx.createBufferSource();music.buffer=bed;music.loop=true;music.connect(trim);music.start(0);
   const play=(name,at)=>{const s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=buffers[name];g.gain.value=revised?M.SFX_ROLE_GAINS[name]*normalization[name]:old[name];s.connect(g);g.connect(master);s.start(at);};
   for(let t=.2;t<5.5;t+=.07)play('shoot',t);for(let t=.2;t<5.5;t+=.055)play('hit',t);for(let t=.2;t<5.5;t+=.045)play('pickup',t);
   [['click',.1],['hurt',1],['nova',1.5],['elite',2],['levelup',2.5],['boss',3],['gameover',4],['victory',4.5]].forEach(([n,t])=>play(n,t));
   rows.push({index,bed:beds[index],revised,trim:trim.gain.value,...stats(await ctx.startRendering())});
  }}
  await decode.close();return{normalization,rows};
 });
 }finally{await browser.close();}fs.writeFileSync(path.join(OUTPUT,'source-mix.json'),JSON.stringify(results,null,2)+'\n');
 const rows=results.rows.filter(r=>r.revised),maxPeak=Math.max(...rows.map(r=>r.peak));
 if(rows.some(r=>r.clippedSamples||r.peak>=1))throw Error('sample mix clips');
 console.log(JSON.stringify({beds:rows.length,maxPeak,clippedSamples:rows.reduce((n,r)=>n+r.clippedSamples,0),samples:rows.reduce((n,r)=>n+r.sampleCount,0)}));
})().catch(e=>{console.error(e);process.exit(1);});