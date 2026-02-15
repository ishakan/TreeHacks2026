"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AiOutlineAntDesign } from "react-icons/ai";
import { ArrowRight, TreePine } from "lucide-react";
import Image from "next/image";

export default function SiteHeader({ session }: { session: any }) {
  const [scrolled, setScrolled] = useState(false);
  const ticking = useRef(false);

  useEffect(() => {
    const handle = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          setScrolled(window.scrollY > 1);
          ticking.current = false;
        });
        ticking.current = true;
      }
    };

    handle();
    window.addEventListener("scroll", handle, { passive: true });
    return () => window.removeEventListener("scroll", handle);
  }, []);

  const base = "fixed inset-x-0 top-0 z-50 transition-colors duration-200";
  const scrolledClasses = "bg-[#060816]/85 backdrop-blur-xl shadow-sm";
  const unscrolledClasses = "bg-transparent";

  return (
    <header className={base}>
      {/* <div className="w-full bg-cyan-50 h-9 flex items-center justify-center">
        <Link
          href="/signup"
          className="hover:opacity-80 text-center text-sm text-slate-950 font-medium tracking-tight"
        >
          <TreePine className="inline-block size-4 mr-1 mb-0.5"/>
          TreeHacks: Voxal is now generally available on all desktops{" "}
          <ArrowRight className="inline size-4 mb-0.5" strokeWidth={2} />
        </Link>
      </div> */}
      <div
        className={`${scrolled ? scrolledClasses : unscrolledClasses} h-18 border-b border-white/20 transition-colors duration-200`}
      >
        <div className="mx-auto h-full w-full max-w-[1384px] px-6 md:px-10 lg:px-12">
          <div className="grid h-full grid-cols-[1fr_auto_1fr] px-1">
            <nav className="hidden items-center gap-7 text-sm text-slate-100 md:flex">
              <Link href="#features" className="transition hover:text-white">
                Features
              </Link>
              <Link href="#platform" className="transition hover:text-white">
                Platform
              </Link>
              <Link href="#models" className="transition hover:text-white">
                Models
              </Link>
              <Link href="#pricing" className="transition hover:text-white">
                Pricing
              </Link>
            </nav>

            <Link
              href="/"
              className="hover:opacity-80 text-2xl font-semibold text-white flex items-center gap-1"
            >
              <Image src="/voxalLogoTransparent.png" alt="Logo" width={32} height={32} />
              Voxal
            </Link>

            <div className="flex items-center justify-end gap-2">
              {session ? (
                <Button asChild variant="outline">
                  <Link href="/dashboard">
                    Open dashboard <ArrowRight />
                  </Link>
                </Button>
              ) : (
                <>
                  <Button
                    asChild
                    variant="ghost"
                    className="text-slate-100 hover:bg-white/10"
                  >
                    <Link href="/login">Log in</Link>
                  </Button>
                  <Button
                    asChild
                    className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"
                  >
                    <Link href="/signup">
                      Start free <ArrowRight />
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
