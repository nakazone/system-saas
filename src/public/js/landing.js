(()=>{
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const toast=(m)=>{const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2200)};

/* nav + progress + active link */
const nav=$('#nav'),prog=$('#progress'),links=$$('.nav-links a[href^="#"]');
addEventListener('scroll',()=>{
  const h=document.documentElement; prog.style.width=(h.scrollTop/(h.scrollHeight-h.clientHeight)*100)+'%';
  nav.classList.toggle('scrolled',h.scrollTop>10);
  let cur=''; $$('section[id]').forEach(s=>{if(s.getBoundingClientRect().top<140)cur=s.id});
  links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+cur));
},{passive:true});
const burger=$('#burger');
burger.onclick=()=>{const open=$('#links').classList.toggle('open');burger.setAttribute('aria-expanded',open?'true':'false')};
$$('#links a').forEach(a=>a.addEventListener('click',()=>{$('#links').classList.remove('open');burger.setAttribute('aria-expanded','false')}));

/* reveal + counters */
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.12});
$$('.reveal').forEach(el=>{if(reduce)el.classList.add('in');else io.observe(el)});
const cio=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const el=e.target,end=+el.dataset.count;
  if(reduce){el.textContent=String(end);cio.unobserve(el);return}
  let t0;const step=t=>{t0??=t;const p=Math.min((t-t0)/1200,1);el.textContent=Math.round(end*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(step)};requestAnimationFrame(step);cio.unobserve(el)}),{threshold:.6});
$$('[data-count]').forEach(el=>{if(reduce)el.textContent=el.dataset.count;cio.observe(el)});

/* rotating word */
const words=['flooring','hardwood','LVP','tile','carpet','laminate'];let wi=0;
if(!reduce)setInterval(()=>{wi=(wi+1)%words.length;$('#rot').innerHTML='<span>'+words[wi]+'</span>'},2400);

/* board tilt */
const board=$('#board');
if(!reduce&&matchMedia('(pointer:fine)').matches){
  board.parentElement.addEventListener('mousemove',e=>{const r=board.getBoundingClientRect();const x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;board.style.transform=`perspective(1000px) rotateY(${x*6}deg) rotateX(${-y*6}deg)`});
  board.parentElement.addEventListener('mouseleave',()=>board.style.transform='');
}

/* pipeline kanban */
const dots=['var(--gray)','var(--blue)','var(--brand)','var(--green)'];
const labels=['Website form','Follow-up tomorrow','Quote sent','Install booked'];
const pool=[['Rivera Residence','Hardwood',4280],['Chen Condo','LVP',2150],['Oak St. Duplex','Laminate',3380],['Patel Kitchen','Tile',2940],['Brooks Basement','Carpet',1320],['Nguyen Home','Hardwood',5610],['Lopez Rental','LVP',1880],['Harbor Office','Tile',7420]];
let pi=0,won=4280;const cols=$$('.col');
function mk(stage){const [n,t,v]=pool[pi++%pool.length];const c=document.createElement('div');c.className='card';c.draggable=true;c.dataset.v=v;
  c.innerHTML=`<b>${n}</b><small><i style="background:${dots[stage]}"></i><span>${t} · $${v.toLocaleString()}</span></small>`;cols[stage].appendChild(c);bindCard(c);return c}
function counts(){cols.forEach(c=>c.querySelector('em').textContent=c.querySelectorAll('.card').length)}
function moveTo(card,stage){const from=+card.parentElement.dataset.stage;if(from===stage)return;
  cols[stage].appendChild(card);card.style.animation='none';card.offsetHeight;card.style.animation='';
  card.querySelector('i').style.background=dots[stage];
  if(stage===3&&from!==3){won+=+card.dataset.v;animWon();const f=$('#floatWon');f.textContent='🎉 '+card.querySelector('b').textContent+' — won';f.classList.add('show');setTimeout(()=>f.classList.remove('show'),1800)}
  if(from===3&&stage!==3){won-=+card.dataset.v;animWon()}
  counts()}
let shown=won;function animWon(){const s=shown,e=won,t0=performance.now();const st=t=>{const p=Math.min((t-t0)/700,1);shown=Math.round(s+(e-s)*p);$('#wonTotal').textContent='$'+shown.toLocaleString();if(p<1)requestAnimationFrame(st)};requestAnimationFrame(st)}
let dragged=null;
function bindCard(c){c.addEventListener('dragstart',()=>{dragged=c;c.classList.add('dragging');pause()});c.addEventListener('dragend',()=>{c.classList.remove('dragging');dragged=null});
  c.addEventListener('click',()=>{const s=+c.parentElement.dataset.stage;if(s<3){moveTo(c,s+1);pause()}})}
cols.forEach(col=>{col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('over')});col.addEventListener('dragleave',()=>col.classList.remove('over'));
  col.addEventListener('drop',e=>{e.preventDefault();col.classList.remove('over');if(dragged)moveTo(dragged,+col.dataset.stage)})});
mk(0);mk(0);mk(1);mk(2);const w=mk(3);pool.push(pool.shift());counts();
let paused=0;function pause(){paused=Date.now()+6000}
function tick(){if(Date.now()<paused||reduce)return;
  const wonCards=cols[3].querySelectorAll('.card');if(wonCards.length>2){wonCards[0].style.transition='.3s';wonCards[0].style.opacity=0;setTimeout(()=>wonCards[0].remove(),300)}
  for(let s=2;s>=0;s--){const cs=cols[s].querySelectorAll('.card');if(cs.length&&Math.random()<.55){moveTo(cs[0],s+1);break}}
  if(cols[0].querySelectorAll('.card').length<2)mk(0);setTimeout(counts,320)}
setInterval(tick,2200);

/* fit quiz */
const qs=[['Install hardwood, LVP, laminate, tile, or carpet','need'],['Need a shared pipeline for sales and office staff','need'],['Want estimates with waste & markup rules you control','need'],['Prefer a focused tool over a full ERP rollout','need'],
  ['Need crew scheduling or field payroll today','gap'],['Require a builder/partner portal out of the box','gap'],['Want full accounting / AR-AP in the same app','gap'],['Need custom-domain wildcards before you can start','gap']];
const ans={};const quiz=$('#quiz');
qs.forEach(([t,k],i)=>{const d=document.createElement('div');d.className='q';d.innerHTML=`<span class="kind ${k}">${k==='need'?'Fit':'Gap'}</span><p>${t}</p><div class="tg"><button type="button" class="yes">Yes</button><button type="button" class="no">No</button></div>`;
  d.querySelectorAll('button').forEach(b=>b.onclick=e=>{e.stopPropagation();ans[i]=b.classList.contains('yes');d.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');score()});quiz.appendChild(d)});
function score(){const n=Object.keys(ans).length;let pts=0;qs.forEach(([t,k],i)=>{if(i in ans)pts+=(k==='need'?ans[i]:!ans[i])?1:0});
  const pct=Math.round(pts/Math.max(n,1)*100);$('#garc').style.strokeDashoffset=236-236*pct/100;$('#gval').textContent=pct+'%';
  const gaps=qs.filter(([t,k],i)=>k==='gap'&&ans[i]).length;
  $('#garc').style.stroke=pct>=75?'#2F9E6B':pct>=50?'#E8792C':'#E0A400';
  if(n<3){$('#ftitle').textContent='Keep going…';$('#fdesc').textContent=`${n} of ${qs.length} answered.`;return}
  if(gaps>=2){$('#ftitle').textContent='Not the right fit (yet)';$('#fdesc').textContent='Some things you need are on our roadmap, not in the product today. Check back soon — or try it anyway for the parts that work.'}
  else if(pct>=75){$('#ftitle').textContent='Looks like a great fit';$('#fdesc').textContent='ObraMate covers what you need today. Start your 30-day trial — no card required.'}
  else{$('#ftitle').textContent='Could be a fit';$('#fdesc').textContent=gaps?'One item you need is on the roadmap. Everything else works today.':'Worth a try — the trial is free and takes minutes to set up.'}}

/* feature tabs */
const tabs=$$('.tab'),panes=$$('.pane');let ti=0,tTimer;
function show(i){ti=i;tabs.forEach((t,j)=>{t.classList.toggle('active',j===i);const b=t.querySelector('.bar');b.style.animation='none';b.offsetHeight;b.style.animation=''});
  panes.forEach((p,j)=>{p.classList.toggle('show',j===i)});clearTimeout(tTimer);if(!reduce)tTimer=setTimeout(()=>show((ti+1)%tabs.length),6000)}
tabs.forEach((t,i)=>t.onclick=()=>show(i));
const tabsEl=$('#tabs');const stage=$('.stage');
[tabsEl,stage].forEach(el=>{el.addEventListener('mouseenter',()=>{tabsEl.classList.add('paused');clearTimeout(tTimer)});el.addEventListener('mouseleave',()=>{tabsEl.classList.remove('paused');show(ti)})});
const tio=new IntersectionObserver(es=>{if(es[0].isIntersecting){show(0);tio.disconnect()}},{threshold:.3});tio.observe(stage);

/* calculator */
const FALLBACK_R={hardwood:{w:10,mm:30,lm:40,mr:8.5,lr:3.5},lvp:{w:8,mm:35,lm:40,mr:4.25,lr:2.75},laminate:{w:8,mm:35,lm:35,mr:3.5,lr:2.5},tile:{w:12,mm:40,lm:45,mr:5.5,lr:6},carpet:{w:10,mm:30,lm:35,mr:2.75,lr:1.5}};
const R=(Array.isArray(window.__ESTIMATE_RULES__)&&window.__ESTIMATE_RULES__.length)
  ?Object.fromEntries(window.__ESTIMATE_RULES__.map(r=>[r.flooringType,{w:+r.wastePercent,mm:+r.materialMarkup,lm:+r.laborMarkup,mr:+r.defaultPricePerSqft,lr:+r.defaultLaborPerSqft}]))
  :FALLBACK_R;
const names={hardwood:'Hardwood',lvp:'LVP',laminate:'Laminate',tile:'Tile',carpet:'Carpet'};
let type='hardwood',rules={...R.hardwood};
const typesEl=$('#types');Object.keys(R).forEach(k=>{const b=document.createElement('button');b.type='button';b.className='type'+(k===type?' on':'');b.innerHTML=`<div class="sw ${k}"></div>${names[k]}`;
  b.onclick=()=>{type=k;rules={...R[k]};$$('.type').forEach(x=>x.classList.remove('on'));b.classList.add('on');buildKnobs();calc()};typesEl.appendChild(b)});
const knobDefs=[['w','Waste',0,30,1,'%'],['mm','Material markup',0,100,1,'%'],['lm','Labor markup',0,100,1,'%'],['mr','Material $/sqft',0.5,20,.25,'$'],['lr','Labor $/sqft',0.5,15,.25,'$']];
function buildKnobs(){const k=$('#knobs');k.innerHTML='';knobDefs.forEach(([key,l,mn,mx,st,u])=>{const d=document.createElement('div');d.className='knob';
  const lab=v=>u==='$'?'$'+(+v).toFixed(2):v+'%';
  d.innerHTML=`<label>${l}<b>${lab(rules[key])}</b></label><input type="range" min="${mn}" max="${mx}" step="${st}" value="${rules[key]}">`;
  const inp=d.querySelector('input');paint(inp);inp.oninput=()=>{rules[key]=+inp.value;d.querySelector('b').textContent=lab(inp.value);paint(inp);calc()};k.appendChild(d)});
  const reset=document.createElement('button');reset.type='button';reset.className='chip';reset.style.cssText='grid-column:1/-1;justify-self:start;cursor:pointer';reset.textContent='↺ Reset to defaults';reset.onclick=()=>{rules={...R[type]};buildKnobs();calc();toast('Rules reset to '+names[type]+' defaults')};k.appendChild(reset)}
function paint(r){r.style.setProperty('--p',((r.value-r.min)/(r.max-r.min)*100)+'%')}
const area=$('#area'),areaR=$('#areaR');
area.oninput=()=>{areaR.value=Math.min(+area.value||0,3000);paint(areaR);calc()};
areaR.oninput=()=>{area.value=areaR.value;paint(areaR);calc()};
$$('.presets button').forEach(b=>b.onclick=()=>{area.value=areaR.value=b.dataset.a;paint(areaR);calc()});
const cur={total:0,mat:0,lab:0,bill:0};
function tween(key,to,el,f){const from=cur[key],t0=performance.now();cur[key]=to;if(reduce){el.textContent=f(to);return}
  const st=t=>{const p=Math.min((t-t0)/450,1),e=1-Math.pow(1-p,3);el.textContent=f(from+(to-from)*e);if(p<1&&cur[key]===to)requestAnimationFrame(st)};requestAnimationFrame(st)}
function calc(){const a=Math.max(0,+area.value||0);const bill=a*(1+rules.w/100);const mat=bill*rules.mr*(1+rules.mm/100);const lab=a*rules.lr*(1+rules.lm/100);const tot=mat+lab;
  tween('bill',bill,$('#billable'),v=>v.toFixed(2)+' sqft');tween('mat',mat,$('#mat'),fmt);tween('lab',lab,$('#lab'),fmt);tween('total',tot,$('#total'),fmt);
  $('#per').textContent=(a?fmt(tot/a):'$0.00')+' per sqft installed';$('#outType').textContent=names[type]+' · '+a.toLocaleString()+' sqft';
  $('#sMat').style.width=(tot?mat/tot*100:50)+'%';$('#sLab').style.width=(tot?lab/tot*100:50)+'%'}
paint(areaR);buildKnobs();calc();

/* steps track */
const sio=new IntersectionObserver(es=>{if(!es[0].isIntersecting)return;$('#track').style.width='100%';$$('.step').forEach((s,i)=>setTimeout(()=>s.classList.add('lit'),reduce?0:300+i*450));sio.disconnect()},{threshold:.5});
sio.observe($('#steps'));

/* compare table */
const Y='<span class="v yes">✓ Yes</span>',P=t=>`<span class="v part">◐ ${t}</span>`,N=t=>`<span class="v no">— ${t}</span>`;
const rows=[['Built for flooring waste/markup estimates',Y,Y,P('Limited'),P('Limited')],['Multi-tenant SaaS (many companies)',Y,P('Usually single-company'),Y,Y],['Lead pipeline + quotes in one place',Y,Y,Y,Y],
  ['Crew scheduling / field payroll',P('Roadmap'),P('Varies'),Y,P('Varies')],['Full ERP / inventory depth',N('Not the goal'),Y,N('No'),P('Varies')],['Fast to start (trial, low setup)',Y,P('Often heavy'),Y,P('Moderate')]];
const tb=$('#cmp tbody');rows.forEach(r=>{const tr=document.createElement('tr');tr.innerHTML=r.map((c,i)=>`<td class="${i===1?'c-om':''}">${c}</td>`).join('');tb.appendChild(tr)});
$$('#cmpT button').forEach(b=>b.onclick=()=>{$$('#cmpT button').forEach(x=>x.classList.remove('on'));b.classList.add('on');const c=b.dataset.c,tbl=$('#cmp');
  tbl.classList.toggle('focus',c!=='all');tbl.querySelectorAll('tr').forEach(tr=>[...tr.children].forEach((cell,i)=>cell.classList.toggle('dim',c!=='all'&&i>1&&i!==+c+1)))});

/* faq */
const faqs=[['Is my company’s data isolated from other tenants?','Yes. Every business record is scoped to an organization. The app injects the tenant id automatically, and Postgres Row-Level Security is a second layer of protection.'],
  ['What happens after the 30-day trial?','Today Starter is trial-only — there is no live Stripe billing yet. We’ll communicate paid plans before charging anyone. You can keep using the workspace while billing is still offline.'],
  ['Can I import or export my data?','There is no bulk CSV import/export UI in this version. Your data lives in Postgres and can be exported by your team or via support as we add tooling.'],
  ['Can I cancel or delete my organization?','Platform admins can change organization status (including canceled). Self-serve deletion from inside the app is not finished yet — contact support if you need a workspace removed.'],
  ['Which flooring types are supported in estimates?','Hardwood, LVP, laminate, tile, and carpet — each with default waste and markup rules that you can edit per organization.']];
const fq=$('#faqs');faqs.forEach(([q,a],i)=>{const d=document.createElement('div');d.className='faq-item'+(i===0?' open':'');
  d.innerHTML=`<button type="button" aria-expanded="${i===0}">${q}<span class="pm" aria-hidden="true">+</span></button><div class="ans"><div><p>${a}</p></div></div>`;
  d.querySelector('button').onclick=()=>{const o=d.classList.contains('open');$$('.faq-item').forEach(x=>{x.classList.remove('open');x.querySelector('button').setAttribute('aria-expanded','false')});if(!o){d.classList.add('open');d.querySelector('button').setAttribute('aria-expanded','true')}};fq.appendChild(d)});

/* pricing spotlight */
const pr=$('#price');pr.addEventListener('mousemove',e=>{const r=pr.getBoundingClientRect();pr.style.setProperty('--mx',(e.clientX-r.left)+'px');pr.style.setProperty('--my',(e.clientY-r.top)+'px')});
})();
