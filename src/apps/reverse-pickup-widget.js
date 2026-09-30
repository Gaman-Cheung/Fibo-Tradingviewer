/**
 * Temporary Reverse Pickup calculator.
 * Presentation and arithmetic only: it never touches Pool, storage, cloud or market data.
 */
const LEVELS = Object.freeze([
  { key:'level382', ratio:.382, label:'浅回撤', description:'优先观察承接是否出现' },
  { key:'level500', ratio:.5, label:'中位', description:'强弱分界，重新核对逻辑' },
  { key:'level618', ratio:.618, label:'深回撤', description:'跌破后只做复盘，不自动补仓' },
]);

export function calculateReversePickup({ anchor, close, current = null } = {}) {
  const low=Number(anchor), high=Number(close), now=current===''||current==null?null:Number(current);
  if(!Number.isFinite(low)||low<=0||!Number.isFinite(high)||high<=0||high<=low) return null;
  const span=high-low;
  const levels=Object.fromEntries(LEVELS.map(level=>[level.key,high-span*level.ratio]));
  let zone=null;
  if(Number.isFinite(now)) {
    if(now>high) zone={kind:'neutral',label:'仍在强势区',title:'当前价高于上涨日收盘。',detail:'不追高，等待回踩或新的结构确认。'};
    else if(now>=levels.level382) zone={kind:'success',label:'浅回撤观察',title:'进入 38.2% 上方区域。',detail:'价格仍偏强，观察是否在计划价附近缩量企稳。'};
    else if(now>=levels.level500) zone={kind:'success',label:'接近主计划价',title:'已触及 38.2% 附近。',detail:'先验证承接，再考虑分批；不要一次性押注。'};
    else if(now>=levels.level618) zone={kind:'warning',label:'深回撤警戒',title:'位于 50%—61.8% 区间。',detail:'强弱分界已被跌穿，仓位和逻辑都要重新评估。'};
    else zone={kind:'danger',label:'跌破深回撤',title:'已跌破 61.8% 深回撤位。',detail:'把它当作复盘信号，而不是自动补仓信号。'};
  }
  return {anchor:low,close:high,current:Number.isFinite(now)?now:null,levels,zone};
}

const format=value=>Number.isFinite(value)?Number(value).toFixed(2):'—';
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

function markup() {
  return `<button class="reverse-pickup-launcher" type="button" aria-expanded="false" aria-controls="reversePickupPanel" aria-label="打开倒车接人计算器" title="打开倒车接人计算器"><span class="material-icons" aria-hidden="true">calculate</span></button>
  <section class="reverse-pickup-panel fibo-card" id="reversePickupPanel" role="dialog" aria-modal="false" aria-labelledby="reversePickupTitle" hidden>
    <header class="reverse-pickup-panel__header" data-reverse-pickup-drag-handle>
      <div><span class="reverse-pickup-panel__eyebrow">TEMPORARY TOOL</span><h2 id="reversePickupTitle">倒车接人计算器</h2></div>
      <button class="reverse-pickup-panel__close" type="button" data-reverse-pickup-close aria-label="关闭倒车接人计算器" title="关闭"><span class="material-icons" aria-hidden="true">close</span></button>
    </header>
    <form class="reverse-pickup-form" novalidate>
      <div class="reverse-pickup-rules" aria-label="三条复盘规则"><article><b>01</b><p><strong>先统一锚点</strong>普通上涨日用开盘价；跳空高开时切换到前收价。</p></article><article><b>02</b><p><strong>价位不是买点</strong>38.2% 只是优先观察位，先等承接和结构确认。</p></article><article><b>03</b><p><strong>环境不配合就等</strong>大盘、板块、个股不同步时，重新评估逻辑与仓位。</p></article></div>
      <fieldset class="reverse-pickup-field"><legend>下沿锚点</legend><div class="reverse-pickup-anchor-toggle" role="radiogroup" aria-label="选择下沿锚点"><label><input name="anchorType" value="open" type="radio" checked><span>上涨日开盘</span></label><label><input name="anchorType" value="prev" type="radio"><span>前收价（跳空）</span></label></div><div class="reverse-pickup-input-wrap"><input name="anchor" type="text" inputmode="decimal" autocomplete="off" placeholder="输入下沿价格" required></div><small class="reverse-pickup-hint" data-anchor-hint>普通上涨日使用开盘价；若当天跳空高开，可切换到前收价。</small></fieldset>
      <div class="reverse-pickup-fields-row"><label class="reverse-pickup-field"><span>上涨日收盘价</span><div class="reverse-pickup-input-wrap"><input name="close" type="text" inputmode="decimal" autocomplete="off" placeholder="输入收盘价" required></div></label><label class="reverse-pickup-field"><span>当前价格 <small>（可选）</small></span><div class="reverse-pickup-input-wrap"><input name="current" type="text" inputmode="decimal" autocomplete="off" placeholder="用于判断区间"></div></label></div>
      <p class="reverse-pickup-error" data-reverse-pickup-error aria-live="polite"></p>
      <div class="reverse-pickup-actions"><button class="fibo-button fibo-button--primary" type="submit"><span class="material-icons" aria-hidden="true">insights</span>生成观察位</button><button class="fibo-button" type="button" data-reverse-pickup-clear>清空</button></div>
    </form>
    <div class="reverse-pickup-readout" data-reverse-pickup-readout hidden>
      <div class="reverse-pickup-readout__top"><div><span class="reverse-pickup-panel__eyebrow">OBSERVATION READOUT</span><div class="reverse-pickup-readout__label">38.2% 主观察位</div><strong data-reverse-pickup-primary>—</strong></div><span class="reverse-pickup-badge" data-reverse-pickup-badge>等待输入</span></div>
      <div class="reverse-pickup-rail" role="img" aria-label="回撤价位轨道"><div class="reverse-pickup-rail__track"></div><i data-marker="618"></i><i data-marker="500"></i><i data-marker="382"></i><i data-marker="current" hidden></i><b data-marker="close"></b><div class="reverse-pickup-rail__ends"><span data-reverse-pickup-low>下沿 —</span><span data-reverse-pickup-high>收盘 —</span></div></div>
      <div class="reverse-pickup-levels">${LEVELS.map(level=>`<div><span><strong>${level.label}</strong>${level.ratio*100}%</span><small>${level.description}</small><b data-reverse-pickup-level="${level.key}">—</b></div>`).join('')}</div>
      <div class="reverse-pickup-reading"><span aria-hidden="true">i</span><p><strong data-reverse-pickup-reading-title>先输入上涨日数据。</strong> <span data-reverse-pickup-reading-detail>生成结果后，这里会显示当前价格所处区间。</span></p></div>
    </div>
  </section>`;
}

export function initializeReversePickupWidget({ root = document.body } = {}) {
  const host=document.createElement('div'); host.className='reverse-pickup-widget'; host.innerHTML=markup(); root.append(host);
  const launcher=host.querySelector('.reverse-pickup-launcher'),panel=host.querySelector('.reverse-pickup-panel'),form=host.querySelector('form');
  const error=host.querySelector('[data-reverse-pickup-error]'),readout=host.querySelector('[data-reverse-pickup-readout]');
  const inputs=Object.fromEntries(['anchor','close','current'].map(name=>[name,form.elements[name]]));
  let position=null,drag=null;
  const setOpen=open=>{launcher.setAttribute('aria-expanded',String(open));panel.hidden=!open;host.classList.toggle('is-open',open);if(open) window.requestAnimationFrame(()=>inputs.anchor.focus());};
  const setPosition=(left,top)=>{const rect=panel.getBoundingClientRect(),margin=10;position={left:clamp(left,margin,Math.max(margin,innerWidth-rect.width-margin)),top:clamp(top,margin,Math.max(margin,innerHeight-rect.height-margin))};panel.style.left=position.left+'px';panel.style.top=position.top+'px';panel.style.right='auto';panel.style.bottom='auto';};
  const clear=()=>{form.reset();readout.hidden=true;error.textContent='';host.querySelector('[data-anchor-hint]').textContent='普通上涨日使用开盘价；若当天跳空高开，可切换到前收价。';};
  const render=result=>{
    readout.hidden=false;
    host.querySelector('[data-reverse-pickup-primary]').textContent=format(result.levels.level382);
    host.querySelector('[data-reverse-pickup-low]').textContent='下沿 '+format(result.anchor); host.querySelector('[data-reverse-pickup-high]').textContent='收盘 '+format(result.close);
    LEVELS.forEach(level=>host.querySelector(`[data-reverse-pickup-level="${level.key}"]`).textContent=format(result.levels[level.key]));
    const badge=host.querySelector('[data-reverse-pickup-badge]'),readingTitle=host.querySelector('[data-reverse-pickup-reading-title]'),readingDetail=host.querySelector('[data-reverse-pickup-reading-detail]');
    badge.className='reverse-pickup-badge '+(result.zone?'is-'+result.zone.kind:'');badge.textContent=result.zone?.label||'已生成观察位';readingTitle.textContent=result.zone?.title||'已生成分层价位。';readingDetail.textContent=result.zone?.detail||'先看 38.2% 附近的承接，再核对环境状态。';
    const span=result.close-result.anchor,set=(key,percent,label)=>{const marker=host.querySelector(`[data-marker="${key}"]`);marker.style.left=clamp(percent,0,100)+'%';marker.dataset.label=label;marker.hidden=false;};
    set('618',38.2,'61.8%');set('500',50,'50%');set('382',61.8,'38.2%');set('close',100,'收盘');
    const current=host.querySelector('[data-marker="current"]');if(Number.isFinite(result.current)){set('current',((result.close-result.current)/span)*100,'当前');}else current.hidden=true;
  };
  form.addEventListener('submit',event=>{event.preventDefault();error.textContent='';const result=calculateReversePickup({anchor:inputs.anchor.value,close:inputs.close.value,current:inputs.current.value});if(!result){error.textContent='请填写有效价格，并确保上涨日收盘价高于下沿锚点。';return;}render(result);});
  host.querySelector('[data-reverse-pickup-clear]').addEventListener('click',clear);host.querySelector('[data-reverse-pickup-close]').addEventListener('click',()=>setOpen(false));launcher.addEventListener('click',()=>setOpen(panel.hidden));
  form.querySelectorAll('input[name="anchorType"]').forEach(radio=>radio.addEventListener('change',()=>{host.querySelector('[data-anchor-hint]').textContent=radio.value==='prev'?'已按跳空上涨处理：下沿使用前一日收盘价。':'普通上涨日使用开盘价；若当天跳空高开，可切换到前收价。';}));
  const handle=host.querySelector('[data-reverse-pickup-drag-handle]');
  const stopDrag=()=>{drag=null;host.classList.remove('is-dragging');};
  handle.addEventListener('pointerdown',event=>{if(event.target.closest('button'))return;const rect=panel.getBoundingClientRect();drag={x:event.clientX-rect.left,y:event.clientY-rect.top};handle.setPointerCapture?.(event.pointerId);host.classList.add('is-dragging');});
  window.addEventListener('pointermove',event=>{if(drag)setPosition(event.clientX-drag.x,event.clientY-drag.y);});
  window.addEventListener('pointerup',stopDrag);window.addEventListener('pointercancel',stopDrag);
  window.addEventListener('resize',()=>{if(position&&!panel.hidden)setPosition(position.left,position.top);});
  return {open:()=>setOpen(true),close:()=>setOpen(false),destroy:()=>host.remove()};
}
