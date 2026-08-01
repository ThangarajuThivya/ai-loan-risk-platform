-- Migration 013: Sinhala/Tamil text for the seeded loan products (003).
-- Idempotent — matches on the English `name`, and only fills columns that are
-- still NULL, so re-running never clobbers a translation someone edited by
-- hand in the admin UI.
--
-- Scope is deliberately the seed catalogue only. Products created later
-- through the admin UI get their translations there; until then they COALESCE
-- back to English per field, which is the intended degradation.
--
-- Translations are LLM-assisted and have NOT been reviewed by a native
-- Sinhala or Tamil speaker — same caveat as the frontend's si.json/ta.json
-- `_meta` key. Verify before any real-world use.

USE ai_loan;

UPDATE loan_products SET
  name_si        = COALESCE(name_si,        'පුද්ගලික ණය'),
  name_ta        = COALESCE(name_ta,        'தனிநபர் கடன்'),
  description_si = COALESCE(description_si, 'සාමාන්‍ය අවශ්‍යතා සඳහා ඇපකරයකින් තොර පුද්ගලික ණයක්.'),
  description_ta = COALESCE(description_ta, 'பொதுவான தேவைகளுக்கான பிணையற்ற தனிநபர் கடன்.')
WHERE name = 'Personal Loan';

UPDATE loan_products SET
  name_si        = COALESCE(name_si,        'නිවාස ණය'),
  name_ta        = COALESCE(name_ta,        'வீட்டுக் கடன்'),
  description_si = COALESCE(description_si, 'නිවසක් මිලදී ගැනීම, ඉදිකිරීම හෝ අලුත්වැඩියා කිරීම සඳහා දිගුකාලීන ණයක්.'),
  description_ta = COALESCE(description_ta, 'வீடு வாங்க, கட்ட அல்லது புதுப்பிக்க நீண்டகால கடன்.')
WHERE name = 'Housing Loan';

UPDATE loan_products SET
  name_si        = COALESCE(name_si,        'වාහන කල්බදු'),
  name_ta        = COALESCE(name_ta,        'வாகனக் குத்தகை'),
  description_si = COALESCE(description_si, 'මූලික ගෙවීමක් සහ ස්ථාවර අනුපාත වාරිකයක් සහිත වාහන මූල්‍ය කල්බදු.'),
  description_ta = COALESCE(description_ta, 'முன்பணம் மற்றும் நிலையான விகித EMI உடன் கூடிய வாகன நிதிக் குத்தகை.')
WHERE name = 'Vehicle Leasing';

UPDATE loan_products SET
  name_si        = COALESCE(name_si,        'අධ්‍යාපන ණය'),
  name_ta        = COALESCE(name_ta,        'கல்விக் கடன்'),
  description_si = COALESCE(description_si, 'දේශීය හෝ විදේශීය උසස් අධ්‍යාපන ගාස්තු සහ වියදම් සඳහා ණයක්.'),
  description_ta = COALESCE(description_ta, 'உள்நாட்டு அல்லது வெளிநாட்டு உயர்கல்விக் கட்டணம் மற்றும் செலவுகளுக்கான கடன்.')
WHERE name = 'Education Loan';

UPDATE loan_products SET
  name_si        = COALESCE(name_si,        'ව්‍යාපාරික ණය'),
  name_ta        = COALESCE(name_ta,        'வணிகக் கடன்'),
  description_si = COALESCE(description_si, 'ලියාපදිංචි කුඩා හා මධ්‍ය පරිමාණ ව්‍යාපාර සඳහා ක්‍රියාකාරී ප්‍රාග්ධන හෝ ව්‍යාප්ති ණයක්.'),
  description_ta = COALESCE(description_ta, 'பதிவுசெய்யப்பட்ட சிறு மற்றும் நடுத்தர நிறுவனங்களுக்கான நடைமுறை மூலதன அல்லது விரிவாக்கக் கடன்.')
WHERE name = 'Business Loan';

UPDATE loan_products SET
  name_si        = COALESCE(name_si,        'උකස්'),
  name_ta        = COALESCE(name_ta,        'அடகு'),
  description_si = COALESCE(description_si, 'රන් ආභරණ ඇපයට තබා ලබා දෙන කෙටිකාලීන ණයක්.'),
  description_ta = COALESCE(description_ta, 'தங்க நகைகளை அடமானமாக வைத்து வழங்கப்படும் குறுகியகால கடன்.')
WHERE name = 'Pawning';
