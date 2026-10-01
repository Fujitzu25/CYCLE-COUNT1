const announcementList=document.getElementById('announcementList');
const announcementStatus=document.getElementById('announcementsStatus');

function formatAnnouncementDate(value){
  const date=new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())?String(value||'Date not set'):new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric'}).format(date);
}
function createAnnouncement(item){
  const article=document.createElement('article');
  article.className='announcement-entry';
  article.dataset.announcementId=String(item.id||'');
  const date=document.createElement('time');
  date.className='announcement-date';
  date.dateTime=String(item.date||'');
  date.textContent=formatAnnouncementDate(item.date);
  const content=document.createElement('div');
  content.className='announcement-content';
  const title=document.createElement('h3');
  title.textContent=String(item.title||'Update');
  const author=document.createElement('div');
  author.className='announcement-author';
  author.textContent=String(item.author||'Administrator');
  const message=document.createElement('p');
  message.textContent=String(item.message||'');
  content.append(title,author,message);
  article.append(date,content);
  return article;
}
async function loadAnnouncements(){
  try{
    const response=await fetch(new URL('./comments.json',document.baseURI),{cache:'no-cache'});
    if(!response.ok)throw new Error(`Announcement request failed (${response.status})`);
    const payload=await response.json();
    if(!Array.isArray(payload))throw new Error('Announcement data must be a JSON array.');
    let localAnnouncements=[];
    try{
      const stored=JSON.parse(localStorage.getItem('fuji-cycle-announcements-v1')||'[]');
      if(Array.isArray(stored))localAnnouncements=stored.filter(item=>item&&item.title&&item.message);
    }catch(error){console.warn('Could not read local announcements:',error)}
    const announcements=[...localAnnouncements,...payload.filter(item=>item&&typeof item==='object'&&item.title&&item.message)]
      .sort((left,right)=>String(right.date||'').localeCompare(String(left.date||'')));
    announcementList.replaceChildren(...announcements.map(createAnnouncement));
    if(!announcements.length){
      const empty=document.createElement('p');
      empty.className='announcements-empty';
      empty.textContent='There are no announcements right now.';
      announcementList.append(empty);
    }
    announcementStatus.textContent=`${announcements.length} announcement${announcements.length===1?'':'s'}`;
    document.dispatchEvent(new CustomEvent('announcements-updated',{detail:{announcements}}));
  }catch(error){
    console.error('Could not load announcements:',error);
    announcementStatus.textContent='Announcements are temporarily unavailable.';
    const unavailable=document.createElement('p');
    unavailable.className='announcements-empty';
    unavailable.textContent='Updates could not be loaded. Please try again later.';
    announcementList.replaceChildren(unavailable);
  }
}
window.refreshAnnouncements=loadAnnouncements;
window.addEventListener('storage',event=>{if(event.key==='fuji-cycle-announcements-v1')loadAnnouncements()});
document.addEventListener('authchange',loadAnnouncements);
loadAnnouncements();
