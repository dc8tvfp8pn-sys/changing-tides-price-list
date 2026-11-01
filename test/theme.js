(function(){var K='toc-theme',root=document.documentElement;
function get(){try{return localStorage.getItem(K)==='light'?'light':'dark'}catch(e){return 'dark'}}
function apply(t){root.classList.toggle('light',t==='light');var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',t==='light'?'#ffffff':'#0a1424');
 var b=document.getElementById('themeBtn');if(!b)return;var next=t==='dark'?'light':'dark';
 b.setAttribute('aria-label',next==='light'?'Switch to light mode':'Switch to dark mode');
 b.innerHTML=(t==='dark'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>')+'<span>'+(next==='light'?'Light':'Dark')+'</span>';}
apply(get());
document.addEventListener('DOMContentLoaded',function(){apply(get());var b=document.getElementById('themeBtn');b&&b.addEventListener('click',function(){var t=get()==='dark'?'light':'dark';try{localStorage.setItem(K,t)}catch(e){}apply(t)})});})();
