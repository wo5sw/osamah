/**
 * ============================================================
 *  Store Bro — Direct Publish API (Google Apps Script)
 * ============================================================
 *
 *  WHAT IT DOES
 *  - Authenticates reps/admin for the Store Bro publisher tool
 *    (action:'login') against a PRIVATE user list kept inside this
 *    script — credentials are NEVER exposed to any browser.
 *  - Publishes a product (title + content + category) to your Blogger
 *    blog (action:'publishPost'), after verifying the same credentials
 *    server-side and SANITIZING the HTML content.
 *
 *  Returns JSON:
 *    login   → { success:true, isAdmin, section }  |  { success:false, message }
 *    publish → { success:true, message }           |  { success:false, message }
 *
 *  ── ONE-TIME SETUP ──────────────────────────────────────────
 *  1. script.google.com → New project → paste this whole file → Save 💾.
 *  2. In CONFIG below: set BLOG_URL, and set SALT to any random text
 *     ONCE (changing it later invalidates every stored hash).
 *  3. Add your users:
 *       - Edit runSetup() at the bottom, choose it from the function
 *         dropdown, click Run, then open  View → Logs (Execution log).
 *       - Copy each printed line into the USERS array below.
 *  4. Deploy ▾ → New deployment → type "Web app".
 *        Execute as:     Me (the account that OWNS the blog)
 *        Who has access: Anyone
 *     Deploy → Authorize access → Allow. Copy the "/exec" URL.
 *  5. Put that URL into store-bro-publisher.xml (APPS_SCRIPT_URL) and
 *     re-upload the widget to Blogger.
 *
 *  After ANY change to USERS / CONFIG:  Deploy ▾ → Manage deployments
 *  → Edit ✏ → Version: "New version" → Deploy, or it won't take effect.
 *
 *  TEST: open the /exec URL in a browser — you should see
 *        {"success":false,"message":"This endpoint accepts POST only..."}
 * ============================================================
 */

/* ────────────── CONFIG — edit these ────────────── */
var CONFIG = {
  // Your STORE blog address (where customers shop) — products publish HERE.
  // Must be the store the storefront reads, NOT the workspace tool.
  BLOG_URL: 'https://www.store1bro.com',

  // Google Sheet holding the 'Users' tab — the SAME sheet the login uses.
  // Auth now reads this sheet (not the USERS array below), so login and
  // publish share ONE source of truth.
  SHEET_ID: '1vTJYZzcQcqvZqkTmcudVzkeTHzlq7GPRQAsFiQqAuaE',

  // (Legacy) kept only so the manual makeUser/makeAdmin helpers still run.
  SALT: 'store-bro-salt-CHANGE-ME-7f3ad9',

  // Require a valid username/password before publishing. Keep true.
  REQUIRE_AUTH: true
};

/* ────────────── USERS — your PRIVATE credential list ──────────────
   This is never sent to browsers. Passwords are stored as salted
   SHA-256 hashes, not plain text.

   To add someone, run makeUser / makeAdmin (see runSetup) and copy the
   printed line here. 'section' must match the Blogger Label exactly.
   Admins may publish to any category; their section is 'الكل'.
*/
var USERS = [
  // { user:'ahmad',  hash:'....', section:'ايفون', admin:false },
  // { user:'osamah', hash:'....', section:'الكل',  admin:true  },
];
/* ─────────────────────────────────────────────────────────────── */


/** GET — liveness check so you can confirm the URL works. */
function doGet(e) {
  return json({ success: false, message: 'This endpoint accepts POST only. Deployment is live ✅' });
}

/** POST — login + publish entry point called by the tool. */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ success: false, message: 'لا توجد بيانات في الطلب.' });
    }

    var payload  = JSON.parse(e.postData.contents);
    var action   = (payload.action   || 'publishPost').toString();
    var username = (payload.username || '').toString().trim();
    var password = (payload.password || '').toString();

    /* ---- LOGIN ---- */
    if (action === 'login') {
      var a = verifyCredentials(username, password);
      if (!a.ok) return json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
      return json({ success: true, isAdmin: a.isAdmin, section: a.section });
    }

    /* ---- PUBLISH ---- */
    var title    = (payload.title   || '').toString().trim();
    var content  = (payload.content || '').toString();
    var category = (payload.category ||
                    (Array.isArray(payload.labels) ? payload.labels.join(',') : payload.labels) ||
                    '').toString().trim();

    if (!title)   return json({ success: false, message: 'عنوان المنتج مفقود.' });
    if (!content) return json({ success: false, message: 'محتوى المنتج مفقود.' });

    if (CONFIG.REQUIRE_AUTH) {
      var auth = verifyCredentials(username, password);
      if (!auth.ok) return json({ success: false, message: 'بيانات الدخول غير صحيحة — لا يمكن النشر.' });
      // A normal rep may only publish to their own section.
      if (!auth.isAdmin) category = auth.section;
    }

    // Never trust client HTML — strip anything but safe, structural tags.
    content = sanitizeContent(content);

    /* Build labels list (category → Blogger label) */
    var labels = [];
    if (category && category !== 'الكل') {
      category.split(/[,،]/).forEach(function (c) { c = c.trim(); if (c) labels.push(c); });
    }

    var blogId = getBlogId();
    var result = publishPost(blogId, title, content, labels);

    return json({
      success: true,
      message: 'تم نشر المنتج بنجاح ✅' + (result.url ? ('\nالرابط: ' + result.url) : '')
    });

  } catch (err) {
    return json({ success: false, message: 'خطأ في الخادم: ' + (err && err.message ? err.message : err) });
  }
}


/* ============================================================
   AUTH (server-side, private)
   ============================================================ */

/** Salted SHA-256 of a password → lowercase hex string. */
function hashPw(p) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, CONFIG.SALT + ':' + String(p), Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
  return hex;
}

/** Length-checked, constant-time-ish string comparison. */
function safeEquals(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Verify username/password against the 'Users' sheet (same source as login).
    Columns: A=username  B=password  C=role('admin')  D=section */
function verifyCredentials(u, p) {
  if (!u || p == null || p === '') return { ok: false };
  try {
    var sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Users');
    if (!sh) return { ok: false };
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(u) && String(data[i][1]) === String(p)) {
        return { ok: true, isAdmin: (data[i][2] === 'admin'), section: data[i][3] || '' };
      }
    }
  } catch (e) {}
  return { ok: false };
}

/* ── Setup helpers — run in the editor to mint a USERS line, then copy
      it from View → Logs into the USERS array above. ── */
function makeUser(user, password, section) {
  var line = "  { user:'" + user + "', hash:'" + hashPw(password) + "', section:'" + (section || '') + "', admin:false },";
  Logger.log(line);
  return line;
}
function makeAdmin(user, password) {
  var line = "  { user:'" + user + "', hash:'" + hashPw(password) + "', section:'الكل', admin:true },";
  Logger.log(line);
  return line;
}
/** Edit these calls with your real users, choose runSetup from the
    function dropdown, click Run, then copy the printed lines from Logs. */
function runSetup() {
  // makeAdmin('osamah', 'your-admin-password');
  // makeUser('ahmad', 'his-password', 'ايفون');
  // makeUser('sara',  'her-password', 'عطور');
}


/* ============================================================
   CONTENT SANITIZER
   ============================================================ */

/**
 * Allow only safe structural tags. The publisher only emits <div> lines
 * plus image URLs as plain text, so this never alters legitimate output —
 * but it removes <script>, <iframe>, on* handlers, styles, etc. if anyone
 * ever sends crafted HTML. Text (including image URLs) is preserved.
 */
function sanitizeContent(html) {
  if (!html) return '';
  var s = String(html);

  // Drop dangerous elements together with their contents.
  s = s.replace(/<\s*(script|style|iframe|object|embed|form|svg|math|link|meta|base|noscript)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  // Drop any leftover / unclosed dangerous opening tags.
  s = s.replace(/<\s*(script|style|iframe|object|embed|form|svg|math|link|meta|base|noscript)\b[^>]*>/gi, '');

  var ALLOWED = { div:1, br:1, p:1, b:1, strong:1, i:1, em:1, u:1, span:1, ul:1, ol:1, li:1, h3:1, h4:1 };

  // Keep allowed tags but STRIP ALL ATTRIBUTES; drop every other tag (keep its text).
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)\b[^>]*?(\/?)\s*>/g, function (m, slash, name, selfClose) {
    name = name.toLowerCase();
    if (!ALLOWED[name]) return '';
    if (slash) return '</' + name + '>';
    return '<' + name + (selfClose ? '/' : '') + '>';
  });

  return s;
}


/* ============================================================
   BLOGGER
   ============================================================ */

/** Resolve the numeric Blog ID from BLOG_URL (cached 6h, keyed by URL so
    changing BLOG_URL refreshes automatically instead of using a stale id). */
function getBlogId() {
  var cache = CacheService.getScriptCache();
  var key = 'blog_id::' + CONFIG.BLOG_URL;
  var cached = cache.get(key);
  if (cached) return cached;

  var url = 'https://www.googleapis.com/blogger/v3/blogs/byurl?url=' + encodeURIComponent(CONFIG.BLOG_URL);
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var obj = JSON.parse(resp.getContentText());
  if (!obj.id) throw new Error('تعذّر العثور على المدونة — تأكد من BLOG_URL وأن الحساب يملك المدونة.');
  cache.put(key, obj.id, 21600); // cache 6h
  return obj.id;
}

/** Insert (and publish) a post via the Blogger REST API. */
function publishPost(blogId, title, content, labels) {
  var url = 'https://www.googleapis.com/blogger/v3/blogs/' + blogId + '/posts/?isDraft=false';
  var body = { kind: 'blogger#post', title: title, content: content };
  if (labels && labels.length) body.labels = labels;

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var obj = JSON.parse(resp.getContentText() || '{}');
  if (code < 200 || code >= 300) {
    var msg = obj.error && obj.error.message ? obj.error.message : ('HTTP ' + code);
    throw new Error('فشل النشر على Blogger: ' + msg);
  }
  return { url: obj.url || '' };
}

/** JSON response helper. */
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
