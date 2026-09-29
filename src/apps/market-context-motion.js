/** DOM-only, interruptible motion. Tokens own timing/easing; no polling. */
const active=new WeakMap();
const running=new Set();
let preference;
function reduced() {
  if (!preference) {
    preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    preference.addEventListener('change',()=>{ if(preference.matches) for(const animation of running) animation.cancel(); });
  }
  return preference.matches;
}
export function animateContext(node,frames,{slow=false}={}) {
  active.get(node)?.cancel();
  if (!node?.animate||reduced()) return;
  const style=getComputedStyle(node),token=style.getPropertyValue(slow?'--duration-slow':'--duration-base').trim();
  const duration=parseFloat(token)*(token.endsWith('ms')?1:1000);
  if (!Number.isFinite(duration)||duration<=0) return;
  const animation=node.animate(frames,{duration,easing:style.getPropertyValue('--ease-standard').trim()||'ease-out'});
  active.set(node,animation);running.add(animation);
  animation.finished.catch(()=>{}).finally(()=>{running.delete(animation);if(active.get(node)===animation) active.delete(node);});
}
export function transitionContext(container,update) {
  const previous=container.getBoundingClientRect().height;
  active.get(container)?.cancel();
  update();
  const next=container.getBoundingClientRect().height;
  if(previous&&next&&Math.abs(previous-next)>1) animateContext(container,[{height:previous+'px',overflow:'clip'},{height:next+'px',overflow:'clip'}],{slow:true});
  const visible=[...container.children].find(node=>!node.hidden);
  if(visible) animateContext(visible,[{opacity:.35,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}]);
}
