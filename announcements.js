const announcementList=document.getElementById('announcementList');
const announcementStatus=document.getElementById('announcementsStatus');
const localAnnouncementsKey='fuji-local-announcements-v1';
let announcementRequest=0;
let unsubscribeAnnouncements=null;

function formatAnnouncementDate(value){
  const date=new Date(value?.toDate?.()||value||'');
  return Number.isNaN(date.getTime())?String(value||'Date not set'):new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric'}).format(date);
}
function createAnnouncement(item){
  const article=document.createElement('article');
  article.className='announcement-entry';
  article.dataset.announcementId=String(item.id||'');
  const date=document.createElement('time');
  date.className='announcement-date';
  const createdAt=item.createdAt||item.created_at;
  date.dateTime=createdAt?.toDate?.()?.toISOString()||String(createdAt||'');
  date.textContent=formatAnnouncementDate(createdAt);
  const content=document.createElement('div');
  content.className='announcement-content';
  const title=document.createElement('h3');
  title.textContent=String(item.title||'Update');
  const author=document.createElement('div');
  author.className='announcement-author';
  author.textContent=String(item.authorName||item.author||'FUJI Administrator');
  const message=document.createElement('p');
  message.textContent=String(item.message||'');
  content.append(title,author,message);
  article.append(date,content);
  return article;
}
function showAnnouncementMessage(message){
  const empty=document.createElement('p');
  empty.className='announcements-empty';
  empty.textContent=message;
  announcementList.replaceChildren(empty);
}
async function loadAnnouncements(){
  const request=++announcementRequest;
  const user=window.fujiAuth?.user;
  if(!user){
    announcementList.replaceChildren();
    announcementStatus.textContent='Sign in to view announcements.';
    document.dispatchEvent(new CustomEvent('announcements-updated',{detail:{announcements:[]}}));
    return;
  }
  try{
    let announcements=[];
    if(user.authType==='local'){
      const stored=JSON.parse(localStorage.getItem(localAnnouncementsKey)||'[]');
      announcements=Array.isArray(stored)?stored:[];
    }else{
      const firestore=window.fujiFirebase?.firestore;
      if(!firestore)throw new Error('Online announcements are unavailable.');
      const snapshot=await firestore.collection('announcements').orderBy('createdAt','desc').limit(50).get();
      if(request!==announcementRequest)return;
      announcements=snapshot.docs.map(document=>({id:document.id,...document.data()}));
    }
    if(request!==announcementRequest)return;
    announcementList.replaceChildren(...announcements.map(createAnnouncement));
    if(!announcements.length)showAnnouncementMessage('There are no announcements right now.');
    announcementStatus.textContent=`${announcements.length} announcement${announcements.length===1?'':'s'}`;
    document.dispatchEvent(new CustomEvent('announcements-updated',{detail:{announcements}}));
  }catch(error){
    if(request!==announcementRequest)return;
    console.error('Could not load announcements:',error);
    announcementStatus.textContent='Announcements are temporarily unavailable.';
    showAnnouncementMessage('Could not load updates. Check your connection or contact an administrator.');
  }
}
function watchAnnouncements(user){
  if(unsubscribeAnnouncements){unsubscribeAnnouncements();unsubscribeAnnouncements=null}
  if(user?.authType!=='online')return;
  const firestore=window.fujiFirebase?.firestore;
  if(!firestore)return;
  unsubscribeAnnouncements=firestore.collection('announcements').orderBy('createdAt','desc').limit(50).onSnapshot(()=>loadAnnouncements(),error=>{
    console.error('Live announcement updates are unavailable:',error);
  });
}
window.refreshAnnouncements=loadAnnouncements;
document.addEventListener('authchange',event=>{watchAnnouncements(event.detail?.user);loadAnnouncements()});
window.addEventListener('storage',event=>{if(event.key===localAnnouncementsKey&&window.fujiAuth?.authType==='local')loadAnnouncements()});
