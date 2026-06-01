/**
 * ============================================================
 *  Store Bro — Product Link Enrichment Proxy (Google Apps Script)
 * ============================================================
 *
 *  WHAT IT DOES
 *  Fetches a product page (e.g. Amazon) server-side from Google's servers
 *  and returns its title, images and feature bullets as JSON. The store
 *  template calls this so a Blogger post needs only a product LINK + a
 *  manual price. (The price you type in the post always wins — this
 *  script never sends a price.)
 *
 *  ── HOW TO DEPLOY (one time, free) ──────────────────────────
 *  1. Go to  https://script.google.com  →  New project.
 *  2. Delete the sample code, paste THIS whole file, click Save.
 *  3. Click  Deploy ▾  →  New deployment.
 *  4. Gear icon ⚙ → select type "Web app".
 *  5. Settings:
 *        Execute as:        Me (your account)
 *        Who has access:    Anyone
 *  6. Click Deploy → Authorize access → allow.
 *  7. Copy the "Web app URL" (it ends with /exec).
 *  8. Open template.xml, find  enrichApiUrl: ''  inside CONFIG and paste
 *     the URL between the quotes, e.g.
 *        enrichApiUrl: 'https://script.google.com/macros/s/AKfy..../exec'
 *  9. Re-upload the template to Blogger. Done.
 *
 *  TEST: open  <your /exec url>?url=https://amzn.eu/d/008ECZ0Q  in a browser.
 *  You should see JSON with "title", "images" and "description".
 *
 *  NOTE: Amazon may occasionally block automated requests. If a product
 *  returns no images, the store simply keeps the placeholder — paste an
 *  image manually for that one post.
 * ============================================================
 */

function doGet(e) {
  var url = (e && e.parameter && e.parameter.url) || '';
  var out = { ok: false, title: '', images: [], description: [] };
  try {
    if (!url) throw new Error('missing url parameter');
    var resp = UrlFetchApp.fetch(url, {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
      }
    });
    var html = resp.getContentText();
    out = parseProduct(html);
    out.ok = true;
  } catch (err) {
    out.ok = false;
    out.error = String(err);
  }
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseProduct(html) {
  var res = { title: '', images: [], description: [] };

  /* ---- TITLE ---- */
  var m = html.match(/<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/i);
  if (m) res.title = clean(m[1]);
  if (!res.title) {
    var og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (og) res.title = clean(og[1]);
  }

  /* ---- IMAGES ---- */
  var seen = {}, imgs = [];
  function add(u) {
    if (!u) return;
    u = u.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
    if (u.indexOf('media-amazon.com/images/I/') < 0 && u.indexOf('images-amazon.com/images/I/') < 0) return;
    if (/sprite|icon|grey-pixel|transparent-pixel/i.test(u)) return;
    var idm = u.match(/\/images\/I\/([^.\/]+)/);
    var id = idm ? idm[1] : u;
    if (seen[id]) return;
    seen[id] = true;
    var base = u.replace(/\._[A-Z0-9,_]+_\.(jpg|jpeg|png|webp)/i, '.$1');
    imgs.push(base);
  }
  var re, x;
  re = /"hiRes":"(https:[^"]+?)"/g;        while ((x = re.exec(html))) add(x[1]);
  re = /"large":"(https:[^"]+?)"/g;        while ((x = re.exec(html))) add(x[1]);
  re = /"mainUrl":"(https:[^"]+?)"/g;       while ((x = re.exec(html))) add(x[1]);
  // data-a-dynamic-image="{ "url":[w,h], ... }"
  re = /data-a-dynamic-image=["'](\{[^"']+\})["']/g;
  while ((x = re.exec(html))) {
    var j = x[1].replace(/&quot;/g, '"');
    var rr = /(https:[^"]+?)":\s*\[/g, y;
    while ((y = rr.exec(j))) add(y[1]);
  }
  if (!imgs.length) {
    var ogi = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogi) add(ogi[1]);
  }
  res.images = imgs.slice(0, 8);

  /* ---- DESCRIPTION (feature bullets) ---- */
  var fb = html.match(/id="feature-bullets"[\s\S]*?<\/ul>/i);
  if (fb) {
    var lis = fb[0].match(/<span[^>]*class="a-list-item"[^>]*>([\s\S]*?)<\/span>/gi) || [];
    lis.forEach(function (li) {
      var t = clean(li);
      if (t && t.length > 1 && res.description.indexOf(t) < 0) res.description.push(t);
    });
  }
  if (!res.description.length) {
    var ogd = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    if (ogd) res.description.push(clean(ogd[1]));
  }

  return res;
}

function clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}
