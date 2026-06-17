# تطبيق أندرويد لنظام الطابور (Capacitor)

تغليف موقع **نظام الطابور** (`queue-system.xml` المرفوع على Blogger) داخل تطبيق
أندرويد أصلي، مع **تتبّع الموقع في الخلفية** عبر خدمة تعمل في المقدّمة
(foreground service). الهدف: حصول المندوب على رقم في الطابور تلقائياً عند وصوله
للموقع **حتى لو كان التطبيق مغلقاً أو في الخلفية أو الشاشة مقفلة** — دون إبقائه
مفتوحاً.

> ⚠️ ملاحظتان مهمّتان قبل البدء:
> 1. **لم يُبنَ ملف APK جاهز** هنا؛ هذا مشروع مصدري تبنيه بنفسك (أو مطوّر) عبر
>    Android Studio.
> 2. كود الجسر داخل القالب **لم يُختبر على جهاز فعلي** من جهتي. هو محميّ بحيث لا
>    يؤثر على نسخة الويب إطلاقاً، لكن قد يحتاج ضبطاً بسيطاً عند أول تجربة.

---

## كيف يعمل

- التطبيق يفتح موقعك مباشرة (الرابط في `capacitor.config.json` → `server.url`)،
  فيبقى المنطق والتحديثات في مكان واحد (Blogger).
- إضافة `@capacitor-community/background-geolocation` تُشغّل **خدمة في المقدّمة**
  بإشعار ثابت، فتبقى عملية التطبيق حيّة → يستمر اتصال MQTT ومنطق الطابور في العمل
  بالخلفية.
- داخل `queue-system.xml` يوجد جسر `startNativeBackgroundTracking()` يعمل **فقط**
  داخل التطبيق الأصلي (`window.Capacitor` موجود)، ويمرّر إحداثيات الخلفية إلى نفس
  دوال المسافة/الانضمام الحالية. في المتصفح العادي لا يعمل هذا الجسر نهائياً.

---

## المتطلبات

- [Node.js](https://nodejs.org/) (نسخة 18 أو أحدث)
- [Android Studio](https://developer.android.com/studio) + JDK 17
- جهاز أندرويد للتجربة (محاكي GPS غير موثوق لاختبار الخلفية)

---

## خطوات البناء

```bash
cd android-app

# 1) عدّل الإعدادات: ضع رابط مدونتك ومعرّف التطبيق
#    capacitor.config.json -> server.url = "https://اسم-مدونتك.blogspot.com"
#    capacitor.config.json -> appId      = "com.شركتك.queue"  (اختياري)

# 2) ثبّت الحزم
npm install

# 3) أنشئ مشروع أندرويد الأصلي
npx cap add android

# 4) طبّق صلاحيات AndroidManifest (انظر القسم التالي)

# 5) زامن الإعدادات والإضافات
npx cap sync android

# 6) افتح في Android Studio لبناء الـ APK
npx cap open android
#    ثم في Android Studio:  Build  ▸  Build Bundle(s) / APK(s)  ▸  Build APK(s)
```

ملف الـ APK الناتج يكون عادة في:
`android-app/android/app/build/outputs/apk/debug/app-debug.apk`

---

## صلاحيات AndroidManifest.xml

بعد `npx cap add android`، افتح
`android-app/android/app/src/main/AndroidManifest.xml` وأضف **داخل وسم
`<manifest>` وقبل `<application>`**:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<!-- الظهور فوق التطبيقات (overlay) -->
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
```

> إضافة `background-geolocation` تُسجّل خدمة الموقع في الـ Manifest تلقائياً. إن لم
> تظهر، راجع توثيق الإضافة:
> https://github.com/capacitor-community/background-geolocation

---

## شروط التشغيل على جهاز المندوب (مهم جداً للموثوقية)

أندرويد يقتل العمليات في الخلفية بقوة. لكي يعمل التتبّع بثبات، على المندوب:

1. عند أول تشغيل: منح صلاحية الموقع واختيار **«السماح طوال الوقت» (Allow all the
   time)** — وليس «أثناء الاستخدام فقط».
2. السماح بالإشعارات (أندرويد 13+).
3. **إيقاف تحسين البطارية** للتطبيق: الإعدادات ▸ التطبيقات ▸ Queue System ▸
   البطارية ▸ **غير مقيّد (Unrestricted)**.
4. على أجهزة Xiaomi/Huawei/Oppo/Samsung: تفعيل **التشغيل التلقائي (Autostart)**
   وتثبيت التطبيق في قائمة المهام حتى لا يُغلق.

---

## «الظهور فوق التطبيقات» / التنبيه عند الدور

- صلاحية `SYSTEM_ALERT_WINDOW` مُضافة أعلاه.
- للتنبيه عند أن يصبح المندوب **رقم 1** بحيث يظهر فوق أي تطبيق آخر، الطريقة العملية
  هي **إشعار بأولوية عالية / ملء الشاشة** (heads-up / full-screen intent) عبر
  `@capacitor/local-notifications`. هذا يظهر فوق التطبيقات دون الحاجة لنافذة عائمة
  مخصّصة.
- نافذة عائمة مخصّصة (overlay مستمر) تحتاج كوداً أصلياً إضافياً (خدمة overlay)؛
  أخبرني إن أردتها فأكتب لك الجزء الأصلي.

---

## قائمة اختبار بعد البناء

- [ ] افتح التطبيق وسجّل دخول مندوب تجريبي → يظهر إشعار «نظام الطابور يعمل».
- [ ] اقترب من الموقع (≤100م) والتطبيق **في المقدّمة** → يحصل على رقم.
- [ ] صغّر التطبيق (واتساب مثلاً) أو اقفل الشاشة، ثم اقترب من الموقع → يجب أن
      يحصل على رقم خلال دقيقة دون فتح التطبيق.
- [ ] من لوحة المشرف: «تسليم الطلب» → يصل التنبيه للمندوب.

---

## ملاحظات وقيود بصراحة

- **iOS غير مشمول** هنا (طلبك كان أندرويد). تتبّع iOS في الخلفية أصعب وله قيود
  أشد من Apple.
- موثوقية الخلفية تختلف بين الشركات المصنّعة بسبب «قاتلات البطارية»؛ خطوات
  التشغيل أعلاه ضرورية.
- أرقام إصدارات Capacitor/الإضافة في `package.json` قد تحتاج تحديثاً وقت البناء؛
  إن ظهر خطأ توافق، شغّل `npm install @capacitor/core@latest` وأخواتها وراجع
  توثيق الإضافة.
- الجسر يعيد استخدام منطق الموقع الموجود ومؤقّت الانتظار **5 دقائق** نفسه.
