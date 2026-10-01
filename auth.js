(()=>{
  const accountsKey='fuji-local-accounts-v1';
  const sessionKey='fuji-local-session-v1';
  const announcementsKey='fuji-cycle-announcements-v1';
  const iterations=210000;
  const byId=id=>document.getElementById(id);
  const modal=byId('authModal');
  let currentUser=null;

  function readAccounts(){
    try{const accounts=JSON.parse(localStorage.getItem(accountsKey)||'[]');return Array.isArray(accounts)?accounts:[]}
    catch(error){console.warn('Could not read local accounts:',error);return []}
  }
  function writeAccounts(accounts){localStorage.setItem(accountsKey,JSON.stringify(accounts))}
  function toHex(bytes){return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('')}
  function fromHex(value){return new Uint8Array((value.match(/.{1,2}/g)||[]).map(byte=>parseInt(byte,16)))}
  async function hashPassword(password,salt){
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,256);
    return toHex(bits);
  }
  function setStatus(message,isError=false){const status=byId('authStatus');status.textContent=message;status.classList.toggle('is-error',isError)}
  function showMode(){
    modal.hidden=false;
    byId('authAccountPanel').hidden=false;
    byId('authModalTitle').textContent='Local account';
    byId('authModalCopy').textContent='Manage this browser profile and your local account.';
    byId('authStatus').textContent='';
    if(currentUser?.role==='admin')renderUserList();
  }
  function sessionAccount(){
    try{
      const session=JSON.parse(sessionStorage.getItem(sessionKey)||'null');
      return readAccounts().find(account=>account.username===session?.username)||null;
    }catch(error){return null}
  }
  function applyRole(){
    document.body.classList.toggle('auth-role-admin',currentUser?.role==='admin');
    document.body.classList.toggle('auth-role-user',currentUser?.role==='user');
    const label=byId('authProfileLabel');
    const profile=byId('authProfileBtn');
    label.textContent=currentUser?`${currentUser.username} · ${currentUser.role==='admin'?'Admin':'User'}`:'Sign in';
    profile.title=currentUser?'Open local account':'Sign in';
    byId('authHeaderLogoutBtn').hidden=!currentUser;
    byId('announcementEditor').hidden=currentUser?.role!=='admin';
    document.querySelector('.announcements-readonly').innerHTML=currentUser?.role==='admin'?'<span aria-hidden="true">●</span> ADMIN EDITOR':'<span aria-hidden="true">●</span> READ ONLY';
    document.querySelectorAll('[data-admin-only]').forEach(control=>{
      if(currentUser?.role==='admin'){
        if(control.dataset.authDisabled!==undefined){control.disabled=control.dataset.authDisabled==='true';delete control.dataset.authDisabled}
        control.classList.remove('auth-admin-only');
      }else if('disabled'in control){
        if(control.dataset.authDisabled===undefined)control.dataset.authDisabled=String(control.disabled);
        control.disabled=true;
        control.classList.remove('auth-admin-only');
      }else{
        control.classList.add('auth-admin-only');
      }
    });
    const admin=currentUser?.role==='admin';
    byId('authCreateUserForm').hidden=!admin;
    byId('authUserList').hidden=!admin;
    if(currentUser){
      byId('authCurrentUser').textContent=`Signed in as ${currentUser.username} (${admin?'Administrator':'User'}).`;
      if(admin)renderUserList();
    }
    document.dispatchEvent(new CustomEvent('authchange',{detail:{user:currentUser}}));
  }
  function renderUserList(){
    const list=byId('authUserList');
    list.replaceChildren();
    readAccounts().forEach(account=>{
      const row=document.createElement('div');row.className='auth-user-row';
      const username=document.createElement('strong');username.textContent=account.username;
      const role=document.createElement('span');role.textContent=account.role==='admin'?'Administrator':'User';
      row.append(username,role);list.append(row);
    });
  }
  function setCurrentUser(account){
    currentUser=account?{username:account.username,role:account.role}:null;
    if(currentUser)sessionStorage.setItem(sessionKey,JSON.stringify(currentUser));
    else sessionStorage.removeItem(sessionKey);
    applyRole();
    modal.hidden=true;
    byId('appShell').hidden=!currentUser;
    byId('loginPage').hidden=Boolean(currentUser);
    document.body.classList.toggle('auth-logged-out',!currentUser);
  }
  function enterApp(account){
    currentUser={username:account.username,role:account.role};
    sessionStorage.setItem(sessionKey,JSON.stringify(currentUser));
    applyRole();
    modal.hidden=true;
    byId('appShell').hidden=false;
    byId('loginPage').hidden=true;
    document.body.classList.remove('auth-logged-out');
    byId('loginError').textContent='';
    byId('loginPassword').value='';
    if(typeof window.refreshAnnouncements==='function')window.refreshAnnouncements();
  }
  async function seedDefaultAccounts(){
    const accounts=readAccounts();
    let changed=false;
    for(const [username,password,role] of [['admin','admin123','admin'],['user','user123','user']]){
      if(accounts.some(account=>account.username.toLowerCase()===username))continue;
      const salt=crypto.getRandomValues(new Uint8Array(16));
      accounts.push({username,role,salt:toHex(salt),hash:await hashPassword(password,salt),iterations});
      changed=true;
    }
    if(changed)writeAccounts(accounts);
  }
  async function makeAccount(username,password,role){
    const normalized=username.trim();
    if(!/^[a-zA-Z0-9._-]{3,40}$/.test(normalized))throw new Error('Use 3–40 letters, numbers, dots, underscores, or hyphens for the username.');
    if(password.length<10)throw new Error('Use a password with at least 10 characters.');
    const accounts=readAccounts();
    if(accounts.some(account=>account.username.toLowerCase()===normalized.toLowerCase()))throw new Error('That username is already in use.');
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const account={username:normalized,role,salt:toHex(salt),hash:await hashPassword(password,salt),iterations};
    accounts.push(account);writeAccounts(accounts);
    return account;
  }
  function guardAdminAction(event){
    if(currentUser?.role==='admin')return;
    const target=event.target instanceof Element?event.target:null;
    const protectedControl=target?.closest('[data-admin-only],.edit-item,.delete-item,.shelf-edit-input,.shelf-qty-input,[data-shelf-select],#shelfApplyBulkPromo,#shelfAddRow,#shelfSelectAll,#shelfSelectNone,#saveShiftData,#clearLocalHistory');
    if(!protectedControl)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(typeof window.toast==='function')window.toast('Sign in as an administrator to make changes.');
  }
  ['click','change','input','submit','beforeinput'].forEach(type=>document.addEventListener(type,guardAdminAction,true));

  const adminOnlySelectors=[
    '#settingsBtn','#resetBtn','#chooseFile','#fileInput','#sampleBtn','#reuploadBtn','#addItemBtn','.edit-item','.delete-item',
    '#configurePanel input','#configurePanel select','#masterlistDropzone','#masterlistFile','#shelfAddRow','#shelfFileInput',
    '.shelf-upload','#shelfSelectAll','#shelfSelectNone','#shelfBulkPromo','#shelfApplyBulkPromo','.shelf-edit-input','.shelf-qty-input',
    '[data-shelf-select]','#masterfileUpload','#hotlistResults input','#saveShiftData','#downloadBackupBtn','#restoreBackupInput',
    '#resetSettingsBtn','#clearInventoryBtn','#clearLocalHistory'
  ];
  function markAdminControls(){
    adminOnlySelectors.forEach(selector=>document.querySelectorAll(selector).forEach(control=>{
      control.dataset.adminOnly='true';
      if(control.matches('input[type="file"]'))control.closest('label')?.setAttribute('data-admin-only','true');
    }));
    document.querySelectorAll('#importPanel .dropzone,#importPanel .session-card,#dataPanel .heading-actions').forEach(control=>control.dataset.adminOnly='true');
    if(currentUser?.role!=='admin'){
      document.querySelectorAll('[data-admin-only]').forEach(control=>{
        if('disabled'in control){if(control.dataset.authDisabled===undefined)control.dataset.authDisabled=String(control.disabled);control.disabled=true}
        else control.classList.add('auth-admin-only');
      });
    }
  }
  markAdminControls();
  new MutationObserver(markAdminControls).observe(document.body,{childList:true,subtree:true});

  byId('authProfileBtn').addEventListener('click',()=>{
    if(!currentUser)return;
    showMode();
  });
  byId('loginForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const username=byId('loginUsername').value.trim();
    const account=readAccounts().find(candidate=>candidate.username.toLowerCase()===username.toLowerCase());
    if(!account){byId('loginError').textContent='Invalid username or password';return}
    try{
      const hash=await hashPassword(byId('loginPassword').value,fromHex(account.salt));
      if(hash!==account.hash){byId('loginError').textContent='Invalid username or password';return}
      enterApp(account);
    }catch(error){byId('loginError').textContent='Sign in is unavailable in this browser context.'}
  });
  byId('authCreateUserForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(currentUser?.role!=='admin'){setStatus('Only an administrator can create accounts.',true);return}
    try{
      await makeAccount(byId('authNewUsername').value,byId('authNewPassword').value,byId('authNewRole').value);
      byId('authCreateUserForm').reset();renderUserList();setStatus('Account created for this browser profile.');
    }catch(error){setStatus(error.message||'Could not create this account.',true)}
  });
  function logout(){setCurrentUser(null);byId('loginForm').reset();byId('loginError').textContent='';byId('loginUsername').focus()}
  byId('authLogoutBtn').addEventListener('click',logout);
  byId('authHeaderLogoutBtn').addEventListener('click',logout);
  document.addEventListener('authchange',()=>{
    const announcementForm=byId('announcementForm');
    if(announcementForm){
      try{
        const active=JSON.parse(localStorage.getItem(announcementsKey)||'[]')[0];
        if(active){byId('announcementTitle').value=active.title||'';byId('announcementMessage').value=active.message||''}
      }catch(error){console.warn('Could not restore announcement draft:',error)}
    }
  });
  byId('announcementForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(currentUser?.role!=='admin'){setStatus('Only an administrator can publish updates.',true);return}
    const title=byId('announcementTitle').value.trim();
    const message=byId('announcementMessage').value.trim();
    if(!title||!message)return;
    const announcement={id:`local-${Date.now()}`,date:new Date().toISOString().slice(0,10),author:currentUser.username,title,message};
    localStorage.setItem(announcementsKey,JSON.stringify([announcement]));
    if(typeof window.refreshAnnouncements==='function')window.refreshAnnouncements();
    byId('announcementsStatus').textContent='Announcement published in this browser profile.';
  });
  document.addEventListener('announcements-updated',event=>{
    const home=byId('homePanel');
    const active=event.detail?.announcements?.[0];
    let notice=byId('homeAnnouncementNotice');
    if(!active){notice?.remove();return}
    if(!notice){notice=document.createElement('aside');notice.id='homeAnnouncementNotice';notice.className='home-announcement-notice';byId('homePanel').insertBefore(notice,byId('homePanel').children[1]||null)}
    const eyebrow=document.createElement('span');eyebrow.textContent='LATEST UPDATE';
    const title=document.createElement('strong');title.textContent=active.title;
    const message=document.createElement('p');message.textContent=active.message;
    notice.replaceChildren(eyebrow,title,message);
  });
  window.addEventListener('storage',event=>{
    if(event.key!==accountsKey)return;
    const refreshed=readAccounts();
    const updated=refreshed.find(account=>account.username===currentUser?.username);
    if(!updated){currentUser=null;sessionStorage.removeItem(sessionKey);applyRole();setCurrentUser(null);}
  });

  seedDefaultAccounts().then(()=>{
    const existing=sessionAccount();
    if(existing)enterApp(existing);
    else setCurrentUser(null);
  }).catch(error=>{
    console.error('Could not initialize local accounts:',error);
    byId('loginError').textContent='Local sign-in could not be initialized. Use a secure local web server and try again.';
  });
})();