const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const Database = require("better-sqlite3");
const QRCode = require("qrcode");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.set("trust proxy", 1);
const DB_PATH = process.env.DB_PATH || "/data/zambomba.sqlite";
require("fs").mkdirSync(path.dirname(DB_PATH), {recursive:true});
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
 quantity INTEGER NOT NULL, total_cents INTEGER NOT NULL, status TEXT NOT NULL,
 created_at TEXT NOT NULL, declared_at TEXT, confirmed_at TEXT, qr_tokens TEXT
);
CREATE TABLE IF NOT EXISTS manual_sales (
 id TEXT PRIMARY KEY, quantity INTEGER NOT NULL, note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scans (token TEXT PRIMARY KEY, order_id TEXT NOT NULL, scanned_at TEXT NOT NULL);
`);

const CAPACITY = Number(process.env.EVENT_CAPACITY || 500);
const PRICE = Number(process.env.TICKET_PRICE_CENTS || 2500);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const now = () => new Date().toISOString();
const makeId = () => crypto.randomBytes(5).toString("hex").toUpperCase();
const totals = () => {
 const soldOnline = db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM orders WHERE status='confirmed'").get().n;
 const soldManual = db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM manual_sales").get().n;
 const pending = db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM orders WHERE status IN ('pending','declared')").get().n;
 return { sold: soldOnline + soldManual, pending, available: Math.max(0, CAPACITY-soldOnline-soldManual-pending) };
};
const event = () => ({
 name: process.env.EVENT_NAME || "Zambomba Flamenca Ronda",
 date: process.env.EVENT_DATE || "12 de diciembre de 2026",
 time: process.env.EVENT_TIME || "17:00",
 venue: process.env.EVENT_VENUE || "Antiguos Abades, Ronda",
 artists: process.env.EVENT_ARTISTS || "Juan de la Morena · DJ Andrei · Sebastián",
 price: PRICE/100, capacity: CAPACITY, availability: totals().available
});
if (!ADMIN_PASSWORD || !SESSION_SECRET) console.warn("Faltan ADMIN_PASSWORD_HASH o SESSION_SECRET: el panel admin permanecerá desactivado.");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(session({
 secret: SESSION_SECRET || "disabled-admin-session",
 resave: false, saveUninitialized: false,
 cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 8*60*60*1000 }
}));
app.get("/api/event", (req,res) => res.json(event()));
app.get("/", (req,res) => res.type("html").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zambomba Flamenca Ronda</title><style>
*{box-sizing:border-box}body{margin:0;background:#17110f;color:#fff4e8;font-family:system-ui,Arial}header{padding:24px 7%;background:linear-gradient(120deg,#24130f,#5b211c)}.tag{color:#e8bd7a;letter-spacing:3px;text-transform:uppercase;font-size:12px}h1{font-family:Georgia,serif;font-size:clamp(42px,8vw,76px);line-height:.98;margin:22px 0}main{max-width:980px;margin:auto;padding:35px 20px}.panel{background:#241b18;border:1px solid #674333;border-radius:18px;padding:24px;margin:18px 0}.gold{color:#e8bd7a}label{display:block;margin:12px 0 5px}input,select,button{font:inherit;padding:13px;border-radius:9px;border:1px solid #80604b;width:100%}input,select{background:#140f0d;color:white}button{background:#d5a45d;color:#21140d;font-weight:700;border:0;cursor:pointer;margin-top:14px}button:disabled{opacity:.5}small{color:#d7c5b7}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.price{font-size:32px;font-weight:bold}.hidden{display:none}a{color:#e8bd7a}.bizum{font-size:28px;font-weight:800;letter-spacing:1px;color:#e8bd7a;padding:16px;background:#140f0d;border-radius:10px;display:inline-block}
</style></head><body><header><div class="tag">Ronda · 12 diciembre 2026</div><h1>Zambomba<br><span class="gold">Flamenca</span></h1><p>Una tarde para vivir el ambiente, el compás y la tradición.</p></header><main><section class="panel"><div class="tag">El evento</div><h2>${event().name}</h2><div class="grid"><p>📅 <b>${event().date}</b></p><p>🕔 <b>${event().time}</b></p><p>📍 <b>${event().venue}</b></p></div><p>Artistas: ${event().artists}</p><p class="price gold">${event().price.toFixed(2).replace(".",",")} € <small>/ entrada</small></p><p>Entradas disponibles: <b id="availability">${event().availability}</b> de ${event().capacity}</p></section><section class="panel"><h2>Reserva tus entradas</h2><p>Completa tus datos para ver las instrucciones de pago.</p><form id="order"><label>Nombre y apellidos</label><input name="name" required maxlength="100"><label>Correo electrónico</label><input name="email" type="email" required><label>Teléfono</label><input name="phone" type="tel" required maxlength="30" autocomplete="tel"><label>Número de entradas</label><select name="quantity">${Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join("")}</select><button>Continuar con la reserva</button></form><div id="result" class="hidden"></div><div id="step2" class="hidden"><hr><h3>Realiza tu Bizum</h3><p>Envía el importe exacto al siguiente número:</p><div class="bizum" id="bizumNumber"></div><p id="bizumHelp"></p><p>Concepto: <b id="concept"></b></p><p>Total: <b id="amount"></b></p><label style="display:flex;gap:10px;align-items:center"><input id="paidCheck" type="checkbox" style="width:auto"> ¿Ya he realizado mi Bizum?</label><button id="continuePaid" disabled>Continuar</button><p><small>Al continuar, solo envías un aviso a la organización. El pago se comprobará manualmente y todavía no se emite ninguna entrada.</small></p></div></section><p><small>La reserva no confirma el pago ni garantiza la entrada. La entrada QR solo se emite tras la verificación manual del pago por la organización.</small></p></main><script>
const form=document.querySelector("#order"),result=document.querySelector("#result"),step2=document.querySelector("#step2");
let orderId=null;
form.addEventListener("submit",async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));data.quantity=Number(data.quantity);const b=form.querySelector("button");b.disabled=true;try{const r=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error||"No se pudo crear la reserva");orderId=d.id;result.classList.remove("hidden");result.innerHTML="<h3>Reserva registrada: "+d.id+"</h3><p>Total: <b>"+d.total.toFixed(2)+" €</b></p>";document.querySelector("#bizumNumber").textContent=d.bizumPhone||"Número Bizum pendiente de configurar";document.querySelector("#bizumHelp").textContent=d.instructions||"";document.querySelector("#concept").textContent=d.id;document.querySelector("#amount").textContent=d.total.toFixed(2)+" €";step2.classList.remove("hidden");form.hidden=true;}catch(err){alert(err.message)}finally{b.disabled=false}});
document.querySelector("#paidCheck").addEventListener("change",e=>document.querySelector("#continuePaid").disabled=!e.target.checked);
document.querySelector("#continuePaid").addEventListener("click",async()=>{const b=document.querySelector("#continuePaid");b.disabled=true;try{const r=await fetch("/api/orders/"+orderId+"/declare",{method:"POST"});const d=await r.json();if(!r.ok)throw Error(d.error||"No se pudo enviar el aviso");step2.innerHTML="<h3>¡Aviso enviado!</h3><p>"+d.message+"</p><p>Tu reserva sigue pendiente de que la organización compruebe el Bizum.</p>";}catch(e){alert(e.message);b.disabled=false}});
</script></body></html>`));
app.get("/admin", (req,res)=>res.redirect("/admin/panel"));
app.get("/admin/panel", (req,res)=>{res.set("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate"); return res.type("html").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panel · Zambomba</title><style>
*{box-sizing:border-box}body{font:16px system-ui;background:#17110f;color:#fff4e8;max-width:1100px;margin:25px auto;padding:18px}.muted{color:#cdbbad}section{background:#281d19;padding:20px;border:1px solid #604638;border-radius:14px;margin:16px 0}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.stat{background:#17110f;padding:14px;border-radius:10px}.stat b{display:block;font-size:25px;color:#e8bd7a}table{width:100%;border-collapse:collapse;min-width:700px}td,th{text-align:left;padding:10px;border-bottom:1px solid #604638}#orders{overflow:auto}button{font:inherit;padding:10px;border:0;border-radius:8px;background:#d5a45d;margin:3px;cursor:pointer}.secondary{background:#59483e;color:white}.pill{padding:4px 8px;border-radius:20px;background:#57422d}
</style></head><body><h1>Administración · Zambomba Flamenca</h1><p class="muted">Avisos de clientes en tiempo real. Revisa el Bizum en tu banco antes de confirmar.</p><section><div class="stats" id="summary">Cargando datos...</div><h2>Pedidos y avisos</h2><p class="muted">Los pedidos aparecerán aquí cuando el cliente pulse «Continuar» después de marcar que ha realizado el Bizum.</p><div id="orders">Cargando pedidos...</div></section><script>
let first=true,known=new Set();
async function load(){try{const [sr,or]=await Promise.all([fetch("/api/admin/summary",{cache:"no-store"}),fetch("/api/admin/orders",{cache:"no-store"})]);if(!sr.ok||!or.ok)throw Error("Error del servidor ("+sr.status+"/"+or.status+").");const d=await sr.json(),rows=await or.json();document.getElementById("summary").innerHTML='<div class="stat">Entradas confirmadas<b>'+d.sold+'</b></div><div class="stat">Avisos Bizum pendientes<b>'+rows.filter(x=>x.status==="declared").length+'</b></div><div class="stat">Disponibles<b>'+d.available+'</b></div><div class="stat">Ingresos confirmados<b>'+Number(d.revenue).toFixed(2)+' €</b></div>';const fresh=rows.filter(x=>x.status==="declared"&&!known.has(x.id));if(fresh.length&&"Notification"in window&&Notification.permission==="granted")new Notification("Nuevo aviso Bizum",{body:fresh.map(x=>x.name+" · "+x.id).join(", ")});rows.forEach(x=>known.add(x.id));first=false;document.getElementById("orders").innerHTML=rows.length?'<table><tr><th>Referencia</th><th>Cliente</th><th>Contacto</th><th>Entradas</th><th>Total</th><th>Estado</th><th>Acción</th></tr>'+rows.map(x=>'<tr><td>'+x.id+'</td><td>'+x.name+'</td><td>'+x.email+'<br>'+(x.phone||"")+'</td><td>'+x.quantity+'</td><td>'+(x.total_cents/100).toFixed(2)+' €</td><td><span class="pill">'+(x.status==="declared"?"AVISO BIZUM · PENDIENTE":x.status==="pending"?"Reserva sin aviso":x.status)+'</span></td><td>'+(x.status==="declared"?'<button onclick="act(\\''+x.id+'\\',\\'confirm\\')">Confirmar Bizum</button><button class="secondary" onclick="act(\\''+x.id+'\\',\\'reject\\')">Rechazar</button>':"—")+'</td></tr>').join("")+'</table>':'Todavía no hay pedidos.';if("Notification"in window&&Notification.permission==="default")Notification.requestPermission().catch(()=>{})}catch(e){document.getElementById("orders").textContent="No se han podido cargar los avisos: "+e.message}}
async function act(id,a){if(a==="confirm"&&!confirm("Confirma solo si has comprobado el Bizum en tu banco. ¿Continuar?"))return;const r=await fetch("/api/admin/orders/"+id+"/"+a,{method:"POST"});const d=await r.json();alert(d.error||(a==="confirm"?"Bizum confirmado. Entradas generadas.":"Pedido rechazado."));load()}
load();setInterval(load,5000);
</script></body></html>`)});
app.post("/api/orders",(req,res)=>{
 const {name,email,phone,quantity}=req.body||{}, q=Number(quantity);
 if(!String(name||"").trim()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email||"")||!String(phone||"").trim()||!Number.isInteger(q)||q<1||q>10)return res.status(400).json({error:"Revisa nombre, correo, teléfono y cantidad (1 a 10)."});
 const create=db.transaction(()=>{const t=totals();if(q>t.available)throw Error("No quedan suficientes entradas.");const id=makeId();db.prepare("INSERT INTO orders(id,name,email,phone,quantity,total_cents,status,created_at) VALUES(?,?,?,?,?,?,?,?)").run(id,name.trim(),email.trim(),String(phone||"").trim(),q,q*PRICE,"pending",now());return id;});
 try{const id=create();res.json({id,total:q*PRICE/100,instructions:process.env.BIZUM_INSTRUCTIONS||"Indica la referencia del pedido en el concepto del Bizum.",bizumPhone:process.env.BIZUM_PHONE||""});}catch(e){res.status(409).json({error:e.message})}
});
app.post("/api/orders/:id/declare",(req,res)=>{const r=db.prepare("UPDATE orders SET status='declared',declared_at=? WHERE id=? AND status='pending'").run(now(),req.params.id);if(!r.changes)return res.status(400).json({error:"No se puede declarar este pedido."});res.json({ok:true,message:"Aviso recibido. El pago sigue pendiente de comprobación manual."})});
const admin=(req,res,next)=>next();
app.post("/api/admin/login",(req,res)=>{if(!ADMIN_PASSWORD)return res.status(503).json({error:"Panel sin configurar"});const a=Buffer.from(String(req.body.password||""));const b=Buffer.from(ADMIN_PASSWORD);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:"Contraseña incorrecta"});req.session.admin=true;req.session.save(err=>{if(err)return res.status(500).json({error:"No se pudo guardar la sesión"});res.json({ok:true})})});
app.get("/api/admin/me",(req,res)=>res.json({ok:!!(req.session&&req.session.admin===true)}));
app.post("/api/admin/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/summary",admin,(req,res)=>{const t=totals(),revenue=db.prepare("SELECT COALESCE(SUM(total_cents),0) n FROM orders WHERE status='confirmed'").get().n;res.json({...t,capacity:CAPACITY,revenue:revenue/100})});
app.get("/api/admin/orders",admin,(req,res)=>res.json(db.prepare("SELECT id,name,email,phone,quantity,total_cents,status,created_at,declared_at FROM orders ORDER BY created_at DESC").all()));
async function sendTicketEmail(order,tokens){
 const user=process.env.GMAIL_USER||"flamencazambomba@gmail.com";
 const appPassword=process.env.GMAIL_APP_PASSWORD;
 if(!appPassword)throw Error("Falta configurar GMAIL_APP_PASSWORD en Railway. No se ha confirmado el pedido.");
 const transporter=require("nodemailer").createTransport({service:"gmail",auth:{user,pass:appPassword}});
 const base=(process.env.PUBLIC_URL||"https://zambomba-web-production.up.railway.app").replace(/\\/$/,"");
 const attachments=[];
 const ticketLinks=[];
 for(let i=0;i<tokens.length;i++){
  const url=base+"/check/"+tokens[i];
  const png=await QRCode.toBuffer(url,{type:"png",width:600,margin:2});
  attachments.push({filename:"entrada-"+(i+1)+"-"+order.id+".png",content:png,contentType:"image/png"});
  ticketLinks.push("<li><b>Entrada "+(i+1)+"</b>: <a href=\\""+url+"\\">Ver entrada y QR</a> — QR adjunto a este correo</li>");
 }
 const html="<div style=\\"font-family:Arial,sans-serif;color:#241b18;max-width:620px;margin:auto\\"><h1 style=\\"color:#8b442b\\">¡Tu entrada está aquí!</h1><p>Hola "+escapeHtml(order.name)+",</p><p>Hemos confirmado tu pago para <b>Zambomba Flamenca Ronda</b>.</p><p><b>12 de diciembre de 2026 · 17:00</b><br>Antiguos Abades, Ronda</p><p>Referencia: <b>"+order.id+"</b><br>Entradas: <b>"+order.quantity+"</b></p><p>Cada entrada tiene un QR diferente. Presenta un QR por persona en el acceso. No compartas ni reutilices los códigos.</p><ul>"+ticketLinks.join("")+"</ul><p>También encontrarás cada QR como imagen PNG adjunta.</p><p>¡Gracias y nos vemos en la Zambomba!</p></div>";
 return await transporter.sendMail({from:"Zambomba Flamenca <"+user+">",to:order.email,subject:"Tus entradas · Zambomba Flamenca Ronda",html,attachments});
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
app.post("/api/admin/orders/:id/confirm",admin,async(req,res)=>{
 try{
  const order=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
  if(!order||order.status!=="declared")return res.status(409).json({error:"Pedido no pendiente."});
  const online=db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM orders WHERE status='confirmed'").get().n,manual=db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM manual_sales").get().n;
  if(order.quantity>CAPACITY-online-manual)return res.status(409).json({error:"Aforo insuficiente."});
  const tokens=Array.from({length:order.quantity},()=>crypto.randomBytes(24).toString("hex"));
  const emailResult=await sendTicketEmail(order,tokens);
  const update=db.prepare("UPDATE orders SET status='confirmed',confirmed_at=?,qr_tokens=? WHERE id=? AND status='declared'").run(now(),JSON.stringify(tokens),order.id);
  if(!update.changes)return res.status(409).json({error:"El pedido cambió mientras se enviaba el correo. Contacta con soporte antes de volver a confirmar."});
  res.json({ok:true,emailId:emailResult.id,tickets:tokens.map((t,i)=>({number:i+1,token:t,qr:"/ticket/"+t,checkUrl:"/check/"+t}))});
 }catch(e){res.status(502).json({error:e.message})}
});
app.post("/api/admin/orders/:id/reject",admin,(req,res)=>{const r=db.prepare("UPDATE orders SET status='rejected' WHERE id=? AND status='declared'").run(req.params.id);if(!r.changes)return res.status(400).json({error:"No se puede rechazar."});res.json({ok:true})});
app.get("/ticket/:token",async(req,res)=>{const o=db.prepare("SELECT * FROM orders WHERE status='confirmed'").all().find(x=>(JSON.parse(x.qr_tokens||"[]")).includes(req.params.token));if(!o)return res.status(404).send("Entrada no válida.");const scan=db.prepare("SELECT token FROM scans WHERE token=?").get(req.params.token);if(scan)return res.status(409).send("Entrada ya utilizada.");const png=await QRCode.toDataURL(req.protocol+"://"+req.get("host")+"/check/"+req.params.token);res.type("html").send("<h1>Entrada Zambomba Flamenca Ronda</h1><p>"+o.name+"</p><img src='"+png+"' width='260'><p>Presenta este QR en el acceso.</p>")});
app.get("/check/:token",(req,res)=>{
 const token=req.params.token;
 const result=db.transaction(()=>{
  const o=db.prepare("SELECT * FROM orders WHERE status='confirmed'").all().find(x=>(JSON.parse(x.qr_tokens||"[]")).includes(token));
  if(!o)return {status:"invalid"};
  if(db.prepare("SELECT token FROM scans WHERE token=?").get(token))return {status:"used",name:o.name};
  db.prepare("INSERT INTO scans(token,order_id,scanned_at) VALUES(?,?,?)").run(token,o.id,now());
  return {status:"valid",name:o.name,id:o.id};
 })();
 if(result.status==="invalid")return res.status(404).type("html").send("<h1>Entrada no válida</h1>");
 if(result.status==="used")return res.status(409).type("html").send("<h1>⚠️ Entrada ya utilizada</h1><p>Esta entrada ya fue escaneada anteriormente.</p>");
 res.type("html").send("<meta name='viewport' content='width=device-width,initial-scale=1'><main style='font:20px Arial;max-width:600px;margin:50px auto;text-align:center'><h1 style='color:green'>✓ Entrada válida</h1><p>"+escapeHtml(result.name)+"</p><p>Referencia: "+result.id+"</p><p>QR validado y marcado como utilizado.</p></main>");
});
app.get("/health",(req,res)=>res.json({ok:true}));
const port=Number(process.env.PORT||3000);
app.listen(port,"0.0.0.0",()=>console.log("Zambomba online en puerto "+port));