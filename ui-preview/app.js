(() => {
const toast = document.getElementById('toast'); let timer;
function notify(msg){toast.textContent=msg;toast.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>toast.classList.remove('show'),2400)}
const theme=document.getElementById('theme');
const saved=localStorage.getItem('monitory-preview-theme');
if(saved==='light'||saved==='dark')document.body.classList.add(saved+'-mode');
function icon(){const dark=document.body.classList.contains('dark-mode')||(!document.body.classList.contains('light-mode')&&matchMedia('(prefers-color-scheme: dark)').matches);theme.textContent=dark?'☾':'☼'}
icon();theme.addEventListener('click',()=>{const dark=document.body.classList.contains('dark-mode')||(!document.body.classList.contains('light-mode')&&matchMedia('(prefers-color-scheme: dark)').matches);document.body.classList.remove('light-mode','dark-mode');document.body.classList.add(dark?'light-mode':'dark-mode');localStorage.setItem('monitory-preview-theme',dark?'light':'dark');icon();notify('Theme updated')});
document.getElementById('refresh').addEventListener('click',()=>{document.querySelectorAll('.stats article').forEach((e,i)=>e.animate([{opacity:.6,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:250,delay:i*45}));notify('Preview refreshed — sample data only')});
document.getElementById('search').addEventListener('input',e=>{const q=e.target.value.toLowerCase().trim();document.querySelectorAll('#rows tr').forEach(r=>r.hidden=!r.dataset.name.includes(q))});
document.getElementById('menuBtn').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
['viewAll','activityBtn','permissionsBtn'].forEach(id=>document.getElementById(id).addEventListener('click',()=>notify('Prototype preview only — not connected to backend')));
document.querySelectorAll('.more').forEach(b=>b.addEventListener('click',()=>notify('Device actions are disabled in this visual prototype')));
document.querySelectorAll('nav a').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('nav a').forEach(x=>x.classList.remove('active'));a.classList.add('active')}));
})();