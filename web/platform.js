// DOM is a rendering/effects adapter. Canonical state and decisions live in Rust.
import {connectLibrary} from './library.js';
let dispatch;
let model = {};
let lastLink = location.pathname + location.search;
let suppressLocation = false;
let lastReported = '';
let iconMarkup = {};
let passageTools;
const inlinePassageActions = matchMedia('(min-width:700px)');
const $ = (id) => document.getElementById(id);
const emit = (action, id = '', book = model.book ?? '', value = 0) => dispatch?.(JSON.stringify({ action, id, book, value }));
const button = (label, action, icon, className = 'icon') => {
  const element = document.createElement('button');
  element.type = 'button'; element.className = className;
  element.setAttribute('aria-label', label); element.title = label;
  element.innerHTML = iconMarkup[icon] ?? '';
  element.addEventListener('click', () => emit(action));
  return element;
};
const escapeCSS = (value) => CSS.escape(value);
const passageElement = (id) => $('reader-text').querySelector(`[data-passage-id="${escapeCSS(id)}"]`);
function selectPassage(id) { emit(model.selected === id ? 'clear' : 'select', id); }
function captureAnchor() {
  const scroller = $('reader-scroll');
  const top = scroller.getBoundingClientRect().top;
  const elements = [...$('reader-text').querySelectorAll('.passage')];
  const element = elements.find((p) => p.getBoundingClientRect().bottom > top + 12);
  return element ? { id: element.dataset.passageId, offset: element.getBoundingClientRect().top - top } : null;
}
function restoreAnchor(anchor) {
  if (!anchor) return;
  const element = passageElement(anchor.id);
  if (element) $('reader-scroll').scrollTop += element.getBoundingClientRect().top - $('reader-scroll').getBoundingClientRect().top - anchor.offset;
}
function textWithRanges(p) {
  const fragment = document.createDocumentFragment();
  const boundaries = new Set([0, p.text.length]);
  for (const [start, length] of [...p.modernization, ...p.quotations]) { boundaries.add(start); boundaries.add(start + length); }
  const points = [...boundaries].sort((a,b) => a-b);
  for (let i = 1; i < points.length; i++) {
    const start = points[i-1], end = points[i];
    const span = document.createElement('span'); span.textContent = p.text.slice(start,end);
    if (p.modernization.some(([a,n]) => start >= a && end <= a+n)) span.classList.add('modernized');
    if (p.quotations.some(([a,n]) => start >= a && end <= a+n)) span.classList.add('quotation');
    fragment.append(span);
  }
  return fragment;
}
function renderChapters(chapters) {
  const text = $('reader-text');
  // Reuse unchanged chapter nodes: text selection survives window extension.
  const old = new Map([...text.children].map((c) => [c.dataset.key, c]));
  const desired = [];
  for (const chapter of chapters) {
    const key = chapter.paragraphs[0]?.id ?? chapter.title;
    const fingerprint = JSON.stringify(chapter);
    let section = old.get(key);
    if (!section || section._fingerprint !== fingerprint) {
      section = document.createElement('section'); section.className = 'chapter'; section.dataset.key = key;
      section._fingerprint = fingerprint;
      if (chapter.opening) {
        const opening = document.createElement('div'); opening.className = 'book-opening';
        const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'BOOK';
        const title = document.createElement('h1'); title.textContent = chapter.opening.title;
        const details = document.createElement('p'); details.className = 'details';
        details.textContent = `${chapter.opening.author}\n${chapter.opening.collection} · ${chapter.opening.chapters} chapters`;
        opening.append(eyebrow, title, details); section.append(opening);
      }
      const heading = document.createElement('h2'); heading.textContent = chapter.title; section.append(heading);
      for (const key of ['subtitle','edition']) if (chapter[key]) { const p = document.createElement('p'); p.className = key; p.textContent = chapter[key]; section.append(p); }
      let group;
      for (const source of chapter.paragraphs) {
        if (source.scripture_group && group?.dataset.groupId !== source.scripture_group) {
          group = document.createElement('div'); group.className = 'commentary-group';
          group.dataset.groupId = source.scripture_group; section.append(group);
        } else if (!source.scripture_group) group = null;
        const container = group ?? section;
        const p = document.createElement('p'); p.className = 'passage'; p.dataset.passageId = source.id;
        p.dataset.link = source.link; p.dataset.reference = source.reference; p.tabIndex = 0;
        p.addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();selectPassage(source.id);}});
        if (source.highlight) { p.classList.add('highlight'); p.style.setProperty('--highlight', highlightColor(source.highlight)); }
        p.append(textWithRanges(source)); container.append(p);
        if (source.scripture_links?.length) {
          const links = document.createElement('div'); links.className = 'scripture-links';
          links.setAttribute('aria-label', 'Linked scripture');
          for (const target of source.scripture_links) {
            const link = document.createElement('a'); link.textContent = target.reference;
            link.href = target.link.replace(/^https:\/\/www\.crosscanon\.com/, '');
            link.setAttribute('aria-label', `Read ${target.reference} in Scripture`);
            link.addEventListener('click', event => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault(); emit('scripture', source.id, target.id);
            });
            links.append(link);
          }
          container.append(links);
        }
      }
    }
    desired.push(section);
  }
  for (const node of [...text.children]) if (!desired.includes(node)) node.remove();
  desired.forEach((node, index) => { if (text.children[index] !== node) text.insertBefore(node, text.children[index] ?? null); });
}
function highlightColor(mark) {
  return ({yellow:'#f9eab3',green:'#d5ead2',blue:'#d3e4f5',pink:'#f4d6e1',purple:'#e3d8ef'})[mark] ?? '#f9eab3';
}
function placePassageActions() {
  const passage = model.selected && passageElement(model.selected);
  const inline = inlinePassageActions.matches && passage;
  if (inline) {
    if (passage.nextElementSibling !== passageTools) passage.after(passageTools);
  } else if (passageTools.parentElement !== $('reader-footer')) {
    $('reader-footer').prepend(passageTools);
  }
  passageTools.hidden = !model.selected || (inlinePassageActions.matches && !passage);
  $('reader-footer').hidden = Boolean(model.selected && inlinePassageActions.matches) || (!model.selected && !model.status);
}
function revealPassageActions() {
  if (!inlinePassageActions.matches || !model.visible || !model.selected) return;
  const passage = passageElement(model.selected);
  if (!passage) return;
  const viewport = $('reader-scroll').getBoundingClientRect();
  const rect = passage.getBoundingClientRect();
  // Only a new selection reveals its controls. Passive scrolling never pulls
  // the reader back to a selected passage, and the row never overlays text.
  if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
    const overflow = passageTools.getBoundingClientRect().bottom - viewport.bottom + 12;
    if (overflow > 0) $('reader-scroll').scrollTop += overflow;
  }
}
function updateReader(next) {
  const previous = model;
  const anchor = captureAnchor();
  model = { ...model, ...next };
  $('reader').hidden = !next.visible;
  $('app-canvas').style.opacity = next.visible ? '0' : '1';
  $('app-canvas').style.pointerEvents = next.visible ? 'none' : 'auto';
  if (!next.visible) return;
  document.title = `${next.title} · Cross Canon`;
  const root = document.documentElement;
  root.style.setProperty('--paper', next.paper); root.style.setProperty('--ink', next.ink);
  root.style.setProperty('--muted', next.muted); root.style.setProperty('--accent', next.accent);
  root.style.setProperty('--line', `color-mix(in srgb,${next.muted} 25%,${next.paper})`);
  root.style.setProperty('--body-size', `${19.84 * next.fontScale}px`);
  root.style.setProperty('--line-height', next.lineHeight);
  root.style.setProperty('--column', `${next.width - 20}px`);
  root.dataset.theme = next.theme === 2 ? 'dark' : 'light';
  root.style.colorScheme = next.theme === 2 ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = next.paper;
  document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]').content = next.theme === 2 ? 'black-translucent' : 'default';
  const audio = $('reader-audio');
  const audioLabel = next.playing ? 'Pause audio' : 'Play audio';
  audio.innerHTML = iconMarkup[next.playing ? 'pause' : 'play'] ?? '';
  audio.setAttribute('aria-label', audioLabel); audio.title = audioLabel;
  audio.dataset.playing = String(next.playing); audio.disabled = !next.audio;
  $('reader-jump').textContent = next.title;
  $('reader-jump').setAttribute('aria-label', `Current reading, ${next.collection}, ${next.title}`);
  $('reader-text').classList.toggle('work', !next.scripture);
  if (next.chapters) renderChapters(next.chapters);
  for (const p of $('reader-text').querySelectorAll('.passage')) {
    p.classList.toggle('selected', p.dataset.passageId === next.selected);
    p.setAttribute('aria-current', p.dataset.passageId === next.location ? 'location' : 'false');
  }
  // A changed Chapter can detach the controls with its old text nodes. Put
  // the retained controls back before updating their reference and buttons.
  placePassageActions();
  $('reader-reference').hidden = !next.selected; $('reader-reference').textContent = next.reference ?? '';
  $('passage-actions').hidden = !next.selected;
  $('reader-status').hidden = Boolean(next.selected); $('reader-status').textContent = next.status ?? '';
  $('action-commentary').hidden = !next.scripture;
  // Layout changes retain a Passage and its local viewport position, never a saved scroll offset.
  if (next.jump) {
    suppressLocation = true;
    requestAnimationFrame(() => {
      const passage = passageElement(next.jump);
      const section = passage?.closest(".chapter");
      const target = section?.querySelector(".passage") === passage ? section : passage;
      if (target) $('reader-scroll').scrollTop += target.getBoundingClientRect().top - $('reader-scroll').getBoundingClientRect().top - 8;
      const link = next.link?.replace(/^https:\/\/www\.crosscanon\.com/, '');
      if (link && link !== lastLink) { history.pushState(null, '', link); lastLink = link; }
      requestAnimationFrame(() => { suppressLocation = false; reportLocation(); });
    });
  } else if (next.chapters || previous.fontScale !== next.fontScale || previous.lineHeight !== next.lineHeight || previous.width !== next.width) {
    restoreAnchor(anchor);
  }
  if (next.selected && next.selected !== previous.selected) requestAnimationFrame(revealPassageActions);
  if ($('reader-settings').open) renderSettings();
}
function reportLocation() {
  if (suppressLocation || !model.visible || $('reader-settings').open) return;
  const scroller = $('reader-scroll');
  const anchor = captureAnchor();
  if (anchor && anchor.id !== lastReported) { lastReported = anchor.id; emit('location', anchor.id); }
  if (scroller.scrollTop < 500 && model.previous) emit('previous');
  else if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 900 && model.next) emit('next');
}
let scrollFrame = 0;
function scheduleLocation() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; reportLocation(); });
}
function renderAccessibility(tree) {
  const root = $('dialog-accessibility');
  root.hidden = !tree.modal;
  if (!tree.modal) { root.replaceChildren(); return; }
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal','true');
  root.setAttribute('aria-label', tree.scope?.split(':')[0] ?? 'Reader dialog');
  const old = new Map([...root.children].map((e) => [e.dataset.id,e]));
  const retained = new Set();
  for (const node of tree.nodes.sort((a,b)=>Math.abs(a.rect[1]-b.rect[1])>4?a.rect[1]-b.rect[1]:a.rect[0]-b.rect[0])) {
    const tag = node.role === 'input' ? (node.multiline ? 'textarea' : 'input') : node.role === 'text' ? 'span' : 'button';
    let element = old.get(node.id);
    if (!element || element.localName !== tag) {
      element?.remove(); element = document.createElement(tag); element.dataset.id = node.id;
      if (tag === 'button') {
        element.type = 'button';
        // HTML controls sit above the canvas, so wheel events need the same
        // Rust scroll routing as touch drags. DOM deltas use the opposite sign.
        element.addEventListener('wheel',(event)=>{
          if(event.ctrlKey||!event.deltaY)return;
          event.preventDefault();
          const unit=event.deltaMode===WheelEvent.DOM_DELTA_LINE?16:event.deltaMode===WheelEvent.DOM_DELTA_PAGE?innerHeight:1;
          emit('scroll',node.id,'',-event.deltaY*unit);
        },{passive:false});
        element.addEventListener('pointerdown',(event)=>{if(document.activeElement?.localName==='textarea')event.preventDefault();});
        let drag;
        let suppressClick=false;
        element.addEventListener('pointerdown',(event)=>{
          drag={y:event.clientY,start:event.clientY};suppressClick=false;
          element.setPointerCapture(event.pointerId);
        });
        element.addEventListener('pointermove',(event)=>{
          if(!drag)return;
          const delta=event.clientY-drag.y;drag.y=event.clientY;
          if(Math.abs(event.clientY-drag.start)>8)suppressClick=true;
          if(suppressClick)emit('scroll',node.id,'',delta);
        });
        element.addEventListener('pointerup',()=>{drag=null;});
        element.addEventListener('pointercancel',()=>{drag=null;suppressClick=true;});
        element.addEventListener('click', () => {if(!suppressClick)emit('accessibility',node.id,'click');});
      }
      if (tag === 'input' || tag === 'textarea') {
        element.autocomplete = 'off';
        element.addEventListener('focus', () => emit('accessibility',node.id,'focus'));
        // Committing a suggestion releases Rust focus while the DOM input can
        // remain active. A second click must reopen its completion list.
        element.addEventListener('pointerdown',()=>{if(document.activeElement===element)emit('accessibility',node.id,'focus');});
        if(tag==='input')element.addEventListener('keydown',event=>{
          if(!event.isComposing&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&['ArrowUp','ArrowDown','Enter','Escape'].includes(event.key)){
            event.preventDefault();event.stopPropagation();emit('key',event.key,node.id);
          }
        });
        const selection=()=>JSON.stringify({text:element.value,start:element.selectionStart??0,end:element.selectionEnd??0});
        element.addEventListener('input', () => emit('text',selection(),node.id));
        element.addEventListener('select', () => emit('selection',selection(),node.id));
        element.addEventListener('keyup', () => emit('selection',selection(),node.id));
        element.addEventListener('pointerup', () => emit('selection',selection(),node.id));
      }
      root.append(element);
    }
    retained.add(element);
    element.setAttribute('aria-label',node.label);
    if (node.selected != null) element.setAttribute('aria-pressed',String(node.selected));
    if (node.role === 'text') element.textContent = node.label;
    if (node.role === 'input') {
      if(element.value!==(node.value??''))element.value=node.value??'';
      if(document.activeElement===element&&node.selection&&(element.selectionStart!==node.selection[0]||element.selectionEnd!==node.selection[1]))element.setSelectionRange(...node.selection);
    }
    const [left,top,width,height] = node.rect.map((n) => n * tree.scale);
    Object.assign(element.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`});
    if (node.role === 'adjustable') {
      element.setAttribute('role','slider'); element.setAttribute('aria-valuenow', node.number ?? 0);
      element.onkeydown = (e) => { if (e.key.startsWith('Arrow')) { e.preventDefault(); emit('accessibility',node.id, ['ArrowRight','ArrowUp'].includes(e.key) ? 'increment' : 'decrement'); } };
    }
  }
  for (const element of [...root.children]) if (!retained.has(element)) element.remove();
}
export function updateSurface(json, accessibility) {
  const value = JSON.parse(json);
  if (accessibility) renderAccessibility(value); else updateReader(value);
}
function closeMenu() { $('tools-menu').close(); $('reader-tools').setAttribute('aria-expanded','false'); }
function openTools() {
  const menu = $('tools-menu'); menu.replaceChildren();
  const items = [['Reader settings','settings','settings'],['Search','search','search'],[model.playing?'Pause audio':'Play audio','audio',model.playing?'pause':'play'],['Audio downloads','downloads','download'],['Account and sync','account','account']];
  if (model.versionControl) items.push([model.original?'Read modernized text':'Read original text','original','book']);
  for (const [label,action,icon] of items) {
    const item = button(label,action,icon,'menu-item');
    const span = document.createElement('span'); span.textContent = label; item.prepend(span);
    item.disabled = action === 'audio' && !model.audio;
    item.onclick = (event) => { event.stopImmediatePropagation(); closeMenu(); if (action === 'settings') { renderSettings(); $('reader-settings').showModal(); } };
    // Standard actions are sent by button's listener; settings stays in the adapter just as UIKit's sheet does.
    if (action === 'settings') { const fresh = item.cloneNode(true); fresh.onclick = () => {closeMenu();renderSettings();$('reader-settings').showModal();}; menu.append(fresh); }
    else { item.addEventListener('click',closeMenu); menu.append(item); }
  }
  menu.showModal(); $('reader-tools').setAttribute('aria-expanded','true');
}
function settingSection(title, footer = '') {
  const section = document.createElement('section'); section.className = 'settings-section';
  const h = document.createElement('h3'); h.textContent = title;
  const group = document.createElement('div'); group.className='settings-group';
  section.append(h,group);
  if (footer) { const p = document.createElement('p');p.textContent=footer;section.append(p); }
  $('settings-content').append(section); return group;
}
function preference(id,value) { emit('preference',id,'',value); }
function renderSettings() {
  const active = document.activeElement?.dataset.setting;
  $('settings-content').replaceChildren();
  const text = settingSection('Text', 'Your browser’s text selection, dictionary, translation, and accessibility tools remain available.');
  for (const [label,id,key,step,min,max,detail] of [
    ['Text size','font','fontScale',.05,.86,1.35,`${Math.round(model.fontScale*100)}% of default size`],
    ['Line spacing','spacing','lineHeight',.1,1.42,2.08,Number(model.lineHeight).toFixed(2)],
    ['Column width','width','width',20,620,880,`${model.width} points maximum`]]) {
    const row = document.createElement('div');row.className='setting-row';
    const title=document.createElement('span');title.textContent=label; const small=document.createElement('small');small.textContent=detail;title.append(small);
    const controls=document.createElement('div');controls.className='stepper';
    for(const [symbol,direction] of [['−',-1],['+',1]]) { const b=document.createElement('button');b.textContent=symbol;b.dataset.setting=id+direction;b.setAttribute('aria-label',`${direction<0?'Decrease':'Increase'} ${label.toLowerCase()}`);b.disabled=direction<0?model[key]<=min:model[key]>=max;b.onclick=()=>preference(id,Math.max(min,Math.min(max,model[key]+direction*step)));controls.append(b); }
    row.append(title,controls);text.append(row);
  }
  for(const [label,values] of [['Default',[1,1.72,820]],['Compact',[.94,1.54,880]],['Open',[1.07,1.86,760]],['Relaxed',[1.14,1.96,700]]]) {
    const b=document.createElement('button');b.className='setting-row';b.textContent=label;b.setAttribute('aria-pressed',String(values.every((n,i)=>Math.abs(n-[model.fontScale,model.lineHeight,model.width][i])<.002)));b.onclick=()=>['font','spacing','width'].forEach((id,i)=>preference(id,values[i]));text.append(b);
  }
  for(const [title,id,key,choices,footer] of [
    ['Bible translation','translation','translation',['World English Bible','Majority Standard Bible'],'Audio follows your translation. MSB recordings stream online. Offline audio downloads use WEB. Search uses the World English Bible index.'],
    ['Theme','theme','theme',['Paper','Sepia','Dark','High contrast'],''],
    ['Scripture canon','canon','canon',['Protestant','Catholic','Orthodox'],'']]) {
    const group=settingSection(title,footer);choices.forEach((label,value)=>{const b=document.createElement('button');b.className='setting-row';b.textContent=label;b.setAttribute('aria-pressed',String(model[key]===value));b.dataset.setting=id+value;b.onclick=()=>preference(id,value);group.append(b);});
  }
  const account=settingSection('Account and connection',model.info);
  const b=document.createElement('button');b.className='setting-row';b.textContent='Account and reading progress';b.onclick=()=>{$('reader-settings').close();emit('account');};account.append(b);
  if(active)$('settings-content').querySelector(`[data-setting="${escapeCSS(active)}"]`)?.focus({preventScroll:true});
}
export async function signIn() {
  try {
    const response=await fetch('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:location.pathname+location.search,errorCallbackURL:location.pathname+location.search})});
    const result=await response.json();if(!response.ok||!result.url)throw Error(result.message??'Sign-in unavailable');location.assign(result.url);
  }catch(error){emit('browser-status',String(error));}
}
export async function signOut() {
  try { const response=await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw Error('Could not sign out');location.reload(); }
  catch(error){emit('browser-status',String(error));}
}
export function openURL(url) { if(/^https?:\/\//.test(url)) window.open(url,'_blank','noopener,noreferrer'); }
export function connect(send, icons, books) {
  dispatch=send;iconMarkup=icons;
  passageTools=document.createElement('div');passageTools.id='passage-tools';
  passageTools.append($('reader-reference'),$('passage-actions'));
  $('reader-footer').prepend(passageTools);
  $('reader-tools').innerHTML=icons.tools;
  $('reader-library').querySelector('.library-icon').innerHTML=icons.library;
  connectLibrary($('library-navigation'), books, () => model, emit, icons);
  $('reader-tools').onclick=openTools;
  $('reader-audio').onclick=()=>emit('audio');
  for(const [label,action,icon,text] of [['Highlight passage','highlight','highlight','Highlight'],['Passage notes','note','note','Notes'],['View commentaries','commentary','commentary','Commentaries'],['Similar passages','similar','search','Similar passages'],['Close passage actions','clear','close','']]) {
    const b=button(label,action,icon);b.id='action-'+action;
    if(text){const span=document.createElement('span');span.className='action-label';span.textContent=text;span.setAttribute('aria-hidden','true');b.append(span);}
    if(action==='clear')b.addEventListener('click',()=>passageElement(model.selected)?.focus({preventScroll:true}));
    $('passage-actions').append(b);
  }
  $('settings-done').onclick=()=>{$('reader-settings').close();$('reader-tools').focus();};
  $('tools-menu').addEventListener('click',(e)=>{if(e.target===$('tools-menu'))closeMenu();});
  $('tools-menu').addEventListener('cancel',()=>{$('reader-tools').setAttribute('aria-expanded','false');});
  $('reader-settings').addEventListener('click',(e)=>{if(e.target===$('reader-settings'))$('reader-settings').close();});
  document.addEventListener('keydown',(event)=>{
    const root=$('dialog-accessibility');
    if(event.key==='Tab'&&!root.hidden){
      const elements=[...root.querySelectorAll('button,input,textarea')];if(!elements.length)return;
      const index=elements.indexOf(document.activeElement);
      if(index<0||(!event.shiftKey&&index===elements.length-1)||(event.shiftKey&&index===0)){
        event.preventDefault();elements[event.shiftKey?elements.length-1:0].focus();
      }
    }
  });
  $('reader-scroll').addEventListener('scroll',scheduleLocation,{passive:true});
  let down;
  $('reader-text').addEventListener('pointerdown',(e)=>{down={x:e.clientX,y:e.clientY,id:e.target.closest('.passage')?.dataset.passageId};});
  $('reader-text').addEventListener('pointerup',(e)=>{
    const start=down;down=null;
    if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<8&&!getSelection()?.toString()&&start.id)selectPassage(start.id);
  });
  $('reader-text').addEventListener('pointercancel',()=>{down=null;});
  window.addEventListener('popstate',()=>{lastLink=location.pathname+location.search;emit('link','https://www.crosscanon.com'+lastLink);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')reportLocation();else emit('resume');});
  let resizeAnchor=captureAnchor();
  new ResizeObserver(()=>{placePassageActions();restoreAnchor(resizeAnchor);resizeAnchor=captureAnchor();}).observe($('reader-scroll'));
  $('reader-scroll').addEventListener('scroll',()=>{resizeAnchor=captureAnchor();},{passive:true});
  document.fonts.ready.then(()=>restoreAnchor(resizeAnchor));
}

let foregroundGeneration=0;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)foregroundGeneration++;});
export function isActive(){return !document.hidden;}
export function activityGeneration(){return foregroundGeneration;}
export function safeInsets(){
  const viewport=window.visualViewport;
  const bottom=viewport?Math.max(0,innerHeight-viewport.height-viewport.offsetTop):0;
  // Use the same CSS safe area as the reading surface, including while that
  // surface is hidden for a canvas dialog. The keyboard can require more room.
  const style=getComputedStyle($('reader'));
  const padding=side=>parseFloat(style[side])||0;
  return [padding('paddingTop'),padding('paddingLeft'),Math.max(padding('paddingBottom'),bottom),padding('paddingRight')];
}
