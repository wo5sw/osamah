/**
 * ============================================================
 *  Store Bro — Cloud DB (Apps Script) — HARDENED
 *  Backs DB_SCRIPT_URL. Talks to two sheets: 'Users' and 'Posts'.
 *
 *  Users sheet columns:  A=username  B=password  C=role('admin')  D=section
 *  Posts sheet columns:  A=id  B=author  C=status  D=title  E=jsonData  F=timestamp
 *
 *  SECURITY MODEL
 *  Every data action (saveProduct / getUserWorkspace / deleteProduct)
 *  re-verifies username+password against the Users sheet and derives
 *  isAdmin/section FROM THE SERVER. The client's `isAdmin` field is
 *  ignored. Non-admins can only read / modify / delete their OWN rows.
 *
 *  Deploy: after editing, Deploy ▸ Manage deployments ▸ edit the
 *  existing one ▸ Version: New version ▸ Deploy (keeps the same URL).
 * ============================================================ */

/** Re-check credentials against the Users sheet. Returns the server's
    view of the caller — never trust anything role-related from the client. */
function verifyUser(usersSheet, params) {
  if (!usersSheet || !params || !params.username || params.password == null) return { ok: false };
  var data = usersSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == params.username && data[i][1] == params.password) {
      return { ok: true, name: data[i][0], isAdmin: (data[i][2] === 'admin'), section: data[i][3] || '' };
    }
  }
  return { ok: false };
}

function doPost(e) {
  var response = { success: false, message: 'إجراء غير معروف' };

  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var usersSheet = ss.getSheetByName('Users');
    var postsSheet = ss.getSheetByName('Posts');

    // 1. نظام تسجيل الدخول
    if (action === 'login') {
      var data = usersSheet.getDataRange().getValues();
      var found = false;
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] == params.username && data[i][1] == params.password) {
          response = {
            success: true,
            user: {
              name: data[i][0],
              isAdmin: (data[i][2] === 'admin'),
              section: data[i][3] || '',
              merchant: (data[i][4] || '').toString().replace(/[^0-9]/g, ''),
              delivery: data[i][5] || ''
            }
          };
          found = true;
          break;
        }
      }
      if (!found) response.message = 'بيانات الدخول غير صحيحة';
    }

    // 1.5 إعدادات الأقسام: رقم التاجر (E) + مدة التوصيل (F) لكل قسم من جدول Users
    else if (action === 'getSections') {
      var auth = verifyUser(usersSheet, params);
      if (!auth.ok) {
        response = { success: false, message: 'غير مصرّح — سجّل الدخول من جديد' };
      } else {
        var u = usersSheet.getDataRange().getValues();
        var sections = {};
        for (var i = 1; i < u.length; i++) {
          var sec = (u[i][3] || '').toString().trim();
          if (!sec) continue;
          sections[sec] = {
            merchant: (u[i][4] || '').toString().replace(/[^0-9]/g, ''),
            delivery: (u[i][5] || '').toString().trim()
          };
        }
        response = { success: true, sections: sections };
      }
    }

    // 2. حفظ منتج (مسودة أو تحديث) — يتطلب تحقق + ملكية
    else if (action === 'saveProduct') {
      var auth = verifyUser(usersSheet, params);
      if (!auth.ok) {
        response = { success: false, message: 'غير مصرّح — سجّل الدخول من جديد' };
      } else {
        var author = auth.name;                 // المؤلف = المستخدم المتحقق منه (يمنع الانتحال)
        var data = postsSheet.getDataRange().getValues();
        var timestamp = new Date().toISOString();
        var handled = false;

        for (var i = 1; i < data.length; i++) {
          if (data[i][0] == params.id) {
            // مندوب عادي لا يعدّل إلا صفوفه؛ المدير يعدّل أي صف
            if (!auth.isAdmin && data[i][1] != author) {
              response = { success: false, message: 'لا تملك صلاحية تعديل هذا المنتج' };
            } else {
              postsSheet.getRange(i + 1, 2, 1, 5).setValues([[
                author,
                params.status,
                params.title,
                JSON.stringify(params.jsonData),
                timestamp
              ]]);
              response = { success: true, message: 'تم الحفظ بنجاح' };
            }
            handled = true;
            break;
          }
        }

        if (!handled) {
          postsSheet.appendRow([
            params.id,
            author,
            params.status,
            params.title,
            JSON.stringify(params.jsonData),
            timestamp
          ]);
          response = { success: true, message: 'تم الحفظ بنجاح' };
        }
      }
    }

    // 3. جلب بيانات المستخدم — يتطلب تحقق؛ المندوب يرى صفوفه فقط
    else if (action === 'getUserWorkspace') {
      var auth = verifyUser(usersSheet, params);
      if (!auth.ok) {
        response = { success: false, message: 'غير مصرّح — سجّل الدخول من جديد' };
      } else {
        var data = postsSheet.getDataRange().getValues();
        var userDrafts = [];
        var userPublished = [];

        for (var i = 1; i < data.length; i++) {
          // المدير يرى الكل؛ غيره يرى صفوفه فقط (الصلاحية من الخادم لا من العميل)
          if (auth.isAdmin || data[i][1] == auth.name) {
            var productObj = {
              id: data[i][0],
              author: data[i][1],
              status: data[i][2],
              title: data[i][3],
              data: JSON.parse(data[i][4]),
              date: data[i][5]
            };

            if (data[i][2] === 'draft') {
              userDrafts.push(productObj);
            } else {
              userPublished.push(productObj);
            }
          }
        }

        response = {
          success: true,
          drafts: userDrafts,
          history: userPublished
        };
      }
    }

    // 4. حذف منتج — يتطلب تحقق؛ المندوب يحذف صفوفه فقط
    else if (action === 'deleteProduct') {
      var auth = verifyUser(usersSheet, params);
      if (!auth.ok) {
        response = { success: false, message: 'غير مصرّح — سجّل الدخول من جديد' };
      } else {
        var data = postsSheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (data[i][0] == params.id) {
            if (auth.isAdmin || data[i][1] == auth.name) {
              postsSheet.deleteRow(i + 1);
              response = { success: true, message: 'تم الحذف بنجاح' };
            } else {
              response = { success: false, message: 'لا تملك صلاحية الحذف' };
            }
            break;
          }
        }
      }
    }

  } catch (error) {
    response = { success: false, message: error.message };
  }

  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}
