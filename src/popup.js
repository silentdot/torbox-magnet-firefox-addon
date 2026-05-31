/* --- State --- */
var THEME_KEY = 'torbox_theme';
var API_KEY   = 'torbox_api_key';
var currentTheme = 'dark';
function $(id) { return document.getElementById(id); }
var liveDot = $('live-dot'), mainContent = $('main-content'), connectPanel = $('connect-panel');
var apiInput = $('api-key'), saveKeyBtn = $('save-key'), keyStatus = $('key-status');
var pageDomain = $('page-domain'), sendPageBtn = $('send-page'), actionStatus = $('action-status');
var historyEl = $('history-section'), clearHistBtn = $('clear-history'), refreshHistBtn = $('refresh-history'), dashboardBtn = $('open-dashboard');
var toastEl = $('toast'), settingsToggle = $('settings-toggle'), settingsDrawer = $('settings-drawer');
var settingsClose = $('settings-close'), drawerEmail = $('drawer-email');
var drawerThemeLabel = $('drawer-theme-label'), drawerThemeToggle = $('drawer-theme-toggle');
var drawerChangeKey = $('drawer-change-key');
var checkUpdateBtn = $('check-update-btn');

function icon(n,s){var sz=s||14;return '<svg width="'+sz+'" height="'+sz+'" viewBox="0 0 24 24" class="i"><use href="#i-'+n+'"/></svg>';}
var FILE_ICONS = {archive:'archive',video:'video',audio:'audio',image:'image',doc:'doc',app:'app'};

async function get(k){var r=await browser.storage.local.get(k);return r[k];}
async function set(k,v){var o={};o[k]=v;await browser.storage.local.set(o);}

var toastTimer;
function showToast(m){toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(function(){toastEl.classList.remove('show');},1500);}

function applyTheme(t){currentTheme=t||'dark';document.body.setAttribute('data-theme',currentTheme);var b=document.querySelector('.accent-bar');if(b)b.style.background=currentTheme==='light'?'linear-gradient(90deg,#04bf8a,#039f75)':'linear-gradient(90deg,#04bf8a,#026873,#04bf8a)';drawerThemeLabel.textContent=currentTheme==='dark'?'Dark':'Light';}
async function toggleTheme(){var n=currentTheme==='dark'?'light':'dark';applyTheme(n);await set(THEME_KEY,n);}
async function initTheme(){applyTheme(await get(THEME_KEY)||'dark');}

async function initApiKey(){var key=await get(API_KEY);if(!key){connectPanel.classList.remove('hidden');return;}var status=await browser.runtime.sendMessage({type:'get-apikey-status'});if(status&&status.valid){showConnected(status.email||'Connected');}else{var result=await browser.runtime.sendMessage({type:'validate-apikey',apiKey:key});if(result.valid){showConnected(result.email||'Connected');}else{apiInput.value=key;connectPanel.classList.remove('hidden');setStatus(keyStatus,'Session expired - reconnect?','error');}}}
function showConnected(email){connectPanel.classList.add('hidden');mainContent.classList.remove('hidden');liveDot.classList.add('live-dot--active');showActions();loadHistory();drawerEmail.textContent=email;}

async function saveApiKey(){var key=apiInput.value.trim();if(!key){setStatus(keyStatus,'Enter your API key.','error');return;}setStatus(keyStatus,'Connecting...');var result=await browser.runtime.sendMessage({type:'validate-apikey',apiKey:key});if(result.valid){await set(API_KEY,key);setStatus(keyStatus,'','');showConnected(result.email||'Connected');showToast('Connected');}else{setStatus(keyStatus,result.error||'Invalid key','error');}}

function showActions(){browser.tabs.query({active:true,currentWindow:true}).then(function(t){if(t[0]&&t[0].url){try{pageDomain.textContent=new URL(t[0].url).hostname;}catch(e){pageDomain.textContent=t[0].url;}}});}

// Send page magnets via background (send + cache check + download)
async function sendCurrentPageMagnets(){
  var key=await get(API_KEY);
  if(!key){setStatus(actionStatus,'No API key set.','error');return;}
  setStatus(actionStatus,'Searching page for magnets...');
  var tabs=await browser.tabs.query({active:true,currentWindow:true});
  if(!tabs[0])return;
  try{
    var results=await browser.tabs.executeScript(tabs[0].id,{
      code:'Array.from(document.querySelectorAll(\'a[href^="magnet:"]\')).map(function(a){return a.href;})'
    });
    var magnets=[...new Set(results[0]||[])];
    if(magnets.length===0){setStatus(actionStatus,'No magnet links found.','error');return;}
    setStatus(actionStatus,'Processing '+magnets.length+' magnet(s)...');
    var bg=await browser.runtime.sendMessage({type:'send-page-magnets',urls:magnets});
    if(bg.ok){
      var dl=0,q=0,errs=0;
      for(var i=0;i<bg.results.length;i++){
        if(bg.results[i].status==='downloaded')dl++;
        else if(bg.results[i].status==='queued')q++;
        else errs++;
      }
      var parts=[];
      if(dl>0)parts.push(dl+' downloaded');
      if(q>0)parts.push(q+' queued');
      if(errs>0)parts.push(errs+' errors');
      setStatus(actionStatus,parts.join(', '),'success');
    }else{
      setStatus(actionStatus,'Error: '+(bg.error||'Unknown'),'error');
    }
    loadHistory();
  }catch(err){
    setStatus(actionStatus,'Error: '+err.message,'error');
  }
}

// History rendering
async function loadHistory(){
  var result=await browser.runtime.sendMessage({type:'get-history'});
  var history=result.history||[];
  if(history.length===0){
    historyEl.innerHTML='<div class="empty-state">Right-click a magnet or .torrent link &rarr; <strong>Send to TorBox</strong></div>';
    return;
  }
  var html='';
  for(var i=0;i<history.length;i++){
    var entry=history[i];
    var time=new Date(entry.timestamp).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    var typeIcon=FILE_ICONS[entry.fileType]||'file';
    var typeName=entry.fileType||'file';
    var badge=entry.cached?'<span class="badge badge--cached">'+icon(typeIcon,10)+' '+typeName+'</span>':'<span class="badge badge--queued">'+icon('clock',10)+' Queued</span>';
    var name=(entry.name&&entry.name!=='Unknown')?entry.name:(entry.hash?entry.hash.slice(0,16)+'...':'Magnet');
    var dlBtn=(entry.cached&&entry.torrentId)?'<button class="icon-btn icon-btn--sm" data-action="dl" title="Download">'+icon('download')+'</button>':'<button class="icon-btn icon-btn--sm" data-action="dash" title="Open Dashboard">'+icon('grid')+'</button>';
    html+='<div class="history-item" data-hash="'+eAttr(entry.hash||'')+'" data-tid="'+(entry.torrentId||'')+'" data-name="'+eAttr(name)+'"><div class="hi-content"><div class="hi-name" title="'+eAttr(name)+'">'+eHtml(name)+'</div><div class="hi-meta"><span class="hi-time">'+time+'</span>'+badge+'</div></div><div class="hi-actions">'+dlBtn+'<button class="icon-btn icon-btn--sm" data-action="share" title="Copy TorBox share link">'+icon('link')+'</button><button class="icon-btn icon-btn--sm" data-action="del" title="Remove">'+icon('close')+'</button></div></div>';
  }
  historyEl.innerHTML=html;
}

function eHtml(s){if(!s)return '';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function eAttr(s){if(!s)return '';return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');}

// History events
historyEl.addEventListener('click',async function(e){
  var btn=e.target.closest('[data-action]');
  if(!btn)return;
  var item=btn.closest('.history-item');
  if(!item)return;
  var hash=item.dataset.hash;
  var tid=item.dataset.tid;
  var name=item.dataset.name||'Unknown';
  var action=btn.dataset.action;

  if(action==='dl'&&tid){
    await browser.runtime.sendMessage({type:'re-download',torrentId:Number(tid),name:name});
    showToast('Downloading...');
  }else if(action==='dash'){
    browser.runtime.sendMessage({type:'open-dashboard'});
  }else if(action==='share'){
    var r=await browser.runtime.sendMessage({type:'copy-share-link',torrentId:Number(tid||0),hash:hash});
    if(r.ok)showToast('Share link copied');
    else showToast('No link available');
  }else if(action==='del'&&hash){
    await browser.runtime.sendMessage({type:'delete-history-entry',hash:hash});
    await loadHistory();
  }
});

clearHistBtn.addEventListener('click',async function(){await browser.runtime.sendMessage({type:'clear-history'});await loadHistory();});
refreshHistBtn.addEventListener('click',async function(){
  if(refreshHistBtn.disabled)return;
  refreshHistBtn.disabled=true;
  var r=await browser.runtime.sendMessage({type:'refresh-history-cache'});
  refreshHistBtn.disabled=false;
  if(r.history)loadHistory();
});
dashboardBtn.addEventListener('click',function(){browser.runtime.sendMessage({type:'open-dashboard'});});
settingsToggle.addEventListener('click',function(){settingsDrawer.classList.remove('hidden');});
settingsClose.addEventListener('click',function(){settingsDrawer.classList.add('hidden');});
var drawerScrim=settingsDrawer.querySelector('.drawer-scrim');if(drawerScrim)drawerScrim.addEventListener('click',function(){settingsDrawer.classList.add('hidden');});
drawerThemeToggle.addEventListener('click',toggleTheme);
drawerChangeKey.addEventListener('click',function(){settingsDrawer.classList.add('hidden');connectPanel.classList.remove('hidden');mainContent.classList.add('hidden');liveDot.classList.remove('live-dot--active');apiInput.value='';apiInput.focus();setStatus(keyStatus,'','');});
saveKeyBtn.addEventListener('click',saveApiKey);sendPageBtn.addEventListener('click',sendCurrentPageMagnets);checkUpdateBtn.addEventListener('click',async function(){checkUpdateBtn.textContent='Checking...';var r=await browser.runtime.sendMessage({type:'check-update-now'});checkUpdateBtn.textContent='Check for updates';if(r&&r.latest&&r.latest!==r.current){showToast('v'+r.latest+' available');var ban=$('update-banner');var txt=$('update-text');var link=$('update-link');if(ban&&txt){txt.textContent='v'+r.latest+' available';if(r.url)link.href=r.url;ban.classList.remove('hidden');}}else{showToast('Up to date');}});
apiInput.addEventListener('keydown',function(e){if(e.key==='Enter')saveApiKey();});
function setStatus(el,text,type){el.innerHTML=text;el.className='status'+(type?' '+type:'');}
(async function(){
  await initTheme();
  await initApiKey();
  // Check for extension update
  var uc = await browser.runtime.sendMessage({type:'check-update'});
  if(uc && uc.latest && uc.latest !== uc.current){
    var ban=document.getElementById('update-banner');
    var txt=document.getElementById('update-text');
    var link=document.getElementById('update-link');
    var dim=document.getElementById('update-dismiss');
    if(ban && txt && link){
      txt.textContent='v'+uc.latest+' available';
      if(uc.url) link.href=uc.url;
      ban.classList.remove('hidden');
      if(dim) dim.addEventListener('click',function(){ban.classList.add('hidden');});
    }
  }
})();
