/** Only dark host backgrounds may harmonize the already-dark splash/page. */
export function darkThemeColor(value:unknown):string|null {
 if(typeof value!=='string'||!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value))return null;
 const hex=value.length===4?'#'+[...value.slice(1)].map(c=>c+c).join(''):value;
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
 return .2126*r+.7152*g+.0722*b<.25?hex.toLowerCase():null;
}
interface ThemeHost {
 initData?:string;themeParams?:{bg_color?:string};
 onEvent?:(type:string,callback:()=>void)=>void;offEvent?:(type:string,callback:()=>void)=>void;
}
interface ThemeWindow {
 Telegram?:{WebApp?:ThemeHost};WebApp?:{initData?:string};
 addEventListener(type:string,callback:()=>void):void;removeEventListener(type:string,callback:()=>void):void;
}
export function installTelegramTheme(win:ThemeWindow=window,doc:Document=document):()=>void {
 const elements=[doc.documentElement,doc.body,doc.getElementById('splash')].filter((e):e is HTMLElement=>!!e);
 const previous=elements.map(e=>e.style.getPropertyValue('background'));
 let host:ThemeHost|undefined,closed=false;
 const restore=()=>elements.forEach((e,i)=>{if(previous[i])e.style.setProperty('background',previous[i]);else e.style.removeProperty('background');});
 const paint=()=>{
  const color=darkThemeColor(host?.themeParams?.bg_color);
  if(!color){restore();return;}
  for(const e of elements)e.style.setProperty('background',color);
 };
 const detach=()=>{try{host?.offEvent?.('themeChanged',paint);}catch{/* Optional host capability. */}};
 const bind=()=>{
  const next=win.WebApp?.initData?undefined:win.Telegram?.WebApp;
  if(next===host){paint();return;}
  detach();host=next?.initData?next:undefined;
  try{if(host?.onEvent&&host?.offEvent)host.onEvent('themeChanged',paint);}catch{/* Safe fallback remains CSS dark. */}
  paint();
 };
 win.addEventListener('ofeliya:telegram-bridge-ready',bind);
 win.addEventListener('ofeliya:max-bridge-ready',bind);bind();
 return()=>{if(closed)return;closed=true;detach();restore();win.removeEventListener('ofeliya:telegram-bridge-ready',bind);win.removeEventListener('ofeliya:max-bridge-ready',bind);};
}
