import type Phaser from 'phaser';
import { PlatformBridge } from './index';
import { TelegramLifecycle } from './TelegramLifecycle';
import { TELEGRAM_BRIDGE_READY_EVENT } from './TelegramBridgeLoader';

/** Keep host pauses separate from UI/modal/manual pause ownership. */
export function installGameHostLifecycle(scene:Phaser.Scene,isRunning:()=>boolean):()=>void {
 let controller:TelegramLifecycle<object>|null=null;
 let host:object|undefined;
 let owner:object|null=null;
 let stopped=false;
 const active=()=>!stopped&&isRunning()&&(scene.scene.isActive('Game')||scene.scene.isPaused('Game'));
 const canResume=()=>{
  const ui=scene.scene.get('UI') as Phaser.Scene & {canResumeFromHost?:()=>boolean};
  return ui.canResumeFromHost?.()??true;
 };
 const owns=(token:object)=>{
  if(owner!==token)return false;
  if(!canResume()){owner=null;return false;}
  return true;
 };
 const resume=(token:object)=>{
  if(active()&&scene.scene.isPaused('Game')&&owns(token)){owner=null;scene.scene.resume('Game');}
 };
 const bind=()=>{
  const wa=PlatformBridge.kind==='telegram'?window.Telegram?.WebApp:undefined;
  if(wa===host)return;
  controller?.destroy();controller=null;host=wa;
  if(!wa||!active())return;
  controller=new TelegramLifecycle(wa,document,{isGameActive:active,isPaused:()=>scene.scene.isPaused('Game'),
   pause:()=>{owner={};scene.scene.pause('Game');return owner;},isPauseOwned:owns,resume});
  controller.start();
 };
 // If the adapter disappears while hidden, release only our own pause when the page
 // becomes visible again. The old controller's removed listeners cannot do that.
 const onVisible=()=>{if(document.visibilityState!=='hidden'&&owner)resume(owner);};
 const onResume=()=>{owner=null;};
 window.addEventListener(TELEGRAM_BRIDGE_READY_EVENT,bind);
 window.addEventListener('ofeliya:max-bridge-ready',bind);
 document.addEventListener('visibilitychange',onVisible);
 scene.events.on('resume',onResume);
 bind();
 return ()=>{
  if(stopped)return;stopped=true;
  controller?.destroy();controller=null;owner=null;
  window.removeEventListener(TELEGRAM_BRIDGE_READY_EVENT,bind);
  window.removeEventListener('ofeliya:max-bridge-ready',bind);
  document.removeEventListener('visibilitychange',onVisible);
  scene.events.off('resume',onResume);
 };
}
