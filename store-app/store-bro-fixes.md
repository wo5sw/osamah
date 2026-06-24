# إصلاحات قالب Store Bro — 4 نقاط

طبّقها في **Blogger ← المظهر ← تعديل HTML** (Ctrl+F للبحث عن سطر «قبل» واستبدله بـ «بعد»).
احفظ نسخة احتياطية من القالب أولًا.

---

## 1) (P0) إصلاح الـ regex الذي يُعطّل تحليل المنتجات

**قبل:**
```js
        var sections = rawHTML.replace(/&nbsp;|/gi,' ').split(/(?:\s*(?:<[^>]+>\s*)*[.·•‧⋅·]{5,})/);
```
**بعد:** (حذف الفرع الفارغ `|`)
```js
        var sections = rawHTML.replace(/&nbsp;/gi,' ').split(/(?:\s*(?:<[^>]+>\s*)*[.·•‧⋅·]{5,})/);
```

---

## 2) (P0) إغلاق ثغرة XSS — استخدام DOMParser بدل innerHTML

**قبل:**
```js
        sections.forEach(function(sec, sIdx) {
          var d = document.createElement('div');
          d.innerHTML = sec;
```
**بعد:** (مستند خامل: لا يُحمّل صورًا ولا يُشغّل onerror/سكربت)
```js
        sections.forEach(function(sec, sIdx) {
          var d = new DOMParser().parseFromString(sec, 'text/html');
```
> بقية الدالة (`d.querySelectorAll('img')` …) تعمل كما هي بلا تغيير.

**ملاحظة تشغيلية (ليست في الكود):** قيّد مفتاح `CONFIG.mapsApiKey` بالـ HTTP referrer (نطاقك فقط) من Google Cloud Console، أو جدّده.

---

## 3) (P1) حذف وسم `<title>` المكرّر

**قبل:**
```xml
  <meta content='width=device-width,initial-scale=1.0,viewport-fit=cover' name='viewport'/>
  <title><data:blog.title/></title>
  <meta content='yes' name='apple-mobile-web-app-capable'/>
```
**بعد:** (احذف السطر الثابت؛ كتلة `<b:if>` الشرطية أدناه تبقى المصدر الوحيد للعنوان)
```xml
  <meta content='width=device-width,initial-scale=1.0,viewport-fit=cover' name='viewport'/>
  <meta content='yes' name='apple-mobile-web-app-capable'/>
```

---

## 4) (P1) توحيد هروب القيم في onclick

### أ) أضِف دالة `jsAttr` مباشرةً بعد دالة `escapeHtml`:
**قبل:**
```js
function escapeHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```
**بعد:**
```js
function escapeHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// تضمين قيمة بأمان داخل onclick="...('VALUE')" : هروب JS ثم HTML
function jsAttr(s) {
  return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
```

### ب) استبدل النمط `.replace(/'/g,"\\'")` في 5 مواضع:

| الموضع (الدالة) | قبل | بعد |
|---|---|---|
| renderDrawerSlider | `(img.full||'').replace(/'/g,"\\'")` | `jsAttr(img.full||'')` |
| buildOptionsHTML | `v.color.replace(/'/g,"\\'")` | `jsAttr(v.color)` |
| buildSizePillsHTML | `s.label.replace(/'/g,"\\'")` | `jsAttr(s.label)` |
| renderCartSheet | `escapeHtml(item.imageFull||item.image||'').replace(/'/g,"\\'")` | `jsAttr(item.imageFull||item.image||'')` |
| renderCartBody | `escapeHtml(item.imageFull||item.image||'').replace(/'/g,"\\'")` | `jsAttr(item.imageFull||item.image||'')` |

---

## 5) (P2) معرّف منتج ثابت من رابط التدوينة

### أ) داخل `data.feed.entry.forEach(function(entry) {` بعد سطر `postTitle`:
**قبل:**
```js
        var postTitle = (entry.title && entry.title.$t || '').trim();
```
**بعد:**
```js
        var postTitle = (entry.title && entry.title.$t || '').trim();
        // معرّف ثابت من رابط التدوينة (بديل تسلسلي عند الفشل)
        var _alt = ''; if (entry.link) { for (var _li = 0; _li < entry.link.length; _li++) { if (entry.link[_li].rel === 'alternate') { _alt = entry.link[_li].href || ''; break; } } }
        var pid = _alt ? _alt.replace(/[#?].*$/,'').replace(/\/+$/,'').split('/').pop().replace(/\.html?$/i,'') : '';
        if (!pid) pid = 'p' + gid;
        if (productIndex[pid]) pid = pid + '-' + gid;
        gid++;
```

### ب) غيّر سطر إسناد المعرّف:
**قبل:**
```js
            id: String(gid++),
```
**بعد:**
```js
            id: pid,
```

> ملاحظة: السلة المحفوظة سابقًا (بمعرّفات رقمية) لن تطابق المعرّفات الجديدة — يختفي مؤشّر الكمية على بطاقات تلك العناصر مرة واحدة فقط حتى تُضاف من جديد. السلال الجديدة تعمل وتثبت تمامًا.

---

## بعد التطبيق
احفظ القالب، ثم افتح المتجر في وضع التصفّح الخفي (لتفادي الكاش القديم 5 دقائق) للتأكد.
