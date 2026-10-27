import { config, capabilities } from '../config.js';
import { HttpError } from '../db/pool.js';
import { audit, notify, q, q1 } from './helpers.js';

/**
 * Crop quality reports.
 *
 * The design principle running through this module is that three different
 * things are routinely confused and must stay distinct:
 *
 *   - what the farmer asserts       (report_type = 'farmer_provided')
 *   - what a machine guessed        (report_type = 'ai_assisted')
 *   - what a reviewer accepted      (verification_status = 'verified')
 *
 * Only the third is an official verification, and only an administrator can
 * create it. The database trigger guard_quality_verification refuses any other
 * path to a verified status, so a farmer cannot self-certify by calling the API
 * directly.
 */

export const AI_DISCLAIMER =
  'AI-assisted visual assessment is informational and does not replace professional ' +
  'inspection or laboratory testing.';

export interface QualityReportInput {
  product_id: string;
  title: string;
  summary?: string | null;
  measurements?: Record<string, unknown>;
  report_document?: string | null;
  inspection_provider?: string | null;
  inspection_date?: string | null;
  inspector_name?: string | null;
  expiry_date?: string | null;
}

/** A farmer records quality information about one of their own listings. */
export async function createFarmerQualityReport(
  farmerId: string,
  input: QualityReportInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ id: string }> {
  const product = await q1<{ id: string }>(
    'SELECT id FROM products WHERE id = $1 AND farmer_id = $2',
    [input.product_id, farmerId],
  );
  if (!product) {
    throw new HttpError(404, 'That listing could not be found.', 'PRODUCT_NOT_FOUND');
  }

  if (input.inspection_provider || input.inspector_name) {
    // Claiming a third-party inspection without the paperwork attached is not
    // something the app should help with.
    if (!input.report_document) {
      throw new HttpError(
        422,
        'Attach the inspection report before naming an inspection provider.',
        'DOCUMENT_REQUIRED',
        { report_document: 'Upload the report issued by the inspection body.' },
      );
    }
  }

  const created = await q1<{ id: string }>(
    `INSERT INTO crop_quality_reports (
       product_id, submitted_by, report_type, title, summary, measurements,
       report_document, inspection_provider, inspection_date, inspector_name,
       expiry_date, verification_status
     ) VALUES (
       $1, $2, 'farmer_provided', $3, $4, $5::jsonb,
       $6, $7, $8, $9,
       $10, 'unverified'
     ) RETURNING id`,
    [
      input.product_id, farmerId, input.title, input.summary ?? null,
      JSON.stringify(input.measurements ?? {}),
      input.report_document ?? null, input.inspection_provider ?? null,
      input.inspection_date ?? null, input.inspector_name ?? null,
      input.expiry_date ?? null,
    ],
  );
  if (!created) throw new HttpError(500, 'The quality report could not be saved.', 'CREATE_FAILED');

  await audit({
    action: 'quality_report.create',
    entityType: 'crop_quality_report',
    entityId: created.id,
    after: { product_id: input.product_id, report_type: 'farmer_provided' },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return created;
}

/** A farmer asks for a review of a report they submitted. */
export async function requestQualityReview(
  farmerId: string,
  reportId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const report = await q1<{ id: string; product_id: string; verification_status: string }>(
    `SELECT id, product_id, verification_status::text AS verification_status
       FROM crop_quality_reports
      WHERE id = $1 AND submitted_by = $2`,
    [reportId, farmerId],
  );
  if (!report) throw new HttpError(404, 'That quality report could not be found.', 'REPORT_NOT_FOUND');

  if (report.verification_status === 'verified') {
    throw new HttpError(409, 'This report is already verified.', 'ALREADY_VERIFIED');
  }

  await q(
    `UPDATE crop_quality_reports
        SET verification_status = 'pending', report_type = 'inspection_pending'
      WHERE id = $1`,
    [reportId],
  );

  // Tell every administrator there is something to review.
  const admins = await q<{ id: string }>(`SELECT id FROM profiles WHERE role = 'admin' AND NOT is_suspended`);
  for (const admin of admins) {
    await notify(
      admin.id,
      'quality',
      'A quality report is awaiting review',
      'A farmer has submitted a quality report for verification.',
      '/admin/quality-reviews',
      { reportId },
    );
  }

  await audit({
    action: 'quality_report.review_requested',
    entityType: 'crop_quality_report',
    entityId: reportId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/** Reports attached to a listing the caller owns, or to any public listing. */
export async function listQualityReportsForProduct(
  productId: string,
  options: { publicOnly?: boolean } = {},
): Promise<Array<Record<string, unknown>>> {
  if (options.publicOnly) {
    return q(
      `SELECT id, report_type, title, summary, measurements, ai_findings, ai_disclaimer,
              inspection_provider, inspection_date, inspector_name,
              verification_status, expiry_date, reviewed_at, report_document, created_at
         FROM public_quality_reports
        WHERE product_id = $1
        ORDER BY created_at DESC`,
      [productId],
    );
  }
  return q(
    `SELECT * FROM crop_quality_reports WHERE product_id = $1 ORDER BY created_at DESC`,
    [productId],
  );
}

/**
 * AI-assisted visual assessment.
 *
 * This is the one place in the app that calls a third-party model, and it is
 * deliberately narrow. It looks for *visible* characteristics only. It never
 * asserts anything about residues, contamination, nutrition or safety, because
 * a photograph cannot establish those things. Every stored result carries the
 * disclaimer and is labelled preliminary.
 *
 * When no vision API is configured the endpoint reports that clearly instead of
 * inventing an assessment.
 */
export async function analyseCropImage(
  userId: string,
  input: { product_id: string; image_path: string },
  meta: { ip: string | null; userAgent: string | null },
): Promise<Record<string, unknown>> {
  if (!capabilities.aiVision) {
    throw new HttpError(
      503,
      'AI-assisted image assessment is not configured on this deployment. ' +
        'Set AI_VISION_ENABLED=true and AI_VISION_API_KEY to turn it on.',
      'AI_NOT_CONFIGURED',
    );
  }

  const product = await q1<{ id: string; name: string; farmer_id: string }>(
    'SELECT id, name, farmer_id FROM products WHERE id = $1',
    [input.product_id],
  );
  if (!product) throw new HttpError(404, 'That listing could not be found.', 'PRODUCT_NOT_FOUND');

  const findings = await callVisionModel(product.name, input.image_path);

  const created = await q1<{ id: string }>(
    `INSERT INTO crop_quality_reports (
       product_id, submitted_by, report_type, title, summary, ai_findings,
       ai_disclaimer, verification_status
     ) VALUES ($1, $2, 'ai_assisted', $3, $4, $5::jsonb, $6, 'unverified')
     RETURNING id`,
    [
      input.product_id, userId,
      `AI-assisted visual assessment for ${product.name}`,
      findings.summary,
      JSON.stringify(findings),
      AI_DISCLAIMER,
    ],
  );

  await audit({
    action: 'quality_report.ai_assessment',
    entityType: 'crop_quality_report',
    entityId: created?.id ?? null,
    after: { product_id: input.product_id, model: config.aiVision.model },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return {
    id: created?.id,
    report_type: 'ai_assisted',
    verification_status: 'unverified',
    disclaimer: AI_DISCLAIMER,
    ...findings,
  };
}

interface VisionFindings {
  summary: string;
  observations: Array<{ aspect: string; finding: string; confidence: 'low' | 'medium' | 'high' }>;
  limitations: string[];
}

/**
 * Ask the configured vision model for a preliminary visual assessment.
 *
 * The prompt constrains the model to what a photograph can actually show, and
 * the response is filtered so a model that volunteers a claim about pesticide
 * residue cannot have that claim stored as if it were a finding.
 */
async function callVisionModel(productName: string, imagePath: string): Promise<VisionFindings> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aiVision.apiKey}`,
    },
    body: JSON.stringify({
      model: config.aiVision.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You assess produce photographs for a farmer marketplace.',
            'Report only characteristics that are visible in the image: colour,',
            'surface defects, bruising, mould, shrivelling, size uniformity.',
            'You cannot and must not comment on pesticide residue, chemical',
            'contamination, microbial safety, nutrition, or certification.',
            'Return JSON: {"summary": string, "observations": [{"aspect": string,',
            '"finding": string, "confidence": "low"|"medium"|"high"}],',
            '"limitations": [string]}',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Produce: ${productName}. Assess the visible condition.` },
            { type: 'image_url', image_url: { url: imagePath } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[ai-vision] request failed', response.status, detail.slice(0, 400));
    throw new HttpError(
      502,
      'The image assessment service did not respond. Please try again later.',
      'AI_PROVIDER_ERROR',
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new HttpError(502, 'The image assessment returned no result.', 'AI_EMPTY_RESULT');
  }

  let parsed: VisionFindings;
  try {
    parsed = JSON.parse(content) as VisionFindings;
  } catch {
    throw new HttpError(502, 'The image assessment returned an unreadable result.', 'AI_BAD_RESULT');
  }

  const FORBIDDEN = /(pesticide|residue|chemical|contaminat|microb|pathogen|nutrition|protein|vitamin|organic|certif|food safety|safe to eat)/i;

  const observations = (parsed.observations ?? [])
    .filter((o) => o && typeof o.finding === 'string' && !FORBIDDEN.test(o.finding))
    .slice(0, 10)
    .map((o) => ({
      aspect: String(o.aspect ?? 'appearance').slice(0, 60),
      finding: String(o.finding).slice(0, 300),
      confidence: (['low', 'medium', 'high'] as const).includes(o.confidence)
        ? o.confidence
        : ('low' as const),
    }));

  return {
    summary: String(parsed.summary ?? 'Preliminary visual assessment completed.').slice(0, 600),
    observations,
    limitations: [
      'Based on a photograph only, in one lighting condition.',
      'Cannot detect residues, contamination, or internal quality.',
      ...(parsed.limitations ?? []).map((l) => String(l).slice(0, 200)).slice(0, 4),
    ],
  };
}

/**
 * A customer flags a suspected quality problem.
 *
 * Recorded as a user report so it lands in the administrator queue alongside
 * listing and review reports, rather than being a private message that goes
 * nowhere.
 */
export async function reportQualityIssue(
  reporterId: string,
  input: { product_id: string; reason: string; details?: string | null },
): Promise<{ id: string }> {
  const product = await q1<{ id: string }>('SELECT id FROM products WHERE id = $1', [
    input.product_id,
  ]);
  if (!product) throw new HttpError(404, 'That listing could not be found.', 'PRODUCT_NOT_FOUND');

  const created = await q1<{ id: string }>(
    `INSERT INTO user_reports (reporter_id, target_type, target_id, reason, details)
     VALUES ($1, 'product', $2, $3, $4)
     RETURNING id`,
    [reporterId, input.product_id, input.reason, input.details ?? null],
  );
  if (!created) throw new HttpError(500, 'The report could not be submitted.', 'CREATE_FAILED');
  return created;
}

/** Quality verification states a report can be in, with plain-language labels. */
export const QUALITY_STATUS_LABELS: Record<string, { label: string; explanation: string }> = {
  unverified: {
    label: 'Farmer-provided information',
    explanation: 'Supplied by the farmer. Not independently checked.',
  },
  pending: {
    label: 'Inspection pending',
    explanation: 'Submitted for review. A decision has not been made yet.',
  },
  verified: {
    label: 'Verified inspection',
    explanation: 'Reviewed and accepted by a RythuDirect reviewer.',
  },
  rejected: {
    label: 'Rejected report',
    explanation: 'A reviewer did not accept this report.',
  },
  expired: {
    label: 'Expired report',
    explanation: 'The verification period for this report has ended.',
  },
};

export const REPORT_TYPE_LABELS: Record<string, string> = {
  farmer_provided: 'Farmer-provided information',
  ai_assisted: 'AI-assisted visual assessment (preliminary)',
  inspection_pending: 'Inspection pending',
  verified_inspection: 'Verified inspection',
  rejected: 'Rejected report',
  expired: 'Expired report',
};
