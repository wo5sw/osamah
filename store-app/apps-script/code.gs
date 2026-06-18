/* ============================================================
   STORE BRO — Unified Apps Script backend (DB + Images + Publish)
   ------------------------------------------------------------
   Powers BOTH client URLs — point APPS_SCRIPT_URL and DB_SCRIPT_URL
   (in store-bro + store-workspace) to THIS one deployment URL.

   Google Sheet (SHEET_ID) must have two tabs:
     Users    : username | password | role | section | merchant | delivery
                role = "admin" or "agent"
                merchant = WhatsApp number, international, digits only (e.g. 9665XXXXXXXX)
     Products : id | username | status | title | data | date
                status = "draft" or "published"

   SECURITY: role/section/merchant are ALWAYS derived from the verified
   username+password — the client's "isAdmin" is never trusted.
   ============================================================ */

var SHEET_ID        = 'PUT_YOUR_SPREADSHEET_ID';   // قاعدة البيانات (Users + Products)
var BLOG_ID         = 'PUT_YOUR_BLOGGER_BLOG_ID';  // رقم مدوّنة المتجر (numeric)
var DRIVE_FOLDER_ID = '';                          // مجلد صور اختياري؛ '' = جذر Drive
var USERS    = 'Users';
var PRODUCTS = 'Products';

function doPost(e) {
  var out, lock = LockService.getScriptLock();
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action || '';

    if (action === 'login') { out = apiLogin(body); }
    else {
      var auth = authenticate(body.username, body.password);
      if (!auth.ok) { out = { success: false, message: 'بيانات الدخول غير صحيحة' }; }
      else {
        var mutating = (action === 'saveProduct' || action === 'deleteProduct' || action === 'uploadImage' || action === 'publishPost');
        if (mutating) lock.waitLock(20000);
        switch (action) {
          case 'getSections':      out = apiGetSections(auth); break;
          case 'getUserWorkspace': out = apiGetWorkspace(auth); break;
          case 'saveProduct':      out = apiSaveProduct(auth, body); break;
          case 'deleteProduct':    out = apiDeleteProduct(auth, body); break;
          case 'uploadImage':      out = apiUploadImage(auth, body); break;
          case 'publishPost':      out = apiPublishPost(auth, body); break;
          default:                 out = { success: false, message: 'إجراء غير معروف' };
        }
      }
    }
  } catch (err) {
    out = { success: false, message: 'خطأ بالخادم: ' + err };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ success: true, service: 'store-bro' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss() { return SpreadsheetApp.openById(SHEET_ID); }

/* ===== AUTH — single source of truth; never trust client isAdmin ===== */
function authenticate(username, password) {
  if (!username || !password) return { ok: false };
  var rows = ss().getSheetByName(USERS).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var u = String(rows[i][0]).trim();
    if (u && u === String(username).trim() && verifyPassword(String(password), String(rows[i][1]))) {
      var role = String(rows[i][2] || 'agent').trim().toLowerCase();
      return {
        ok: true, username: u, role: role, isAdmin: (role === 'admin'),
        section:  String(rows[i][3] || '').trim(),
        merchant: String(rows[i][4] || '').replace(/[^0-9]/g, ''),
        delivery: String(rows[i][5] || '').trim()
      };
    }
  }
  return { ok: false };
}

/* قارن كلمة المرور. حاليًا نص صريح ليطابق جدولك.
   ▶ موصى به: خزّن SHA-256 وفعّل السطر المعلّق. */
function verifyPassword(input, stored) {
  // return sha256(input) === String(stored);
  return input === String(stored);
}
function sha256(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return raw.map(function (b) { b = (b < 0 ? b + 256 : b).toString(16); return b.length < 2 ? '0' + b : b; }).join('');
}

function apiLogin(body) {
  var a = authenticate(body.username, body.password);
  if (!a.ok) return { success: false, message: 'بيانات الدخول غير صحيحة' };
  return { success: true, user: { name: a.username, isAdmin: a.isAdmin, section: a.section, merchant: a.merchant, delivery: a.delivery } };
}

/* ===== SECTIONS — per-category merchant number (this powers routing) ===== */
function apiGetSections(auth) {
  var rows = ss().getSheetByName(USERS).getDataRange().getValues();
  var map = {};
  for (var i = 1; i < rows.length; i++) {
    var section = String(rows[i][3] || '').trim();
    if (!section) continue;
    if (!auth.isAdmin && section !== auth.section) continue; // agent: own section only
    map[section] = {
      merchant: String(rows[i][4] || '').replace(/[^0-9]/g, ''),
      delivery: String(rows[i][5] || '').trim()
    };
  }
  return { success: true, sections: map };
}

/* ===== WORKSPACE ===== */
function apiGetWorkspace(auth) {
  var rows = ss().getSheetByName(PRODUCTS).getDataRange().getValues();
  var drafts = [], history = [];
  for (var i = 1; i < rows.length; i++) {
    var id = String(rows[i][0]); if (!id) continue;
    var owner = String(rows[i][1]), status = String(rows[i][2] || 'draft');
    var title = String(rows[i][3] || ''), dataStr = String(rows[i][4] || ''), date = rows[i][5] ? String(rows[i][5]) : '';
    if (!auth.isAdmin && owner !== auth.username) continue; // non-admin: own records only
    var item = { id: id, author: owner, status: status, title: title, date: date, data: safeJson(dataStr) };
    if (status === 'published') history.push(item); else drafts.push(item);
  }
  return { success: true, drafts: drafts, history: history };
}

function apiSaveProduct(auth, body) {
  var id = String(body.id || '').trim();
  if (!id) return { success: false, message: 'معرّف ناقص' };
  var status = auth.isAdmin ? String(body.status || 'draft') : 'draft'; // agents: draft only
  var title = String(body.title || '');
  var data = (typeof body.jsonData === 'string') ? body.jsonData : JSON.stringify(body.jsonData || {});

  var sh = ss().getSheetByName(PRODUCTS);
  var rows = sh.getDataRange().getValues();
  var now = new Date();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      var owner = String(rows[i][1]);
      if (!auth.isAdmin && owner !== auth.username) return { success: false, message: 'غير مصرح' };
      sh.getRange(i + 1, 1, 1, 6).setValues([[ id, owner || auth.username, status, title, data, now ]]);
      return { success: true };
    }
  }
  sh.appendRow([ id, auth.username, status, title, data, now ]);
  return { success: true };
}

function apiDeleteProduct(auth, body) {
  var id = String(body.id || '').trim();
  if (!id) return { success: false, message: 'معرّف ناقص' };
  var sh = ss().getSheetByName(PRODUCTS);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      if (!auth.isAdmin && String(rows[i][1]) !== auth.username) return { success: false, message: 'غير مصرح' };
      sh.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, message: 'غير موجود' };
}

/* ===== IMAGES → Drive (returns a url containing id= so the client extracts fileId) ===== */
function apiUploadImage(auth, body) {
  var b64 = String(body.base64 || '');
  var comma = b64.indexOf(','); if (comma > -1) b64 = b64.substring(comma + 1); // strip data:...;base64,
  var name = String(body.filename || ('img_' + Date.now() + '.jpg')).replace(/[^\w.\-]/g, '_');
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name);
  var folder = DRIVE_FOLDER_ID ? DriveApp.getFolderById(DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { success: true, url: 'https://drive.google.com/uc?export=view&id=' + file.getId() };
}

/* ===== PUBLISH → Blogger (admin only) ===== */
function apiPublishPost(auth, body) {
  if (!auth.isAdmin) return { success: false, message: 'النشر مسموح للمدير فقط' };
  var title = String(body.title || '').trim() || 'منتج';
  var content = String(body.content || '');
  var labels = (body.labels && body.labels.length) ? body.labels.filter(String) : [];
  var url = 'https://www.googleapis.com/blogger/v3/blogs/' + BLOG_ID + '/posts/';
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ kind: 'blogger#post', title: title, content: content, labels: labels }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode(), data = {};
  try { data = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
  if (code >= 200 && code < 300) return { success: true, postUrl: data.url || '', id: data.id || '' };
  return { success: false, message: 'فشل النشر (' + code + '): ' + ((data.error && data.error.message) || '') };
}

function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }
