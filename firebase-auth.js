(()=>{
  const byId=id=>document.getElementById(id);
  const localUsersKey='fuji-local-accounts-v1';
  const localSessionKey='fuji-unified-local-session-v1';
  const localAnnouncementsKey='fuji-local-announcements-v1';
  const loginModeKey='fuji-login-mode-v1';
  const passwordIterations=210000;
  const validRoles=new Set(['admin','user']);
  let currentUser=null;
  let loginMode='local';
  let firebaseAuth=null;
  let firestore=null;
  let firebaseInitialization=null;
  let authObserverRegistered=false;
  let authResolution=0;
  let loginModeResolution=0;
  let localAuthReady=false;
  let loginInProgress=false;
  const loadedScripts=new Map();

  function userState(){return {user:currentUser,isAuthenticated:Boolean(currentUser)}}
  function publishAuthState(){
    window.fujiCurrentUser=currentUser;
    window.fujiAuth={get user(){return currentUser},get isAuthenticated(){return Boolean(currentUser)},get authType(){return currentUser?.authType||null}};
    document.dispatchEvent(new CustomEvent('authchange',{detail:userState()}));
  }
  function setLoginError(message=''){
    byId('loginError').textContent=message;
    byId('loginError').classList.toggle('is-error',Boolean(message));
  }
  function updateLoginSubmitState(){
    byId('loginSubmit').disabled=loginInProgress||(loginMode==='local'&&!localAuthReady);
  }
  function setAccountStatus(message,isError=false){
    byId('authStatus').textContent=message;
    byId('authStatus').classList.toggle('is-error',isError);
  }
  function setApplicationVisible(isAuthenticated){
    byId('appShell').hidden=!isAuthenticated;
    byId('loginPage').hidden=isAuthenticated;
    byId('authModal').hidden=true;
    document.body.classList.toggle('auth-logged-out',!isAuthenticated);
  }
  function updateAdminControl(control,isAdmin){
    if(isAdmin){
      if(control.dataset.authDisabled!==undefined){
        control.disabled=control.dataset.authDisabled==='true';
        delete control.dataset.authDisabled;
      }
      control.classList.remove('auth-admin-only');
    }else if('disabled'in control){
      if(control.dataset.authDisabled===undefined)control.dataset.authDisabled=String(control.disabled);
      control.disabled=true;
      control.classList.remove('auth-admin-only');
    }else{
      control.classList.add('auth-admin-only');
    }
  }
  function applyRole(){
    const isAdmin=currentUser?.role==='admin';
    document.body.classList.toggle('auth-role-admin',isAdmin);
    document.body.classList.toggle('auth-role-user',currentUser?.role==='user');
    byId('authProfileLabel').textContent=currentUser?`${currentUser.name} · ${isAdmin?'Admin':'User'}`:'Sign in';
    byId('authProfileBtn').title=currentUser?'Open account':'Sign in';
    byId('authHeaderLogoutBtn').hidden=!currentUser;
    byId('announcementEditor').hidden=!isAdmin;
    document.querySelector('.announcements-readonly').innerHTML=isAdmin?'<span aria-hidden="true">●</span> ADMIN EDITOR':'<span aria-hidden="true">●</span> READ ONLY';
    document.querySelectorAll('[data-admin-only]').forEach(control=>updateAdminControl(control,isAdmin));
    byId('authCreateUserForm').hidden=!isAdmin||currentUser.authType==='online';
    byId('authUserList').hidden=!isAdmin;
    byId('authStorageNote').textContent=currentUser?.authType==='online'
      ?'Online identity and role are verified with Firebase.'
      :'Local account and session stay on this computer.';
    byId('authCurrentUser').textContent=currentUser?`Signed in ${currentUser.authType==='local'?'locally':'online'} as ${currentUser.email||currentUser.username} (${isAdmin?'Administrator':'User'}).`:'';
    if(isAdmin)renderUserList();
    publishAuthState();
  }
  function showLogin(message=''){
    currentUser=null;
    applyRole();
    setApplicationVisible(false);
    setLoginError(message);
    byId('loginUsername').value='';
    byId('loginPassword').value='';
  }
  function enterApp(user){
    currentUser=user;
    applyRole();
    setApplicationVisible(true);
    setLoginError('');
    byId('loginPassword').value='';
    if(typeof window.refreshAnnouncements==='function')window.refreshAnnouncements();
  }
  function toHex(bytes){return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('')}
  function fromHex(value){return new Uint8Array((value.match(/.{1,2}/g)||[]).map(byte=>parseInt(byte,16)))}
  async function hashPassword(password,salt){
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
    return toHex(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:passwordIterations,hash:'SHA-256'},key,256));
  }
  function readLocalUsers(){
    try{const users=JSON.parse(localStorage.getItem(localUsersKey)||'[]');return Array.isArray(users)?users:[]}
    catch(error){console.warn('Could not read local accounts:',error);return []}
  }
  async function seedLocalAccounts(){
    const users=readLocalUsers();
    let changed=false;
    for(const [username,password,role] of [['admin','admin123','admin'],['user','user123','user']]){
      if(users.some(user=>String(user.username).toLowerCase()===username))continue;
      const salt=crypto.getRandomValues(new Uint8Array(16));
      users.push({username,role,salt:toHex(salt),hash:await hashPassword(password,salt),iterations:passwordIterations});
      changed=true;
    }
    if(changed)localStorage.setItem(localUsersKey,JSON.stringify(users));
  }
  function readLocalSession(){
    try{
      const session=JSON.parse(localStorage.getItem(localSessionKey)||'null');
      if(session?.auth_type!=='local')return null;
      const account=readLocalUsers().find(user=>user.username===session.username&&user.role===session.role);
      if(!account||!validRoles.has(account.role))return null;
      return {id:`local:${account.username}`,username:account.username,name:account.username,email:null,role:account.role,authType:'local'};
    }catch(error){return null}
  }
  function saveLocalSession(account){
    const session={auth_type:'local',username:account.username,role:account.role,createdAt:new Date().toISOString()};
    localStorage.setItem(localSessionKey,JSON.stringify(session));
    enterApp({id:`local:${account.username}`,username:account.username,name:account.username,email:null,role:account.role,authType:'local'});
  }
  async function loginLocally(username,password){
    const account=readLocalUsers().find(user=>user.username.toLowerCase()===username.toLowerCase());
    if(!account)return false;
    const hash=await hashPassword(password,fromHex(account.salt));
    if(hash!==account.hash)return false;
    saveLocalSession(account);
    return true;
  }
  async function createLocalUser(username,password,role){
    const normalized=username.trim();
    if(!/^[a-zA-Z0-9._-]{3,40}$/.test(normalized))throw new Error('Use 3–40 letters, numbers, dots, underscores, or hyphens for the username.');
    if(password.length<6)throw new Error('Use a password with at least 6 characters.');
    if(!validRoles.has(role))throw new Error('Choose a valid role.');
    const users=readLocalUsers();
    if(users.some(user=>user.username.toLowerCase()===normalized.toLowerCase()))throw new Error('That username already exists on this computer.');
    const salt=crypto.getRandomValues(new Uint8Array(16));
    users.push({username:normalized,role,salt:toHex(salt),hash:await hashPassword(password,salt),iterations:passwordIterations});
    localStorage.setItem(localUsersKey,JSON.stringify(users));
  }
  function loadScript(source){
    if(loadedScripts.has(source))return loadedScripts.get(source);
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=source;
      script.async=true;
      const timeout=window.setTimeout(()=>reject(new Error('Firebase SDK request timed out.')),12000);
      script.onload=()=>{window.clearTimeout(timeout);resolve()};
      script.onerror=()=>{window.clearTimeout(timeout);reject(new Error('Firebase SDK could not be downloaded.'))};
      document.head.append(script);
    });
    loadedScripts.set(source,promise);
    promise.catch(()=>loadedScripts.delete(source));
    return promise;
  }
  function applyOnlineUser(user){
    const resolution=++authResolution;
    if(!user){
      if(currentUser?.authType==='online'){
        currentUser=null;
        applyRole();
        setApplicationVisible(false);
      }
      return Promise.resolve();
    }
    return firestore.collection('users').doc(user.uid).get().then(snapshot=>{
      if(resolution!==authResolution)return;
      if(!snapshot.exists)throw new Error('Your account has no assigned application role. Contact the administrator.');
      const profile=snapshot.data();
      if(!validRoles.has(profile.role))throw new Error('Your account role is invalid. Contact the administrator.');
      enterApp({id:user.uid,username:profile.username||user.displayName||user.email,name:profile.name||user.displayName||user.email, email:user.email,role:profile.role,authType:'online'});
    }).catch(async error=>{
      if(resolution!==authResolution)return;
      console.error('Could not verify Firebase user role:',error);
      if(firebaseAuth.currentUser)await firebaseAuth.signOut();
      showLogin(error.message.includes('role')?'Your account role could not be verified. Contact an administrator.':'Could not verify your online account. Check your connection and try again.');
    });
  }
  async function initializeFirebase(){
    if(firebaseInitialization)return firebaseInitialization;
    firebaseInitialization=(async()=>{
      const config=window.FUJI_FIREBASE_CONFIG;
      if(!config?.apiKey||!config?.projectId)throw new Error('Firebase configuration is missing.');
      if(!window.firebase?.initializeApp){
        const base='https://www.gstatic.com/firebasejs/10.14.1/';
        if(!window.firebase?.apps?.length)await loadScript(`${base}firebase-app-compat.js`);
        await Promise.all([loadScript(`${base}firebase-auth-compat.js`),loadScript(`${base}firebase-firestore-compat.js`)]);
      }
      if(!window.firebase.apps.length)window.firebase.initializeApp(config);
      firebaseAuth=window.firebase.auth();
      firestore=window.firebase.firestore();
      await firebaseAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
      window.fujiFirebase={auth:firebaseAuth,firestore};
      if(!authObserverRegistered){
        authObserverRegistered=true;
        firebaseAuth.onAuthStateChanged(user=>{
          if(user&&currentUser?.authType==='local')return;
          void applyOnlineUser(user);
        });
      }
      return {auth:firebaseAuth,firestore};
    })();
    try{return await firebaseInitialization}
    catch(error){firebaseInitialization=null;throw error}
  }
  async function renderUserList(){
    const list=byId('authUserList');
    list.replaceChildren();
    if(currentUser?.authType==='online'){
      const note=document.createElement('p');
      note.className='auth-user-list-note';
      note.textContent='Manage cloud accounts in Firebase Authentication and assign roles in Firestore users/{uid}.';
      list.append(note);
      return;
    }
    readLocalUsers().forEach(account=>{
      const row=document.createElement('div');row.className='auth-user-row';
      const username=document.createElement('strong');username.textContent=account.username;
      const role=document.createElement('span');role.textContent=account.role==='admin'?'Administrator':'User';
      row.append(username,role);list.append(row);
    });
  }
  function guardAdminAction(event){
    if(currentUser?.role==='admin')return;
    const target=event.target instanceof Element?event.target:null;
    const protectedControl=target?.closest('[data-admin-only],.edit-item,.delete-item,.shelf-edit-input,.shelf-qty-input,[data-shelf-select],#shelfApplyBulkPromo,#shelfAddRow,#shelfSelectAll,#shelfSelectNone,#saveShiftData,#clearLocalHistory');
    if(!protectedControl)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(typeof window.toast==='function')window.toast('Administrator access is required to make changes.');
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
    document.querySelectorAll('#importPanel .dropzone,#importPanel .session-card').forEach(control=>control.dataset.adminOnly='true');
    document.querySelectorAll('[data-admin-only]').forEach(control=>updateAdminControl(control,currentUser?.role==='admin'));
  }
  markAdminControls();
  new MutationObserver(markAdminControls).observe(document.body,{childList:true,subtree:true});

  function setLoginMode(mode){
    const resolution=++loginModeResolution;
    loginMode=mode;
    try{localStorage.setItem(loginModeKey,mode)}catch(error){console.warn('Could not remember the selected login mode:',error)}
    document.querySelectorAll('[data-login-mode]').forEach(tab=>{
      const active=tab.dataset.loginMode===mode;
      tab.classList.toggle('is-active',active);
      tab.setAttribute('aria-selected',String(active));
    });
    const online=mode==='online';
    byId('loginUsernameLabel').textContent=online?'Email':'Username';
    byId('loginUsername').type=online?'email':'text';
    byId('loginUsername').placeholder=online?'name@company.com':'Enter username';
    byId('loginUsername').autocomplete=online?'username':'username';
    byId('loginSubmitLabel').textContent=online?'Sign In Online':'Sign In Locally';
    byId('loginModeStatus').textContent=online?'ONLINE · FIREBASE AUTHENTICATION':'OFFLINE · THIS COMPUTER';
    byId('loginFootnoteMode').textContent=online?'SECURE CLOUD SESSION':'LOCAL WORKSPACE';
    updateLoginSubmitState();
    setLoginError('');
    if(online)initializeFirebase().then(()=>{if(firebaseAuth.currentUser)void applyOnlineUser(firebaseAuth.currentUser)}).catch(()=>{
      if(resolution===loginModeResolution&&loginMode==='online')setLoginError('Network error: Unable to connect to online server. Local Machine Login remains available.');
    });
  }
  document.querySelectorAll('[data-login-mode]').forEach(tab=>tab.addEventListener('click',()=>setLoginMode(tab.dataset.loginMode)));
  byId('loginForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(loginMode==='local'&&!localAuthReady){setLoginError('Local accounts are still initializing. Try again in a moment.');return}
    loginInProgress=true;
    updateLoginSubmitState();
    document.querySelectorAll('[data-login-mode]').forEach(tab=>{tab.disabled=true});
    setLoginError('');
    try{
      const username=byId('loginUsername').value.trim();
      const password=byId('loginPassword').value;
      if(loginMode==='local'){
        const valid=await loginLocally(username,password);
        if(!valid)throw new Error('Invalid username or password.');
      }else{
        const {auth}=await initializeFirebase();
        await auth.signInWithEmailAndPassword(username,password);
      }
    }catch(error){
      const networkFailure=!navigator.onLine||error.code==='auth/network-request-failed'||/network|timed out|download/i.test(error.message||'');
      setLoginError(networkFailure?'Network error: Unable to connect to online server. Local Machine Login remains available.':error.message==='Invalid username or password.'?error.message:'Invalid username/email or password.');
    }finally{loginInProgress=false;updateLoginSubmitState();document.querySelectorAll('[data-login-mode]').forEach(tab=>{tab.disabled=false})}
  });
  byId('authProfileBtn').addEventListener('click',()=>{
    if(!currentUser)return;
    byId('authAccountPanel').hidden=false;
    byId('authModalTitle').textContent='Account management';
    byId('authModalCopy').textContent=currentUser.authType==='local'?'Manage local accounts on this computer.':'Online account and verified role.';
    byId('authStatus').textContent='';
    renderUserList();
    byId('authModal').hidden=false;
  });
  byId('authModalClose').addEventListener('click',()=>{byId('authModal').hidden=true});
  byId('authModal').addEventListener('click',event=>{if(event.target===byId('authModal'))byId('authModal').hidden=true});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!byId('authModal').hidden)byId('authModal').hidden=true;
  });
  byId('authCreateUserForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(currentUser?.role!=='admin'||currentUser.authType!=='local'){setAccountStatus('Local account creation requires a local administrator.',true);return}
    const submit=byId('authCreateUserForm').querySelector('button[type="submit"]');
    submit.disabled=true;
    setAccountStatus('Creating local account…');
    try{
      await createLocalUser(byId('authNewUsername').value,byId('authNewPassword').value,byId('authNewRole').value);
      byId('authCreateUserForm').reset();
      await renderUserList();
      setAccountStatus('Local account created on this computer.');
    }catch(error){setAccountStatus(error.message||'Could not create the local account.',true)}
    finally{submit.disabled=false}
  });
  byId('announcementForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(currentUser?.role!=='admin'){setAccountStatus('Administrator access is required to publish announcements.',true);return}
    const submit=byId('announcementForm').querySelector('button[type="submit"]');
    submit.disabled=true;
    const title=byId('announcementTitle').value.trim();
    const message=byId('announcementMessage').value.trim();
    try{
      if(!title||!message)throw new Error('Enter both a title and announcement.');
      if(currentUser.authType==='local'){
        const announcements=JSON.parse(localStorage.getItem(localAnnouncementsKey)||'[]');
        announcements.unshift({id:`local-${Date.now()}`,title,message,authorName:currentUser.name,createdAt:new Date().toISOString()});
        localStorage.setItem(localAnnouncementsKey,JSON.stringify(announcements.slice(0,50)));
      }else{
        await firestore.collection('announcements').add({
          title,
          message,
          authorId:currentUser.id,
          authorName:currentUser.name,
          createdAt:window.firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      await window.refreshAnnouncements();
      byId('announcementsStatus').textContent='Announcement published.';
    }catch(error){
      console.error('Could not publish announcement:',error);
      byId('announcementsStatus').textContent=error.message||'Could not publish this announcement.';
    }finally{submit.disabled=false}
  });
  async function logout(){
    const button=byId('authHeaderLogoutBtn');
    button.disabled=true;
    try{
      if(currentUser?.authType==='online'&&firebaseAuth){await firebaseAuth.signOut()}
      else localStorage.removeItem(localSessionKey);
      showLogin();
    }catch(error){
      console.error('Could not sign out:',error);
      if(typeof window.toast==='function')window.toast('Could not sign out. Check your connection and retry.');
    }finally{button.disabled=false}
  }
  byId('authHeaderLogoutBtn').addEventListener('click',logout);
  byId('authLogoutBtn').addEventListener('click',logout);
  document.addEventListener('authchange',()=>{if(typeof window.refreshAnnouncements==='function')window.refreshAnnouncements()});
  window.addEventListener('storage',event=>{
    if(event.key!==localSessionKey)return;
    const session=readLocalSession();
    if(session)enterApp(session);
    else if(currentUser?.authType==='local')showLogin();
  });
  window.addEventListener('online',()=>{
    if(loginMode==='online')initializeFirebase().catch(()=>setLoginError('Network error: Unable to connect to online server.'));
  });

  window.fujiFirebase=null;
  window.fujiCurrentUser=null;
  window.fujiAuth={get user(){return currentUser},get isAuthenticated(){return Boolean(currentUser)},get authType(){return currentUser?.authType||null}};
  updateLoginSubmitState();
  setApplicationVisible(false);
  seedLocalAccounts().then(()=>{
    localAuthReady=true;
    updateLoginSubmitState();
    const localSession=readLocalSession();
    if(localSession)enterApp(localSession);
    else{
      currentUser=null;
      applyRole();
      setApplicationVisible(false);
      if(localStorage.getItem(loginModeKey)==='online')setLoginMode('online');
    }
  }).catch(error=>{
    console.error('Could not initialize local accounts:',error);
    localAuthReady=false;
    updateLoginSubmitState();
    setLoginError('Local login could not be initialized in this browser.');
  });
})();
