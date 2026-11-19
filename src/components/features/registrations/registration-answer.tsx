'use client';

/**
 * How the OWNER of a listing reads one answer in the registrations table.
 *
 * Text answers are text. A file answer is a card — the name the applicant sent,
 * its size and type, and two actions: View (opens it in a new tab, inline) and
 * Download. Both go through the owner-only download route; the storage id that
 * is the answer's raw value is never shown and never a link, because there is
 * no public URL to a file.
 *
 * The same pieces serve the desktop table and the mobile cards, so the two
 * cannot drift.
 */
import { useTranslations } from 'next-intl';
import { Download, ExternalLink, FileText, ImageIcon, Paperclip } from 'lucide-react';
import { FileName } from './registration-file-field';
import { formatFileSize } from '@/lib/registration-file-upload';
import { formatAnswerValue } from '@/lib/registration-options';
import type { Registration, RegistrationFormField } from '@/types/domain';

type Answer = Registration['answers'][number];

/** The text form of an answer, for everything that is not a file. */
export function answerText(answer: Answer): string {
  return formatAnswerValue(answer.value);
}

/** How many files this participant attached. */
export function attachedFileCount(reg: Registration): number {
  return reg.answers.filter((a) => a.file).length;
}

/** A paperclip and a count beside the participant's name, when they attached something. */
export function FileCountBadge({ reg }: { reg: Registration }) {
  const t = useTranslations('registrationsTable');
  const count = attachedFileCount(reg);
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
      title={t('filesAttached', { count })}
      aria-label={t('filesAttached', { count })}
    >
      <Paperclip className="size-3" aria-hidden="true" />
      {count}
    </span>
  );
}

export function AnswerValue({
  reg,
  field,
  answer,
  endpoint,
  textClassName,
}: {
  reg: Registration;
  field: RegistrationFormField;
  answer: Answer;
  /** `/api/incubator/registrations` or `/api/consultant/registrations`. */
  endpoint: string;
  textClassName: string;
}) {
  const t = useTranslations('registrationsTable');

  // `anywhere`, not just `break-word`: a pasted link has no spaces, and only
  // `anywhere` lets it shrink below its own length inside a grid, flex or table cell.
  const wrap = '[overflow-wrap:anywhere]';
  if (field.type !== 'FILE') {
    return <p className={`${textClassName} ${wrap}`}>{answerText(answer)}</p>;
  }
  const file = answer.file;
  if (!file) return <p className={`${textClassName} ${wrap}`}>—</p>;

  const href = `${endpoint}/${reg.id}/files/${field.id}`;
  const Icon = file.contentType === 'image/jpeg' ? ImageIcon : FileText;
  const button =
    'inline-flex min-h-11 items-center gap-1.5 rounded-md border lg:min-h-9 border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted';

  return (
    <div className="mt-1 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-2.5">
      <Icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-[8rem] flex-1">
        <FileName name={file.name} />
        <p className="text-xs text-muted-foreground">
          {file.contentType === 'image/jpeg' ? 'JPG' : 'PDF'} · {formatFileSize(file.bytes)}
        </p>
      </div>
      <div className="flex gap-2">
        <a href={href} target="_blank" rel="noopener noreferrer" className={button}>
          <ExternalLink className="size-3.5" aria-hidden="true" />
          {t('viewFile')}
        </a>
        <a href={`${href}?download=1`} className={button}>
          <Download className="size-3.5" aria-hidden="true" />
          {t('downloadFile')}
        </a>
      </div>
    </div>
  );
}
