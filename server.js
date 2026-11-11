const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');
const sessions = new Map();

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verify(password, record) {
  const test = crypto.scryptSync(password, record.salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(record.hash, 'hex'));
}
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const admin = hash('password');
    const db = { users:[{id:1,name:'System Administrator',email:'admin@taskpro.com',password:admin,role:'Admin',createdAt:new Date().toISOString()}], projects:[], tasks:[], nextUser:2,nextProject:1,nextTask:1 };
    saveDB(db); return db;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
let db = readDB();

function send(res, status, data, headers={}) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', ...headers});
  res.end(JSON.stringify(data));
}
function parseBody(req) {
  return new Promise((resolve,reject)=>{
    let body=''; req.on('data',c=>{body+=c;if(body.length>1e6) reject(new Error('Payload too large'));});
    req.on('end',()=>{try{resolve(body?JSON.parse(body):{});}catch(e){reject(e);}});
  });
}
function getUser(req) {
  const token = (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('tp_session='));
  return token ? sessions.get(token.slice('tp_session='.length)) : null;
}
function publicUser(u) { return {id:u.id,name:u.name,email:u.email,role:u.role}; }
function auth(req,res,admin=false) {
  const user=getUser(req);
  if(!user){send(res,401,{error:'Please sign in first.'});return null;}
  if(admin && user.role!=='Admin'){send(res,403,{error:'Admin access required.'});return null;}
  return user;
}
function safeTask(t) {
  const p=db.projects.find(x=>x.id===t.projectId);
  const u=db.users.find(x=>x.id===t.assignedTo);
  return {...t,projectName:p?.name||'Deleted project',assignee:u?.name||'Unassigned'};
}
function safeProject(p) {
  const owner=db.users.find(x=>x.id===p.createdBy);
  return {...p,owner:owner?.name||'Unknown',taskCount:db.tasks.filter(t=>t.projectId===p.id).length};
}
async function api(req,res,url) {
  const method=req.method, route=url.pathname;
  if(route==='/api/register' && method==='POST'){
    const b=await parseBody(req);
    if(!b.name?.trim() || !/^\S+@\S+\.\S+$/.test(b.email||'') || (b.password||'').length<6) return send(res,400,{error:'Enter a name, valid email and password (at least 6 characters).'});
    if(db.users.some(u=>u.email.toLowerCase()===b.email.toLowerCase())) return send(res,409,{error:'Email is already registered.'});
    const u={id:db.nextUser++,name:b.name.trim(),email:b.email.trim().toLowerCase(),password:hash(b.password),role:'Member',createdAt:new Date().toISOString()};
    db.users.push(u);saveDB(db);return send(res,201,{user:publicUser(u)});
  }
  if(route==='/api/login' && method==='POST'){
    const b=await parseBody(req),u=db.users.find(x=>x.email.toLowerCase()===(b.email||'').toLowerCase());
    if(!u || !verify(b.password||'',u.password)) return send(res,401,{error:'Email or password is incorrect.'});
    const token=crypto.randomBytes(32).toString('hex');sessions.set(token,publicUser(u));
    return send(res,200,{user:publicUser(u)},{'Set-Cookie':`tp_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`});
  }
  if(route==='/api/logout' && method==='POST'){
    const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('tp_session='));
    if(token)sessions.delete(token.slice(11));
    return send(res,200,{ok:true},{'Set-Cookie':'tp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
  }
  const user=auth(req,res);if(!user)return;
  if(route==='/api/me' && method==='GET') return send(res,200,{user});
  if(route==='/api/dashboard' && method==='GET'){
    const done=db.tasks.filter(t=>t.status==='Done').length;
    return send(res,200,{stats:{projects:db.projects.length,tasks:db.tasks.length,completed:done,members:db.users.length},recent:db.tasks.slice().sort((a,b)=>b.id-a.id).slice(0,8).map(safeTask)});
  }
  if(route==='/api/projects' && method==='GET') return send(res,200,{projects:db.projects.slice().sort((a,b)=>b.id-a.id).map(safeProject)});
  if(route==='/api/projects' && method==='POST'){
    const b=await parseBody(req);if(!b.name?.trim())return send(res,400,{error:'Project name is required.'});
    const p={id:db.nextProject++,name:b.name.trim(),description:b.description||'',startDate:b.startDate||'',dueDate:b.dueDate||'',status:b.status||'Planning',createdBy:user.id,createdAt:new Date().toISOString()};
    db.projects.push(p);saveDB(db);return send(res,201,{project:safeProject(p)});
  }
  const pm=route.match(/^\/api\/projects\/(\d+)$/);
  if(pm){
    const id=+pm[1],idx=db.projects.findIndex(p=>p.id===id);
    if(idx<0)return send(res,404,{error:'Project not found.'});
    if(method==='PUT'){const b=await parseBody(req);if(!b.name?.trim())return send(res,400,{error:'Project name is required.'});db.projects[idx]={...db.projects[idx],name:b.name.trim(),description:b.description||'',startDate:b.startDate||'',dueDate:b.dueDate||'',status:b.status||'Planning'};saveDB(db);return send(res,200,{project:safeProject(db.projects[idx])});}
    if(method==='DELETE'){db.projects.splice(idx,1);db.tasks=db.tasks.filter(t=>t.projectId!==id);saveDB(db);return send(res,200,{ok:true});}
  }
  if(route==='/api/tasks' && method==='GET')return send(res,200,{tasks:db.tasks.slice().sort((a,b)=>b.id-a.id).map(safeTask)});
  if(route==='/api/tasks' && method==='POST'){
    const b=await parseBody(req);if(!b.title?.trim()||!db.projects.some(p=>p.id===+b.projectId))return send(res,400,{error:'Task title and valid project are required.'});
    const t={id:db.nextTask++,title:b.title.trim(),description:b.description||'',projectId:+b.projectId,assignedTo:b.assignedTo?+b.assignedTo:null,priority:b.priority||'Medium',status:b.status||'To Do',dueDate:b.dueDate||'',createdAt:new Date().toISOString()};
    db.tasks.push(t);saveDB(db);return send(res,201,{task:safeTask(t)});
  }
  const tm=route.match(/^\/api\/tasks\/(\d+)$/);
  if(tm){
    const id=+tm[1],idx=db.tasks.findIndex(t=>t.id===id);if(idx<0)return send(res,404,{error:'Task not found.'});
    if(method==='PUT'){const b=await parseBody(req);if(!b.title?.trim()||!db.projects.some(p=>p.id===+b.projectId))return send(res,400,{error:'Task title and valid project are required.'});db.tasks[idx]={...db.tasks[idx],title:b.title.trim(),description:b.description||'',projectId:+b.projectId,assignedTo:b.assignedTo?+b.assignedTo:null,priority:b.priority||'Medium',status:b.status||'To Do',dueDate:b.dueDate||''};saveDB(db);return send(res,200,{task:safeTask(db.tasks[idx])});}
    if(method==='DELETE'){db.tasks.splice(idx,1);saveDB(db);return send(res,200,{ok:true});}
  }
  if(route==='/api/users' && method==='GET'){
    if(user.role!=='Admin')return send(res,403,{error:'Admin access required.'});
    return send(res,200,{users:db.users.map(u=>({...publicUser(u),createdAt:u.createdAt}))});
  }
  const um=route.match(/^\/api\/users\/(\d+)\/role$/);
  if(um && method==='PUT'){
    if(user.role!=='Admin')return send(res,403,{error:'Admin access required.'});
    const id=+um[1],b=await parseBody(req),target=db.users.find(u=>u.id===id);
    if(!target)return send(res,404,{error:'User not found.'});
    if(id===user.id && b.role!=='Admin')return send(res,400,{error:'You cannot remove your own Admin role.'});
    if(!['Admin','Member'].includes(b.role))return send(res,400,{error:'Invalid role.'});
    target.role=b.role;saveDB(db);return send(res,200,{user:publicUser(target)});
  }
  send(res,404,{error:'API route not found.'});
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(url.pathname.startsWith('/api/')){
    try{await api(req,res,url);}catch(e){console.error(e);send(res,500,{error:'Server error. Please try again.'});}return;
  }
  let file=path.join(PUBLIC,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname));
  if(!file.startsWith(PUBLIC)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,data)=>{
    if(err){fs.readFile(path.join(PUBLIC,'index.html'),(e,d)=>{if(e){res.writeHead(404);res.end('Not found');}else{res.writeHead(200,{'Content-Type':mime['.html']});res.end(d);}});return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log(`TaskPro Dynamic running on port ${PORT}`));
