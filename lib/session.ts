import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

const getCurrentSessionCached = cache(async () => {
  return auth.api.getSession({
    headers: await headers(),
  });
});

export async function getCurrentSession() {
  return getCurrentSessionCached();
}

export async function requireSession() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}
