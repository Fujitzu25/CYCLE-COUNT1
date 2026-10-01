import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { addDoc, collection, getFirestore, onSnapshot, orderBy, query, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCiF6Hxh9AT-LhEFBtSsP5iW6BPyRcHcag',
  authDomain: 'planning-with-ai-cfb47.firebaseapp.com',
  projectId: 'planning-with-ai-cfb47',
  storageBucket: 'planning-with-ai-cfb47.firebasestorage.app',
  messagingSenderId: '68671022214',
  appId: '1:68671022214:web:dd7084172d550b63241d07'
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const postForm = document.getElementById('feedPostForm');
const postNameInput = document.getElementById('feedPostName');
const postTextInput = document.getElementById('feedPostText');
const imageInput = document.getElementById('feedPostImage');
const imageName = document.getElementById('feedImageName');
const publishButton = document.getElementById('feedPublishButton');
const postStatus = document.getElementById('feedPostStatus');
const connectionStatus = document.getElementById('feedConnectionStatus');
const postList = document.getElementById('feedPostList');
const commentsByPost = new Map();
const commentUnsubscribers = new Map();
let db;
let storage;
let latestPostDocuments = [];

function setConnectionStatus(message, state) {
  connectionStatus.textContent = message;
  connectionStatus.dataset.state = state;
}

function hasFirebaseConfig() {
  return Object.values(firebaseConfig).every(value => value && !value.startsWith('YOUR_'));
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timestampDate(timestamp) {
  if (!timestamp) return null;
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeTime(date) {
  const elapsedSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (elapsedSeconds > -10 && elapsedSeconds < 10) return 'Just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' });
  for (const [unit, seconds] of units) {
    if (Math.abs(elapsedSeconds) >= seconds) return formatter.format(Math.round(elapsedSeconds / seconds), unit);
  }
  return formatter.format(elapsedSeconds, 'second');
}

function appendTimestamp(parent, date, className) {
  const time = element('time', className);
  if (date) {
    time.dateTime = date.toISOString();
    time.dataset.timestamp = date.toISOString();
    time.textContent = relativeTime(date);
    time.title = date.toLocaleString();
  } else {
    time.textContent = 'Just now';
  }
  parent.append(time);
}

function makeComment(postId, comment) {
  const row = element('article', 'feed-comment');
  const meta = element('div', 'feed-comment-meta');
  meta.append(element('span', 'feed-comment-name', comment.name || 'Community member'));
  appendTimestamp(meta, timestampDate(comment.created_at), 'feed-comment-time');
  row.append(meta, element('p', 'feed-comment-text', comment.text || ''));
  return row;
}

function renderComments(postId) {
  const post = document.getElementById(`feed-post-${postId}`);
  if (!post) return;
  const comments = commentsByPost.get(postId) || [];
  const list = post.querySelector('.feed-comment-list');
  const count = post.querySelector('.feed-comment-count');
  list.replaceChildren(...comments.map(comment => makeComment(postId, comment)));
  count.textContent = String(comments.length);
  count.setAttribute('aria-label', `${comments.length} comments`);
}

function makePost(documentSnapshot) {
  const postId = documentSnapshot.id;
  const data = documentSnapshot.data();
  const article = element('article', 'feed-post');
  article.id = `feed-post-${postId}`;
  article.dataset.postId = postId;

  const header = element('header', 'feed-post-header');
  const author = element('div', 'feed-author');
  const name = String(data.name || 'Community member');
  author.append(element('span', 'feed-avatar', name.trim().slice(0, 1) || '?'));
  const authorDetails = element('div');
  authorDetails.append(element('div', 'feed-author-name', name));
  appendTimestamp(authorDetails, timestampDate(data.created_at), 'feed-time');
  author.append(authorDetails);
  header.append(author);
  article.append(header);

  if (data.text) article.append(element('p', 'feed-post-text', data.text));
  if (typeof data.image_url === 'string' && data.image_url.startsWith('https://')) {
    const image = element('img', 'feed-post-image');
    image.src = data.image_url;
    image.alt = `Photo shared by ${name}`;
    image.loading = 'lazy';
    article.append(image);
  }

  const footer = element('div', 'feed-post-footer');
  const toggle = element('button', 'feed-comments-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', `feed-comments-${postId}`);
  toggle.append(element('span', '', 'Comments'), element('span', 'feed-comment-count', '0'));
  const comments = element('section', 'feed-comments');
  comments.id = `feed-comments-${postId}`;
  comments.hidden = true;
  const commentList = element('div', 'feed-comment-list');
  const commentForm = element('form', 'feed-comment-form');
  commentForm.dataset.postId = postId;
  const commentName = document.createElement('input');
  commentName.type = 'text';
  commentName.name = 'name';
  commentName.maxLength = 50;
  commentName.placeholder = 'Your name';
  commentName.setAttribute('aria-label', 'Your name');
  commentName.required = true;
  const commentText = document.createElement('input');
  commentText.type = 'text';
  commentText.name = 'text';
  commentText.maxLength = 500;
  commentText.placeholder = 'Write a comment…';
  commentText.setAttribute('aria-label', 'Write a comment');
  commentText.required = true;
  const replyButton = element('button', '', 'Reply');
  replyButton.type = 'submit';
  replyButton.disabled = !db;
  commentForm.append(commentName, commentText, replyButton);
  const commentStatus = element('p', 'feed-status');
  commentStatus.setAttribute('role', 'status');
  commentStatus.setAttribute('aria-live', 'polite');
  comments.append(commentList, commentForm, commentStatus);
  footer.append(toggle);
  article.append(footer, comments);
  toggle.addEventListener('click', () => {
    comments.hidden = !comments.hidden;
    toggle.setAttribute('aria-expanded', String(!comments.hidden));
  });
  commentForm.addEventListener('submit', submitComment);
  return article;
}

function renderPosts(documents) {
  const fragment = document.createDocumentFragment();
  for (const postDocument of documents) {
    const post = makePost(postDocument);
    fragment.append(post);
  }
  postList.replaceChildren(fragment);
  if (!documents.length) postList.append(element('p', 'feed-empty', 'No posts yet. Start the conversation.'));
  for (const postDocument of documents) renderComments(postDocument.id);
}

function subscribeToComments(postId) {
  const commentsQuery = query(collection(db, 'posts', postId, 'comments'), orderBy('created_at', 'asc'));
  const unsubscribe = onSnapshot(commentsQuery, snapshot => {
    commentsByPost.set(postId, snapshot.docs.map(comment => comment.data()));
    renderComments(postId);
  }, error => {
    console.error(`Could not load comments for post ${postId}:`, error);
  });
  commentUnsubscribers.set(postId, unsubscribe);
}

function startFeedListeners() {
  const postsQuery = query(collection(db, 'posts'), orderBy('created_at', 'desc'));
  onSnapshot(postsQuery, snapshot => {
    latestPostDocuments = snapshot.docs;
    const activePostIds = new Set(snapshot.docs.map(post => post.id));
    for (const [postId, unsubscribe] of commentUnsubscribers) {
      if (!activePostIds.has(postId)) {
        unsubscribe();
        commentUnsubscribers.delete(postId);
        commentsByPost.delete(postId);
      }
    }
    for (const post of snapshot.docs) {
      if (!commentUnsubscribers.has(post.id)) subscribeToComments(post.id);
    }
    renderPosts(latestPostDocuments);
    setConnectionStatus('Live updates on', 'ready');
  }, error => {
    console.error('Could not load community posts:', error);
    setConnectionStatus('Could not load posts', 'error');
    postList.replaceChildren(element('p', 'feed-empty', 'Posts could not be loaded. Check the Firebase configuration and database rules.'));
  });
}

async function submitPost(event) {
  event.preventDefault();
  if (!db || !storage) {
    postStatus.textContent = 'Add your Firebase web app settings in feed.js before publishing.';
    return;
  }
  const name = postNameInput.value.trim();
  const text = postTextInput.value.trim();
  const imageFile = imageInput.files[0];
  if (!name || !text) return;
  if (imageFile && (!allowedImageTypes.has(imageFile.type) || imageFile.size > MAX_IMAGE_SIZE)) {
    postStatus.textContent = 'Choose a JPG, PNG, WEBP, or GIF image smaller than 5 MB.';
    return;
  }

  publishButton.disabled = true;
  postStatus.textContent = imageFile ? 'Uploading photo and publishing…' : 'Publishing…';
  try {
    let imageUrl = '';
    if (imageFile) {
      const safeName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const imageRef = ref(storage, `post-images/${crypto.randomUUID()}-${safeName}`);
      await uploadBytes(imageRef, imageFile, { contentType: imageFile.type });
      imageUrl = await getDownloadURL(imageRef);
    }
    await addDoc(collection(db, 'posts'), {
      name,
      text,
      image_url: imageUrl,
      created_at: serverTimestamp()
    });
    postForm.reset();
    imageName.textContent = 'No photo selected';
    postStatus.textContent = 'Your post is live.';
  } catch (error) {
    console.error('Could not publish community post:', error);
    postStatus.textContent = 'Could not publish. Check your connection and Firebase rules, then try again.';
  } finally {
    publishButton.disabled = false;
  }
}

async function submitComment(event) {
  event.preventDefault();
  if (!db) return;
  const form = event.currentTarget;
  const nameInput = form.elements.namedItem('name');
  const textInput = form.elements.namedItem('text');
  const name = nameInput.value.trim();
  const text = textInput.value.trim();
  if (!name || !text) return;
  const button = form.querySelector('button[type=submit]');
  const status = form.nextElementSibling;
  button.disabled = true;
  status.textContent = 'Sending…';
  try {
    await addDoc(collection(db, 'posts', form.dataset.postId, 'comments'), {
      name,
      text,
      created_at: serverTimestamp()
    });
    textInput.value = '';
    status.textContent = '';
  } catch (error) {
    console.error('Could not add community comment:', error);
    status.textContent = 'Could not send the reply. Check your connection and Firebase rules.';
  } finally {
    button.disabled = false;
  }
}

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  imageName.textContent = file ? file.name : 'No photo selected';
  if (file && (!allowedImageTypes.has(file.type) || file.size > MAX_IMAGE_SIZE)) {
    postStatus.textContent = 'Choose a JPG, PNG, WEBP, or GIF image smaller than 5 MB.';
  } else {
    postStatus.textContent = '';
  }
});
postForm.addEventListener('submit', submitPost);

if (!hasFirebaseConfig()) {
  setConnectionStatus('Not connected', 'setup');
  const setupMessage = element('p', 'feed-empty', 'Connect Firebase to enable live posts, photos, and comments.');
  const setupLink = document.createElement('a');
  setupLink.href = 'README.md#community-feed-firebase-setup';
  setupLink.textContent = 'Open Firebase setup steps';
  setupMessage.append(document.createElement('br'), setupLink);
  postList.replaceChildren(setupMessage);
  postStatus.textContent = 'Firebase configuration is required before posts and replies can be sent.';
  publishButton.disabled = true;
} else {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    storage = getStorage(firebaseApp);
    startFeedListeners();
  } catch (error) {
    console.error('Could not initialize Firebase:', error);
    setConnectionStatus('Firebase setup error', 'error');
    postList.replaceChildren(element('p', 'feed-empty', 'Firebase could not initialize. Check the configuration values in feed.js.'));
    publishButton.disabled = true;
  }
}

setInterval(() => {
  document.querySelectorAll('.community-feed [data-timestamp]').forEach(time => {
    const date = new Date(time.dataset.timestamp);
    if (!Number.isNaN(date.getTime())) time.textContent = relativeTime(date);
  });
}, 60000);