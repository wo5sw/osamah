# خادم Store Bro — Apps Script (التوجيه متعدد التجار)

خادم واحد يخدم **أداة التاجر** و**المتجر**. يُرجع رقم واتساب كل قسم من قاعدة البيانات،
فيصل الرقم إلى التدوينة عند النشر، ويوجّه المتجر طلب «اشترِ الآن» لتاجر القسم.

## 1) قاعدة البيانات (Google Sheet)
أنشئ Google Sheet فيه تبويبان (الصف الأول عناوين):

**Users**
| username | password | role | section | merchant | delivery |
|---|---|---|---|---|---|
| admin | ••• | admin | | | |
| tajer1 | ••• | agent | الشيش والمعسلات | 9665XXXXXXXX | خلال ساعة |
| tajer2 | ••• | agent | الشاشات | 9665YYYYYYYY | خلال يوم |

- `role`: `admin` أو `agent`.
- `section`: قسم التاجر (يطابق تسمية/Label التدوينة في Blogger).
- `merchant`: رقم واتساب دولي بأرقام فقط (مثل `9665XXXXXXXX`) — **هذا هو الرقم الذي يستقبل الطلب**.
- `delivery`: مدة التوصيل (اختياري).

**Products** (يُنشئه النظام تلقائيًا عند أول حفظ، أو أنشئه يدويًا)
| id | username | status | title | data | date |
|---|---|---|---|---|---|

> انسخ `SHEET_ID` من رابط الجدول: `.../spreadsheets/d/`**`SHEET_ID`**`/edit`.

## 2) النشر (Deploy)
1. [script.google.com](https://script.google.com) ← مشروع جديد.
2. الصق `code.gs`، واضبط في الأعلى: `SHEET_ID` و`BLOG_ID` (رقم مدوّنة المتجر).
3. (اختياري) فعّل عرض ملف الإعداد: ⚙️ Project Settings ← «Show appsscript.json» ثم الصق محتوى `appsscript.json`.
4. **Deploy ← New deployment ← Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. وافق على الصلاحيات (Sheets/Drive/Blogger). حساب النشر **يجب أن يملك المدوّنة**.
6. انسخ رابط `/exec`.

## 3) الربط في القالبين
في **store-bro.blogger.xml** و**store-workspace.xml** اجعل الرابطين يشيران لنفس النشر:
```js
var APPS_SCRIPT_URL = "https://script.google.com/macros/s/XXXX/exec";
var DB_SCRIPT_URL   = "https://script.google.com/macros/s/XXXX/exec";
```
وفي **store-bro.blogger.xml** اضبط داخل `CONFIG` نفس الرابط ليقرأ المتجر أرقام الأقسام لحظيًا:
```js
dbScriptUrl: "https://script.google.com/macros/s/XXXX/exec",
```

## 4) كيف يعمل التوجيه (لحظيًا من القاعدة)
```
Users: section + merchant (رقم القسم في قاعدة البيانات)
   └─ getPublicSections (بدون تسجيل دخول) يُرجع خريطة: قسم → رقم
        └─ المتجر يجلبها عند فتحه ويكتب الرقم الحالي فوق كل منتج حسب قسمه
             └─ زر «اشترِ الآن» يفتح wa.me/<رقم تاجر القسم الحالي>
```
- غيّر رقم أي تاجر في `Users` → يسري فورًا على كل منتجات قسمه **بدون إعادة نشر**.
- ترتيب التوجيه: الرقم الحيّ من القاعدة ← الرقم المثبّت بالمنتج وقت النشر ← `CONFIG.whatsapp`.
- الأرقام ظاهرة للعملاء أصلًا (يراسلونها)، لذا عرضها عبر `getPublicSections` آمن.

## الأمان
- الدور والقسم والرقم تُشتقّ من **التحقق من كلمة المرور** فقط؛ `isAdmin` القادم من العميل يُتجاهَل.
- غير المدير: يرى/يحذف سجلاته فقط، ويُحفظ منتجه «مسودة» فقط، ولا يستطيع النشر.
- ▶ يُنصح بتخزين كلمات المرور كـ SHA-256 (فعّل `verifyPassword` المجزّأة).
