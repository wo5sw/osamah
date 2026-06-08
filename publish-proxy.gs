/**
 * ============================================================
 *  Store Bro — Direct Publish API (Google Apps Script)
 * ============================================================
 *
 *  WHAT IT DOES
 *  Receives a product (title + HTML content + category) from the
 *  Store Bro publisher tool, verifies the rep's username/password
 *  against the same credentials page the tool uses, then publishes
 *  the post to your Blogger blog with the category as a label.
 *
 *  It returns JSON:  { "success": true,  "message": "..." }
 *                or  { "success": false, "message": "..." }
 *  — exactly what the tool's publishDirectly() expects.
 *
 *  ── HOW TO DEPLOY (one time, free) ──────────────────────────
 *  1. Go to  https://script.google.com  →  New project.
 *  2. Delete the sample code, paste THIS whole file, click Save 💾.
 *  3. Set your blog address below in CONFIG (BLOG_URL).
 *  4. Click  Deploy ▾  →  New deployment.
 *  5. Gear icon ⚙ → select type "Web app".
 *  6. Settings:
 *        Execute as:        Me (the Google account that OWNS the blog)
 *        Who has access:    Anyone
 *  7. Click Deploy → Authorize access → choose your account → Allow.
 *        (It asks for Blogger permission — this is required to publish.)
 *  8. Copy the "Web app URL" (it ends with /exec).
 *  9. Open store-bro-publisher.html, find:
 *        const APPS_SCRIPT_URL = "...";
 *     and paste your URL between the quotes. Re-upload to Blogger. Done.
 *
 *  TEST after deploy: open  <your /exec url>  in a browser — you should
 *  see  {"success":false,"message":"This endpoint accepts POST only."}
 *  That confirms it is live.
 * ============================================================
 */

/* ────────────── CONFIG — edit these ────────────── */
var CONFIG = {
  // Your blog address (no trailing slash). Used to auto-detect the Blog ID.
  BLOG_URL: 'https://broo1stoor.blogspot.com',

  // The published page that holds the rep credentials (one per line):
  //   username:password:section      ← normal rep
  //   username:AD:password           ← admin (can publish to any category)
  // This is the SAME page your tool's login reads.
  CREDENTIALS_FEED_URL: 'https://broo1stoor.blogspot.com/feeds/pages/default/280206546608680039?alt=json',

  // Set to true to require a valid username/password before publishing.
  // Set to false to skip the check (NOT recommended).
  REQUIRE_AUTH: true
};
/* ─────────────────────────────────────────────────── */


/** GET — just a liveness check so you can confirm the URL works. */
function doGet(e) {
  return json({ success: false, message: 'This endpoint accepts POST only. Deployment is live ✅' });
}

/** POST — the publish entry point called by the tool. */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ success: false, message: 'لا توجد بيانات في الطلب.' });
    }

    var payload = JSON.parse(e.postData.contents);
    var username = (payload.username || '').toString().trim();
    var password = (payload.password || '').toString().trim();
    var title    = (payload.title    || '').toString().trim();
    var content  = (payload.content  || '').toString();
    var category = (payload.category || (Array.isArray(payload.labels) ? payload.labels.join(',') : payload.labels) || '').toString().trim();

    if (!title)   return json({ success: false, message: 'عنوان المنتج مفقود.' });
    if (!content) return json({ success: false, message: 'محتوى المنتج مفقود.' });

    /* 1) Verify credentials (same rules as the tool's login) */
    if (CONFIG.REQUIRE_AUTH) {
      var auth = verifyCredentials(username, password);
      if (!auth.ok) return json({ success: false, message: 'بيانات الدخول غير صحيحة — لا يمكن النشر.' });

      // A normal rep may only publish to their own section.
      if (!auth.isAdmin) {
        category = auth.section; // force the rep's assigned section
      }
    }

    /* 2) Build labels list (category → Blogger label) */
    var labels = [];
    if (category && category !== 'الكل') {
      category.split(/[,،]/).forEach(function (c) {
        c = c.trim();
        if (c) labels.push(c);
      });
    }

    /* 3) Publish to Blogger */
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
   HELPERS
   ============================================================ */

/** Verify username/password against the credentials page feed. */
function verifyCredentials(u, p) {
  if (!u || !p) return { ok: false };
  try {
    var resp = UrlFetchApp.fetch(CONFIG.CREDENTIALS_FEED_URL, { muteHttpExceptions: true });
    var data = JSON.parse(resp.getContentText());
    var rawHtml = data.entry.content.$t;
    var lines = rawHtml.replace(/<[^>]+>/g, '\n').split('\n');

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var parts = line.split(':');

      if (parts.length === 3) {
        if (parts[1] === 'AD') {
          if (parts[0] === u && parts[2] === p) return { ok: true, isAdmin: true, section: 'الكل' };
        } else {
          if (parts[0] === u && parts[1] === p) return { ok: true, isAdmin: false, section: parts[2].trim() };
        }
      } else if (parts.length === 2) {
        if (parts[0] === u && parts[1] === p) return { ok: true, isAdmin: false, section: u };
      }
    }
  } catch (e) { /* fall through to failure */ }
  return { ok: false };
}

/** Resolve the numeric Blog ID from BLOG_URL (cached for speed). */
function getBlogId() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('blog_id');
  if (cached) return cached;

  var url = 'https://www.googleapis.com/blogger/v3/blogs/byurl?url='
          + encodeURIComponent(CONFIG.BLOG_URL);
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var obj = JSON.parse(resp.getContentText());
  if (!obj.id) throw new Error('تعذّر العثور على المدونة — تأكد من BLOG_URL وأن الحساب يملك المدونة.');
  cache.put('blog_id', obj.id, 21600); // cache 6h
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
  return ContentService
    .createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
