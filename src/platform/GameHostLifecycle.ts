import type Phaser from 'phaser';
import { PlatformBridge } from './index';
import { TelegramLifecycle } from './TelegramLifecycle';
import { TELEGRAM_BRIDGE_READY_EVENT } from './TelegramBridgeLoader';

/** Keep host pauses separate from UI/modal/manual pause ownership. */
export function installGameHostLifecycle(scene:Phaser.Scene,isRunning:()=>boolean):()=>void {
 // Phaser 3.90 queues `ScenePlugin.pause/resume` for the next Scene Manager update, while the
 // pause ownership below is tracked synchronously. A deferred pause lets a host activation arrive
 // before the pause is applied: the ownership is then dropped, the queued pause lands anyway and
 // the run stays frozen with nobody able to release it. The Scene Manager applies pause/resume
 // immediately, so ownership and scene state always agree inside the same host event.
 const manager=scene.sys.game.scene;
 let controller:TelegramLifecycle<object>|null=null;
 let host:object|undefined;
 let owner:object|null=null;
 let stopped=false;
 const active=()=>!stopped&&isRunning()&&(manager.isActive('Game')||manager.isPaused('Game'));
 const canResume=()=>{
  const ui=manager.getScene('UI') as Phaser.Scene & {canResumeFromHost?:()=>boolean}|null;
  return ui?.canResumeFromHost?.()??true;
 };
 const owns=(token:object)=>{
  if(owner!==token)return false;
  if(!canResume()){owner=null;return false;}
  return true;
 };
 const resume=(token:object)=>{
  if(active()&&manager.isPaused('Game')&&owns(token)){owner=null;manager.resume('Game');}
 };
 const bind=()=>{
  const wa=PlatformBridge.kind==='telegram'?window.Telegram?.WebApp:undefined;
  if(wa===host)return;
  controller?.destroy();controller=null;host=wa;
  if(!wa||!active())return;
  controller=new TelegramLifecycle(wa,document,{isGameActive:active,isPaused:()=>manager.isPaused('Game'),
   pause:()=>{owner={};manager.pause('Game');return owner;},isPauseOwned:owns,resume});
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
