// One-time, non-destructive import of existing browser reader/study data.
// Rust validates passage identities and writes its normal checkpoint; originals
// remain intact so rollback never loses a guest's notes or pending account edits.
const parse=(value)=>{try{return JSON.parse(value??'null');}catch{return null;}};
export async function legacyCheckpoint() {
  const reader={},locations={},profiles={},accounts={profiles:{},guest:[]};
  const active=localStorage.getItem('cross-cannon:active-account:v1');
  const keys={scripture:'cross-cannon:reader-position:v1',fathers:'cross-cannon:church-fathers-position:v1',classics:'cross-cannon:christian-classics-position:v1'};
  for(const [corpus,key] of Object.entries(keys)) {
    const raw=localStorage.getItem(active?`${key}:account:${active}`:key);
    const location=parse(raw);
    if(location?.version===2)locations[corpus]=location;
    else if(raw)locations[corpus]={version:2,corpus,chapterKey:corpus==='scripture'?raw.replace(/:(\d+)$/,'\t$1'):raw};
  }
  const settings=parse(localStorage.getItem('cross-cannon:reader-settings:v1'));
  if(settings){reader.font_scale=settings.fontScale;reader.line_height=settings.lineHeight;reader.width=settings.contentWidth;reader.theme=({paper:'Paper',sepia:'Sepia',dark:'Dark',contrast:'Contrast'})[settings.theme]??'Paper';}
  const filters=parse(localStorage.getItem('cross-cannon:filters:v1'));
  if(['protestant','catholic','orthodox'].includes(filters?.canon))reader.canon=filters.canon;
  reader.favorite_books=[...new Set(['cross-cannon:church-fathers-favorite-books:v1','cross-cannon:christian-classics-favorite-books:v1'].flatMap(key=>{const ids=parse(localStorage.getItem(key));return Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[];}))];
  const translation=localStorage.getItem('cross-cannon:scripture-translation:v1');
  if(translation==='msb')reader.scripture_translation='msb';
  for(let i=0;i<localStorage.length;i++) {
    const key=localStorage.key(i);const match=/^cross-cannon:account:(.+):progress:(scripture|fathers|classics):v1$/.exec(key);
    if(match){const value=parse(localStorage.getItem(key));if(value?.location){accounts.profiles[match[1]]??={};accounts.profiles[match[1]][match[2]]={saved:{location:value.location,revision:value.revision??0},dirty:!!value.dirty,conflict:value.conflict??null};}}
  }
  if(active)accounts.user={id:active,name:'',email:''};
  if(indexedDB.databases) {
    const databases=await indexedDB.databases();
    if(databases.some((db)=>db.name==='cross-canon-study-v1')) {
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('cross-canon-study-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      if(db.objectStoreNames.contains('items'))await new Promise((resolve,reject)=>{
        const tx=db.transaction('items','readonly');const request=tx.objectStore('items').openCursor();
        request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const key=String(cursor.key);const value=cursor.value;const match=/^(guest|user:([^:]+)):/.exec(key);
          if(match&&value?.item){const owner=match[1]==='guest'?'guest':`user:${decodeURIComponent(match[2])}`;profiles[owner]??={};profiles[owner][value.item.id]={...value,conflict:value.conflict??null,alternatives:value.alternatives??[]};}cursor.continue();};
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      });db.close();
    }
  }
  return JSON.stringify({reader,locations,study:{profiles},accounts});
}
