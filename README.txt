CWR CRM  -  DEPLOY GUIDE (Hinglish)
===================================

PAGES
  Admin portal    : https://YOUR-DOMAIN/            (index.html)
  Employee portal : https://YOUR-DOMAIN/employee.html
  Health check    : https://YOUR-DOMAIN/api/health

LOCAL TEST
  node server.js            -> http://localhost:3000
  Pehli baar chalane par admin banta hai:
     username: admin   password: ADMIN_PASS env, warna "admin123" (login ke baad turant change karo)
  Employees ko admin portal > Team se banao.

ENVIRONMENT VARIABLES
  ADMIN_PASS   = pehle admin ka strong password (sirf pehli baar kaam karta hai)
  ADMIN_USER   = (optional) admin username, default "admin"
  DATA_FILE    = data.json ka full path, e.g. /data/data.json  (PERSISTENT DISK par rakho)
  TRUST_PROXY  = 1  (Render/Railway/Nginx ke peeche chalate ho to zaroor)
  PORT         = hosting khud deti hai

HOSTING (must)
  1) HTTPS zaroori hai - warna selfie attendance ka camera nahi khulega.
  2) Persistent disk zaroori hai - data.json, photos/ aur backups/ usi disk par aate hain.
     Free plan jo restart par files mita deta hai (Render free etc.) mat use karo.
  3) Render example: New Web Service > Start command "node server.js" > Add Disk mount /data
     > env: DATA_FILE=/data/data.json, TRUST_PROXY=1, ADMIN_PASS=<strong password>
  4) VPS: pm2 start server.js --name cwr-crm  + Nginx + Let's Encrypt (HTTPS)
     Nginx me proxy_set_header X-Forwarded-For $remote_addr; aur X-Forwarded-Proto $scheme; dalo.

BACKUP
  Server har 6 ghante me aur har start par backups/ me data-YYYY-MM-DD.json banata hai (last 14 rakhta hai).
  Mahine me ek baar data.json + photos/ + backups/ ko kahin aur copy kar lo.

APP BANANA (phone par install)
  Android Chrome: site kholo > menu > "Install app".  iPhone Safari: Share > "Add to Home Screen".
  Admin aur Employee dono ka alag app icon banta hai.

SECURITY CHECKLIST
  [x] Koi demo/temporary password code nahi hai
  [x] data.json blank hai (test data hata diya)
  [ ] ADMIN_PASS set karo ya pehle login par password change karo
  [ ] Naye employees ko default password milta hai - unhe pehle login par change karne ko bolo
