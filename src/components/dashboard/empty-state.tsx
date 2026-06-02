import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  cta?: { label: string; href: string };
};

export function EmptyState({ icon: Icon, title, description, cta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 border border-dashed border-[#262626] rounded-[6px] bg-[#1a1a1a]">
      <div className="w-10 h-10 inline-flex items-center justify-center rounded-full bg-[#CCE9E7]/10 border border-[#CCE9E7]/25 text-[#CCE9E7] mb-3">
        <Icon className="w-4 h-4" strokeWidth={1.8} />
      </div>
      <div className="text-white text-[14px] font-semibold mb-1">{title}</div>
      {description && (
        <div className="text-gray-500 text-[12px] max-w-sm leading-relaxed">
          {description}
        </div>
      )}
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex items-center h-8 px-4 rounded-[5px] bg-white text-black text-[12px] font-semibold hover:bg-gray-100 transition-colors"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
