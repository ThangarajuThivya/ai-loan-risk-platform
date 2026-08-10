-- Migration 051: seed the approved dealer and valuer registers (L17).
--
-- 044 created both registers and left them empty, on the reasonable
-- assumption that an admin would curate them. No admin screen was ever
-- built, so nothing could put a row in either table, and the consequence was
-- silent rather than loud: the dealer dropdown on the lease application and
-- the valuer dropdown on the review queue simply rendered EMPTY. Every lease
-- processed so far therefore went through as "a private seller" with an
-- unassigned valuer — not a choice anyone made, just the only reachable
-- state. L17 adds the admin screens; this gives them something to show.
--
-- ON THE NAMES BELOW: these are invented firms, not real Sri Lankan
-- dealerships. Seeding a recognisable company's name next to a fabricated
-- bank account number would create a record that reads as genuine and is
-- not, which is a bad thing to have sitting in a database regardless of
-- intent. The names follow local naming conventions so the demo reads
-- correctly; the account numbers are obviously-fake sequences.
--
-- ONE DEALER IS DELIBERATELY LEFT UNBANKED. "Ruhunu Auto Traders" has no
-- account details, which makes it unpayable under supplierIsPayable() and
-- gives the admin register's readiness warning something real to report.
-- A seed set where everything is already correct cannot demonstrate the one
-- check that stops money going nowhere.
--
-- Idempotent: both tables carry UNIQUE keys on the identifying columns
-- (uq_lease_suppliers_name, uq_lease_valuers_name_license), so INSERT IGNORE
-- makes a re-run a no-op. Additive only.

USE ai_loan;

-- ---------------------------------------------------------------------------
-- Approved dealers.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO lease_suppliers
  (name, business_reg_no, contact_person, phone, email, address,
   bank_name, bank_branch, bank_account_no, account_holder, status)
VALUES
  ('Sandaru Motor Company (Pvt) Ltd', 'PV-84213', 'Dilan Wickramasinghe',
   '0112345601', 'sales@sandarumotors.lk',
   'No. 214, Nawala Road, Rajagiriya',
   'Bank of Ceylon', 'Rajagiriya', '0000110022334', 'Sandaru Motor Company (Pvt) Ltd', 'active'),

  ('Lakvin Auto Lanka (Pvt) Ltd', 'PV-91755', 'Nadeesha Fernando',
   '0112345602', 'info@lakvinauto.lk',
   'No. 55, Kandy Road, Kiribathgoda',
   'Commercial Bank of Ceylon', 'Kiribathgoda', '0000220033445', 'Lakvin Auto Lanka (Pvt) Ltd', 'active'),

  ('Nuwara Vehicle Traders', 'W-33018', 'Mohamed Rizwan',
   '0812345603', 'contact@nuwaravehicles.lk',
   'No. 8, Peradeniya Road, Kandy',
   'Hatton National Bank', 'Kandy', '0000330044556', 'Nuwara Vehicle Traders', 'active'),

  ('Southern Lanka Motors (Pvt) Ltd', 'PV-70642', 'Chamari Jayasuriya',
   '0912345604', 'sales@southernlankamotors.lk',
   'No. 132, Wakwella Road, Galle',
   'Sampath Bank', 'Galle', '0000440055667', 'Southern Lanka Motors (Pvt) Ltd', 'active'),

  -- Intentionally unbanked — see the header note.
  ('Ruhunu Auto Traders', 'W-45119', 'Sunil Perera',
   '0472345605', 'ruhunuautotraders@gmail.com',
   'No. 21, Tissa Road, Hambantota',
   NULL, NULL, NULL, NULL, 'active');

-- ---------------------------------------------------------------------------
-- Approved valuers.
--
-- Licence numbers follow the shape used by the Institute of Valuers of Sri
-- Lanka registrations (IVSL/<year>/<serial>) so the field is obviously a
-- licence and not a free-text note, which is the whole point of it being
-- separate from the name.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO lease_valuers (name, license_no, phone, email, status)
VALUES
  ('K. A. Sriyani Gunawardena', 'IVSL/2016/1184', '0771234501', 'sriyani.valuations@gmail.com', 'active'),
  ('M. T. Anuradha Silva',      'IVSL/2013/0872', '0771234502', 'anuradha.silva.fiv@gmail.com', 'active'),
  ('P. Ravindra Bandara',       'IVSL/2019/1550', '0771234503', 'ravindra.bandara.valuer@gmail.com', 'active'),
  ('S. Fathima Nazreen',        'IVSL/2021/1803', '0771234504', 'fnazreen.valuations@gmail.com', 'active');
