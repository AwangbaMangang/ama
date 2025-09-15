// app.js (module)
const DB_NAME = 'meetei-dict-db';
const DB_STORE = 'dictionary';
const DB_VER = 1;

// UI elements
const inputText = document.getElementById('inputText');
const outputText = document.getElementById('outputText');
const replaceBtn = document.getElementById('replaceBtn');
const clearBtn = document.getElementById('clearBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadOutputBtn = document.getElementById('downloadOutputBtn');

const fileInput = document.getElementById('fileInput');
const mergeBtn = document.getElementById('mergeBtn');
const exportBtn = document.getElementById('exportBtn');
const addFrom = document.getElementById('addFrom');
const addTo = document.getElementById('addTo');
const addPairBtn = document.getElementById('addPairBtn');

const dictCountEl = document.getElementById('dictCount');
const lastSyncedEl = document.getElementById('lastSynced');
const searchKey = document.getElementById('searchKey');
const searchBtn = document.getElementById('searchBtn');
const removeBtn = document.getElementById('removeBtn');
const searchResult = document.getElementById('searchResult');
const helpBtn = document.getElementById('helpBtn');
const helpPanel = document.getElementById('helpPanel');
const syncBtn = document.getElementById('syncBtn');

// state
let dictionary = [];
let trie = null;
let lastSynced = null;

// ---------------- IndexedDB ----------------
function openDb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = ev => {
      const db = ev.target.result;
      if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function saveDictToDb(dictObj){
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const now = new Date().toISOString();
    const obj = { id: 'main', data: dictObj, updatedAt: now };
    const putReq = store.put(obj);
    putReq.onsuccess = () => res(now);
    putReq.onerror = () => rej(putReq.error);
  });
}
async function loadDictFromDb(){
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const getReq = store.get('main');
    getReq.onsuccess = () => res(getReq.result);
    getReq.onerror = () => rej(getReq.error);
  });
}

// ---------------- Trie ----------------
class TrieNode { constructor(){ this.children = new Map(); this.value = null; } }
class Trie {
  constructor(){ this.root = new TrieNode(); }
  add(word, val){ let node = this.root; for(const ch of word){ if(!node.children.has(ch)) node.children.set(ch, new TrieNode()); node = node.children.get(ch);} node.value = val; }
  findFrom(text,pos){ let node = this.root; if(!node) return null; let i = pos; let lastMatch = null; while(i<text.length){ const ch = text[i]; node = node.children.get(ch); if(!node) break; i++; if(node.value!==null) lastMatch = {replacement: node.value, length: i-pos}; } return lastMatch; }
  static fromPairs(pairs){ const t = new Trie(); for(const p of pairs){ if(!p || !p.from) continue; t.add(p.from, p.to ?? ''); } return t; }
}

function rebuildTrie(){ trie = Trie.fromPairs(dictionary); }

// ---------------- Core replace ----------------
function replaceUsingTrie(text){ if(!text) return ''; let out = ''; let i=0; const n = text.length; while(i<n){ const f = trie.findFrom(text,i); if(f){ out += f.replacement; i += f.length; } else { out += text[i]; i++; } } return out; }

// ---------------- Merge helpers ----------------
function mergePairs(newPairs){ const map = new Map(dictionary.map(p => [p.from,p.to])); for(const p of newPairs) if(p && p.from) map.set(p.from, p.to ?? ''); dictionary = Array.from(map.entries()).map(([from,to]) => ({from,to})); rebuildTrie(); }

// ---------------- UI helpers ----------------
function setStatusCount(){ dictCountEl.textContent = `Entries: ${dictionary.length}`; }
function setLastSynced(ts){ lastSynced = ts; lastSyncedEl.textContent = `Last synced: ${ts? new Date(ts).toLocaleString() : 'never'}`; }

// ---------------- Event wiring ----------------
replaceBtn.addEventListener('click', ()=>{ replaceBtn.disabled=true; setTimeout(()=>{ try{ outputText.value = replaceUsingTrie(inputText.value); }finally{ replaceBtn.disabled=false; } },10); });
clearBtn.addEventListener('click', ()=>{ inputText.value=''; outputText.value=''; });
copyBtn.addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(outputText.value); copyBtn.textContent='Copied!'; setTimeout(()=>copyBtn.textContent='Copy',1200); }catch(e){ alert('Copy failed: '+e); } });

downloadOutputBtn.addEventListener('click', ()=>{ const blob = new Blob([outputText.value], {type:'text/plain;charset=utf-8'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'replaced_output.txt'; document.body.appendChild(a); a.click(); a.remove(); });

mergeBtn.addEventListener('click', async ()=>{
  const files = fileInput.files; if(!files || files.length===0){ alert('Choose a JSON file first'); return; }
  const txt = await files[0].text(); let json; try{ json = JSON.parse(txt); }catch(e){ alert('Invalid JSON'); return; }
  const newPairs = json.pairs || [];
  mergePairs(newPairs);
  setStatusCount();
  try{ const savedAt = await saveDictToDb({pairs:dictionary, meta: json.meta||{}}); setLastSynced(savedAt); alert(`Merged ${newPairs.length} pairs — total ${dictionary.length}`); }catch(e){ console.warn(e); }
});

exportBtn.addEventListener('click', ()=>{
  const exportObj = { pairs: dictionary, meta: { exportedAt: new Date().toISOString() } };
  const blob = new Blob([JSON.stringify(exportObj,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dictionary-export-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`; document.body.appendChild(a); a.click(); a.remove();
});

addPairBtn.addEventListener('click', async ()=>{
  const from = addFrom.value.trim(); const to = addTo.value; if(!from){ alert('Provide "from"'); return; }
  const map = new Map(dictionary.map(p=>[p.from,p.to])); map.set(from,to); dictionary = Array.from(map.entries()).map(([f,t])=>({from:f,to:t})); rebuildTrie(); setStatusCount(); try{ const savedAt = await saveDictToDb({pairs:dictionary, meta:{note:'single add'}}); setLastSynced(savedAt); addFrom.value=''; addTo.value=''; }catch(e){ console.warn(e); }
});

searchBtn.addEventListener('click', ()=>{ const key = searchKey.value.trim(); if(!key){ searchResult.textContent='Enter search value'; return; } const found = dictionary.filter(p => p.from.includes(key) || (p.to && p.to.includes(key))); searchResult.textContent = JSON.stringify(found.slice(0,200), null, 2); });

removeBtn.addEventListener('click', async ()=>{ const key = searchKey.value.trim(); if(!key){ alert('Enter search query'); return; } const before = dictionary.length; dictionary = dictionary.filter(p => !(p.from.includes(key))); rebuildTrie(); setStatusCount(); try{ const savedAt = await saveDictToDb({pairs:dictionary, meta:{note:'removed matches'}}); setLastSynced(savedAt); alert(`Removed ${before - dictionary.length} entries`); searchResult.textContent=''; }catch(e){ console.warn(e); } });

helpBtn.addEventListener('click', ()=>{ helpPanel.hidden = !helpPanel.hidden; });
syncBtn.addEventListener('click', async ()=>{ try{ const savedAt = await saveDictToDb({pairs:dictionary, meta:{note:'manual sync'}}); setLastSynced(savedAt); alert('Synced to device'); }catch(e){ alert('Sync failed'); } });

document.addEventListener('keydown',(e)=>{ if((e.ctrlKey||e.metaKey) && e.key==='Enter') replaceBtn.click(); });

// ---------------- Startup load ----------------
async function init(){
  try{
    const stored = await loadDictFromDb();
    if(stored && stored.data && stored.data.pairs){ dictionary = stored.data.pairs; rebuildTrie(); setStatusCount(); setLastSynced(stored.updatedAt); console.info('Loaded from IndexedDB', dictionary.length); return; }
  }catch(e){ console.warn(e); }
  try{
    const r = await fetch('dictionary.json');
    if(r.ok){ const j = await r.json(); dictionary = j.pairs || []; rebuildTrie(); setStatusCount(); const savedAt = await saveDictToDb({pairs:dictionary, meta: j.meta||{}}); setLastSynced(savedAt); console.info('Loaded dictionary.json'); }
  }catch(e){ console.warn('Failed to load dictionary.json', e); }
}

init();

// ---------------- Service Worker registration ----------------
if('serviceWorker' in navigator){
  window.addEventListener('load', async ()=>{
    try{
      const reg = await navigator.serviceWorker.register('service-worker.js');
      console.info('SW registered', reg);
    }catch(e){ console.warn('SW register failed', e); }
  });
}
