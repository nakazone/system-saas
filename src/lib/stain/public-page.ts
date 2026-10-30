/**
 * Samples de stain — the client's page (English, no login): photos the crew took of each sample,
 * pick one, type the name, sign and approve. Server-rendered; a few lines of JS for the signature pad.
 */

export type PublicSample = { id: string; number: number; name: string; sub: string; photos: string[] };

export type PublicPageInput = {
  token: string;
  company: { name: string; initials: string; phone?: string | null; email?: string | null; accent?: string | null };
  jobNumber?: number | null;
  address?: string | null;
  woodSpecies?: string | null;
  sampledOn?: string | null;
  board?: string | null;
  samples: PublicSample[];
  terms: string;
  state: "open" | "approved" | "another" | "closed";
  approved?: { name: string; sub: string; number: number; photo?: string | null; signer: string; when: string } | null;
  error?: string | null;
  signerDefault?: string | null;
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const CSS = `
*{box-sizing:border-box}html,body{margin:0}body{background:#F7F8FA;color:#221E1A;font-family:Geist,system-ui,-apple-system,Segoe UI,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:560px;margin:0 auto;background:#fff;min-height:100vh;display:flex;flex-direction:column}
.top{display:flex;align-items:center;gap:10px;padding:18px 20px;border-bottom:1px solid #EEF0F3}
.logo{width:32px;height:32px;border-radius:8px;background:#221E1A;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
.top b{font-size:15px}
.hero{padding:24px 20px 6px}.hero small{display:block;font-size:13px;color:#667085}
h1{margin:6px 0 0;font-size:28px;line-height:1.15;letter-spacing:-.02em}
.hero p{margin:10px 0 0;font-size:15px;line-height:1.5;color:#475467}
.board{margin:16px 20px 0;border-radius:14px;overflow:hidden;position:relative;background:#F1F3F5}
.board img{display:block;width:100%;max-height:340px;object-fit:cover}
.tag{position:absolute;left:10px;bottom:10px;font-size:12px;font-weight:600;color:#fff;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:6px}
.note{margin:16px 20px 0;padding:12px 14px;border-radius:12px;background:#F7F8FA;font-size:13px;line-height:1.45;color:#475467}
.list{padding:20px 20px 0;display:flex;flex-direction:column;gap:14px;border:0;margin:0}
.list legend{font-size:13px;font-weight:600;color:#475467;padding:0 0 10px}
.card{display:block;border:1px solid #E5E7EB;border-radius:16px;padding:10px;cursor:pointer;position:relative}
.card input{position:absolute;opacity:0;width:1px;height:1px}
.card:has(input:checked){border:2px solid #221E1A;padding:9px}
.card:has(input:focus-visible){outline:3px solid #E7792C;outline-offset:2px}
.ph{position:relative;border-radius:10px;overflow:hidden;background:#F1F3F5;aspect-ratio:4/3}
.ph img{width:100%;height:100%;object-fit:cover;display:block}
.num{position:absolute;left:10px;top:10px;font-size:13px;font-weight:700;color:#221E1A;background:#F2E6B8;padding:2px 8px;border-radius:4px}
.more{position:absolute;right:10px;bottom:10px;font-size:12px;font-weight:600;color:#fff;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:6px;text-decoration:none}
.thumbs{display:flex;gap:6px;margin-top:8px;overflow-x:auto}.thumbs a{flex:none}.thumbs img{width:64px;height:48px;object-fit:cover;border-radius:6px;display:block}
.row{display:flex;align-items:center;gap:10px;padding:10px 4px 4px}
.dot{width:22px;height:22px;border-radius:999px;border:2px solid #D0D5DD;flex:none;display:flex;align-items:center;justify-content:center}
.card:has(input:checked) .dot{background:#221E1A;border-color:#221E1A}
.card:has(input:checked) .dot::after{content:"";width:8px;height:8px;border-radius:999px;background:#fff}
.nm{font-size:16px;font-weight:600}.sb{font-size:13px;color:#667085}
.sign{margin:20px;padding-top:20px;border-top:1px solid #EEF0F3;display:flex;flex-direction:column;gap:14px}
h2{margin:0;font-size:20px}
label.f{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:#475467}
input.t,textarea{height:48px;border:1px solid #D0D5DD;border-radius:10px;padding:0 12px;font:400 16px inherit;color:#221E1A;font-family:inherit}
textarea{height:96px;padding:10px 12px;resize:vertical}
.pad{position:relative;height:150px;border:1px solid #D0D5DD;border-radius:10px;background:#FCFCFD;touch-action:none}
.pad canvas{width:100%;height:100%;display:block;border-radius:10px}
.pad .line{position:absolute;left:20px;right:20px;bottom:30px;border-top:1px solid #E5E7EB;pointer-events:none}
.pad .hint{position:absolute;left:20px;bottom:8px;font-size:12px;color:#98A2B3;pointer-events:none}
.clear{position:absolute;top:6px;right:6px;height:36px;padding:0 10px;border:0;background:transparent;font:500 13px inherit;color:#475467;font-family:inherit}
.agree{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.45;color:#344054}
.agree input{width:20px;height:20px;margin:1px 0 0;flex:none;accent-color:#221E1A}
.btn{height:54px;border-radius:14px;border:0;background:#221E1A;color:#fff;font:600 16px inherit;font-family:inherit;cursor:pointer;width:100%}
.btn[disabled]{background:#E5E7EB;color:#475467;cursor:not-allowed}
.btn2{height:48px;border-radius:14px;border:1px solid #D0D5DD;background:#fff;color:#221E1A;font:600 15px inherit;font-family:inherit;cursor:pointer;width:100%}
.small{font-size:12px;line-height:1.45;color:#667085;margin:0}
.err{margin:16px 20px 0;padding:12px 14px;border-radius:12px;background:#FEF3EC;color:#8A3C0F;font-size:14px}
details.another{margin:14px 20px 0}details.another summary{list-style:none;cursor:pointer;height:48px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600}
details.another summary::-webkit-details-marker{display:none}
details.another form{display:flex;flex-direction:column;gap:10px}
.done{padding:40px 20px 0;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px}
.ok{width:56px;height:56px;border-radius:999px;background:#536249;display:flex;align-items:center;justify-content:center}
.box{margin:24px 20px 0;border:1px solid #E5E7EB;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px}
.box .hd{display:flex;gap:14px;align-items:center}.box .hd img,.box .hd span.ph0{width:72px;height:72px;border-radius:12px;object-fit:cover;background:#F1F3F5;flex:none}
.kv{display:flex;justify-content:space-between;font-size:14px;gap:12px}.kv span:first-child{color:#667085}
.foot{margin-top:auto;padding:20px;font-size:12px;color:#667085;border-top:1px solid #EEF0F3}
a.btnlink{display:flex;align-items:center;justify-content:center;text-decoration:none}
`;

function head(title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>`;
}

function top(c: PublicPageInput["company"]): string {
  return `<header class="top"><div class="logo" aria-hidden="true">${esc(c.initials)}</div><b>${esc(c.name)}</b></header>`;
}

function foot(c: PublicPageInput["company"]): string {
  return `<footer class="foot">${[c.name, c.phone, c.email].filter(Boolean).map(esc).join(" · ")}</footer>`;
}

const CHECK = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>`;

export function renderStainPage(p: PublicPageInput): string {
  const base = `/public/stain/${esc(p.token)}`;
  const meta = [p.jobNumber ? `Job #${p.jobNumber}` : null, p.address].filter(Boolean).map(esc).join(" · ");

  if (p.state === "approved" && p.approved) {
    const a = p.approved;
    return `${head("Stain approved")}<main class="wrap">${top(p.company)}
<section class="done"><div class="ok">${CHECK}</div><h1 style="font-size:26px">You approved ${esc(a.name)}</h1>
<p style="margin:0;font-size:15px;line-height:1.5;color:#475467">Thanks, ${esc(a.signer.split(/\s+/)[0] || "")}. Our crew will apply this color on your floor.</p></section>
<section class="box"><div class="hd">${a.photo ? `<img src="${esc(a.photo)}" alt="Photo of the approved sample on your floor">` : '<span class="ph0"></span>'}
<div><div class="nm" style="font-size:17px;font-weight:700">${esc(a.name)}</div><div class="sb">${esc(a.sub)} · sample #${a.number}</div></div></div>
<div class="kv"><span>Signed by</span><span>${esc(a.signer)}</span></div><div class="kv"><span>Date</span><span>${esc(a.when)}</span></div>${p.jobNumber ? `<div class="kv"><span>Job</span><span>#${p.jobNumber}</span></div>` : ""}</section>
<div style="padding:16px 20px 0"><a class="btn btnlink" href="${base}/pdf" target="_blank" rel="noopener">Download confirmation (PDF)</a></div>
<p class="note">Need to change the color? Call us before the stain goes on. Changes after approval have a fee, and after the stain is applied they need re-sanding.</p>
${foot(p.company)}</main></body></html>`;
  }

  if (p.state === "another" || p.state === "closed") {
    const title = p.state === "another" ? "We got your note" : "This link is no longer open";
    const text = p.state === "another"
      ? "Thanks. Our team will prepare another sample and send you a new link."
      : "This color choice was replaced or closed. Please contact us if you have questions.";
    return `${head(title)}<main class="wrap">${top(p.company)}<section class="done"><h1 style="font-size:26px">${title}</h1>
<p style="margin:0;font-size:15px;line-height:1.5;color:#475467">${text}</p></section>${foot(p.company)}</main></body></html>`;
  }

  const n = p.samples.length;
  const cards = p.samples.map((s, i) => {
    const first = s.photos[0];
    const extra = s.photos.slice(1).map((u, k) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="Photo ${k + 2} of sample ${s.number}"><img src="${esc(u)}?w=200" alt="" loading="lazy"></a>`).join("");
    return `<label class="card"><input type="radio" name="sample_id" value="${esc(s.id)}" ${i === 0 && n === 1 ? "checked" : ""} required>
<span class="ph">${first ? `<img src="${esc(first)}?w=900" alt="Crew photo of sample #${s.number}, ${esc(s.name)}, on your floor" loading="lazy">` : ""}
<span class="num">#${s.number}</span>${first ? `<a class="more" href="${esc(first)}" target="_blank" rel="noopener">${s.photos.length > 1 ? `${s.photos.length} photos` : "Zoom"}</a>` : ""}</span>
${extra ? `<span class="thumbs">${extra}</span>` : ""}
<span class="row"><span class="dot" aria-hidden="true"></span><span><span class="nm">${esc(s.name)}</span><br><span class="sb">${esc(s.sub)}</span></span></span></label>`;
  }).join("");

  return `${head("Choose your stain color")}<main class="wrap">${top(p.company)}
<section class="hero"><small>${meta}</small><h1>Choose your stain color</h1>
<p>We applied ${n} sample${n === 1 ? "" : "s"} on your${p.woodSpecies ? ` ${esc(p.woodSpecies)}` : ""} floor${p.sampledOn ? ` on ${esc(p.sampledOn)}` : ""}. These are the photos our crew took on site. Pick one and sign below so we can finish your floors.</p></section>
${p.error ? `<p class="err" role="alert">${esc(p.error)}</p>` : ""}
${p.board ? `<div class="board"><img src="${esc(p.board)}?w=1100" alt="Photo of all samples on your floor"><span class="tag">All samples on your floor</span></div>` : ""}
<p class="note">If you can, look at the samples on your floor in person. Photos and screens change colors, and stain varies from board to board.</p>
<form method="post" action="${base}/approve" id="approveForm">
<fieldset class="list"><legend>Tap the color you want</legend>${cards}</fieldset>
<section class="sign"><h2>Sign to approve</h2>
<label class="f">Your full name<input class="t" name="signer_name" autocomplete="name" required maxlength="120" value="${esc(p.signerDefault || "")}"></label>
<div class="f" style="display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:#475467"><span id="sigLabel">Signature</span>
<div class="pad"><canvas id="sig" aria-labelledby="sigLabel" role="img"></canvas><span class="line"></span><span class="hint">Sign with your finger or mouse</span><button type="button" class="clear" id="sigClear">Clear</button></div></div>
<input type="hidden" name="signature_data_url" id="sigData">
<label class="agree"><input type="checkbox" name="accept_terms" value="on" required><span>${esc(p.terms)}</span></label>
<button class="btn" type="submit" id="approveBtn">Approve and sign</button>
<p class="small">We record your name, signature, date, time and IP address, and email you a PDF copy with the photos.</p></section>
</form>
<details class="another"><summary>None of these? Request another sample</summary>
<form method="post" action="${base}/another"><label class="f">What are you looking for?<textarea name="comment" required maxlength="1000" placeholder="Example: a little lighter than #2, less red"></textarea></label>
<button class="btn2" type="submit">Send to ${esc(p.company.name)}</button></form></details>
${foot(p.company)}</main>
<script>
(function(){
  var c=document.getElementById('sig'),ctx=c.getContext('2d'),drawing=false,inked=false,last=null;
  function size(){var r=c.getBoundingClientRect(),d=window.devicePixelRatio||1;var img=inked?c.toDataURL():null;c.width=r.width*d;c.height=r.height*d;ctx.scale(d,d);ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#221E1A';if(img){var i=new Image();i.onload=function(){ctx.drawImage(i,0,0,r.width,r.height)};i.src=img;}}
  function pt(e){var r=c.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  c.addEventListener('pointerdown',function(e){drawing=true;last=pt(e);c.setPointerCapture(e.pointerId)});
  c.addEventListener('pointermove',function(e){if(!drawing)return;var p=pt(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;inked=true});
  ['pointerup','pointercancel','pointerleave'].forEach(function(t){c.addEventListener(t,function(){drawing=false})});
  document.getElementById('sigClear').addEventListener('click',function(){ctx.clearRect(0,0,c.width,c.height);inked=false});
  window.addEventListener('resize',size);size();
  document.getElementById('approveForm').addEventListener('submit',function(e){
    if(!document.querySelector('input[name=sample_id]:checked')){e.preventDefault();alert('Please tap the color you want.');return;}
    if(!inked){e.preventDefault();alert('Please sign in the box.');return;}
    document.getElementById('sigData').value=c.toDataURL('image/png');
    var b=document.getElementById('approveBtn');b.disabled=true;b.textContent='Saving…';
  });
})();
</script></body></html>`;
}
