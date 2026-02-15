import { redirect } from "next/navigation";

export default async function AuthAliasPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const loginUrl = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  redirect(loginUrl);
}
