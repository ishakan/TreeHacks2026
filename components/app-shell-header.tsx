"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, FolderOpen, HelpCircle, Plus, Search, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchProjectResult = {
  id: string;
  name: string;
  description: string | null;
};

type SearchAssetResult = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
};

type SearchResponse = {
  projects: SearchProjectResult[];
  assets: SearchAssetResult[];
};

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

export function AppShellHeader() {
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse>({ projects: [], assets: [] });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      setIsLoading(false);
      setResults({ projects: [], assets: [] });
      return;
    }

    const abortController = new AbortController();

    const runSearch = async () => {
      setIsLoading(true);

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`, {
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error("Failed search");
        }

        const payload = (await response.json()) as SearchResponse;
        setResults({
          projects: payload.projects ?? [],
          assets: payload.assets ?? [],
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setResults({ projects: [], assets: [] });
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    runSearch();

    return () => {
      abortController.abort();
    };
  }, [debouncedQuery]);

  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;
  const hasResults = results.projects.length > 0 || results.assets.length > 0;

  return (
    <header className="bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 z-20 flex h-14 shrink-0 items-center border-b">
      <div className={`transition-all flex w-full items-center gap-2 px-4 ${pathname.startsWith("/studio/") ? "lg:px-4" : "lg:px-8"}`}>
        <div className="relative w-full max-w-md" ref={rootRef}>
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search projects or assets..."
            className="h-8 pl-8"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onFocus={() => {
              setIsOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsOpen(false);
              }
            }}
          />

          {isOpen ? (
            <div className="bg-popover text-popover-foreground border-border absolute top-10 left-0 z-30 w-full rounded-md border shadow-lg">
              {!hasQuery ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">
                  Type at least {MIN_QUERY_LENGTH} characters to search.
                </p>
              ) : isLoading ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">Searching...</p>
              ) : hasResults ? (
                <div className="max-h-80 overflow-y-auto py-1">
                  {results.projects.length > 0 ? (
                    <>
                      <p className="text-muted-foreground px-3 py-1 text-xs font-medium tracking-wide uppercase">
                        Projects
                      </p>
                      {results.projects.map((project) => (
                        <Link
                          key={project.id}
                          href={`/projects/${project.id}`}
                          className="hover:bg-muted flex items-start gap-2 px-3 py-2 text-sm"
                        >
                          <FolderOpen className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{project.name}</span>
                            {project.description ? (
                              <span className="text-muted-foreground block truncate text-xs">
                                {project.description}
                              </span>
                            ) : null}
                          </span>
                        </Link>
                      ))}
                    </>
                  ) : null}

                  {results.assets.length > 0 ? (
                    <>
                      <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium tracking-wide uppercase">
                        Assets
                      </p>
                      {results.assets.map((asset) => (
                        <Link
                          key={asset.id}
                          href={`/assets/${asset.id}`}
                          className="hover:bg-muted flex items-start gap-2 px-3 py-2 text-sm"
                        >
                          <Box className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{asset.title}</span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {asset.fileName}
                            </span>
                          </span>
                        </Link>
                      ))}
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground px-3 py-2 text-sm">No matches found.</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm">
            <HelpCircle className="size-4" />
            Help
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="size-4" />
            Settings
          </Button>
          <Button size="sm" asChild>
            <Link href="/projects">
              <Plus className="size-4" />
              New project
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
