document.addEventListener("DOMContentLoaded",function(){
(()=>{'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const form=$('#orderForm'),ready=$('#ready'),link=$('#waLink'),dialog=$('#pieceDialog');let message='';
const menu=$('.menu-toggle'),mobileNav=$('#mobile-nav');
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')==='true';menu.setAttribute('aria-expanded',String(!open));mobileNav.hidden=open;menu.querySelector('span').textContent=open?'＋':'−'});
$$('#mobile-nav a').forEach(a=>a.addEventListener('click',()=>{mobileNav.hidden=true;menu.setAttribute('aria-expanded','false');menu.querySelector('span').textContent='＋'}));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){mobileNav.hidden=true;menu.setAttribute('aria-expanded','false');menu.querySelector('span').textContent='＋'}});
function pick(product){$('#product').value=product;form.hidden=false;ready.hidden=true;$('#formStep').textContent='01 / CONFIGURA'}
$$('[data-pick]').forEach(a=>a.addEventListener('click',()=>pick(a.dataset.pick)));
$$('.piece').forEach(b=>b.addEventListener('click',()=>{$('#dialogImage').src=b.dataset.image;$('#dialogImage').alt=b.querySelector('img').alt;$('#dialogTitle').textContent=b.dataset.title;$('#dialogQuote').dataset.product=b.dataset.product;dialog.showModal();document.body.classList.add('lock')}));
$('.dialog-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>document.body.classList.remove('lock'));dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
$('#dialogQuote').addEventListener('click',()=>{pick($('#dialogQuote').dataset.product);dialog.close()});
form.addEventListener('submit',e=>{e.preventDefault();const qty=Number($('#quantity').value);if(!form.reportValidity()||!Number.isInteger(qty)||qty<1)return;message=['Hola, equipo Fundidoral. Quisiera solicitar una cotización:','','Producto: '+$('#product').value,'Material: '+$('#material').value,'Cantidad: '+qty+' piezas','Medidas: '+($('#size').value.trim()||'Por definir'),'Acabado: '+$('#finish').value,'Detalles: '+($('#details').value.trim()||'Por definir'),'','Quedo atento/a a su respuesta.'].join('\n');link.href='https://wa.me/584242018095?text='+encodeURIComponent(message);$('#waFallback').href='https://api.whatsapp.com/send?phone=584242018095&text='+encodeURIComponent(message);$('#messagePreview').textContent=message;form.hidden=true;ready.hidden=false;$('#formStep').textContent='02 / REVISA Y ENVÍA';$('#copyStatus').textContent='';ready.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});link.focus({preventScroll:true});if(window.ScrollTrigger)ScrollTrigger.refresh()});
$('#editBtn').addEventListener('click',()=>{ready.hidden=true;form.hidden=false;$('#formStep').textContent='01 / CONFIGURA';$('#product').focus({preventScroll:true});if(window.ScrollTrigger)ScrollTrigger.refresh()});
$('#copyBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(message);$('#copyStatus').textContent='Mensaje copiado.'}catch{$('#copyStatus').textContent='Selecciona el mensaje para copiarlo o abre WhatsApp.'}});
// One active player keeps bandwidth focused on the selected video.
$$('.reel-card video').forEach(video=>{video.addEventListener('play',()=>{$$('.reel-card video').forEach(other=>{if(other!==video)other.pause()})});video.addEventListener('error',()=>{video.parentElement.querySelector('.video-status').hidden=false});video.parentElement.querySelector('.retry-video').addEventListener('click',()=>{video.parentElement.querySelector('.video-status').hidden=true;video.load();video.play().catch(()=>{})})});
const activeSections=$$('.section-track');const observer=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting)$$('.rail a').forEach(a=>{a.classList.toggle('active',a.hash==='#'+e.target.id);if(a.hash==='#'+e.target.id)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current')})})},{rootMargin:'-20% 0px -45% 0px'});activeSections.forEach(s=>observer.observe(s));
let ticking=false;addEventListener('scroll',()=>{if(!ticking){requestAnimationFrame(()=>{$('.header').classList.toggle('scrolled',scrollY>40);ticking=false});ticking=true}},{passive:true});
// Continuous photo carousel, independent of page scrolling.
const gallery=$('.hero-gallery'),track=$('.carousel-track'),group=$('.carousel-group'),pause=$('#carouselPause');
if(window.gsap){
 const clone=group.cloneNode(true);clone.setAttribute('aria-hidden','true');track.append(clone);
 let motion,paused=reduced,inView=true;
 const sync=()=>{if(motion){if(paused||!inView||document.hidden)motion.pause();else motion.play()}};
 const build=()=>{const progress=motion?motion.progress():0;motion?.kill();gsap.set(track,{x:0});motion=gsap.to(track,{x:()=>-group.getBoundingClientRect().width,duration:20,ease:'none',repeat:-1,paused:true});motion.progress(progress);sync()};
 const label=()=>{pause.textContent=paused?'Reproducir carrusel ▶':'Pausar carrusel Ⅱ';pause.setAttribute('aria-pressed',String(paused))};
 pause.addEventListener('click',()=>{paused=!paused;label();sync()});
 new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;sync()}).observe(gallery);
 document.addEventListener('visibilitychange',sync);new ResizeObserver(build).observe(gallery);label();build();
}else pause.hidden=true;
if(!reduced&&window.gsap&&window.ScrollTrigger){
gsap.registerPlugin(ScrollTrigger);ScrollTrigger.config({ignoreMobileResize:true});
gsap.timeline({defaults:{ease:'power3.out'}}).from('.hero h1 .line>span',{yPercent:110,duration:1.1,stagger:.13},.1).from('.hero-reveal',{opacity:0,y:20,duration:.85,stagger:.14},.35).from('.hero-gallery',{opacity:0,y:65,duration:1.2},.45);
$$('.reveal').forEach(el=>gsap.from(el,{y:30,opacity:0,duration:.9,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 90%',once:true}}));
const mm=gsap.matchMedia();mm.add('(min-width: 701px)',()=>{$$('.story').forEach(section=>{const img=section.querySelector('.product-image');gsap.fromTo(img,{yPercent:3,scale:.96},{yPercent:-3,scale:1,ease:'none',scrollTrigger:{trigger:section,start:'top bottom',end:'bottom top',scrub:1}});gsap.from(section.querySelectorAll('.story-copy > *'),{y:30,opacity:0,stagger:.09,duration:.8,scrollTrigger:{trigger:section,start:'top 70%',once:true}})});gsap.from('.piece',{y:45,opacity:0,stagger:.13,duration:.9,scrollTrigger:{trigger:'.collection-grid',start:'top 85%',once:true}});gsap.from('.step',{y:30,opacity:0,stagger:.13,duration:.8,scrollTrigger:{trigger:'.steps',start:'top 80%',once:true}})});
mm.add('(max-width: 700px)',()=>{$$('.story-visual').forEach(el=>gsap.from(el,{opacity:0,y:25,duration:.7,scrollTrigger:{trigger:el,start:'top 90%',once:true}}))});
addEventListener('load',()=>ScrollTrigger.refresh(),{once:true});document.fonts?.ready.then(()=>ScrollTrigger.refresh());
}
})();

});