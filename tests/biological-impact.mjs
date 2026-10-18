import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function load(file) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', 'exports', 'require', code)(module, module.exports, () => ({ BIOLOGICAL_KEYS: ['virus-player', 'immune-antibody'] }));
  return module.exports;
}
const { biologicalHitDirection, biologicalHitFrame, biologicalHitAtlasKey, bakeBiologicalHit, ensureBiologicalImpacts } = load('src/game/BiologicalImpact.ts');
const { artSourceFactor } = load('src/game/ArtMetrics.ts');
assert.deepEqual([[1,0],[0,1],[-1,0],[0,-1]].map(([x,y])=>biologicalHitDirection(x,y)),[0,1,2,3]);
assert.equal(biologicalHitDirection(0,1,Math.PI/2),0,'direction compensates existing rotation');
assert.equal(biologicalHitDirection(NaN,1),0);
assert.equal(biologicalHitDirection(0,0),0);
assert.deepEqual([0,59,60,119,120,179,180,-1].map(t=>biologicalHitFrame(t,2)),['hit-2-0','hit-2-0','hit-2-1','hit-2-1','hit-2-2','hit-2-2',null,null]);
assert.deepEqual([0,89,90,179,180].map(t=>biologicalHitFrame(t,1,true)),['hit-1-0','hit-1-0','hit-1-2','hit-1-2',null]);
const started=performance.now();
const entries=new Map(), frames=[], allocations=[];
for(const [key,size] of [['virus-player',224],['immune-antibody',152]]) {
  const source=new Uint8ClampedArray(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const i=(y*size+x)*4;
    source[i]=x;source[i+1]=y;source[i+2]=180;source[i+3]=Math.hypot(x-size/2,y-size/2)<size*.43?255:0;
  }
  const original=source.slice();
  const left=bakeBiologicalHit(source,size,0,0),down=bakeBiologicalHit(source,size,1,0),recovery=bakeBiologicalHit(source,size,0,2);
  assert.notDeepEqual(left,source);assert.notDeepEqual(left,down);assert.notDeepEqual(left,recovery);
  assert.deepEqual(left,bakeBiologicalHit(source,size,0,0));assert.deepEqual(source,original);
  for(const pixels of [left,down,recovery]) {
    assert.equal(pixels.length,source.length);
    for(let x=0;x<size;x++)assert.equal(pixels[x*4+3],0,'transparent top border retained');
  }
  assert.equal(artSourceFactor(biologicalHitAtlasKey(key)),4);
  entries.set(key,{get:()=>({cutWidth:size,cutHeight:size}),getContext:()=>({getImageData:()=>({data:source})})});
}
const scene={textures:{exists:key=>entries.has(key),get:key=>entries.get(key),remove:key=>entries.delete(key),
  createCanvas(key,width,height) {
    allocations.push({key,width,height});
    const texture={getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}}),
      add:(...args)=>frames.push([key,...args]),refresh:()=>{texture.refreshed=true;}};
    entries.set(key,texture);return texture;
  }}};
ensureBiologicalImpacts(scene);ensureBiologicalImpacts(scene);
assert.equal(allocations.length,2);assert.equal(frames.length,24);
for(const {width,height} of allocations)assert.ok(width<=896&&height<=672);
for(const [key,name,index,x,y,width,height] of frames) {
  const [,direction,pose]=name.split('-').map(Number);
  assert.equal(index,0);assert.equal(width,height);assert.equal(x,direction*width);assert.equal(y,pose*height);
  assert.equal(entries.get(key).refreshed,true);
}
entries.delete('bio-hit-virus-player');
scene.textures.createCanvas=key=>{const partial={getContext(){throw Error('Canvas unavailable');}};entries.set(key,partial);return partial;};
ensureBiologicalImpacts(scene);
assert.equal(entries.has('bio-hit-virus-player'),false);assert.equal(entries.has('virus-player'),true);
console.log(`biological impact: direction, exact lifetime/reduced poses, deterministic local warp, 24 invariant frames, idempotent boot/fallback PASS (${(performance.now()-started).toFixed(1)}ms desktop audit, not mobile timing)`);
