import type { PublicCourseCard } from '@/server/academy/catalog';
import { cn } from '@/lib/utils';

/** Brand gradients for courses without a cover yet (style guide: greens only). */
const FALLBACKS = [
  'linear-gradient(135deg,#04150C 0%,#0B4A28 70%,#04A54F 140%)',
  'repeating-linear-gradient(115deg,rgba(255,255,255,.04) 0 2px,transparent 2px 14px),linear-gradient(160deg,#0A2617,#06331C 60%,#0F6B3A)',
  'radial-gradient(circle at 15% 20%,#18834A 0,transparent 45%),linear-gradient(140deg,#031009,#0A2E1B)',
  'linear-gradient(150deg,#123D2A,#081B11 50%,#0A5A31)',
];

function pick(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length]!;
}

/** 16:9 cover: the uploaded image, or a branded tile with the title. */
export function CourseCover({ course, fieldLabel, badge, duration, className, large }: {
  course: Pick<PublicCourseCard, 'id' | 'title' | 'thumbnailUrl'>;
  fieldLabel?: string;
  badge?: string | null;
  duration?: string;
  className?: string;
  large?: boolean;
}) {
  return (
    <div className={cn('relative aspect-video w-full overflow-hidden rounded-xl bg-muted', className)} style={course.thumbnailUrl ? undefined : { background: pick(course.id) }}>
      {course.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={course.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="flex size-full flex-col justify-end p-3 text-white sm:p-4">
          {fieldLabel && <span className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-[#9FF5C2]">{fieldLabel}</span>}
          <span className={cn('mt-1 line-clamp-3 max-w-[85%] font-display font-extrabold leading-tight', large ? 'text-2xl sm:text-3xl' : 'text-base')}>{course.title}</span>
        </div>
      )}
      {badge && <span className="absolute start-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white" style={{ background: 'linear-gradient(120deg,#057A41,#04A54F)' }}>{badge}</span>}
      {duration && <span className="absolute end-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10.5px] font-bold text-white">{duration}</span>}
    </div>
  );
}
