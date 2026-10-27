import type { ReactNode } from 'react';
import { CheckCircle2, Info, ShieldCheck, Sparkles, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { VerificationStatus, QualityGrade } from '@/lib/types';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'leaf';

const TONES: Record<Tone, string> = {
  neutral: 'bg-soil-100 text-soil-800 ring-soil-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  success: 'bg-leaf-50 text-leaf-800 ring-leaf-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
  leaf: 'bg-leaf-600 text-white ring-leaf-700',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * The verification badge.
 *
 * Four distinct states, deliberately not merged into one "trusted" idea:
 * a registered user, a verified identity, a verified farmer, and an inspected
 * product are all different claims.
 */
export function VerificationBadge({ status }: { status: VerificationStatus }) {
  switch (status) {
    case 'verified':
      return (
        <Badge tone="success" icon={<ShieldCheck className="size-3.5" aria-hidden="true" />}>
          Verified
        </Badge>
      );
    case 'pending':
      return (
        <Badge tone="warning" icon={<Clock className="size-3.5" aria-hidden="true" />}>
          Pending
        </Badge>
      );
    case 'rejected':
      return (
        <Badge tone="danger" icon={<XCircle className="size-3.5" aria-hidden="true" />}>
          Not approved
        </Badge>
      );
    default:
      return (
        <Badge tone="neutral" icon={<Info className="size-3.5" aria-hidden="true" />}>
          Unverified
        </Badge>
      );
  }
}

/** Grade chip. Ungraded is shown plainly rather than as a low grade. */
export function GradeBadge({ grade }: { grade: QualityGrade }) {
  if (grade === 'ungraded') {
    return <Badge tone="neutral">Not graded</Badge>;
  }
  const tone: Tone = grade === 'A' ? 'success' : grade === 'B' ? 'info' : 'warning';
  return (
    <Badge tone={tone} icon={<Sparkles className="size-3.5" aria-hidden="true" />}>
      Grade {grade}
    </Badge>
  );
}

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}

/**
 * The AI-assessment marker. Always carries the caveat, wherever it appears, so
 * the disclaimer can never be separated from the claim it qualifies.
 */
export function AiAssessmentBadge() {
  return (
    <Badge tone="info" icon={<Sparkles className="size-3.5" aria-hidden="true" />}>
      AI-assisted (preliminary)
    </Badge>
  );
}

export function VerifiedPurchaseBadge() {
  return (
    <Badge tone="leaf" icon={<CheckCircle2 className="size-3.5" aria-hidden="true" />}>
      Verified purchase
    </Badge>
  );
}

export function LowStockBadge({ quantity }: { quantity: number }) {
  if (quantity <= 0) {
    return (
      <Badge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden="true" />}>
        Out of stock
      </Badge>
    );
  }
  if (quantity <= 10) {
    return (
      <Badge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden="true" />}>
        Only {quantity} left
      </Badge>
    );
  }
  return null;
}
