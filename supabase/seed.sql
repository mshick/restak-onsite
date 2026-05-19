-- Accounts + policies from docs/accounts.csv and docs/policies.csv.
-- Documents and reconciliation_items are seeded by scripts/seed-documents.mjs
-- (chained off `pnpm db:reset`) because they need to insert PDF binary blobs.

-- accounts -------------------------------------------------------------------

insert into public.accounts (account_id, account_name, contact_name, contact_email, contact_phone, street, city, state, zip) values
  ('ACC-10042', 'Greenfield Properties LLC',          'Margaret Chen',                          'm.chen@greenfieldprop.com',         '(512) 555-0147', '4200 West Lake Blvd, Suite 300',  'Austin',   'TX', '78746'),
  ('ACC-10078', 'Dr. James Whitfield, DDS',            'James Whitfield',                        'jwhitfield@whitfielddentalgroup.com','(303) 555-0291', '1887 Pearl Street',               'Boulder',  'CO', '80302'),
  ('ACC-10103', 'Summit Ridge Contractors Inc',        'Roberto Alejandro Gutierrez-Medina',     'roberto@summitridgegc.com',         '(404) 555-0183', '920 Peachtree Industrial Blvd',   'Atlanta',  'GA', '30309'),
  ('ACC-10155', 'Coastal Veterinary Associates',       'Patricia O''Brien-Walsh',                'pob@coastalvetassoc.com',           '(619) 555-0334', '7650 Girard Avenue',              'La Jolla', 'CA', '92037'),
  ('ACC-10201', 'Nakamura & Patel Law Group PLLC',     'Yuki Nakamura',                          'ynakamura@nplawgroup.com',          '(206) 555-0412', '1201 Third Avenue, Floor 22',     'Seattle',  'WA', '98101');

-- policies -------------------------------------------------------------------
-- Joined to accounts via the human-readable account_id.

insert into public.policies (policy_number, account_id, carrier, policy_type, status, premium, effective_date, expiration_date, coverage_limit)
select v.policy_number, a.id, v.carrier, v.policy_type, v.status, v.premium, v.effective_date, v.expiration_date, v.coverage_limit
from (values
  ('CGL-2024-08812', 'ACC-10042', 'Hartford Financial Services', 'Commercial General Liability', 'active', 18750.00::numeric, '2024-07-01'::date, '2025-07-01'::date, 2000000.00::numeric),
  ('CPP-2024-03341', 'ACC-10042', 'Hartford Financial Services', 'Commercial Property',          'active', 32100.00,           '2024-07-01',        '2025-07-01',        5000000.00),
  ('BOP-2024-55219', 'ACC-10078', 'Travelers Insurance',         'Business Owners Policy',       'active',  4825.00,           '2024-03-15',        '2025-03-15',        1000000.00),
  ('WC-2024-71004',  'ACC-10103', 'AmTrust Financial',           'Workers Compensation',         'active', 41200.00,           '2024-09-01',        '2025-09-01',        null::numeric),
  ('CGL-2024-71005', 'ACC-10103', 'AmTrust Financial',           'Commercial General Liability', 'active', 15600.00,           '2024-09-01',        '2025-09-01',        2000000.00),
  ('PL-2024-40082',  'ACC-10155', 'CNA Financial',               'Professional Liability',       'active',  9450.00,           '2024-11-01',        '2025-11-01',        1000000.00),
  ('BOP-2024-40083', 'ACC-10155', 'CNA Financial',               'Business Owners Policy',       'active',  6200.00,           '2024-11-01',        '2025-11-01',         500000.00),
  ('PL-2024-88930',  'ACC-10201', 'Zurich Insurance',            'Professional Liability',       'active', 22800.00,           '2024-06-01',        '2025-06-01',        5000000.00)
) as v(policy_number, account_id_text, carrier, policy_type, status, premium, effective_date, expiration_date, coverage_limit)
join public.accounts a on a.account_id = v.account_id_text;
