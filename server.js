const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('.'));

// =================================================================
// ===== Supabase Setup =====
// =================================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'certificates';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

function mapRowToCertificate(row) {
  if (!row) return null;
  const certification = row.certification || {};
  return {
    id: row.id,
    registrationNumber: row.registration_number,
    studentName: row.student_name,
    studentCategory: row.student_category,
    studentCenter: row.student_center,
    image: row.image_url || null,
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
    ...certification
  };
}

function parseImageData(image) {
  if (!image || typeof image !== 'string') return null;

  // data:image/png;base64,...
  const dataUrlMatch = image.match(/^data:(.+);base64,(.*)$/);
  if (dataUrlMatch) {
    return {
      mime: dataUrlMatch[1],
      base64: dataUrlMatch[2]
    };
  }

  // raw base64 fallback (assume png)
  return { mime: 'image/png', base64: image };
}

function getExtensionFromMime(mime) {
  if (!mime) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

// حفظ شهادة جديدة أو تحديثها
app.post('/api/certificates/save', async (req, res) => {
  try {
    const {
      registrationNumber,
      studentName,
      studentCategory,
      studentCenter,
      certification,
      image,
      id
    } = req.body;

    if (!registrationNumber || !studentName || !studentCategory) {
      return res.status(400).json({ error: 'بيانات ناقصة - يجب تحديد رقم القيد والاسم والفئة' });
    }

    const certId = id || Date.now().toString();
    const now = new Date().toISOString();
    const certPayload = certification && typeof certification === 'object' ? certification : {};

    // Fetch existing for saved_at/image_path if needed
    const { data: existingRow } = await supabase
      .from('certificates')
      .select('id, image_path, image_url, saved_at')
      .eq('id', certId)
      .maybeSingle();

    let imagePath = existingRow?.image_path || null;
    let imageUrl = existingRow?.image_url || null;

    // Upload image to Supabase Storage if provided
    const parsedImage = parseImageData(image);
    if (parsedImage) {
      const ext = getExtensionFromMime(parsedImage.mime);
      imagePath = `${certId}.${ext}`;

      const uploadResult = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(imagePath, Buffer.from(parsedImage.base64, 'base64'), {
          contentType: parsedImage.mime || 'image/png',
          upsert: true
        });

      if (uploadResult.error) {
        console.error('Storage upload error:', uploadResult.error);
        return res.status(500).json({ error: 'خطأ في رفع صورة الشهادة' });
      }

      const publicUrl = supabase.storage
        .from(SUPABASE_BUCKET)
        .getPublicUrl(imagePath);
      imageUrl = publicUrl?.data?.publicUrl || null;
    }

    const row = {
      id: certId,
      registration_number: registrationNumber,
      student_name: studentName,
      student_category: studentCategory,
      student_center: studentCenter || certPayload.studentCenter || null,
      certification: certPayload,
      image_path: imagePath,
      image_url: imageUrl,
      saved_at: existingRow?.saved_at || now,
      updated_at: now
    };

    const { data, error } = await supabase
      .from('certificates')
      .upsert(row, { onConflict: 'id' })
      .select()
      .maybeSingle();

    if (error) {
      console.error('Supabase upsert error:', error);
      return res.status(500).json({ error: 'خطأ في حفظ الشهادة' });
    }

    const certificate = mapRowToCertificate(data || row);

    console.log(`✅ تم حفظ/تحديث الشهادة: ${certId}`);

    res.json({
      success: true,
      message: 'تم حفظ الشهادة بنجاح',
      id: certId,
      certificate
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في حفظ الشهادة' });
  }
});

// جلب قائمة الشهادات
app.get('/api/certificates/list', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('certificates')
      .select('id,registration_number,student_name,student_category,student_center,certification,image_url,saved_at,updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Supabase list error:', error);
      return res.status(500).json({ error: 'خطأ في جلب الشهادات' });
    }

    const certificates = (data || []).map(mapRowToCertificate);
    res.json(certificates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب الشهادات' });
  }
});

// جلب شهادة محددة
app.get('/api/certificates/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('certificates')
      .select('id,registration_number,student_name,student_category,student_center,certification,image_url,saved_at,updated_at')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) {
      console.error('Supabase get error:', error);
      return res.status(500).json({ error: 'خطأ في جلب الشهادة' });
    }

    if (data) {
      res.json(mapRowToCertificate(data));
    } else {
      res.status(404).json({ error: 'الشهادة غير موجودة' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في جلب الشهادة' });
  }
});

// تحميل صورة الشهادة
app.get('/api/certificates/image/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('certificates')
      .select('image_path')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) {
      console.error('Supabase image lookup error:', error);
      return res.status(500).json({ error: 'خطأ في تحميل الصورة' });
    }

    if (!data || !data.image_path) {
      return res.status(404).json({ error: 'الصورة غير موجودة' });
    }

    const downloadResult = await supabase.storage
      .from(SUPABASE_BUCKET)
      .download(data.image_path);

    if (downloadResult.error) {
      console.error('Storage download error:', downloadResult.error);
      return res.status(500).json({ error: 'خطأ في تحميل الصورة' });
    }

    const blob = downloadResult.data;
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = blob.type || 'image/png';
    const ext = data.image_path.split('.').pop() || 'png';

    res.setHeader('Content-Type', contentType);
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="certificate_${req.params.id}.${ext}"`);
    }
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في تحميل الصورة' });
  }
});

// البحث عن شهادة برقم القيد
app.get('/api/certificates/search/byRegNumber/:regNum', async (req, res) => {
  try {
    const regNum = req.params.regNum;
    const { data, error } = await supabase
      .from('certificates')
      .select('id,registration_number,student_name,student_category,student_center,certification,image_url,saved_at,updated_at')
      .eq('registration_number', regNum)
      .maybeSingle();

    if (error) {
      console.error('Supabase search error:', error);
      return res.status(500).json({ error: 'خطأ في البحث عن الشهادة' });
    }

    if (data) {
      res.json(mapRowToCertificate(data));
    } else {
      res.status(404).json({ error: 'الشهادة غير موجودة' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في البحث عن الشهادة' });
  }
});

// حذف شهادة
app.delete('/api/certificates/:id', async (req, res) => {
  try {
    const { data: existing, error: lookupError } = await supabase
      .from('certificates')
      .select('image_path')
      .eq('id', req.params.id)
      .maybeSingle();

    if (lookupError) {
      console.error('Supabase lookup error:', lookupError);
      return res.status(500).json({ error: 'خطأ في حذف الشهادة' });
    }

    if (!existing) {
      return res.status(404).json({ error: 'الشهادة غير موجودة' });
    }

    if (existing.image_path) {
      await supabase.storage.from(SUPABASE_BUCKET).remove([existing.image_path]);
    }

    const { error } = await supabase
      .from('certificates')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      console.error('Supabase delete error:', error);
      return res.status(500).json({ error: 'خطأ في حذف الشهادة' });
    }

    res.json({ success: true, message: 'تم حذف الشهادة بنجاح' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في حذف الشهادة' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎓 خادم الشهادات يعمل على المنفذ ${PORT}`);
});
