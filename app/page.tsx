import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/session";
import SiteHeader from "@/components/site-header";
import { ArrowRight } from "lucide-react";

const partners = [
  {
    id: "treehacks",
    name: "TreeHacks",
    logoSrc: "/treehacks1.png",
  },
  {
    id: "microsoft",
    name: "Microsoft",
    logoSrc: "/microsoft.webp",
  },
  { id: "stanford", name: "Stanford", logoSrc: "/stanford1.png" },
  { id: "mit", name: "MIT", logoSrc: "/mit1.png" },
  { id: "anthropic", name: "Anthropic", logoSrc: "/anthropic.svg" },
  { id: "openai", name: "OpenAI", logoSrc: "/openai1.png" },
];

const features = [
  {
    title: "Generate complex CAD from prompts",
    description:
      "Describe a concept in plain language and produce editable, production-ready geometry in seconds.",
    metric: "10x faster ideation",
    tone: "from-sky-500/5 via-indigo-500/2 to-cyan-500/5",
  },
  {
    title: "Collaborate with live model sessions",
    description:
      "Review, annotate, and branch design decisions with teammates in real time, directly in-browser.",
    metric: "0 design handoff lag",
    tone: "from-fuchsia-500/5 via-purple-500/2 to-blue-500/5",
  },
  {
    title: "Automated manufacturability checks",
    description:
      "Run AI-driven tolerance and material checks before export so fabrication issues are caught early.",
    metric: "92% fewer revisions",
    tone: "from-emerald-500/5 via-teal-500/2 to-blue-500/5",
  },
  {
    title: "Secure asset pipeline",
    description:
      "Role-based access, versioned artifacts, and signed exports keep every model traceable and protected.",
    metric: "SOC2-ready workflow",
    tone: "from-violet-500/5 via-indigo-500/2 to-sky-500/5",
  },
];

function FloatingSkeleton({
  className,
  delay,
  label,
}: {
  className: string;
  delay: string;
  label: string;
}) {
  return (
    <div
      className={`floating-card group absolute rounded-2xl border border-white/20 bg-white/5 p-4 backdrop-blur-xl transition-transform duration-300 hover:scale-[1.03] hover:border-cyan-300/40 ${className}`}
      style={{ animationDelay: delay }}
    >
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
        {label}
      </p>
      <div className="mt-3 h-24 rounded-xl border border-white/10 bg-gradient-to-br from-slate-400/20 via-slate-300/5 to-transparent" />
      <div className="mt-3 h-2 w-3/4 rounded bg-white/20" />
      <div className="mt-2 h-2 w-1/2 rounded bg-white/10" />
      <div className="mt-4 flex gap-2">
        <div className="h-8 flex-1 rounded-lg border border-white/10 bg-white/10" />
        <div className="h-8 w-10 rounded-lg border border-white/10 bg-white/10" />
      </div>
    </div>
  );
}

export default async function Home() {
  const session = await getCurrentSession();

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#060816] text-white">
      <div className="pointer-events-none absolute inset-0">
        {/* <div className="hero-orb absolute -top-56 -left-56 h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.45),rgba(79,70,229,0.18)_42%,transparent_75%)] blur-3xl" /> */}
        <div className="hero-wave absolute -right-32 -top-16 h-[34rem] w-[34rem] rounded-full bg-[conic-gradient(from_220deg_at_50%_50%,rgba(14,255,100,0.7),rgba(255,100,246,0.3),rgba(14,165,233,0.7),rgba(255,0,0,1))] opacity-80 blur-2xl" />
      </div>
      <div className="pointer-events-none absolute top-18 bottom-0 left-[max(1rem,calc((100vw-80rem)/2))] z-10 w-px bg-white/20" />
      <div className="pointer-events-none absolute top-18 bottom-0 right-[max(1rem,calc((100vw-80rem)/2))] z-10 w-px bg-white/20" />

      <SiteHeader session={session} />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col px-6 pb-24 pt-32 md:px-10 lg:px-12">
        <section className="grid items-center gap-14 lg:grid-cols-[1.08fr_0.92fr]">
          <div>
            <h1 className="border-l-[4px] border-cyan-300 -ml-12 pl-[44px] pb-1 max-w-[600px] text-5xl leading-[1.06] font-semibold tracking-tight text-balance md:text-[64px]">
              Revamped CAD for the AI era
            </h1>
            <p className="mt-6 max-w-[600px] text-lg leading-relaxed text-slate-300">
              Voxal is the AI-native CAD studio that turns your imagination
              into a 3D asset library. Generate, manage, and edit 3D models all
              in one place.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button
                asChild
                size="lg"
                className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"
              >
                <Link href={session ? "/dashboard" : "/login"}>
                  {session ? "Open dashboard" : "Try Voxal"} <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/20 bg-white/5 text-white hover:bg-white/10"
              >
                <Link href={session ? "/dashboard" : "/login"}>
                  Book product demo
                </Link>
              </Button>
            </div>

            <div className="mt-12 grid grid-cols-2 gap-6 text-sm text-slate-300 sm:grid-cols-3">
              <div>
                <p className="text-2xl font-semibold text-cyan-200">4.8x</p>
                <p className="mt-1">Faster concept-to-prototype cycles</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-cyan-200">99.9%</p>
                <p className="mt-1">Pipeline reliability across teams</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-cyan-200">35k+</p>
                <p className="mt-1">Generated CAD assets in production</p>
              </div>
            </div>
          </div>

          <div
            id="models"
            className="relative mx-auto h-[28rem] w-full max-w-xl"
          >
            {/* <div className="absolute inset-0 rounded-[2rem] border border-white/20 bg-gradient-to-br from-white/20 via-white/5 to-transparent backdrop-blur-xl" />
            <div className="absolute inset-6 rounded-[1.5rem] border border-white/20 bg-[#060816]/80" /> */}

            <FloatingSkeleton
              className="left-6 top-7 w-56"
              delay="0s"
              label="Model Layer A"
            />
            <FloatingSkeleton
              className="right-6 top-16 w-52"
              delay="1.3s"
              label="Material Study"
            />
            <FloatingSkeleton
              className="bottom-8 left-20 w-60"
              delay="2.1s"
              label="Assembly Draft"
            />
          </div>
        </section>

        <section className="mt-14 -mx-6 px-6 py-4 md:-mx-10 md:px-10 lg:-mx-12 lg:px-12 border-y border-white/20">
          <div className="flex justify-center gap-20 text-sm text-slate-300">
            {partners.map((partner) => (
              <div
                key={partner.id}
                className="flex h-20 items-center justify-center rounded-lg"
              >
                <Image
                  src={partner.logoSrc}
                  alt={partner.name}
                  width={140}
                  height={40}
                  className="h-10 w-auto max-w-40 object-contain grayscale brightness-1000 opacity-80"
                />
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="mt-16 space-y-16">
          <h2 className="border-l-[4px] border-cyan-400 -ml-12 pl-[44px] max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
            Flexible modules for every stage of 3D product development.
          </h2>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {features.map((feature) => (
              <Card
                key={feature.title}
                className="relative overflow-hidden bg-transparent border-white/10 py-0 rounded-sm"
              >
                <div className={`pointer-events-none absolute inset-0`} />
                <CardHeader className="relative pt-6">
                  <CardTitle className="text-2xl leading-tight">
                    {feature.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative pb-6">
                  <p className="text-slate-200/90">{feature.description}</p>
                  <div className="mt-6 rounded-xl border border-white/10 bg-slate-900/40 p-4">
                    <div className="h-3 w-2/5 rounded bg-white/20" />
                    <div className="mt-3 h-2 w-full rounded bg-white/10" />
                    <div className="mt-2 h-2 w-11/12 rounded bg-white/10" />
                    <div className="mt-2 h-2 w-9/12 rounded bg-white/10" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
