import Image from "next/image";
import { cn } from "@/lib/utils";

type FloatingCardProps = {
  title: string;
  image: string;
  imageAlt?: string;
  className?: string;
  delay?: string;
};

export default function FloatingCard({
  title,
  image,
  imageAlt,
  className,
  delay = "0s",
}: FloatingCardProps) {
  return (
    <div
      className={cn(
        "floating-card group absolute rounded-2xl border border-white/20 bg-white/5 p-4 backdrop-blur-xl transition-transform duration-300 hover:scale-[1.03] hover:border-cyan-300/40",
        className
      )}
      style={{ animationDelay: delay }}
    >
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
        {title}
      </p>
      <div className="relative mt-3 h-36 overflow-hidden rounded-xl border border-white/10 bg-slate-950/40">
        <Image
          src={image}
          alt={imageAlt ?? title}
          fill
          sizes="224px"
          className="object-cover opacity-90 transition duration-500 group-hover:scale-105"
        />
      </div>
    </div>
  );
}
