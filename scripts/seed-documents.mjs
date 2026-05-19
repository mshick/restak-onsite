#!/usr/bin/env node
/**
 * Seeds the `documents` and `reconciliation_items` tables from the five PDFs
 * in docs/generated_policies/.
 *
 * Runs after `supabase db reset` (chained from package.json db:reset). Reads
 * each PDF, inserts the raw bytes into `documents.pdf_blob` alongside a
 * hand-crafted extraction envelope, then creates one reconciliation_items
 * row per document linked to the matching policy by policy_number.
 *
 * The extraction envelopes mirror what a real extractor (Textract, Reducto,
 * an in-house Claude pass) would emit: per-field { value, raw_text,
 * confidence, page } plus `unparsed_sections[]` for the free-text the
 * extractor couldn't classify. Confidence scores are tuned per-field to
 * reflect realistic extractor behavior — high on bold form labels, low on
 * truncated wraps.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PDF_DIR = resolve(root, 'docs/generated_policies');

// Default to the standard local Supabase Postgres URL; override with
// SUPABASE_DB_URL if seeding a different instance.
const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// One entry per PDF. The `extracted` envelope is the file's worth of
// hand-crafted "extraction output" — what the demo will reconcile against.
const DOCS = [
  // -----------------------------------------------------------------------
  // 1. Greenfield CGL Renewal (Hartford)
  //
  // SOR has CGL-2024-08812 effective 2024-07-01 → 2025-07-01, premium
  // $18,750. The PDF is a renewal for the NEXT term: 2025-07-01 →
  // 2026-07-01, premium $22,875 (+22%). Expected material findings on
  // effective/expiration/premium; everything else should match cleanly.
  // -----------------------------------------------------------------------
  {
    filename: 'Greenfield_CGL_Renewal_2025.pdf',
    docType: 'renewal',
    policyNumber: 'CGL-2024-08812',
    reference: 'GREENFIELD-CGL-2026-RENEWAL',
    dueAt: '2026-05-30T00:00:00Z',
    extracted: {
      source: {
        filename: 'Greenfield_CGL_Renewal_2025.pdf',
        pages: 2,
        extracted_at: '2026-04-15T10:30:00Z',
        extractor: 'claim-extract-v3',
      },
      fields: {
        named_insured: {
          value: 'Greenfield Properties LLC',
          raw_text: 'Named Insured: Greenfield Properties LLC',
          confidence: 0.97,
          page: 1,
        },
        contact_name: {
          value: 'Margaret Chen',
          raw_text: 'Contact: Margaret Chen',
          confidence: 0.96,
          page: 1,
        },
        contact_email: {
          value: 'm.chen@greenfieldprop.com',
          raw_text: 'Email: m.chen@greenfieldprop.com',
          confidence: 0.98,
          page: 1,
        },
        contact_phone: {
          value: '(512) 555-0147',
          raw_text: 'Phone: (512) 555-0147',
          confidence: 0.96,
          page: 1,
        },
        mailing_address: {
          value: '4200 West Lake Blvd, Suite 300, Austin, TX 78746',
          raw_text: 'Mailing Address: 4200 West Lake Blvd, Suite 300, Austin, TX 78746',
          confidence: 0.95,
          page: 1,
        },
        policy_number: {
          value: 'CGL-2024-08812',
          raw_text: 'Policy Number: CGL-2024-08812',
          confidence: 0.99,
          page: 1,
        },
        carrier: {
          value: 'Hartford Financial Services',
          raw_text: 'HARTFORD FINANCIAL SERVICES',
          confidence: 0.97,
          page: 1,
        },
        policy_type: {
          value: 'Commercial General Liability',
          raw_text: 'Policy Type: Commercial General Liability',
          confidence: 0.98,
          page: 1,
        },
        effective_date: {
          value: '2025-07-01',
          raw_text: 'Effective Date: July 01, 2025',
          confidence: 0.94,
          page: 1,
        },
        expiration_date: {
          value: '2026-07-01',
          raw_text: 'Expiration Date: July 01, 2026',
          confidence: 0.94,
          page: 1,
        },
        premium: {
          value: 22875.0,
          raw_text: 'Total Annual Premium: $22,875.00',
          confidence: 0.96,
          page: 1,
        },
        coverage_limit: {
          value: 2000000.0,
          raw_text: 'General Aggregate Limit $2,000,000.00',
          confidence: 0.93,
          page: 1,
        },
      },
      unparsed_sections: [
        {
          label: 'COVERAGE SCHEDULE — full breakdown',
          page: 1,
          text:
            'General Aggregate Limit $2,000,000.00\n' +
            'Products-Completed Operations Aggregate $2,000,000.00\n' +
            'Each Occurrence $1,000,000.00\n' +
            'Personal & Advertising Injury $1,000,000.00\n' +
            'Damage to Rented Premises $100,000\n' +
            'Medical Expense (Any One Person) $10,000',
        },
        {
          label: 'PREMIUM BREAKDOWN',
          page: 1,
          text:
            'Premises/Operations: $13,725.00\n' +
            'Products/Completed Operations: $5,718.75\n' +
            'Additional Insureds: $2,287.50\n' +
            'Terrorism (TRIA): $1,143.75\n' +
            'Total Annual Premium: $22,875.00\n' +
            'Payment Plan: Quarterly - 25% due at inception',
        },
        {
          label: 'ENDORSEMENTS & FORMS',
          page: 2,
          text:
            'CG 00 01 04 13 Commercial General Liability Coverage Form\n' +
            'CG 20 10 04 13 Additional Insured - Owners, Lessees, or Contractors\n' +
            'CG 20 37 04 13 Additional Insured - Owners, Lessees, Contractors (Completed Ops)\n' +
            'CG 24 04 05 09 Waiver of Transfer of Rights (Subrogation)\n' +
            'IL 00 21 09 08 Nuclear Energy Liability Exclusion\n' +
            'CG 21 67 12 04 Fungi or Bacteria Exclusion\n' +
            'TRIA-04 Terrorism Risk Insurance Act Endorsement',
        },
      ],
      warnings: [],
    },
  },

  // -----------------------------------------------------------------------
  // 2. Whitfield BOP "Endorsement" (Travelers)
  //
  // SOR has BOP-2024-55219 effective 2024-03-15 → 2025-03-15, premium
  // $4,825, account_name "Dr. James Whitfield, DDS". The PDF is labelled
  // "Endorsement Summary" but it's actually a renewal-term snapshot
  // (2025-03-15 → 2026-03-15, premium unchanged at $4,825). Big
  // named_insured discrepancy: doc shows "Whitfield Dental Group - James
  // Whitfield DDS" with DBA "Whitfield Family Dentistry"; SOR has just
  // the personal-name form.
  // -----------------------------------------------------------------------
  {
    filename: 'Whitfield_BOP_Endorsement_2025.pdf',
    docType: 'endorsement',
    policyNumber: 'BOP-2024-55219',
    reference: 'WHITFIELD-BOP-2026-ENDORSEMENT',
    dueAt: '2026-05-22T00:00:00Z',
    extracted: {
      source: {
        filename: 'Whitfield_BOP_Endorsement_2025.pdf',
        pages: 2,
        extracted_at: '2026-03-31T14:12:00Z',
        extractor: 'claim-extract-v3',
      },
      fields: {
        named_insured: {
          value: 'Whitfield Dental Group - James Whitfield DDS',
          raw_text:
            'Named Insured: Whitfield Dental Group - James Whitfield DDS\nDBA: Whitfield Family Dentistry',
          confidence: 0.92,
          page: 1,
        },
        contact_name: {
          value: 'James Whitfield',
          raw_text: 'Contact: James Whitfield',
          confidence: 0.96,
          page: 1,
        },
        contact_phone: {
          value: '303-555-0291',
          raw_text: 'Phone: 303-555-0291',
          confidence: 0.97,
          page: 1,
        },
        mailing_address: {
          value: '1887 Pearl St., Boulder, Colorado 80302',
          raw_text: 'Mailing Address: 1887 Pearl St., Boulder, Colorado 80302',
          confidence: 0.93,
          page: 1,
        },
        policy_number: {
          value: 'BOP-2024-55219',
          raw_text: 'Policy Number: BOP-2024-55219',
          confidence: 0.99,
          page: 1,
        },
        carrier: {
          value: 'Travelers',
          raw_text: 'TRAVELERS',
          confidence: 0.95,
          page: 1,
        },
        policy_type: {
          value: 'Business Owners Policy (BOP)',
          raw_text: 'Policy Type: Business Owners Policy (BOP)',
          confidence: 0.97,
          page: 1,
        },
        effective_date: {
          value: '2025-03-15',
          raw_text: 'Effective Date: March 15, 2025',
          confidence: 0.95,
          page: 1,
        },
        expiration_date: {
          value: '2026-03-15',
          raw_text: 'Expiration Date: March 15, 2026',
          confidence: 0.95,
          page: 1,
        },
        premium: {
          value: 4825.0,
          raw_text: 'Total Annual Premium: $4,825.00',
          confidence: 0.97,
          page: 2,
        },
        coverage_limit: {
          value: 1000000.0,
          raw_text: 'Each Occurrence $1,000,000.00',
          confidence: 0.93,
          page: 1,
        },
      },
      unparsed_sections: [
        {
          label: 'PROPERTY COVERAGE',
          page: 1,
          text:
            'Building (Replacement Cost) $650,000\n' +
            'Business Personal Property $175,000\n' +
            'Dental Equipment (Scheduled) $280,000\n' +
            'Business Income & Extra Expense $120,000 (12 months)\n' +
            'Electronic Data Processing Equipment $50,000\n' +
            'Valuable Papers & Records $25,000\n' +
            'Signs (Interior & Exterior) $10,000\n' +
            'Employee Dishonesty $15,000\n' +
            'Property Deductible: $1,000 per occurrence\n' +
            'Coinsurance: 80% (waived with agreed amount endorsement)',
        },
        {
          label: 'LIABILITY COVERAGE — full breakdown',
          page: 1,
          text:
            'Each Occurrence $1,000,000.00\n' +
            'General Aggregate $2,000,000.00\n' +
            'Products-Completed Operations $1,000,000.00\n' +
            'Personal & Advertising Injury $1,000,000.00\n' +
            'Damage to Rented Premises $300,000\n' +
            'Medical Expense (Any One Person) $5,000',
        },
        {
          label: 'LOCATION SCHEDULE',
          page: 2,
          text:
            'Loc #1: 1887 Pearl St., Boulder, CO 80302 — Class: Dental Office — Construction: Masonry Non-Combustible\n' +
            'Year Built: 2003 | Sq Ft: 3,200 | Stories: 1 | Protection Class: 3 | Fire Alarm: Central Station',
        },
        {
          label: 'BUSINESS METADATA',
          page: 1,
          text:
            'NAICS Code: 621210 - Offices of Dentists\n' +
            'Entity Type: Professional Corporation (PC)\n' +
            'Year Established: 2018\n' +
            'Number of Employees: 12',
        },
      ],
      warnings: [],
    },
  },

  // -----------------------------------------------------------------------
  // 3. Summit Ridge WC Audit (AmTrust)
  //
  // SOR has WC-2024-71004 with premium $41,200 and full contact
  // "Roberto Alejandro Gutierrez-Medina" + full address. The audit PDF
  // shows "Estimated Annual Premium $18,240" (significantly lower than
  // SOR) — a major reconciliation question. Plus low-confidence
  // truncated extractions on contact_name and mailing_address that the
  // LLM should mark ambiguous. Rich unparsed sections: classification
  // breakdown (4 codes including 5645 Carpentry-Residential as
  // governing class), audit math, EMR 1.12, loss history.
  // -----------------------------------------------------------------------
  {
    filename: 'SummitRidge_WC_Audit_2025.pdf',
    docType: 'audit',
    policyNumber: 'WC-2024-71004',
    reference: 'SUMMITRIDGE-WC-2025-AUDIT',
    dueAt: '2026-05-25T00:00:00Z',
    extracted: {
      source: {
        filename: 'SummitRidge_WC_Audit_2025.pdf',
        pages: 2,
        extracted_at: '2025-08-15T16:45:00Z',
        extractor: 'claim-extract-v3',
      },
      fields: {
        named_insured: {
          value: 'Summit Ridge Contractors Inc',
          raw_text: 'Named Insured: Summit Ridge Contractors Inc',
          confidence: 0.96,
          page: 1,
        },
        contact_name: {
          value: 'Roberto',
          raw_text: 'Contact: Roberto',
          confidence: 0.62,
          page: 1,
        },
        mailing_address: {
          value: '920 Peachtree Blvd, Atlanta, GA',
          raw_text: 'Mailing Address: 920 Peachtree Blvd, Atlanta, GA',
          confidence: 0.71,
          page: 1,
        },
        policy_number: {
          value: 'WC-2024-71004',
          raw_text: 'Policy Number: WC-2024-71004',
          confidence: 0.99,
          page: 1,
        },
        carrier: {
          value: 'AmTrust Financial Services',
          raw_text: 'AMTRUST FINANCIAL SERVICES',
          confidence: 0.94,
          page: 1,
        },
        policy_type: {
          value: "Workers' Compensation & Employers Liability",
          raw_text: "Policy Type: Workers' Compensation & Employers Liability",
          confidence: 0.93,
          page: 1,
        },
        effective_date: {
          value: '2024-09-01',
          raw_text: 'Effective Date: September 01, 2024 (estimated)',
          confidence: 0.85,
          page: 1,
        },
        expiration_date: {
          value: '2025-09-01',
          raw_text: 'Expiration Date: September 01, 2025',
          confidence: 0.94,
          page: 1,
        },
        premium: {
          value: 18240.0,
          raw_text: 'Estimated Annual Premium: $18,240.00',
          confidence: 0.91,
          page: 1,
        },
      },
      unparsed_sections: [
        {
          label: 'CLASSIFICATION & PAYROLL — AUDIT PERIOD',
          page: 1,
          text:
            '5645 Carpentry - Residential | Est. Payroll $820,000 | Audited Payroll $894,350 | Rate / $100 $12.47\n' +
            '5403 Carpentry - Commercial  | Est. Payroll $340,000 | Audited Payroll $312,600 | Rate / $100 $15.82\n' +
            '8810 Clerical Office          | Est. Payroll $185,000 | Audited Payroll $192,100 | Rate / $100 $0.32\n' +
            '8742 Salespersons (Outside)   | Est. Payroll $95,000  | Audited Payroll $88,400  | Rate / $100 $0.78\n' +
            'TOTAL Est. Payroll $1,440,000 | TOTAL Audited Payroll $1,487,450\n' +
            'Governing Class: 5645 - Carpentry | Rating State: Georgia | Interstate ID: GA-334053',
        },
        {
          label: 'PREMIUM COMPUTATION',
          page: 1,
          text:
            'NOTE: Final premium is subject to completion of payroll audit verification.\n' +
            "The insured's audited payroll exceeded estimated payroll by $47,450.\n" +
            'An additional premium adjustment may be forthcoming pending NCCI review.\n' +
            'Estimated Annual Premium: $18,240.00\n' +
            'Audit Adjustment (Est.): $2,180.00\n' +
            'Experience Modification (1.12): Applied\n' +
            'Schedule Credit: -5%\n' +
            'Final Premium: PENDING — See Audit Worksheet',
        },
        {
          label: 'EMPLOYERS LIABILITY LIMITS',
          page: 1,
          text:
            'Bodily Injury by Accident: $500,000 each accident\n' +
            'Bodily Injury by Disease: $500,000 policy limit\n' +
            'Bodily Injury by Disease: $500,000 each employee',
        },
        {
          label: 'LOSS HISTORY (3 YEARS)',
          page: 2,
          text:
            '2024: 2 claims | Incurred $14,320 | Reserves $0 | Fall from scaffolding; hand laceration\n' +
            '2023: 1 claim  | Incurred $8,750  | Reserves $0 | Back strain - lifting materials\n' +
            '2022: 3 claims | Incurred $41,200 | Reserves $5,400 | Saw injury; 2x sprains',
        },
      ],
      warnings: [
        'contact_name: confidence 0.62 — appears truncated at first name only',
        'mailing_address: confidence 0.71 — appears truncated (missing street suffix and zip)',
        'premium reflects estimated annual only; final premium pending audit',
      ],
    },
  },

  // -----------------------------------------------------------------------
  // 4. Coastal Vet PL Certificate (CNA)
  //
  // SOR has PL-2024-40082 with address "7650 Girard Avenue, La Jolla, CA
  // 92037" and coverage_limit $1,000,000. The certificate PDF shows a
  // completely different address ("2300 Camino Del Rio South, Ste 100,
  // San Diego, CA 92108") at high confidence — the practice has moved.
  // It also shows coverage as $500K each-claim / $1.5M aggregate, vs
  // SOR's single $1M — different cut of the same limit set. Other
  // fields match cleanly.
  // -----------------------------------------------------------------------
  {
    filename: 'CoastalVet_PL_Certificate_2025.pdf',
    docType: 'certificate',
    policyNumber: 'PL-2024-40082',
    reference: 'COASTALVET-PL-2025-CERT',
    dueAt: '2026-05-21T00:00:00Z',
    extracted: {
      source: {
        filename: 'CoastalVet_PL_Certificate_2025.pdf',
        pages: 2,
        extracted_at: '2026-03-31T09:22:00Z',
        extractor: 'claim-extract-v3',
      },
      fields: {
        named_insured: {
          value: 'Coastal Veterinary Associates',
          raw_text: 'Named Insured: Coastal Veterinary Associates',
          confidence: 0.97,
          page: 1,
        },
        contact_name: {
          value: "Patricia O'Brien-Walsh",
          raw_text: "Contact: Patricia O'Brien-Walsh",
          confidence: 0.95,
          page: 1,
        },
        contact_email: {
          value: 'pob@coastalvetassoc.com',
          raw_text: 'Email: pob@coastalvetassoc.com',
          confidence: 0.97,
          page: 1,
        },
        contact_phone: {
          value: '(619) 555-0334',
          raw_text: 'Phone: (619) 555-0334',
          confidence: 0.96,
          page: 1,
        },
        mailing_address: {
          value: '2300 Camino Del Rio South, Ste 100, San Diego, CA 92108',
          raw_text: 'Mailing Address: 2300 Camino Del Rio South, Ste 100, San Diego, CA 92108',
          confidence: 0.94,
          page: 1,
        },
        policy_number: {
          value: 'PL-2024-40082',
          raw_text: 'Policy Number: PL-2024-40082',
          confidence: 0.99,
          page: 1,
        },
        carrier: {
          value: 'CNA Financial',
          raw_text: 'CNA FINANCIAL',
          confidence: 0.97,
          page: 1,
        },
        policy_type: {
          value: 'Professional Liability',
          raw_text: 'Policy Type: Professional Liability',
          confidence: 0.98,
          page: 1,
        },
        effective_date: {
          value: '2024-11-01',
          raw_text: 'Effective Date: November 01, 2024',
          confidence: 0.95,
          page: 1,
        },
        expiration_date: {
          value: '2025-11-01',
          raw_text: 'Expiration Date: November 01, 2025',
          confidence: 0.95,
          page: 1,
        },
        premium: {
          value: 9450.0,
          raw_text: 'Total Annual Premium: $9,450.00',
          confidence: 0.97,
          page: 2,
        },
        coverage_limit: {
          value: 500000.0,
          raw_text: 'Each Claim $500,000.00',
          confidence: 0.93,
          page: 1,
        },
      },
      unparsed_sections: [
        {
          label: 'COVERAGE SCHEDULE — full breakdown',
          page: 1,
          text:
            'Each Claim $500,000.00\n' +
            'Annual Aggregate $1,500,000.00\n' +
            'Defense Costs Outside the Limit\n' +
            'Deductible $2,500 per claim\n' +
            'Consent to Settle Hammer clause - 80/20 split\n' +
            'Extended Reporting Period: 60 days (automatic); 3 years (optional, 200% premium)',
        },
        {
          label: 'CLAIMS-MADE NOTICES',
          page: 2,
          text:
            'This is a CLAIMS-MADE policy. Coverage applies only to claims first made and reported during the policy period.\n' +
            'The retroactive date is November 01, 2019. No coverage for acts or omissions before this date.\n' +
            'Notice of claim must be given to the carrier within 30 days of receipt of written demand or suit papers.\n' +
            'This certificate is issued as a matter of information only and confers no rights upon the certificate holder.',
        },
        {
          label: 'COVERED SERVICES',
          page: 1,
          text:
            'Veterinary medical & surgical services\n' +
            'Diagnostic imaging (radiography, ultrasound, CT)\n' +
            'Dental procedures\n' +
            'Emergency & critical care\n' +
            'Anesthesiology\n' +
            'Boarding & grooming (incidental to treatment)\n' +
            'Dispensing of medications\n' +
            'Telemedicine consultations',
        },
        {
          label: 'PRACTICE DETAILS',
          page: 1,
          text:
            'Practice Type: Small Animal & Exotic Veterinary Medicine\n' +
            'Number of Veterinarians: 4 (full-time), 2 (part-time / relief)\n' +
            'Number of Technicians: 8\n' +
            'State License: CA-VET-23434\n' +
            'Retroactive Date: November 01, 2019',
        },
      ],
      warnings: [],
    },
  },

  // -----------------------------------------------------------------------
  // 5. Nakamura & Patel PL Renewal (Zurich)
  //
  // SOR has PL-2024-88930 effective 2024-06-01 → 2025-06-01, premium
  // $22,800, coverage_limit $5M. The renewal proposal PDF shows:
  //   - effective 2025-05-01 (BEFORE expiring policy expires on 2025-06-01)
  //   - new expiration 2026-06-01
  //   - renewal total $24,500
  //   - "expiring" total $21,150 — disagrees with SOR's $22,800!
  //   - new $2,500 Cyber Liability Sublimit (NEW coverage)
  //   - cosmetic differences on named_insured (comma), address, phone
  //   - carrier "Zurich Insurance Group" vs SOR "Zurich Insurance"
  //   - policy_type "Lawyers Professional Liability" vs SOR "Professional Liability"
  // -----------------------------------------------------------------------
  {
    filename: 'NakamuraPatel_PL_Renewal_2025.pdf',
    docType: 'renewal',
    policyNumber: 'PL-2024-88930',
    reference: 'NAKAMURAPATEL-PL-2026-RENEWAL',
    dueAt: '2026-05-26T00:00:00Z',
    extracted: {
      source: {
        filename: 'NakamuraPatel_PL_Renewal_2025.pdf',
        pages: 2,
        extracted_at: '2026-04-01T11:08:00Z',
        extractor: 'claim-extract-v3',
      },
      fields: {
        named_insured: {
          value: 'Nakamura & Patel Law Group, PLLC',
          raw_text: 'Named Insured: Nakamura & Patel Law Group, PLLC',
          confidence: 0.96,
          page: 1,
        },
        contact_name: {
          value: 'Yuki Nakamura',
          raw_text: 'Contact: Yuki Nakamura',
          confidence: 0.96,
          page: 1,
        },
        contact_email: {
          value: 'ynakamura@nplawgroup.com',
          raw_text: 'Email: ynakamura@nplawgroup.com',
          confidence: 0.98,
          page: 1,
        },
        contact_phone: {
          value: '+1 (206) 555-0412',
          raw_text: 'Phone: +1 (206) 555-0412',
          confidence: 0.96,
          page: 1,
        },
        mailing_address: {
          value: '1201 3rd Ave, 22nd Floor, Seattle, Washington 98101',
          raw_text: 'Mailing Address: 1201 3rd Ave, 22nd Floor, Seattle, Washington 98101',
          confidence: 0.94,
          page: 1,
        },
        policy_number: {
          value: 'PL-2024-88930',
          raw_text: 'Policy Number: PL-2024-88930',
          confidence: 0.99,
          page: 1,
        },
        carrier: {
          value: 'Zurich Insurance Group',
          raw_text: 'ZURICH INSURANCE GROUP',
          confidence: 0.97,
          page: 1,
        },
        policy_type: {
          value: 'Lawyers Professional Liability',
          raw_text: 'Policy Type: Lawyers Professional Liability',
          confidence: 0.97,
          page: 1,
        },
        effective_date: {
          value: '2025-05-01',
          raw_text: 'Effective Date: May 01, 2025',
          confidence: 0.93,
          page: 1,
        },
        expiration_date: {
          value: '2026-06-01',
          raw_text: 'Expiration Date: June 01, 2026',
          confidence: 0.94,
          page: 1,
        },
        premium: {
          value: 24500.0,
          raw_text: 'TOTAL Renewal (2025-26) $24,500.00',
          confidence: 0.92,
          page: 2,
        },
        coverage_limit: {
          value: 5000000.0,
          raw_text: 'Each Claim $5,000,000.00',
          confidence: 0.94,
          page: 1,
        },
      },
      unparsed_sections: [
        {
          label: 'COVERAGE SCHEDULE — full breakdown',
          page: 1,
          text:
            'Each Claim $5,000,000.00\n' +
            'Annual Aggregate $10,000,000.00\n' +
            'Defense Costs Inside the Limit (eroding)\n' +
            'Deductible - Each Claim $25,000\n' +
            'Deductible - Defense Costs $10,000\n' +
            'Consent to Settle Full consent - no hammer clause\n' +
            'Extended Reporting Period (Optional) 1 yr (100%), 2 yr (160%), 3 yr (200%)\n' +
            'Coverage Basis: Claims-Made and Reported\n' +
            'Retroactive Date: January 15, 2012 (firm inception)',
        },
        {
          label: 'PREMIUM — RENEWAL COMPARISON',
          page: 2,
          text:
            'Component                | Expiring (2024-25) | Renewal (2025-26)\n' +
            'Base Premium             | $21,800.00         | $22,900.00\n' +
            'Increased Limits Factor  | Included           | Included\n' +
            'Claims-Free Credit (5 yr)| -$1,500.00         | -$1,500.00\n' +
            'New Attorney Surcharge   | $0.00              | $600.00\n' +
            'Cyber Liability Sublimit | N/A                | $2,500.00 (new)\n' +
            'Taxes & Fees             | $850.00            | $0.00\n' +
            'TOTAL                    | $21,150.00         | $24,500.00\n' +
            'Year-over-year change: +15.8% | Payment: Full at inception or 50/25/25 quarterly',
        },
        {
          label: 'ATTORNEY SCHEDULE',
          page: 1,
          text:
            'Yuki Nakamura     | Managing Partner | Corporate / M&A | WA, 2007\n' +
            'Arun Patel        | Senior Partner   | IP Litigation   | WA, CA, 2005\n' +
            'Christine Dolores | Partner          | Employment      | WA, 2010\n' +
            'Marcus Whitfield  | Partner          | Corporate       | WA, OR, 2009\n' +
            'Diana Roe         | Partner          | M&A             | WA, 2011\n' +
            'James Tsai        | Associate        | IP Litigation   | WA, 2018\n' +
            'Leah Goldberg     | Associate        | Employment      | WA, 2019\n' +
            '(Full schedule of 14 attorneys available in Appendix A)\n' +
            'Firm Size: 14 attorneys (8 partners, 4 associates, 2 of counsel)\n' +
            'Gross Revenue: $6,200,000 (prior year)\n' +
            'Practice Areas: Corporate, M&A, Employment, IP Litigation\n' +
            'Year Established: 2012',
        },
        {
          label: 'LOSS HISTORY (5 YEARS)',
          page: 2,
          text:
            'No claims reported during the past five policy years.\n' +
            'Prior acts coverage is continuous from firm inception date (January 15, 2012).',
        },
      ],
      warnings: [
        'effective_date 2025-05-01 begins one month BEFORE expiring policy expiration date 2025-06-01 (per system of record)',
        'Cyber Liability Sublimit $2,500.00 listed as NEW — not present on expiring policy per the carrier comparison table',
      ],
    },
  },
];

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    // Wipe in case of re-run (db:reset already drops everything; this is
    // belt-and-suspenders if the SQL seed somehow runs without a reset).
    await client.query('delete from public.reconciliation_items');
    await client.query('delete from public.documents');

    for (const d of DOCS) {
      const pdfPath = resolve(PDF_DIR, d.filename);
      const buffer = readFileSync(pdfPath);

      const policyRes = await client.query(
        'select id from public.policies where policy_number = $1',
        [d.policyNumber],
      );
      if (policyRes.rowCount === 0) {
        throw new Error(
          `No policy found for ${d.policyNumber} (referenced by ${d.filename}). Did the SQL seed run?`,
        );
      }
      const policyId = policyRes.rows[0].id;

      const docRes = await client.query(
        `insert into public.documents
           (filename, doc_type, policy_id, pdf_blob, pdf_size_bytes, extracted, extractor)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          d.filename,
          d.docType,
          policyId,
          buffer,
          buffer.length,
          JSON.stringify(d.extracted),
          'manual-handcrafted-v1',
        ],
      );
      const documentId = docRes.rows[0].id;

      await client.query(
        `insert into public.reconciliation_items
           (reference, document_id, policy_id, due_at)
         values ($1, $2, $3, $4)`,
        [d.reference, documentId, policyId, d.dueAt],
      );

      console.log(`  seeded ${d.reference}  (${(buffer.length / 1024).toFixed(1)} KB pdf)`);
    }

    console.log(`[seed-documents] inserted ${DOCS.length} documents + reconciliation_items`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[seed-documents] failed:', err);
  process.exit(1);
});
